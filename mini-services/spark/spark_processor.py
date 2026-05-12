import os
import sys
import json
import torch
import torch.nn as nn
import pandas as pd
import numpy as np
from pyspark.sql import SparkSession
from pyspark.sql.functions import col, from_json, struct, timestamp_seconds, to_timestamp
from pyspark.sql.types import StructType, StructField, StringType, IntegerType, FloatType, DoubleType, TimestampType, ArrayType
import redis
import psycopg2

# Configuration
KAFKA_HOST = os.getenv("KAFKA_HOST", "kafka:29092")
REDIS_HOST = os.getenv("REDIS_HOST", "redis")
REDIS_PORT = int(os.getenv("REDIS_PORT", 6379))
POSTGRES_DB = os.getenv("POSTGRES_DB", "traffic_db")
POSTGRES_USER = os.getenv("POSTGRES_USER", "user")
POSTGRES_PASSWORD = os.getenv("POSTGRES_PASSWORD", "password")
POSTGRES_HOST = os.getenv("POSTGRES_HOST", "db")

# Schema for incoming Kafka messages
schema = StructType([
    StructField("DateTime", StringType()),
    StructField("Junction", IntegerType()),
    StructField("Vehicles", IntegerType()),
    StructField("ID", DoubleType()),
    StructField("hour", IntegerType()),
    StructField("dayofweek", IntegerType()),
    StructField("month", IntegerType()),
    StructField("is_weekend", IntegerType()),
    StructField("hour_sin", DoubleType()),
    StructField("hour_cos", DoubleType())
])

class TrafficLSTM(nn.Module):
    def __init__(self, input_size=10, hidden_size=64, num_layers=2):
        super(TrafficLSTM, self).__init__()
        self.lstm = nn.LSTM(input_size, hidden_size, num_layers, batch_first=True)
        self.fc = nn.Linear(hidden_size, 1)

    def forward(self, x):
        out, _ = self.lstm(x)
        out = self.fc(out[:, -1, :])
        return out

model = None
def load_model():
    global model
    if model is None:
        model = TrafficLSTM(input_size=10)
        model_path = "/app/models/global_model.pt"
        if os.path.exists(model_path):
            model.load_state_dict(torch.load(model_path, map_location=torch.device('cpu')))
        model.eval()
    return model

def update_traffic_state(key, pdf, state):
    junction_id = key[0]

    if state.exists:
        # state.get() returns a tuple based on stateStructType
        lags = state.get[0]
    else:
        lags = [0.0] * 24

    results = []
    m = load_model()

    pdf = pdf.sort_values("DateTime")

    for _, row in pdf.iterrows():
        current_features = [
            row['hour'], row['dayofweek'], row['month'], row['is_weekend'],
            row['hour_sin'], row['hour_cos'],
            lags[0], lags[1], lags[2], lags[23]
        ]

        X = torch.tensor([current_features], dtype=torch.float32).unsqueeze(1)
        with torch.no_grad():
            prediction = m(X).item()

        new_vehicles = float(row['Vehicles'])
        lags = [new_vehicles] + lags[:-1]

        res = row.to_dict()
        res['prediction'] = prediction
        results.append(res)

    state.update((lags,))
    return pd.DataFrame(results)

def sink_to_redis_and_postgres(partition_iterator):
    r = redis.Redis(host=REDIS_HOST, port=REDIS_PORT)
    conn = psycopg2.connect(
        dbname=POSTGRES_DB,
        user=POSTGRES_USER,
        password=POSTGRES_PASSWORD,
        host=POSTGRES_HOST
    )
    cur = conn.cursor()

    for row in partition_iterator:
        data = row.asDict()
        junction_id = data['Junction']
        prediction = float(data['prediction'])

        status_key = f"junction:{junction_id}:status"
        r.set(status_key, json.dumps(data, default=str))
        r.publish("traffic_updates", json.dumps(data, default=str))

        cur.execute(
            "INSERT INTO predictions (timestamp, junction_id, actual_vehicles, predicted_vehicles) VALUES (%s, %s, %s, %s)",
            (data['DateTime'], junction_id, data['Vehicles'], prediction)
        )

    conn.commit()
    cur.close()
    conn.close()

def main():
    spark = SparkSession.builder \
        .appName("TrafficPredictionStreaming") \
        .getOrCreate()

    df = spark.readStream \
        .format("kafka") \
        .option("kafka.bootstrap.servers", KAFKA_HOST) \
        .option("subscribe", "traffic_data") \
        .option("startingOffsets", "latest") \
        .load()

    traffic_df = df.selectExpr("CAST(value AS STRING)") \
        .select(from_json(col("value"), schema).alias("data")) \
        .select("data.*") \
        .withColumn("DateTime", to_timestamp(col("DateTime")))

    output_schema = StructType([f if f.name != "DateTime" else StructField("DateTime", TimestampType()) for f in schema.fields] + [StructField("prediction", FloatType())])
    state_schema = StructType([StructField("lags", ArrayType(DoubleType()))])

    prediction_df = traffic_df \
        .groupBy("Junction") \
        .applyInPandasWithState(
            update_traffic_state,
            outputStructType=output_schema,
            stateStructType=state_schema,
            outputMode="append",
            timeoutConf="NoTimeout"
        )

    query = prediction_df.writeStream \
        .foreachBatch(lambda batch_df, batch_id: batch_df.foreachPartition(sink_to_redis_and_postgres)) \
        .option("checkpointLocation", "/tmp/spark-checkpoints") \
        .start()

    query.awaitTermination()

if __name__ == "__main__":
    main()
