from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
import redis
import psycopg2
from psycopg2.extras import RealDictCursor
import os
import json
import asyncio
import httpx

app = FastAPI(title="Road Traffic Prediction API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configuration
REDIS_HOST = os.getenv("REDIS_HOST", "localhost")
REDIS_PORT = int(os.getenv("REDIS_PORT", 6379))
POSTGRES_DB = os.getenv("POSTGRES_DB", "traffic_db")
POSTGRES_USER = os.getenv("POSTGRES_USER", "user")
POSTGRES_PASSWORD = os.getenv("POSTGRES_PASSWORD", "password")
POSTGRES_HOST = os.getenv("POSTGRES_HOST", "localhost")
SIMULATOR_URL = os.getenv("SIMULATOR_URL", "http://simulator:8001")

# Connections
redis_client = redis.Redis(host=REDIS_HOST, port=REDIS_PORT, decode_responses=True)

def get_db_connection():
    return psycopg2.connect(
        dbname=POSTGRES_DB,
        user=POSTGRES_USER,
        password=POSTGRES_PASSWORD,
        host=POSTGRES_HOST
    )

class ConnectionManager:
    def __init__(self):
        self.active_connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        self.active_connections.remove(websocket)

    async def broadcast(self, message: str):
        for connection in self.active_connections:
            await connection.send_text(message)

manager = ConnectionManager()

@app.get("/traffic/current")
async def get_current_traffic():
    keys = redis_client.keys("junction:*:status")
    traffic_data = {}
    for key in keys:
        junction_id = key.split(":")[1]
        data = redis_client.get(key)
        if data:
            traffic_data[junction_id] = json.loads(data)
    return traffic_data

@app.get("/traffic/history/{junction_id}")
async def get_traffic_history(junction_id: int):
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    cur.execute(
        "SELECT * FROM predictions WHERE junction_id = %s ORDER BY timestamp DESC LIMIT 100",
        (junction_id,)
    )
    history = cur.fetchall()
    cur.close()
    conn.close()
    return history

@app.post("/simulation/start")
async def start_simulation():
    async with httpx.AsyncClient() as client:
        response = await client.post(f"{SIMULATOR_URL}/start")
        return response.json()

@app.websocket("/ws/traffic")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            # We can either wait for a message from the client
            # or just keep the connection open and broadcast from another task
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)

# Background task to listen to Redis Pub/Sub for real-time updates from Spark
async def redis_listener():
    pubsub = redis_client.pubsub()
    pubsub.subscribe("traffic_updates")

    # Use async iterator for more efficient listening
    for message in pubsub.listen():
        if message['type'] == 'message':
            await manager.broadcast(message['data'])
        await asyncio.sleep(0.01) # Small yield

@app.on_event("startup")
async def startup_event():
    asyncio.create_task(redis_listener())

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
