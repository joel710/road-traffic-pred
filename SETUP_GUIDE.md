# 🚀 Guide de Configuration Complète - Kafka + Spark + LSTM

## 📋 Prérequis

- **Java 11+** ✅ (Installé : `/usr/bin/java`)
- **Python 3.11+** ✅ 
- **Spark 3.5.0** 🔄 (En téléchargement)
- **Aiven Kafka** 🔧 (À configurer avec vos credentials)

---

## ⚙️ PHASE 1: Configuration Aiven Kafka

### 1.1 Récupérer vos credentials Aiven

Connectez-vous à **[Aiven Console](https://console.aiven.io)** et :

1. Allez à votre service Kafka
2. Onglet **"Connection information"**
3. Copiez :
   - **Host** (ex: `kafka-xxx.a.aivencloud.com`)
   - **Port** (normalement `9092`)
   - **Username** (ex: `avnadmin`)
   - **Password** 
   - **CA Certificate** (téléchargez `ca.pem`)

### 1.2 Créer les Topics

```bash
# Dans Aiven Console ou via CLI:
# Topic 1: flux_data (INPUT - du simulateur vers Spark)
# Topic 2: traffic_predictions (OUTPUT - de Spark vers API)
```

### 1.3 Remplir `.env`

```bash
cp .env.example .env
# Éditez .env avec vos credentials:
KAFKA_HOST=your-service.a.aivencloud.com
KAFKA_PORT=9092
KAFKA_USERNAME=avnadmin
KAFKA_PASSWORD=your-password-here
KAFKA_SSL_CA=/app/certs/ca.pem
KAFKA_TOPIC_INPUT=flux_data
KAFKA_TOPIC_OUTPUT=traffic_predictions
```

Placez aussi le fichier `ca.pem` dans `certs/` :
```bash
# Téléchargez depuis Aiven Console
cp ~/Downloads/ca.pem certs/ca.pem
chmod 644 certs/ca.pem
```

---

## 📦 PHASE 2: Installation Spark + Dépendances Python

### 2.1 Vérifier Spark

```bash
# Attendre que le téléchargement se termine
ls -la /opt/spark/bin/spark-submit

# Test rapide
/opt/spark/bin/spark-submit --version
```

### 2.2 Installation des dépendances (déjà complétées)

**Backend API** (FastAPI + Kafka):
```bash
source backend_venv/bin/activate
pip install -r mini-services/api/requirements.txt  # ✅ Fait
```

**Simulator** (Kafka Producer):
```bash
pip install -r mini-services/simulator/requirements.txt
```

**Spark Processor** (LSTM Inference):
```bash
# À faire après que Spark soit prêt
# Les dépendances PyTorch seront installées dans le Docker
```

---

## 🧪 PHASE 3: Tests Locaux (Avant Docker)

### 3.1 Tester la connexion Kafka

```bash
cd /home/jojo/road-traffic-pred
source backend_venv/bin/activate

# Test 1: Vérifier que Kafka est accessible
python -c "
from kafka import KafkaConsumer
import os
from dotenv import load_dotenv

load_dotenv()
try:
    consumer = KafkaConsumer('test', bootstrap_servers=os.getenv('KAFKA_HOST'))
    print('✅ Kafka connected!')
except Exception as e:
    print(f'❌ Kafka error: {e}')
"
```

### 3.2 Démarrer l'API Backend

```bash
cd /home/jojo/road-traffic-pred
source backend_venv/bin/activate
uvicorn mini-services/api/main:app --host 0.0.0.0 --port 8000 --reload
```

Test: `http://localhost:8000` → Vous devriez voir `{"status": "online"}`

### 3.3 Lancer le Simulator

```bash
# Terminal 2
source backend_venv/bin/activate
python mini-services/simulator/main.py
```

Ou démarrer le serveur FastAPI du simulator:
```bash
uvicorn mini-services/simulator/simulator:app --host 0.0.0.0 --port 8001
```

Puis appeler: `curl -X POST http://localhost:8001/start`

### 3.4 Démarrer Spark Processor

```bash
# Terminal 3 (une fois Spark prêt)
export SPARK_HOME=/opt/spark
export PATH=$PATH:$SPARK_HOME/bin

# Lancer le job Spark
$SPARK_HOME/bin/spark-submit \
  --master local[*] \
  --packages org.apache.spark:spark-sql-kafka-0-10_2.12:3.5.0 \
  mini-services/spark/spark_processor.py
```

### 3.5 Vérifier le flux complet

```bash
# Vérifier les messages Kafka (dans un terminal séparé)
# À faire avec un consumer Kafka
```

---

## 🐳 PHASE 4: Docker Compose (Production)

```bash
# Vérifier les volumes pour les certs et modèles
docker-compose up -d

# Vérifier les logs
docker-compose logs -f backend
docker-compose logs -f spark-processor
docker-compose logs -f simulator
```

---

## 🔗 PHASE 5: Connecter le Frontend

Voir [src/components/traffic/TrafficMap.tsx](src/components/traffic/TrafficMap.tsx)

```typescript
const ws = new WebSocket('ws://localhost:8000/ws/traffic');
ws.onmessage = (event) => {
  const prediction = JSON.parse(event.data);
  // Mettre à jour la carte avec: 
  // - prediction.Junction
  // - prediction.PredictedVehicles
  // - prediction.Status (fluid|moderate|congested)
};
```

---

## 📊 Architecture Complète

```
┌─────────────────────────────────────────────────────┐
│            FLUX DE DONNÉES TEMPS RÉEL                │
├─────────────────────────────────────────────────────┤
│                                                      │
│  Aiven Kafka: flux_data (INPUT)                    │
│         ↓                                            │
│  ┌──────────────────────────────────┐              │
│  │   SIMULATOR (Python)              │              │
│  │   Lit test.csv → envoie Kafka     │              │
│  └──────────────────────────────────┘              │
│         ↓                                            │
│  Aiven Kafka: flux_data                            │
│         ↓                                            │
│  ┌──────────────────────────────────┐              │
│  │   SPARK PROCESSOR                 │              │
│  │   • Consomme flux_data            │              │
│  │   • Charge LSTM (PyTorch)        │              │
│  │   • Prédit Vehicles (T+1)         │              │
│  │   • Classe: fluid|moderate|cong  │              │
│  └──────────────────────────────────┘              │
│         ↓                                            │
│  Aiven Kafka: traffic_predictions                  │
│         ↓                                            │
│  ┌──────────────────────────────────┐              │
│  │   API BACKEND (FastAPI)           │              │
│  │   • WebSocket /ws/traffic        │              │
│  │   • REST /traffic/current        │              │
│  │   • REST /traffic/history        │              │
│  └──────────────────────────────────┘              │
│         ↓                                            │
│  ┌──────────────────────────────────┐              │
│  │   FRONTEND (Next.js)              │              │
│  │   • Carte 3D (MapLibre)           │              │
│  │   • WebSocket client              │              │
│  │   • Temps réel                    │              │
│  └──────────────────────────────────┘              │
└─────────────────────────────────────────────────────┘
```

---

## 🆘 Troubleshooting

### Kafka Connection Refused
- Vérifiez que Aiven Kafka est accessible
- Vérifiez `KAFKA_HOST`, `KAFKA_PORT`, credentials dans `.env`
- Testez SSL: `openssl s_client -connect host:9092`

### Spark Job Won't Start
- Vérifiez `spark-submit` est accessible: `$SPARK_HOME/bin/spark-submit --version`
- Vérifiez PyTorch est installé: `python -c "import torch; print(torch.__version__)"`
- Vérifiez model path: `ls models/global_model.pt`

### Model Not Loading
- Vérifiez chemin dans `spark_processor.py`: `MODEL_PATH = "models/global_model.pt"`
- Vérifiez le modèle PyTorch est compatible: `torch==2.1.1`

### WebSocket No Messages
- Vérifiez API reçoit messages Kafka: voir logs `/traffic/current`
- Vérifiez frontend WebSocket URL: `ws://localhost:8000/ws/traffic`
- Vérifiez CORS dans main.py (déjà configuré ✅)

---

## 📚 Ressources

- [Aiven Kafka Docs](https://docs.aiven.io/docs/products/kafka)
- [Apache Spark Docs](https://spark.apache.org/docs/latest/)
- [PyTorch Docs](https://pytorch.org/docs/)
- [FastAPI Docs](https://fastapi.tiangolo.com/)
