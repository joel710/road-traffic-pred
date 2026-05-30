import os
import json
import torch
import torch.nn as nn
import numpy as np
import joblib
from collections import deque, defaultdict
from pathlib import Path
from pyspark.sql import SparkSession
from pyspark.sql.functions import col, from_json, to_json, struct
from pyspark.sql.types import StructType, StructField, StringType, IntegerType, FloatType
from kafka import KafkaProducer
from datetime import datetime, timezone

# ─── Aiven Kafka Configuration ───────────────────────────────────
KAFKA_HOST = os.getenv("KAFKA_HOST", "localhost")
KAFKA_PORT = int(os.getenv("KAFKA_PORT", "9092"))
KAFKA_USERNAME = os.getenv("KAFKA_USERNAME", "")
KAFKA_PASSWORD = os.getenv("KAFKA_PASSWORD", "")
KAFKA_SSL_CA = os.getenv("KAFKA_SSL_CA", "")
KAFKA_SSL_CERT = os.getenv("KAFKA_SSL_CERT", "")
KAFKA_SSL_KEY = os.getenv("KAFKA_SSL_KEY", "")
TOPIC_INPUT = os.getenv("KAFKA_TOPIC_INPUT", "traffic_stream")
TOPIC_OUTPUT = os.getenv("KAFKA_TOPIC_OUTPUT", "traffic_predictions")
MODEL_PATH = os.getenv("MODEL_PATH", "models/global_model.pt")
BOOTSTRAP_SERVER = f"{KAFKA_HOST}:{KAFKA_PORT}"


def build_kafka_producer() -> KafkaProducer:
    """KafkaProducer with SSL client certs (Aiven mTLS) or plaintext fallback."""
    opts = {
        "bootstrap_servers": [BOOTSTRAP_SERVER],
        "value_serializer": lambda x: json.dumps(x).encode("utf-8"),
        "acks": "all",
        "retries": 5,
    }
    # Prefer SSL with client certificates (Aiven mTLS)
    if KAFKA_SSL_CA and KAFKA_SSL_CERT and KAFKA_SSL_KEY \
       and Path(KAFKA_SSL_CA).exists() and Path(KAFKA_SSL_CERT).exists() and Path(KAFKA_SSL_KEY).exists():
        opts.update(
            security_protocol="SSL",
            ssl_cafile=KAFKA_SSL_CA,
            ssl_certfile=KAFKA_SSL_CERT,
            ssl_keyfile=KAFKA_SSL_KEY,
        )
    # Fallback to SASL_SSL if only username/password are provided
    elif KAFKA_USERNAME and KAFKA_PASSWORD:
        opts.update(
            security_protocol="SASL_SSL",
            sasl_mechanism="PLAIN",
            sasl_plain_username=KAFKA_USERNAME,
            sasl_plain_password=KAFKA_PASSWORD,
        )
        if KAFKA_SSL_CA and Path(KAFKA_SSL_CA).exists():
            opts["ssl_cafile"] = KAFKA_SSL_CA
    return KafkaProducer(**opts)


# ─── LSTM Model Definition ───────────────────────────────────────
class TrafficLSTM(nn.Module):
    def __init__(self, input_size=9, hidden_size=128, num_layers=2):
        super().__init__()
        self.lstm = nn.LSTM(input_size, hidden_size, num_layers, batch_first=True, dropout=0.3)
        self.batch_norm = nn.BatchNorm1d(hidden_size)
        self.fc = nn.Sequential(
            nn.Linear(hidden_size, 64),
            nn.ReLU(),
            nn.Dropout(0.2),
            nn.Linear(64, 1)
        )

    def forward(self, x):
        out, _ = self.lstm(x)
        out = out[:, -1, :]
        out = self.batch_norm(out)
        out = self.fc(out)
        return out


