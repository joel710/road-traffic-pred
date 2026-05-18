import os
import json
import torch
import torch.nn as nn
from pyspark.sql import SparkSession
from pyspark.sql.functions import col, from_json
from pyspark.sql.types import StructType, StructField, StringType, IntegerType, FloatType
import redis
import psycopg2
from datetime import datetime

# Configuration
REDIS_HOST = os.getenv("REDIS_HOST", "redis")
KAFKA_HOST = os.getenv("KAFKA_HOST", "kafka:29092")
POSTGRES_HOST = os.getenv("POSTGRES_HOST", "db")
POSTGRES_DB = os.getenv("POSTGRES_DB", "traffic_db")
POSTGRES_USER = os.getenv("POSTGRES_USER", "user")
POSTGRES_PASSWORD = os.getenv("POSTGRES_PASSWORD", "password")

MODEL_PATH = "models/global_model.pt"
KAFKA_TOPIC = "traffic_stream"

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
        out = out[:, -1, :]  # On prend le dernier step
        out = self.bn(out)
        out = self.fc(out)
        return out

# Chargement du modèle sur CPU pour la légèreté
device = torch.device("cpu")
model = TrafficLSTM()
try:
    model.load_state_dict(torch.load(MODEL_PATH, map_location=device))
    model.eval()
    print("✅ PyTorch LSTM model loaded successfully.")
except Exception as e:
    print(f"❌ Error loading model: {e}")

# Spark Session en mode local[*] (pas besoin de master/worker séparés, économise ~4 Go de RAM)
spark = SparkSession.builder \
    .appName("TrafficPredictionStreaming") \
    .master("local[*]") \
    .getOrCreate()

# Schéma des données entrantes (doit matcher le JSON envoyé par le simulateur)
schema = StructType([
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

# Connexion Redis
r = redis.Redis(host=REDIS_HOST, port=6379, db=0, decode_responses=True)

def predict_and_store(batch_df, batch_id):
    """
    Inférence vectorielle hautement performante (sans .collect() séquentiel)
    et persistance dans Redis & PostgreSQL.
    """
    row_count = batch_df.count()
    if row_count == 0:
        return

    print(f"⚡ Processing micro-batch {batch_id} containing {row_count} rows...")
    
    # 1. Conversion en Pandas DataFrame pour traitement vectorisé ultra-rapide
    pdf = batch_df.toPandas()

    # 2. Préparation des features vectorielles
    features_list = [
        'hour_sin', 'hour_cos', 'dayofweek', 'month', 'is_weekend',
        'veh_lag_1', 'veh_lag_2', 'veh_lag_3', 'veh_lag_24'
    ]
    
    # Remplissage des NaN éventuels par des valeurs par défaut pour éviter tout crash
    pdf[features_list] = pdf[features_list].fillna(15.0)
    pdf['Vehicles'] = pdf['Vehicles'].fillna(15)

    features_array = pdf[features_list].values
    
    # Construction du tenseur PyTorch : [batch_size, seq_len=1, features=9]
    features_tensor = torch.tensor(features_array, dtype=torch.float32).unsqueeze(1)

    # Inférence vectorisée en une seule passe forward CPU (très légère et rapide !)
    with torch.no_grad():
        predictions = model(features_tensor).squeeze(-1).numpy()

    # 3. Connexion PostgreSQL pour insertion groupée (Bulk insert)
    pg_conn = None
    try:
        pg_conn = psycopg2.connect(
            host=POSTGRES_HOST,
            database=POSTGRES_DB,
            user=POSTGRES_USER,
            password=POSTGRES_PASSWORD
        )
        pg_cursor = pg_conn.cursor()
    except Exception as pg_err:
        print(f"⚠️ Failed to connect to PostgreSQL from Spark: {pg_err}")
        pg_cursor = None

    # 4. Traitement et envoi des résultats
    for idx, row in pdf.iterrows():
        pred_val = max(0.0, round(float(predictions[idx]), 2))
        status = "fluid" if pred_val < 30 else "moderate" if pred_val < 60 else "congested"
        
        result = {
            "DateTime": str(row['DateTime']),
            "Junction": int(row['Junction']),
            "Vehicles": int(row['Vehicles']),
            "PredictedVehicles": pred_val,
            "Status": status
        }

        # Sauvegarde & Publication dans Redis
        r.set(f"junction:{row['Junction']}:status", json.dumps(result))
        r.publish("traffic_updates", json.dumps(result))

        # Enregistrement dans PostgreSQL
        if pg_cursor:
            try:
                dt = datetime.strptime(str(row['DateTime']), "%Y-%m-%d %H:%M:%S")
                pg_cursor.execute(
                    """
                    INSERT INTO predictions (timestamp, junction_id, actual_vehicles, predicted_vehicles)
                    VALUES (%s, %s, %s, %s)
                    """,
                    (dt, int(row['Junction']), int(row['Vehicles']), pred_val)
                )
            except Exception as insert_err:
                print(f"⚠️ SQL Insertion error: {insert_err}")

    # Validation de la transaction PostgreSQL
    if pg_conn:
        try:
            pg_conn.commit()
            pg_cursor.close()
            pg_conn.close()
            # print("✅ PostgreSQL records committed successfully.")
        except Exception as commit_err:
            print(f"⚠️ Failed to commit PostgreSQL transaction: {commit_err}")

    print(f"🔮 Vectorized predictions done for micro-batch {batch_id}.")

# Lecture du flux Kafka en continu
print(f"📥 Connecting Spark to Kafka topic '{KAFKA_TOPIC}'...")
df = spark.readStream \
    .format("kafka") \
    .option("kafka.bootstrap.servers", KAFKA_HOST) \
    .option("subscribe", KAFKA_TOPIC) \
    .option("startingOffsets", "latest") \
    .load()

# Désérialisation du JSON Kafka selon notre schéma
json_df = df.selectExpr("CAST(value AS STRING)") \
    .select(from_json(col("value"), schema).alias("data")) \
    .select("data.*")

# Lancement du streaming avec traitement par batch optimisé
query = json_df.writeStream \
    .foreachBatch(predict_and_store) \
    .start()

print("🚀 Spark Structured Streaming Job is running...")
query.awaitTermination()
