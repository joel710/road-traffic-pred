#!/bin/bash

# Script de démarrage complet du backend + Spark + Simulator
# Usage: ./start-all.sh

set -e

PROJECT_ROOT="/home/jojo/road-traffic-pred"
SPARK_HOME="/home/jojo/tools/spark"
VENV_PATH="$PROJECT_ROOT/backend_venv"

# Couleurs
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}╔════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   🚀 Road Traffic Prediction - Complete Setup      ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════╝${NC}"

# Vérification de l'existence de .env
if [ ! -f "$PROJECT_ROOT/.env" ]; then
    echo -e "${RED}❌ Erreur: .env n'existe pas!${NC}"
    echo -e "${YELLOW}Créez un .env avec vos credentials Aiven:${NC}"
    echo "   cp .env.example .env"
    echo "   # Éditez .env avec vos informations Aiven"
    exit 1
fi

echo -e "${GREEN}✅ Configuration trouvée${NC}"

# Activation venv
echo -e "${BLUE}📦 Activation venv backend...${NC}"
source "$VENV_PATH/bin/activate"

# Vérification Spark
echo -e "${BLUE}🔍 Vérification Spark...${NC}"
if [ ! -f "$SPARK_HOME/bin/spark-submit" ]; then
    echo -e "${RED}❌ Spark non trouvé à $SPARK_HOME${NC}"
    exit 1
fi
echo -e "${GREEN}✅ Spark trouvé${NC}"

# Vérification PyTorch
echo -e "${BLUE}🔍 Vérification PyTorch...${NC}"
python -c "import torch; print(f'✅ PyTorch {torch.__version__}')" || {
    echo -e "${RED}❌ PyTorch non trouvé. Installez via Docker ou:${NC}"
    echo "   pip install torch pandas numpy"
    exit 1
}

# Variables d'env
export SPARK_HOME="$SPARK_HOME"
export PATH="$SPARK_HOME/bin:$PATH"
export PYSPARK_PYTHON=python3
export PYSPARK_DRIVER_PYTHON=python3

echo -e "${YELLOW}═══════════════════════════════════════════════════${NC}"
echo -e "${YELLOW}  Services à démarrer (ouvrez des terminaux séparés)${NC}"
echo -e "${YELLOW}═══════════════════════════════════════════════════${NC}"

echo ""
echo -e "${BLUE}1️⃣  TERMINAL 1 - API Backend:${NC}"
echo "   cd $PROJECT_ROOT"
echo "   source $VENV_PATH/bin/activate"
echo "   uvicorn mini-services/api/main:app --host 0.0.0.0 --port 8000 --reload"
echo ""

echo -e "${BLUE}2️⃣  TERMINAL 2 - Simulator (option 1 - script):${NC}"
echo "   cd $PROJECT_ROOT"
echo "   source $VENV_PATH/bin/activate"
echo "   python mini-services/simulator/main.py"
echo ""

echo -e "${BLUE}   OU TERMINAL 2 - Simulator (option 2 - FastAPI):${NC}"
echo "   cd $PROJECT_ROOT"
echo "   source $VENV_PATH/bin/activate"
echo "   uvicorn mini-services/simulator/simulator:app --host 0.0.0.0 --port 8001"
echo "   # Puis: curl -X POST http://localhost:8001/start"
echo ""

echo -e "${BLUE}3️⃣  TERMINAL 3 - Spark Streaming Job:${NC}"
echo "   cd $PROJECT_ROOT"
echo "   source $VENV_PATH/bin/activate"
echo "   export SPARK_HOME=$SPARK_HOME"
echo "   export PATH=\$SPARK_HOME/bin:\$PATH"
echo "   \$SPARK_HOME/bin/spark-submit \\"
echo "     --master local[*] \\"
echo "     --packages org.apache.spark:spark-sql-kafka-0-10_2.12:3.5.0 \\"
echo "     mini-services/spark/spark_processor.py"
echo ""

echo -e "${YELLOW}═══════════════════════════════════════════════════${NC}"
echo ""

echo -e "${GREEN}✅ Setup complété ! Ouvrez 3 terminaux et lancez les commandes ci-dessus.${NC}"
echo ""
echo -e "${BLUE}Pour tester le flux complet:${NC}"
echo "  • Terminal 1: L'API sera à http://localhost:8000"
echo "  • Terminal 2: Le simulator ou API sera à http://localhost:8001"
echo "  • Terminal 3: Spark traitera les messages Kafka"
echo ""
echo -e "${BLUE}Vérification:${NC}"
echo "  • API Status: http://localhost:8000/"
echo "  • WebSocket: ws://localhost:8000/ws/traffic"
echo "  • Historique: http://localhost:8000/traffic/current"
echo ""