device = torch.device("cpu")
model = TrafficLSTM()
try:
    model.load_state_dict(torch.load(MODEL_PATH, map_location=device))
    model.eval()
    print("✅ PyTorch LSTM model loaded.")
except Exception as e:
    print(f"❌ Error loading model: {e}")

# ─── Load Scalers (fitted on training data) ────────────────────────
SCALER_X_PATH = os.getenv("SCALER_X_PATH", "models/scaler_x.pkl")
SCALER_Y_PATH = os.getenv("SCALER_Y_PATH", "models/scaler_y.pkl")
try:
    scaler_x = joblib.load(SCALER_X_PATH)
    scaler_y = joblib.load(SCALER_Y_PATH)
    print(f"✅ Scalers loaded (y: mean={scaler_y.mean_[0]:.1f}, scale={scaler_y.scale_[0]:.1f})")
except Exception as e:
    print(f"❌ Error loading scalers: {e}")
    scaler_x = None
    scaler_y = None

# ─── Per-junction sliding window buffer (24 time steps) ─────────────
FEATURE_COLS = [
    "hour_sin", "hour_cos", "dayofweek", "month", "is_weekend",
    "veh_lag_1", "veh_lag_2", "veh_lag_3", "veh_lag_24",
]
SEQ_LEN = 24
junction_buffer: dict[int, deque] = defaultdict(lambda: deque(maxlen=SEQ_LEN))

# ─── Spark Session (local[*]) ────────────────────────────────────
spark = SparkSession.builder \
    .appName("TrafficPredictionStreaming") \
    .master("local[*]") \
    .getOrCreate()

spark.sparkContext.setLogLevel("WARN")

# Input schema (matches simulator CSV payload)
input_schema = StructType([
    StructField("DateTime", StringType(), True),
    StructField("Junction", IntegerType(), True),
    StructField("Vehicles", IntegerType(), True),
    StructField("hour_sin", FloatType(), True),
    StructField("hour_cos", FloatType(), True),
    StructField("dayofweek", IntegerType(), True),
    StructField("month", IntegerType(), True),
    StructField("is_weekend", IntegerType(), True),
    StructField("veh_lag_1", FloatType(), True),
    StructField("veh_lag_2", FloatType(), True),
    StructField("veh_lag_3", FloatType(), True),
    StructField("veh_lag_24", FloatType(), True),
])

# ─── Kafka Producer for Output ───────────────────────────────────
print(f"📤 Connecting output producer to {BOOTSTRAP_SERVER} …")
output_producer = build_kafka_producer()


def predict_and_publish(batch_df, batch_id):
    """Stateful LSTM inference with 24-step sequences and scaler normalization."""
    row_count = batch_df.count()
    if row_count == 0:
        return

    pdf = batch_df.toPandas()
    pdf[FEATURE_COLS] = pdf[FEATURE_COLS].fillna(0.0)
    pdf["Vehicles"] = pdf["Vehicles"].fillna(0)

    # Sort by DateTime to maintain temporal order per junction
    pdf = pdf.sort_values("DateTime")

    published = 0
    sample_log = None

    for _, row in pdf.iterrows():
        junction = int(row["Junction"])
        vehicles = int(row["Vehicles"])

        # Append features to this junction's sliding window
        features_raw = np.array([float(row[c]) for c in FEATURE_COLS], dtype=np.float32)
        junction_buffer[junction].append(features_raw)

        if len(junction_buffer[junction]) < SEQ_LEN:
            continue  # Not enough history yet

        # Build sequence (24, 9) → normalize → predict → denormalize
        seq_raw = np.array(list(junction_buffer[junction]))  # (24, 9)
        if scaler_x is not None:
            seq_scaled = scaler_x.transform(seq_raw)
        else:
            seq_scaled = seq_raw

        seq_tensor = torch.tensor(seq_scaled, dtype=torch.float32).unsqueeze(0)  # (1, 24, 9)

        with torch.no_grad():
            pred_scaled = model(seq_tensor).item()

        if scaler_y is not None:
            pred_val = max(0.0, round(float(scaler_y.inverse_transform([[pred_scaled]])[0, 0]), 2))
        else:
            pred_val = max(0.0, round(float(pred_scaled), 2))

        status = "fluid" if pred_val < 30 else "moderate" if pred_val < 60 else "congested"

        result = {
            "DateTime": str(row["DateTime"]),
            "Junction": junction,
            "Vehicles": vehicles,
            "PredictedVehicles": pred_val,
            "Status": status,
            "Timestamp": datetime.now(timezone.utc).isoformat(),
        }

        try:
            output_producer.send(TOPIC_OUTPUT, value=result)
            published += 1
            if sample_log is None:
                sample_log = f"   Sample: J{junction} | Actual={vehicles} veh | Pred={pred_val} veh | Status={status}"
        except Exception as e:
            print(f"⚠️ Failed to publish prediction to Kafka: {e}")

    if published > 0:
        print(f"🔮 Published {published} predictions to topic '{TOPIC_OUTPUT}'.")
        if sample_log:
            print(sample_log)


