#!/bin/bash
# 🔍 Test de connexion Aiven Kafka

set -e
cd /home/jojo/road-traffic-pred

# Charger .env
export $(cat .env | grep -v '^#' | xargs)

echo "🔐 Test connexion Aiven Kafka..."
echo "   Host: $KAFKA_HOST:$KAFKA_PORT"
echo "   Username: $KAFKA_USERNAME"
echo "   SSL CA: $KAFKA_SSL_CA"
echo ""

# Vérifier fichiers certs
echo "✓ Vérification des certificats..."
ls -lh certs/ca.pem certs/service.cert certs/service.key

echo ""
echo "✓ Activant venv..."
source backend_venv/bin/activate

echo ""
echo "🧪 Test Python Kafka..."
python3 << 'EOF'
import os
from pathlib import Path
from kafka import KafkaConsumer
from kafka.errors import KafkaError

try:
    host = os.getenv("KAFKA_HOST")
    port = int(os.getenv("KAFKA_PORT", "9092"))
    username = os.getenv("KAFKA_USERNAME", "")
    password = os.getenv("KAFKA_PASSWORD", "")
    ca_path = os.getenv("KAFKA_SSL_CA", "")
    
    bootstrap_server = f"{host}:{port}"
    
    opts = {
        "bootstrap_servers": [bootstrap_server],
        "security_protocol": "SASL_SSL",
        "sasl_mechanism": "PLAIN",
        "sasl_plain_username": username,
        "sasl_plain_password": password,
        "ssl_cafile": ca_path,
        "api_version_auto_discovery_enabled": False,
        "api_version": (2, 8, 0),
        "session_timeout_ms": 6000,
        "request_timeout_ms": 12000,
    }
    
    print(f"📡 Connexion à {bootstrap_server}...")
    consumer = KafkaConsumer(**opts)
    
    # Test listing topics
    topics = consumer.topics()
    print(f"✅ CONNECTÉ! Topics disponibles: {topics}")
    
except KafkaError as e:
    print(f"❌ Erreur Kafka: {e}")
except Exception as e:
    print(f"❌ Erreur: {e}")
EOF

echo ""
echo "✅ Test terminé!"
