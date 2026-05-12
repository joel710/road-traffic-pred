import os
import json
import torch
import torch.nn as nn
from pyspark.sql import SparkSession
from pyspark.sql.functions import udf, col, from_json
from pyspark.sql.types import StructType, StructField, StringType, IntegerType, FloatType
import redis

# Configuration
REDIS_HOST = os.getenv("REDIS_HOST", "localhost")
MODEL_PATH = "models/global_model.pt"

# --- Définition du Modèle LSTM (doit matcher l'original) ---
class TrafficLSTM(nn.Module):
    def __init__(self, input_size=9, hidden_size=128, num_layers=2):
        super(TrafficLSTM, self).__init__()
        self.lstm = nn.LSTM(input_size, hidden_size, num_layers, batch_first=True, dropout=0.3)
        self.bn = nn.BatchNorm1d(hidden_size)
        self.fc = nn.Linear(hidden_size, 1)

    def forward(self, x):
        # x: [batch, seq_len, features]
        out, _ = self.lstm(x)
        out = out[:, -1, :] # On prend le dernier step
        out = self.bn(out)
        out = self.fc(out)
        return out

# Chargement du modèle
device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
model = TrafficLSTM()
try:
    model.load_state_dict(torch.load(MODEL_PATH, map_location=device))
    model.eval()
    print("✅ Modèle chargé avec succès.")
except Exception as e:
    print(f"❌ Erreur chargement modèle: {e}")

# Spark Session
spark = SparkSession.builder \
    .appName("TrafficPredictionStreaming") \
    .getOrCreate()

# Schéma des données entrantes
schema = StructType([
    StructField("DateTime", StringType(), True),
    StructField("Junction", IntegerType(), True),
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

# Connexion Redis pour le sink
r = redis.Redis(host=REDIS_HOST, port=6379, db=0)

def predict_and_store(batch_df, batch_id):
    """
    Fonction appelée pour chaque micro-batch Spark.
    """
    rows = batch_df.collect()
    for row in rows:
        # Préparation des features (9 variables)
        features = torch.tensor([[
            row.hour_sin, row.hour_cos, row.dayofweek, row.month, row.is_weekend,
            row.veh_lag_1, row.veh_lag_2, row.veh_lag_3, row.veh_lag_24
        ]], dtype=torch.float32).unsqueeze(1) # [batch=1, seq_len=1, features=9]
        
        with torch.no_grad():
            prediction = model(features).item()
        
        result = {
            "DateTime": row.DateTime,
            "Junction": row.Junction,
            "PredictedVehicles": round(prediction, 2),
            "Status": "fluid" if prediction < 30 else "moderate" if prediction < 60 else "congested"
        }
        
        # Envoi vers Redis
        r.set(f"junction:{row.Junction}:status", json.dumps(result))
        r.publish("traffic_updates", json.dumps(result))
        print(f"🔮 Prediction Junction {row.Junction}: {result['Status']} ({result['PredictedVehicles']})")

# Lecture du flux (ici on simulerait une lecture Redis ou Kafka)
# Pour la démo, on utilise une source 'rate' ou on lit un dossier
# Dans l'archi réelle, on utiliserait le connecteur Kafka.
df = spark.readStream \
    .format("kafka") \
    .option("kafka.bootstrap.servers", os.getenv("KAFKA_HOST", "localhost:9092")) \
    .option("subscribe", "traffic_stream") \
    .load()

# Transformation JSON
json_df = df.selectExpr("CAST(value AS STRING)") \
    .select(from_json(col("value"), schema).alias("data")) \
    .select("data.*")

# Application de la prédiction par batch
query = json_df.writeStream \
    .foreachBatch(predict_and_store) \
    .start()

query.awaitTermination()
