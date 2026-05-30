# Kinetic Flow — Real-Time Traffic Prediction

LSTM neural network + Apache Kafka Streaming + Interactive 3D Map visualization for real-time road traffic prediction.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **ML** | PyTorch LSTM (2-layer, 128 hidden, 9 features, seq_len=24) |
| **Streaming** | Apache Kafka (Aiven Cloud, mTLS) + Spark Structured Streaming 3.5.0 |
| **API** | FastAPI + WebSocket (port 8000) |
| **Frontend** | Next.js 15, React 18, MapLibre GL, Three.js, Recharts |

## Quick Start

```bash
# Terminal 1 — Backend (API + Simulator + Spark)
./start-services.sh --with-simulator

# Terminal 2 — Frontend
npm run dev
```

- Frontend: http://localhost:3000
- Dashboard: http://localhost:3000/dashboard
- API Docs: http://localhost:8000/docs

## Project Structure

```
mini-services/
├── api/main.py              # FastAPI gateway + WebSocket
├── simulator/main.py        # CSV → Kafka publisher
└── spark/spark_processor.py # Kafka → LSTM inference → Kafka

src/
├── app/                     # Next.js pages
├── components/traffic/      # Map, Sidebar, Car animator, 3D visualizer
├── lib/traffic/routing.ts   # Dijkstra congestion-aware pathfinding
├── lib/data/roadGeometries.ts # Real Paris road waypoints
└── types/traffic.ts         # TypeScript interfaces

models/
├── global_model.pt          # Trained LSTM weights
├── scaler_x.pkl             # Feature StandardScaler
└── scaler_y.pkl             # Target StandardScaler

data/
├── train.csv                # 38,476 training rows
└── test.csv                 # 9,621 test rows

certs/                       # Aiven Kafka mTLS certificates
├── ca.pem, service.cert, service.key
```

## Architecture

Full pipeline: `CSV → Simulator → Kafka(flux_data) → Spark → LSTM(24-step seq) → Kafka(predictions) → FastAPI → WebSocket → Next.js Map`

See [ARCHITECTURE.md](./ARCHITECTURE.md) for complete documentation.

## Model Performance

| Junction | MAE (Global Model) |
|----------|-------------------|
| J1 | 3.73 |
| J2 | 1.98 |
| J3 | 2.61 |
| J4 | 2.13 |

Live metrics (MAE, RMSE, Accuracy) are computed dynamically in the dashboard from streaming prediction errors.

## Authors

- **Joel ADZONYA** — AI Research & Core Infrastructure
- **Ghislaine EKLOU** — Data Engineering & Visualization Design
