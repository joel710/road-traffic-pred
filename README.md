# Road Flow — Real-Time Traffic Prediction

Road Flow is a high-performance traffic prediction system combining Deep Learning (LSTM), Distributed Streaming (Apache Kafka & Spark), and a modern 3D Interactive Dashboard.

## 🚀 Quick Start (Step-by-Step)

Since you have Docker and Docker Compose v2 installed, you can launch the entire infrastructure in minutes.

### 1. Clone the Repository
```bash
git clone <repo-url> && cd road-traffic-pred
```

### 2. Setup Environment
Prepare the configuration file required by the backend services:
```bash
cp .env.example .env
```

### 3. Launch the System
Depending on your needs, choose one of the following commands:

**A. Full Stack (Recommended)**
Launches the Frontend, API, Kafka Broker, Spark Processor, and the Traffic Simulator.
```bash
./docker-up.sh --full
```

**B. Minimal Stack**
Launches only the Frontend, API, and Kafka (no data simulation or ML processing).
```bash
./docker-up.sh
```

### 4. Access the Application
Once the containers are healthy (wait for the logs to show "connected to Kafka"), open your browser:
- 🌐 **Main Dashboard**: [http://localhost:3000/dashboard](http://localhost:3000/dashboard)
- 🛠️ **API Documentation**: [http://localhost:8000/docs](http://localhost:8000/docs)
- 📊 **Spark UI**: [http://localhost:4040](http://localhost:4040) (Full stack only)

---

## 🛠 Tech Stack

| Layer | Technology | Role |
| :--- | :--- | :--- |
| **ML** | PyTorch LSTM | Time-series prediction of vehicle flow |
| **Streaming** | Apache Kafka | Real-time data bus for ingestion & predictions |
| **Processing** | PySpark Structured Streaming | Real-time feature engineering & LSTM inference |
| **API Gateway** | FastAPI + WebSockets | Low-latency data bridge to the frontend |
| **Frontend** | Next.js 15 + MapLibre GL | Interactive map & 3D visualization |
| **Visuals** | Three.js + Recharts | 3D car previews and live traffic analytics |

---

## ⚙️ Configuration & Advanced Usage

### Environment Variables (`.env`)
The `.env` file controls the behavior of the backend. Key parameters include:
- `KAFKA_HOST`: Set to `kafka` for Docker, or your cloud provider URL.
- `CSV_PATH`: Path to the traffic data file inside the container.
- `MODEL_PATH`: Path to the trained `.pt` weights.

### Using Aiven Cloud Kafka (Optional)
If you prefer a managed Kafka instance over the local Docker broker:
1. Edit `.env.aiven` with your Aiven credentials.
2. Place your certificates (`ca.pem`, `service.cert`, `service.key`) in the `certs/` folder.
3. Run:
   ```bash
   docker compose --env-file .env --env-file .env.aiven --profile full up --build
   ```

### Local Development (Without Docker)
For developers who want to run services natively:
- **Backend**: Run `./start-services.sh --with-simulator`
- **Frontend**: Run `npm run dev`

---

## 📖 Project Documentation

For a comprehensive understanding of the system, please refer to the dedicated technical guides:

- ⚙️ **[Backend Architecture](./docs/BACKEND.md)**: Deep dive into the data pipeline, Kafka, Spark, and the Gateway API.
- 🎨 **[Frontend Architecture](./docs/FRONTEND.md)**: Details on the 3D visualization engine, Next.js state, and MapLibre integration.
- 🔄 **[System Integration](./docs/INTEGRATION.md)**: The full data flow map from raw CSV to real-time 3D animation.
- 🏛️ **[General Architecture](./ARCHITECTURE.md)**: High-level system design.

---

## 🛠 Project Details

### Project Structure
```text
mini-services/
├── api/                # FastAPI gateway & WebSocket manager
├── simulator/          # Data generator (CSV to Kafka)
└── spark/              # PySpark ML inference engine
src/
├── app/                # Next.js pages
├── components/traffic/ # Map, Sidebar, Car animator, 3D visualizer
└── lib/                # Routing (Dijkstra) & Road geometries
models/                # Trained LSTM weights and scalers
data/                   # Traffic datasets (Train/Test)
certs/                  # mTLS certificates for Kafka
```

### Model Performance (Global Model)
| Junction | Mean Absolute Error (MAE) |
| :--- | :--- |
| **J1** | 3.73 |
| **J2** | 1.98 |
| **J3** | 2.61 |
| **J4** | 2.13 |

---

## ❓ Troubleshooting

- **Port Conflict**: If port 3000 or 8000 is already in use, change the port mapping in `docker-compose.yml`.
- **Spark Memory**: If the `spark-processor` container crashes, ensure your Docker Desktop has at least 4GB of RAM allocated (Settings $\rightarrow$ Resources).
- **Frontend API Error**: If the dashboard cannot connect to the API, check if the `backend` container is healthy.

---

## ✍️ Authors
- **Joel ADZONYA** — AI Research & Core Infrastructure
- **Ghislaine EKLOU** — Data Engineering & Visualization Design
