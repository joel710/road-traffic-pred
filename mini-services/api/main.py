from fastapi import FastAPI, WebSocket, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import redis
import json
import os
import asyncio
from typing import List, Optional

app = FastAPI(title="Road Traffic Prediction API")

# Security: CORS configuration
origins = [
    "http://localhost:3000", # Frontend Next.js
    "http://127.0.0.1:3000",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Setup Redis connection
REDIS_HOST = os.getenv("REDIS_HOST", "localhost")
REDIS_PORT = int(os.getenv("REDIS_PORT", 6379))
r = redis.Redis(host=REDIS_HOST, port=REDIS_PORT, db=0, decode_responses=True)

class TrafficData(BaseModel):
    DateTime: str
    Junction: int
    Vehicles: Optional[int] = None
    ID: Optional[int] = None
    # Features pour le modèle
    hour: Optional[int] = None
    dayofweek: Optional[int] = None
    month: Optional[int] = None
    is_weekend: Optional[int] = None
    hour_sin: Optional[float] = None
    hour_cos: Optional[float] = None
    veh_lag_1: Optional[float] = None
    veh_lag_2: Optional[float] = None
    veh_lag_3: Optional[float] = None
    veh_lag_24: Optional[float] = None

@app.get("/")
def read_root():
    return {"status": "online", "service": "traffic-prediction-api"}

@app.post("/traffic/ingest")
async def ingest_traffic(data: TrafficData):
    """
    Endpoint pour recevoir les données du simulateur et les pousser vers Redis.
    """
    try:
        payload = data.dict()
        # On publie sur un canal Redis pour que Spark ou le WebSocket puissent écouter
        r.publish("traffic_stream", json.dumps(payload))
        # On stocke aussi le dernier état pour la consultation rapide
        r.set(f"junction:{data.Junction}:last", json.dumps(payload))
        return {"status": "success", "message": "Data ingested"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/traffic/current")
def get_current_traffic():
    """
    Récupère le statut actuel de toutes les jonctions.
    """
    keys = r.keys("junction:*:status") # Predictions de Spark
    if not keys:
        # Si pas encore de prédictions, on renvoie les derniers ingérés
        keys = r.keys("junction:*:last")
        
    traffic_data = []
    for key in keys:
        val = r.get(key)
        if val:
            traffic_data.append(json.loads(val))
    return traffic_data

@app.websocket("/ws/traffic")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    pubsub = r.pubsub()
    # On écoute à la fois le flux d'entrée et les prédictions en sortie
    pubsub.subscribe("traffic_updates") # Prédictions de Spark
    pubsub.subscribe("traffic_stream")  # Données brutes du simulateur
    
    try:
        while True:
            # On utilise un mécanisme non-bloquant pour ne pas figer le WebSocket
            message = pubsub.get_message(ignore_subscribe_message=True)
            if message:
                await websocket.send_text(message['data'])
            await asyncio.sleep(0.1) # Petit délai pour éviter de saturer le CPU
    except Exception as e:
        print(f"WebSocket Error: {e}")
    finally:
        await websocket.close()
