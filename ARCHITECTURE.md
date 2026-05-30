# Kinetic Flow — Architecture & Documentation

## Table of Contents
1. [Project Overview](#1-project-overview)
2. [Architecture Diagram](#2-architecture-diagram)
3. [Backend Pipeline](#3-backend-pipeline)
4. [Data Formats](#4-data-formats)
5. [Frontend Architecture](#5-frontend-architecture)
6. [Map & Routing System](#6-map--routing-system)
7. [Setup & Run Guide](#7-setup--run-guide)

---

## 1. Project Overview

**Kinetic Flow** is a real-time road traffic prediction system using an LSTM neural network. It streams live traffic data through Apache Kafka, processes it with PySpark Structured Streaming, runs inference with PyTorch, and displays results on an interactive Next.js map.

### Tech Stack

| Layer | Technology |
|-------|-----------|
| **Streaming** | Apache Kafka (Aiven Cloud, mTLS) |
| **Processing** | Apache Spark 3.5.0 (PySpark Structured Streaming) |
| **ML Inference** | PyTorch LSTM (2-layer, 128 hidden) |
| **API Gateway** | FastAPI + WebSocket |
| **Frontend** | Next.js 15, React 18, MapLibre GL |
| **3D Visualization** | Three.js |
| **Charts** | Recharts |

### Services (3 Python micro-services)

| Service | Port | Role |
|---------|------|------|
| `mini-services/api/` | 8000 | FastAPI REST + WebSocket gateway |
| `mini-services/simulator/` | — | Reads CSV, publishes to Kafka input topic |
| `mini-services/spark/` | — | Spark streaming: Kafka → LSTM → Kafka |

---

## 2. Architecture Diagram

```
┌──────────────┐    CSV rows     ┌──────────────┐
│  Simulator   │ ──────────────→ │    Kafka      │
│  (Python)    │   flux_data     │   (Aiven)     │
└──────────────┘                 │              │
                                 │ flux_data     │
                                 │ topic         │
                                 └──────┬───────┘
                                        │
                                        │ Spark readStream
                                        ▼
                                 ┌──────────────┐
                                 │     Spark     │
                                 │  Processor    │
                                 │  (PySpark)    │
                                 │              │
                                 │ 1. Read JSON  │
                                 │ 2. Buffer 24  │
                                 │    steps/jct  │
                                 │ 3. scaler_x   │
                                 │ 4. LSTM infer │
                                 │ 5. scaler_y⁻¹ │
                                 │ 6. Publish    │
                                 └──────┬───────┘
                                        │
                                        │ traffic_predictions topic
                                        ▼
                                 ┌──────────────┐
                                 │    Kafka      │
                                 │   (Aiven)     │
                                 │ predictions   │
                                 │ topic         │
                                 └──────┬───────┘
                                        │
                                        │ KafkaConsumer (mTLS)
                                        ▼
                                 ┌──────────────┐
                                 │  FastAPI      │
                                 │  Gateway      │
                                 │  (port 8000)  │
                                 │              │
                                 │ REST:         │
                                 │ /traffic/     │
                                 │   current     │
                                 │ /traffic/     │
                                 │   history/:id │
                                 │              │
                                 │ WebSocket:    │
                                 │ /ws/traffic   │
                                 └──────┬───────┘
                                        │
                                        │ WebSocket + REST
                                        ▼
                                 ┌──────────────┐
                                 │   Next.js     │
                                 │   Frontend    │
                                 │  (port 3000)  │
                                 │              │
                                 │ MapLibre GL   │
                                 │ Three.js      │
                                 │ Recharts      │
                                 └──────────────┘
```

### Data Pipeline (complete flow)

```
CSV row
  │ { DateTime, Junction, Vehicles, ID, hour, dayofweek, month,
  │   is_weekend, hour_sin, hour_cos, veh_lag_1..3, veh_lag_24 }
  ▼
Simulator (main.py)
  │ json.dumps(row.to_dict())
  │ KafkaProducer → topic "flux_data"
  ▼
Spark Structured Streaming
  │ readStream.format("kafka").option("subscribe", "flux_data")
  │ from_json(col("value"), input_schema)
  │
  │ foreachBatch(predict_and_publish):
  │   1. Per-junction deque buffer (maxlen=24)
  │   2. Normalize: scaler_x.transform(seq[24,9])
  │   3. LSTM inference: model(1,24,9) → scalar
  │   4. Denormalize: scaler_y.inverse_transform([[scalar]])
  │   5. Status: <30 fluid, <60 moderate, ≥60 congested
  │   6. Publish to "traffic_predictions" topic
  ▼
KafkaProducer → topic "traffic_predictions"
  ▼
FastAPI Consumer (kafka_listener thread)
  │ build_kafka_consumer() → mTLS SSL
  │ for msg in consumer:
  │   asyncio.run_coroutine_threadsafe(broadcast_queue.put(data), loop)
  ▼
WebSocket broadcast_worker
  │ for ws in websocket_clients:
  │   await ws.send_json(data)
  ▼
Browser (Next.js)
  │ TrafficDashboard → useEffect → WebSocket
  │ setJunctions(state update) → Map markers + Sidebar cards
```

---

## 3. Backend Pipeline

### 3.1 Simulator (`mini-services/simulator/main.py`)

Reads CSV and publishes each row as JSON to Kafka.

```python
# SSL mTLS config (Aiven)
opts = {
    "security_protocol": "SSL",
    "ssl_cafile":      KAFKA_SSL_CA,    # ca.pem
    "ssl_certfile":     KAFKA_SSL_CERT,  # service.cert
    "ssl_keyfile":      KAFKA_SSL_KEY,   # service.key
}
producer = KafkaProducer(**opts)
producer.send("flux_data", value=json.dumps(row))
```

### 3.2 Spark Processor (`mini-services/spark/spark_processor.py`)

PySpark Structured Streaming job running on `local[*]`.

**Kafka readStream** (Java-side, SSL mTLS):
```properties
kafka.security.protocol=SSL
kafka.ssl.truststore.location=ca.pem
kafka.ssl.truststore.type=PEM
kafka.ssl.keystore.location=/tmp/kafka_keystore_combined.pem
kafka.ssl.keystore.type=PEM
```

**Inference function** (`predict_and_publish`):
1. Receive micro-batch from Structured Streaming
2. Sort rows by `DateTime`
3. For each row, append 9 features to per-junction deque (maxlen=24)
4. When buffer has 24 steps: build sequence (24,9), normalize with `scaler_x`
5. LSTM forward pass: `(1, 24, 9)` → scalar prediction
6. Denormalize with `scaler_y.inverse_transform()`
7. Publish result to `traffic_predictions` topic via KafkaProducer (Python mTLS)

**Model Architecture**:
```
TrafficLSTM:
  LSTM(9→128, 2 layers, dropout=0.3, batch_first=True)
  → BatchNorm1d(128)
  → Linear(128→64) → ReLU → Dropout(0.2)
  → Linear(64→1)
```

**Features** (9 inputs):
```
hour_sin, hour_cos       — cyclic time encoding
dayofweek, month         — calendar features
is_weekend               — binary flag
veh_lag_1,2,3,24         — historical vehicle counts
```

**Scalers** (fitted on 38,476 training rows):
- `scaler_x.pkl`: StandardScaler for 9 input features
- `scaler_y.pkl`: StandardScaler for target Vehicles (mean=20.1, std=17.86)

### 3.3 API Gateway (`mini-services/api/main.py`)

FastAPI application serving REST endpoints and WebSocket.

**Endpoints**:

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Service status + active connections |
| GET | `/traffic/current` | Latest prediction for all junctions |
| GET | `/traffic/history/{junction_id}` | Last N predictions for a junction |
| POST | `/traffic/ingest` | Receive traffic data (simulator fallback) |
| GET | `/health` | Health check |
| WS | `/ws/traffic` | Live prediction stream |

**Architecture**:
```
Main Thread                    Background Thread
─────────────                  ─────────────────
FastAPI event loop             kafka_listener(loop)
  ↑                                    │
  │ broadcast_worker()                 │ KafkaConsumer (mTLS)
  │   drains broadcast_queue           │ reads traffic_predictions
  │   sends JSON to all WS             │
  │   clients                          │ asyncio.run_coroutine_
  │                                    │   threadsafe(
  │   ┌──────────────────┐             │     broadcast_queue.put(data),
  │   │ broadcast_queue   │←────────────     loop
  │   │ (asyncio.Queue)   │             │   )
  │   └──────────────────┘             │
  │                                    │
  │   ┌──────────────────┐             │
  │   │ current_state     │←──────────── updates junction state
  │   │ history (deque)   │             │
  │   └──────────────────┘             │
```

---

## 4. Data Formats

### 4.1 Simulator → Kafka (`flux_data` topic)

JSON — one CSV row per message:
```json
{
  "DateTime": "2017-03-11 09:00:00",
  "Junction": 3,
  "Vehicles": 11,
  "ID": "20170311093",
  "hour": 9,
  "dayofweek": 5,
  "month": 3,
  "is_weekend": 1,
  "hour_sin": 0.7071,
  "hour_cos": -0.7071,
  "veh_lag_1": 12.0,
  "veh_lag_2": 8.0,
  "veh_lag_3": 7.0,
  "veh_lag_24": 13.0
}
```

### 4.2 Spark Processor → Kafka (`traffic_predictions` topic)

JSON — one prediction per row:
```json
{
  "DateTime": "2017-03-11 09:00:00",
  "Junction": 3,
  "Vehicles": 11,
  "PredictedVehicles": 10.23,
  "Status": "fluid",
  "Timestamp": "2026-05-30T04:45:44+00:00"
}
```

Status thresholds: `<30` fluid, `<60` moderate, `≥60` congested.

### 4.3 WebSocket Payload (to Frontend)

Same format as Spark output — forwarded directly:
```typescript
type WsPayload = {
  Junction: number;
  Vehicles: number;
  PredictedVehicles: number;
  Status: string;
  DateTime: string;
};
```

### 4.4 REST `/traffic/current` Response

```json
[
  {
    "DateTime": "2017-03-11 09:00:00",
    "Junction": 1,
    "Vehicles": 88,
    "PredictedVehicles": 85.4,
    "Status": "congested",
    "Timestamp": "2026-05-30T04:45:44+00:00"
  }
]
```

---

## 5. Frontend Architecture

### 5.1 Component Tree

```
src/app/
├── layout.tsx              — Root layout (metadata, fonts)
├── page.tsx                — Home: renders <Launchpad />
├── dashboard/
│   └── page.tsx            — Dashboard: renders <TrafficDashboard />
└── api/
    └── traffic/
        └── predictions/    — (unused) simulated predictions API

src/components/traffic/
├── Launchpad.tsx            — Landing page: search, quick routes, junction grid
├── TrafficDashboard.tsx     — Main orchestrator: WebSocket, state, car routing
├── TrafficMap.tsx           — MapLibre GL map: markers, routes, popups
├── MapCarAnimator.tsx       — Animated Tesla car on map with re-routing
├── Sidebar.tsx              — Junction cards, metrics, sparklines, 3D car
├── ThreeCarVisualizer.tsx   — Three.js 3D car in sidebar (spinning preview)
└── TimeSlider.tsx           — 0-24h range slider
```

### 5.2 Data Flow

```
WebSocket (ws://localhost:8000/ws/traffic)
  │
  ├─→ setJunctions() → Map markers (color, popup)
  │                  → Sidebar cards (flow, sparkline)
  │                  → Routes recalculation
  │                  → Live metrics (MAE/RMSE buffer)
  │
  └─→ REST fallback (http://localhost:8000/traffic/current)
       on component mount if WebSocket not yet connected

Junction Selection:
  Map marker click → setSelectedJunction(J1..J4)
    ├─→ Camera flyTo junction (once per selection change)
    ├─→ Popup on map
    └─→ 3D car visualizer in sidebar

Car Routing:
  Sidebar "GO" click → buildCarRoute(origin, target)
    ├─→ findBestPath() (Dijkstra, congestion-weighted)
    ├─→ Build fullCoords from roadGeometries
    └─→ MapCarAnimator: animate car along path
         ├─→ Camera follows car (panTo every 20 frames)
         └─→ Re-routing every 3s if congestion changes
```

### 5.3 Live Metrics Computation

```typescript
// Module-level rolling buffer (200 samples)
const errorsBuffer: number[] = [];

// On each WebSocket message:
const err = Math.abs(data.Vehicles - data.PredictedVehicles);
errorsBuffer.push(err);
if (errorsBuffer.length > 200) errorsBuffer.shift();

// Every 10 messages:
const mae = errorsBuffer.reduce((a,b) => a+b, 0) / errorsBuffer.length;
const rmse = Math.sqrt(errorsBuffer.reduce((a,b) => a+b*b, 0) / errorsBuffer.length);
const accuracy = (errorsBuffer.filter(e => e <= 5).length / errorsBuffer.length) * 100;
```

### 5.4 WebSocket Connection

```typescript
useEffect(() => {
  const wsUrl = `ws://localhost:8000/ws/traffic`;

  const connect = () => {
    const ws = new WebSocket(wsUrl);
    ws.onopen = () => setWsConnected(true);
    ws.onmessage = (event) => {
      const data: WsPayload = JSON.parse(event.data);
      // Update junctions state...
    };
    ws.onclose = () => setTimeout(connect, 5000); // auto-reconnect
  };
  connect();
  return () => ws.close();
}, []);
```

---

## 6. Map & Routing System

### 6.1 Map Setup

```
MapLibre GL (react-map-gl/maplibre)
├── Basemap: CartoDB dark-matter / positron
├── InitialView: Paris center [2.3522, 48.8566], zoom 12.5
├── Camera: pitch 58°, unique bearing per junction
└── Controls: dark/light toggle, zoom, reset view
```

### 6.2 Junction Markers

Each junction (J1-J4) is a Marker with:
- Animated pulsing halo (framer-motion, 2.5s loop)
- Outer ring + central dot with colored glow
- Color: emerald (fluid), amber (moderate), red/orange (congested)
- Hover label showing junction name
- Click → camera flyTo + popup with live/predicted flow

### 6.3 Route Lines

Real Paris road geometries rendered as GeoJSON LineStrings:
- **3-layer rendering**: outer glow (blur 10px, 14px wide) → mid glow (blur 5px, 8px) → solid line (3.5px)
- **Animated dash pattern**: white dashes on top for "flow" effect
- **Color by congestion**: emerald/amber/red based on average endpoint flow

### 6.4 Road Geometries

6 routes connecting the 4 junctions, each with 20-35 waypoints tracing actual Paris streets:
```
J1-J2: Gare du Nord → Champs-Élysées
J1-J3: Gare du Nord → Place d'Italie
J1-J4: Gare du Nord → Bastille
J2-J3: Champs-Élysées → Place d'Italie
J2-J4: Champs-Élysées → Bastille
J3-J4: Place d'Italie → Bastille
```

### 6.5 Car Routing (Dijkstra)

Edge weights by congestion:
| Status | Weight |
|--------|--------|
| fluid | 1.0x |
| moderate | 3.0x |
| congested | 8.0x |

The car follows the real road geometry coordinates along the optimal path. Re-routing occurs every 3 seconds — if a segment on the current path becomes congested and a better path exists, the car dynamically switches route mid-journey.

### 6.6 Car Animation

- **60fps** via `requestAnimationFrame`
- Position interpolated between consecutive waypoints
- Direction calculated as `atan2(dy, dx)`
- Camera follows via `map.panTo()` every 20 frames
- Trail dots behind car with fade effect
- Tesla Model S style: grey metallic, panoramic glass roof, LED lights

---

## 7. Setup & Run Guide

### 7.1 Prerequisites

```bash
Java 17+      # For Apache Spark
Python 3.12+  # Backend services
Node.js 22+   # Frontend
```

### 7.2 Environment Setup

**1. Clone & install Python dependencies:**
```bash
cd /home/jojo/road-traffic-pred
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

**2. Install Node.js dependencies:**
```bash
npm install
```

**3. Configure `.env`:**
```bash
# Kafka Aiven
KAFKA_HOST=kafka-xxxxx.h.aivencloud.com
KAFKA_PORT=17498
KAFKA_USERNAME=avnadmin
KAFKA_PASSWORD=YOUR_AIVEN_PASSWORD_HERE

# Cert paths (for mTLS)
KAFKA_SSL_CA=/home/jojo/road-traffic-pred/certs/ca.pem
KAFKA_SSL_CERT=/home/jojo/road-traffic-pred/certs/service.cert
KAFKA_SSL_KEY=/home/jojo/road-traffic-pred/certs/service.key

# Topics
KAFKA_TOPIC_INPUT=flux_data
KAFKA_TOPIC_OUTPUT=traffic_predictions

# Paths
CSV_PATH=/home/jojo/road-traffic-pred/data/test.csv
MODEL_PATH=/home/jojo/road-traffic-pred/models/global_model.pt
```

### 7.3 Certificates Setup

Place Aiven SSL certificates in `certs/`:
```
certs/
├── ca.pem           # CA certificate
├── service.cert     # Client certificate
└── service.key      # Client private key (PKCS#8)
```

### 7.4 Spark Installation

```bash
# Download Spark 3.5.0
wget https://archive.apache.org/dist/spark/spark-3.5.0/spark-3.5.0-bin-hadoop3.tgz
tar xzf spark-3.5.0-bin-hadoop3.tgz -C /home/jojo/tools/
# Ensure SPARK_HOME in .env matches:
SPARK_HOME=/home/jojo/tools/spark
```

### 7.5 Running

**Terminal 1 — Backend services:**
```bash
cd /home/jojo/road-traffic-pred
./start-services.sh --with-simulator
```

This starts (in background):
1. FastAPI Gateway on port 8000
2. Simulator (reads CSV → Kafka)
3. Spark Processor (Kafka → LSTM → Kafka)

**Terminal 2 — Frontend:**
```bash
cd /home/jojo/road-traffic-pred
npm run dev
```

### 7.6 Access

| Service | URL |
|---------|-----|
| Frontend | http://localhost:3000 |
| Dashboard | http://localhost:3000/dashboard |
| API | http://localhost:8000 |
| API Docs | http://localhost:8000/docs |
| Spark UI | http://localhost:4040 |

### 7.7 Expected Output

```
# Backend logs should show:
✅ Connecté à Kafka. Envoi vers topic 'flux_data'...
✅ PyTorch LSTM model loaded.
✅ Scalers loaded (y: mean=20.1, scale=17.9)
🚀 Spark Streaming Job is running (Kafka → LSTM → Kafka) …
⚡ Processing micro-batch 0 (1 rows) …
🔮 Published 1 predictions to topic 'traffic_predictions'.
   Sample: J3 | Actual=11 veh | Pred=10.5 veh | Status=fluid
📡 Kafka consumer listening on 'traffic_predictions' …
🔌 WebSocket client connected (1 total)
```

### 7.8 Model & Scaler Files

| File | Description |
|------|------------|
| `models/global_model.pt` | Trained LSTM weights |
| `models/scaler_x.pkl` | Feature StandardScaler |
| `models/scaler_y.pkl` | Target StandardScaler (fit on 38,476 rows) |

### 7.9 Training Data

| File | Rows | Columns |
|------|------|---------|
| `data/train.csv` | 38,476 | 14 (DateTime, Junction, Vehicles, features) |
| `data/test.csv` | 9,621 | 14 (same schema) |

**Training config** (from notebook):
- Sequence length: 24 time steps
- Train/test split: 80/20 per junction
- Target: Vehicles (next time step after sequence)
- Scaler: StandardScaler on features and target
- Model: LSTM 2×128, BatchNorm, Dropout
- Performance: MAE 2.0-3.7 per junction (Global model)
