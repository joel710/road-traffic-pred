from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import redis.asyncio as redis
import asyncpg
import os
import json
import asyncio
import httpx

# Configuration
REDIS_HOST = os.getenv("REDIS_HOST", "localhost")
REDIS_PORT = int(os.getenv("REDIS_PORT", 6379))
POSTGRES_DB = os.getenv("POSTGRES_DB", "traffic_db")
POSTGRES_USER = os.getenv("POSTGRES_USER", "user")
POSTGRES_PASSWORD = os.getenv("POSTGRES_PASSWORD", "password")
POSTGRES_HOST = os.getenv("POSTGRES_HOST", "localhost")
SIMULATOR_URL = os.getenv("SIMULATOR_URL", "http://simulator:8001")

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
            try:
                await connection.send_text(message)
            except Exception:
                # Connection might be closed
                pass

manager = ConnectionManager()
redis_client = None
db_pool = None

async def redis_listener():
    pubsub = redis_client.pubsub()
    await pubsub.subscribe("traffic_updates")
    try:
        async for message in pubsub.listen():
            if message['type'] == 'message':
                data = message['data']
                if isinstance(data, bytes):
                    data = data.decode('utf-8')
                await manager.broadcast(data)
    except Exception as e:
        print(f"Redis listener error: {e}")
    finally:
        await pubsub.unsubscribe("traffic_updates")

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    global redis_client, db_pool
    redis_client = redis.Redis(host=REDIS_HOST, port=REDIS_PORT, decode_responses=True)
    db_pool = await asyncpg.create_pool(
        user=POSTGRES_USER,
        password=POSTGRES_PASSWORD,
        database=POSTGRES_DB,
        host=POSTGRES_HOST
    )
    listener_task = asyncio.create_task(redis_listener())
    yield
    # Shutdown
    listener_task.cancel()
    await redis_client.close()
    await db_pool.close()

app = FastAPI(title="Road Traffic Prediction API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/traffic/current")
async def get_current_traffic():
    keys = await redis_client.keys("junction:*:status")
    traffic_data = {}
    for key in keys:
        junction_id = key.split(":")[1]
        data = await redis_client.get(key)
        if data:
            traffic_data[junction_id] = json.loads(data)
    return traffic_data

@app.get("/traffic/history/{junction_id}")
async def get_traffic_history(junction_id: int):
    async with db_pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT * FROM predictions WHERE junction_id = $1 ORDER BY timestamp DESC LIMIT 100",
            junction_id
        )
        return [dict(row) for row in rows]

@app.post("/simulation/start")
async def start_simulation():
    async with httpx.AsyncClient() as client:
        try:
            response = await client.post(f"{SIMULATOR_URL}/start", timeout=10.0)
            return response.json()
        except Exception as e:
            return {"error": str(e)}

@app.websocket("/ws/traffic")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            # Keep connection alive
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
