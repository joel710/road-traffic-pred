import os
import json
import torch
import torch.nn as nn
from pathlib import Path
from pyspark.sql import SparkSession
from pyspark.sql.functions import col, from_json, to_json, struct
from pyspark.sql.types import StructType, StructField, StringType, IntegerType, FloatType
from kafka import KafkaProducer
from datetime import datetime

# ─── Aiven Kafka Configuration ───────────────────────────────────
KAFKA_HOST = os.getenv("KAFKA_HOST", "localhost")
KAFKA_PORT = int(os.getenv("KAFKA_PORT", "9092"))
KAFKA_USERNAME = os.getenv("KAFKA_USERNAME", "")
KAFKA_PASSWORD = os.getenv("KAFKA_PASSWORD", "")
KAFKA_SSL_CA = os.getenv("KAFKA_SSL_CA", "")
TOPIC_INPUT = os.getenv("KAFKA_TOPIC_INPUT", "traffic_stream")
TOPIC_OUTPUT = os.getenv("KAFKA_TOPIC_OUTPUT", "traffic_predictions")
MODEL_PATH = os.getenv("MODEL_PATH", "models/global_model.pt")
BOOTSTRAP_SERVER = f"{KAFKA_HOST}:{KAFKA_PORT}"


def build_kafka_producer() -> KafkaProducer:
    """KafkaProducer with SASL_SSL (Aiven) or plaintext fallback."""
    opts = {
        "bootstrap_servers": [BOOTSTRAP_SERVER],
        "value_serializer": lambda x: json.dumps(x).encode("utf-8"),
        "acks": "all",
        "retries": 5,
    }
    if KAFKA_USERNAME and KAFKA_PASSWORD:
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
        self.bn = nn.BatchNorm1d(hidden_size)
        self.fc = nn.Linear(hidden_size, 1)

    def forward(self, x):
        out, _ = self.lstm(x)
        out = out[:, -1, :]
        out = self.bn(out)
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
    """
    Vectorised LSTM inference → publish predictions to output Kafka topic.
    No Redis, no PostgreSQL – pure Kafka pipeline.
    """
    row_count = batch_df.count()
    if row_count == 0:
        return

    print(f"⚡ Processing micro-batch {batch_id} ({row_count} rows) …")
    pdf = batch_df.toPandas()

    feature_cols = [
        "hour_sin", "hour_cos", "dayofweek", "month", "is_weekend",
        "veh_lag_1", "veh_lag_2", "veh_lag_3", "veh_lag_24",
    ]
    pdf[feature_cols] = pdf[feature_cols].fillna(15.0)
    pdf["Vehicles"] = pdf["Vehicles"].fillna(15)

    features_array = pdf[feature_cols].values
    features_tensor = torch.tensor(features_array, dtype=torch.float32).unsqueeze(1)

    with torch.no_grad():
        predictions = model(features_tensor).squeeze(-1).numpy()

    # Publish each prediction to Kafka output topic
    for idx, row in pdf.iterrows():
        pred_val = max(0.0, round(float(predictions[idx]), 2))
        status = "fluid" if pred_val < 30 else "moderate" if pred_val < 60 else "congested"

        result = {
            "DateTime": str(row["DateTime"]),
            "Junction": int(row["Junction"]),
            "Vehicles": int(row["Vehicles"]),
            "PredictedVehicles": pred_val,
            "Status": status,
            "Timestamp": datetime.utcnow().isoformat(),
        }

        try:
            output_producer.send(TOPIC_OUTPUT, value=result)
        except Exception as e:
            print(f"⚠️ Failed to publish prediction to Kafka: {e}")

    print(f"🔮 Published {len(pdf)} predictions to topic '{TOPIC_OUTPUT}'.")


# ─── Kafka Input Stream ──────────────────────────────────────────
print(f"📥 Reading from Kafka topic '{TOPIC_INPUT}' at {BOOTSTRAP_SERVER} …")

kafka_read_opts = {
    "kafka.bootstrap.servers": BOOTSTRAP_SERVER,
    "subscribe": TOPIC_INPUT,
    "startingOffsets": "latest",
    "failOnDataLoss": "false",
}

# Add SSL config for Aiven if needed
if KAFKA_USERNAME and KAFKA_PASSWORD:
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
