"""
Spark Structured Streaming job: Kafka → GNN inference → Kafka.

Consumes traffic data from Kafka with pre-computed features,
runs TrafficGNN inference (4 junctions, 24-step windows),
and publishes predictions to the output topic.

Features (ALL raw — no standardisation, pre-computed in source data):
  hour_sin, hour_cos, dow_sin, dow_cos, month_sin, month_cos,
  is_weekend,
  veh_lag_1, veh_lag_2, veh_lag_3, veh_lag_24,
  veh_ma_6, veh_ma_24,
  veh_diff_1
"""

import os
import sys
import time
import json
import torch
import numpy as np
from collections import deque, defaultdict
from pathlib import Path
from pyspark.sql import SparkSession
from pyspark.sql.functions import col, from_json
from pyspark.sql.types import (
    StructType, StructField, StringType, IntegerType, FloatType,
)
from kafka import KafkaProducer
from kafka.errors import NoBrokersAvailable
from datetime import datetime, timezone

from traffic_gnn import TrafficGNN

# ─── Config ───────────────────────────────────────────────────────
KAFKA_HOST = os.getenv("KAFKA_HOST", "localhost")
KAFKA_PORT = int(os.getenv("KAFKA_PORT", "9092"))
KAFKA_USERNAME = os.getenv("KAFKA_USERNAME", "")
KAFKA_PASSWORD = os.getenv("KAFKA_PASSWORD", "")
KAFKA_SSL_CA = os.getenv("KAFKA_SSL_CA", "")
KAFKA_SSL_CERT = os.getenv("KAFKA_SSL_CERT", "")
KAFKA_SSL_KEY = os.getenv("KAFKA_SSL_KEY", "")
TOPIC_INPUT = os.getenv("KAFKA_TOPIC_INPUT", "flux_data")
TOPIC_OUTPUT = os.getenv("KAFKA_TOPIC_OUTPUT", "traffic_predictions")
MODEL_PATH = os.getenv("MODEL_PATH", "models/gnn_model.pth")
BOOTSTRAP_SERVER = f"{KAFKA_HOST}:{KAFKA_PORT}"

NUM_NODES = 4
SEQ_LEN = 24
NUM_FEATURES = 14

FEATURE_COLS = [
    "hour_sin", "hour_cos",
    "dow_sin", "dow_cos",
    "month_sin", "month_cos",
    "is_weekend",
    "veh_lag_1", "veh_lag_2", "veh_lag_3", "veh_lag_24",
    "veh_ma_6", "veh_ma_24",
    "veh_diff_1",
]

# ─── State ────────────────────────────────────────────────────────
feat_window: dict[int, deque] = defaultdict(lambda: deque(maxlen=SEQ_LEN))
latest_row: dict[int, dict] = {}


def build_kafka_producer() -> KafkaProducer:
    opts = {
        "bootstrap_servers": [BOOTSTRAP_SERVER],
        "value_serializer": lambda x: json.dumps(x).encode("utf-8"),
        "acks": "all",
        "retries": 5,
    }
    if KAFKA_SSL_CA and KAFKA_SSL_CERT and KAFKA_SSL_KEY \
       and Path(KAFKA_SSL_CA).exists() and Path(KAFKA_SSL_CERT).exists() and Path(KAFKA_SSL_KEY).exists():
        opts.update(security_protocol="SSL", ssl_cafile=KAFKA_SSL_CA,
                    ssl_certfile=KAFKA_SSL_CERT, ssl_keyfile=KAFKA_SSL_KEY)
    elif KAFKA_USERNAME and KAFKA_PASSWORD:
        opts.update(security_protocol="SASL_SSL", sasl_mechanism="PLAIN",
                    sasl_plain_username=KAFKA_USERNAME, sasl_plain_password=KAFKA_PASSWORD)
        if KAFKA_SSL_CA and Path(KAFKA_SSL_CA).exists():
            opts["ssl_cafile"] = KAFKA_SSL_CA
    return KafkaProducer(**opts)


# ─── Model ────────────────────────────────────────────────────────
device = torch.device("cpu")
model = TrafficGNN(num_nodes=NUM_NODES, in_features=NUM_FEATURES)
try:
    model.load_pretrained(MODEL_PATH, map_location=device)
except Exception as e:
    print(f"❌ Error loading GNN model: {e}")
    sys.exit(1)


FEATURE_COLS_SET = set(FEATURE_COLS)


def extract_14_features(row_dict: dict) -> np.ndarray:
    """Extract the 14 pre-computed feature values from a row dict."""
    return np.array([float(row_dict.get(c, 0)) for c in FEATURE_COLS], dtype=np.float32)


@torch.no_grad()
def predict_all_junctions() -> dict[int, float] | None:
    """Run GNN on all 4 junctions. Returns {jid: pred} or None if warming up."""
    for j in range(1, NUM_NODES + 1):
        if len(feat_window[j]) < SEQ_LEN:
            return None

    sequences = np.stack([
        np.array(list(feat_window[j])) for j in range(1, NUM_NODES + 1)
    ], axis=0)  # (4, 24, 14)

    x = torch.tensor(sequences, dtype=torch.float32).unsqueeze(0)  # (1, 4, 24, 14)
    out = model(x).squeeze(0)  # (4, 1)

    return {
        jid: max(0.0, round(float(out[i, 0]), 2))
        for i, jid in enumerate(range(1, NUM_NODES + 1))
    }