# ─── Kafka Input Stream ──────────────────────────────────────────
print(f"📥 Reading from Kafka topic '{TOPIC_INPUT}' at {BOOTSTRAP_SERVER} …")

kafka_read_opts = {
    "kafka.bootstrap.servers": BOOTSTRAP_SERVER,
    "subscribe": TOPIC_INPUT,
    "startingOffsets": "latest",
    "failOnDataLoss": "false",
}

# Add SSL config for Aiven if needed
# Prefer SSL with client certificates (Aiven mTLS, PEM-based)
if KAFKA_SSL_CA and KAFKA_SSL_CERT and KAFKA_SSL_KEY \
   and Path(KAFKA_SSL_CA).exists() and Path(KAFKA_SSL_CERT).exists() and Path(KAFKA_SSL_KEY).exists():
    # Java Kafka client expects private key in the keystore PEM file.
    # Combine key + cert into a single PEM so the JVM can load both.
    _combined_keystore = Path("/tmp/kafka_keystore_combined.pem")
    _combined_keystore.write_text(
        Path(KAFKA_SSL_KEY).read_text() + Path(KAFKA_SSL_CERT).read_text()
    )
    kafka_read_opts["kafka.security.protocol"] = "SSL"
    kafka_read_opts["kafka.ssl.truststore.location"] = KAFKA_SSL_CA
    kafka_read_opts["kafka.ssl.truststore.type"] = "PEM"
    kafka_read_opts["kafka.ssl.keystore.location"] = str(_combined_keystore)
    kafka_read_opts["kafka.ssl.keystore.type"] = "PEM"
# Fallback to SASL_SSL if only username/password are provided
elif KAFKA_USERNAME and KAFKA_PASSWORD:
    kafka_read_opts["kafka.security.protocol"] = "SASL_SSL"
    kafka_read_opts["kafka.sasl.mechanism"] = "PLAIN"
    kafka_read_opts["kafka.sasl.jaas.config"] = (
        f'org.apache.kafka.common.security.plain.PlainLoginModule required '
        f'username="{KAFKA_USERNAME}" password="{KAFKA_PASSWORD}";'
    )
    if KAFKA_SSL_CA and Path(KAFKA_SSL_CA).exists():
        kafka_read_opts["kafka.ssl.truststore.location"] = KAFKA_SSL_CA

df = spark.readStream \
    .format("kafka") \
    .options(**kafka_read_opts) \
    .load()

json_df = df.selectExpr("CAST(value AS STRING)") \
    .select(from_json(col("value"), input_schema).alias("data")) \
    .select("data.*")

query = json_df.writeStream \
    .foreachBatch(predict_and_publish) \
    .start()

print("🚀 Spark Streaming Job is running (Kafka → LSTM → Kafka) …")
query.awaitTermination()
