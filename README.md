# 🚦 Urban Traffic Forecasting & 3D Interactive Visualization

[![Next.js](https://img.shields.io/badge/Next.js-15-black?style=flat-square&logo=next.js)](https://nextjs.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-4.0-38bdf8?style=flat-square&logo=tailwind-css)](https://tailwindcss.com/)
[![Deep Learning](https://img.shields.io/badge/AI-LSTM_Neural_Network-FF6F00?style=flat-square&logo=pytorch)](https://pytorch.org/)
[![MapLibre](https://img.shields.io/badge/Map-3D_Interactive-2196F3?style=flat-square&logo=maplibre)](https://maplibre.org/)

A state-of-the-art traffic prediction platform combining **Long Short-Term Memory (LSTM)** neural networks with **Apache Spark Streaming** and a high-fidelity **3D interactive visualization engine**. Designed for urban planners and smart city operators to anticipate and mitigate traffic congestion in real-time.

## 📊 Dataset Source
The project utilizes the [Traffic Prediction Dataset](https://www.kaggle.com/datasets/fedesoriano/traffic-prediction-dataset), featuring multi-junction flow data optimized for time-series forecasting.


## ✨ Core Features

- **🧠 Deep Learning Engine**: Advanced LSTM architecture trained on multi-junction time-series data, achieving over 90% accuracy in specific urban contexts.
- **⚡ Real-Time Streaming**: Powered by **Spark Streaming** to process live traffic feeds and provide instantaneous predictions.
- **🗺️ 3D Digital Twin**: Dynamic map visualization with smooth camera transitions, 3D perspective shifting, and natural road mapping following real city topography.
- **⏳ Temporal Simulation**: Interactive time slider to visualize predicted traffic flows across 24-hour cycles.
- **📊 Multi-Paradigm Analysis**: Switch between global city-wide models and junction-specific optimized models to compare predictive performance.
- **🎨 Premium UX**: Glassmorphism UI, fluid animations (Framer Motion), and a dark-themed aesthetic tailored for command & control centers.

## 🛠️ Technology Stack

| Layer | Technologies |
| :--- | :--- |
| **Frontend** | Next.js 16, TypeScript, Tailwind CSS 4.0 |
| **Visualization** | MapLibre GL JS, React-Map-GL, Framer Motion |
| **Data Processing**| Apache Spark Streaming |
| **Backend/DB** | Prisma ORM, PostgreSQL (via Supabase/Local) |
| **AI/ML** | PyTorch (LSTM), Python (Data Engineering) |
| **Styling** | Shadcn UI, Lucide Icons |

## 🚀 Getting Started

### Prerequisites
- Node.js 18+ 
- Bun (recommended) or NPM

### Installation
```bash
# Clone the repository
git clone https://github.com/your-org/road-trafic-pred.git

# Install dependencies
bun install

# Database setup
bun db:push

# Launch development server
bun dev
```

## 📈 Performance & Results

Our models are optimized for precision. In the **Specific Model** paradigm, we achieve:
- **Mean Absolute Error (MAE)**: 2.17
- **Root Mean Square Error (RMSE)**: 3.08
- **Global Accuracy**: 91.2%

## 📖 Mapping Methodology
For details on how tabular dataset coordinates are mapped to real-world visual road segments, see [MAPPING_METHOD.md](./MAPPING_METHOD.md).

---

## 👥 Authors

- **Joel ADZONYA** - *AI Research & Core Infrastructure*
- **Ghislaine EKLOU** - *Data Engineering & Visualization Design*

## 📄 License
This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