# ─── Spark ────────────────────────────────────────────────────────
spark = SparkSession.builder \
    .appName("TrafficGNNStreaming") \
    .master("local[*]") \
    .getOrCreate()
spark.sparkContext.setLogLevel("WARN")

# Schema matching the refined dataset (all columns in test_gnn.csv)
input_schema = StructType([
    StructField("DateTime", StringType(), True),
    StructField("Junction", IntegerType(), True),
    StructField("Vehicles", IntegerType(), True),
    StructField("ID", IntegerType(), True),
    StructField("is_weekend", IntegerType(), True),
    StructField("hour", IntegerType(), True),
    StructField("dayofweek", IntegerType(), True),
    StructField("month", IntegerType(), True),
    StructField("hour_sin", FloatType(), True),
    StructField("hour_cos", FloatType(), True),
    StructField("dow_sin", FloatType(), True),
    StructField("dow_cos", FloatType(), True),
    StructField("month_sin", FloatType(), True),
    StructField("month_cos", FloatType(), True),
    StructField("veh_lag_1", FloatType(), True),
    StructField("veh_lag_2", FloatType(), True),
    StructField("veh_lag_3", FloatType(), True),
    StructField("veh_lag_24", FloatType(), True),
    StructField("veh_ma_6", FloatType(), True),
    StructField("veh_ma_24", FloatType(), True),
    StructField("veh_diff_1", FloatType(), True),
])


# ─── Kafka Producer ───────────────────────────────────────────────
print(f"📤 Connecting output producer to {BOOTSTRAP_SERVER} …")


def wait_for_kafka(retries=30, delay=2):
    for attempt in range(retries):
        try:
            p = build_kafka_producer()
            p.close(timeout=5)
            print("✅ Kafka broker reachable")
            return True
        except NoBrokersAvailable:
            print(f"⏳ Waiting for Kafka... ({attempt + 1}/{retries})")
            time.sleep(delay)
        except Exception as e:
            print(f"⏳ Kafka not ready: {e} ({attempt + 1}/{retries})")
            time.sleep(delay)
    print("❌ Kafka broker not available")
    return False


if not wait_for_kafka():
    print("❌ Exiting: Kafka is required.")
    sys.exit(1)

output_producer = build_kafka_producer()


# ─── Streaming inference ─────────────────────────────────────────
def process_microbatch(batch_df, batch_id):
    """Consume a Spark micro-batch, update GNN windows, publish predictions."""
    global latest_row

    rows = batch_df.collect()
    if not rows:
        return

    for row in rows:
        j = int(row["Junction"])
        if j < 1 or j > NUM_NODES:
            continue

        # Build raw dict from all columns
        d = {fn: row[fn] for fn in row.__fields__}
        d["DateTime"] = str(d["DateTime"])
        latest_row[j] = d

        # Extract pre-computed 14-feature vector
        feat_window[j].append(extract_14_features(d))

    all_preds = predict_all_junctions()
    if all_preds is None:
        return

    published = 0
    sample_log = None

    for jid, pred_val in all_preds.items():
        raw = latest_row.get(jid, {})
        real_vehicles = int(raw.get("Vehicles", 0))
        status = "fluid" if pred_val < 30 else "moderate" if pred_val < 60 else "congested"

        result = {
            "DateTime": raw.get("DateTime", datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")),
            "Junction": jid,
            "Vehicles": real_vehicles,
            "PredictedVehicles": pred_val,
            "Status": status,
            "Timestamp": datetime.now(timezone.utc).isoformat(),
        }
        try:
            output_producer.send(TOPIC_OUTPUT, value=result)
            published += 1
            if sample_log is None:
                sample_log = f"   Sample: J{jid} | Actual={real_vehicles} veh | Pred={pred_val} veh | Status={status}"
        except Exception as e:
            print(f"⚠️ Failed to publish prediction: {e}")

    if published > 0:
        print(f"🔮 Published {published} predictions to topic '{TOPIC_OUTPUT}'.")
        if sample_log:
            print(sample_log)


# ─── Kafka Stream ─────────────────────────────────────────────────
print(f"📥 Reading from Kafka topic '{TOPIC_INPUT}' at {BOOTSTRAP_SERVER} …")

kafka_read_opts = {
    "kafka.bootstrap.servers": BOOTSTRAP_SERVER,
    "subscribe": TOPIC_INPUT,
    "startingOffsets": "latest",
    "failOnDataLoss": "false",
}

if KAFKA_SSL_CA and KAFKA_SSL_CERT and KAFKA_SSL_KEY \
   and Path(KAFKA_SSL_CA).exists() and Path(KAFKA_SSL_CERT).exists() and Path(KAFKA_SSL_KEY).exists():
    _combined = Path("/tmp/kafka_keystore_combined.pem")
    _combined.write_text(Path(KAFKA_SSL_KEY).read_text() + Path(KAFKA_SSL_CERT).read_text())
    kafka_read_opts.update(kafka_security_protocol="SSL",
                           kafka_ssl_truststore_location=KAFKA_SSL_CA,
                           kafka_ssl_truststore_type="PEM",
                           kafka_ssl_keystore_location=str(_combined),
                           kafka_ssl_keystore_type="PEM")
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
    .foreachBatch(process_microbatch) \
    .start()

print("🚀 Spark Streaming (GNN) — Kafka → GNN → Kafka")
query.awaitTermination()
