from fastapi import FastAPI, WebSocket, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import json
import os
import asyncio
from asyncio import Queue
from pathlib import Path
from threading import Thread
from collections import deque, defaultdict
from typing import Optional
from datetime import datetime
from kafka import KafkaConsumer
from dotenv import load_dotenv

load_dotenv()

app = FastAPI(title="Road Traffic Gateway API — Kafka-Native")

# ─── CORS ────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Aiven Kafka Configuration ───────────────────────────────────
KAFKA_HOST = os.getenv("KAFKA_HOST", "localhost")
KAFKA_PORT = int(os.getenv("KAFKA_PORT", "9092"))
KAFKA_USERNAME = os.getenv("KAFKA_USERNAME", "")
KAFKA_PASSWORD = os.getenv("KAFKA_PASSWORD", "")
KAFKA_SSL_CA = os.getenv("KAFKA_SSL_CA", "")
TOPIC_OUTPUT = os.getenv("KAFKA_TOPIC_OUTPUT", "traffic_predictions")
BOOTSTRAP_SERVER = f"{KAFKA_HOST}:{KAFKA_PORT}"

# ─── In-Memory State (replaces Redis & PostgreSQL) ───────────────
current_state: dict[int, dict] = {}          # junction_id → latest prediction
history: dict[int, deque] = defaultdict(     # junction_id → [prediction, …]
    lambda: deque(maxlen=2000)
)

# ─── WebSocket Manager ───────────────────────────────────────────
websocket_clients: set[WebSocket] = set()
broadcast_queue: asyncio.Queue = Queue()


def build_kafka_consumer() -> KafkaConsumer:
    """KafkaConsumer with SASL_SSL (Aiven) or plaintext fallback."""
    opts = {
        "bootstrap_servers": [BOOTSTRAP_SERVER],
        "group_id": "traffic-api-consumer",
        "auto_offset_reset": "latest",
        "value_deserializer": lambda v: json.loads(v.decode("utf-8")),
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
    return KafkaConsumer(TOPIC_OUTPUT, **opts)


def kafka_listener():
    """Background thread: read predictions from Kafka and push to the asyncio queue."""
    loop = None
    try:
        consumer = build_kafka_consumer()
        print(f"📡 Kafka consumer listening on '{TOPIC_OUTPUT}' …")
        for msg in consumer:
            data = msg.value
            junction = data.get("Junction")
            if junction is not None:
                # Update in-memory state
                current_state[junction] = data
                history[junction].append(data)

            # Push to asyncio broadcast queue
            if loop is None:
                loop = asyncio.new_event_loop()
            asyncio.run_coroutine_threadsafe(
                broadcast_queue.put(data),
                loop,
            )
    except Exception as e:
        print(f"❌ Kafka consumer error: {e}")


@app.on_event("startup")
async def startup():
    # Start Kafka listener in background thread
    thread = Thread(target=kafka_listener, daemon=True)
    thread.start()
    print("✅ Kafka listener thread started")
    # Start the broadcast worker
    asyncio.create_task(broadcast_worker())


async def broadcast_worker():
    """Continuously drain the broadcast queue and send to all WebSocket clients."""
    while True:
        data = await broadcast_queue.get()
        dead_clients: list[WebSocket] = []
        for ws in websocket_clients:
            try:
                await ws.send_json(data)
            except Exception:
                dead_clients.append(ws)
        for ws in dead_clients:
            websocket_clients.discard(ws)


# ─── Models ──────────────────────────────────────────────────────
class TrafficData(BaseModel):
    DateTime: str
    Junction: int
    Vehicles: Optional[int] = None
    ID: Optional[int] = None


# ─── REST Endpoints ──────────────────────────────────────────────
@app.get("/")
def root():
    return {
        "status": "online",
        "service": "traffic-gateway-api",
        "mode": "kafka-native (no Redis/PostgreSQL)",
        "active_connections": len(websocket_clients),
    }


@app.get("/traffic/current")
def get_current():
    """Return the latest prediction for every junction (from in-memory state)."""
    return sorted(current_state.values(), key=lambda x: x.get("Junction", 0))


@app.get("/traffic/history/{junction_id}")
def get_history(junction_id: int, limit: int = 50):
    """Return recent prediction history for a junction (from in-memory deque)."""
    junction_history = list(history.get(junction_id, []))
    return junction_history[-limit:]


# ─── WebSocket Endpoint ──────────────────────────────────────────
@app.websocket("/ws/traffic")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    websocket_clients.add(ws)
    print(f"🔌 WebSocket client connected ({len(websocket_clients)} total)")

    try:
        while True:
            # Keep the connection alive; client pings will reset the timeout
            await ws.receive_text()
    except Exception:
        pass
    finally:
        websocket_clients.discard(ws)
        print(f"🔌 WebSocket client disconnected ({len(websocket_clients)} remaining)")
