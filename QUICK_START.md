# 🚀 KINETIC FLOW - Quick Start Guide

## ✅ Installation Complète

### Prérequis Vérifiés ✓
- ✅ Java installé
- ✅ Spark 3.5.0 dans `/home/jojo/tools/spark`
- ✅ Python venv avec dépendances
- ✅ Certificates Aiven dans `certs/`
- ✅ Favicon SVG généré

---

## 🔐 Étape 1: Finaliser la Configuration `.env`

```bash
cd /home/jojo/road-traffic-pred

# Éditer le .env et ajouter votre mot de passe Aiven
nano .env

# Complétez ces 2 lignes OBLIGATOIRES:
KAFKA_HOST=kafka-4238954-kafka-2c1f.h.aivencloud.com
KAFKA_PORT=17498
KAFKA_USERNAME=avnadmin
KAFKA_PASSWORD=YOUR_PASSWORD_HERE  # ← Récupérez de Aiven Console
```

### Vérifier Connexion Kafka

```bash
chmod +x test_kafka.sh
./test_kafka.sh
```

Attendez le message: **✅ CONNECTÉ! Topics disponibles:**

---

## 🚀 Étape 2: Démarrer Tous les Services

### Option A: Script Automatique (Recommandé)

```bash
chmod +x start-services.sh
./start-services.sh
```

### Option B: Manuellement (3 Terminaux)

**Terminal 1 - API Backend:**
```bash
cd /home/jojo/road-traffic-pred
source backend_venv/bin/activate
uvicorn mini-services/api/main:app --host 0.0.0.0 --port 8000 --reload
```
✅ Vous devez voir: `Uvicorn running on http://0.0.0.0:8000`

**Terminal 2 - Spark Processor:**
```bash
cd /home/jojo/road-traffic-pred
export SPARK_HOME=/home/jojo/tools/spark
export PATH=$PATH:$SPARK_HOME/bin
source backend_venv/bin/activate

$SPARK_HOME/bin/spark-submit \
  --master local[*] \
  --packages org.apache.spark:spark-sql-kafka-0-10_2.12:3.5.0 \
  --driver-memory 1g \
  --executor-memory 1g \
  --total-executor-cores 2 \
  mini-services/spark/spark_processor.py
```
✅ Vous devez voir: `📥 Reading from Kafka topic 'flux_data'`

**Terminal 3 - Frontend (Nouveau Terminal):**
```bash
cd /home/jojo/road-traffic-pred
npm run dev
# ou
bun dev
```
✅ Vous devez voir: `> ready - started server on 0.0.0.0:3000`

---

## 🧪 Étape 3: Tester le Flux Complet

### Test 1: Vérifier la Connexion API

```bash
curl http://localhost:8000/
# Résultat attendu: {"status":"online",...}
```

### Test 2: Vérifier les Connections WebSocket

Ouvrez votre navigateur et allez à: **http://localhost:3000**

Vous devriez voir:
1. **Launchpad** avec les junctions proposées
2. Cliquez sur une junction → Vous accédez au **Dashboard**
3. Cliquez sur le bouton **"Start Test"** → Activation du simulator

### Test 3: Vérifier les Prédictions

Après avoir cliqué "Start Test":
- Les données doivent arriver dans Spark
- Les prédictions doivent s'afficher en temps réel
- La Tesla doit bouger sur la carte

---

## 📊 Optimisation des Ressources

### Configuration Actuelle (Économe)

```env
SPARK_EXECUTOR_MEMORY=1g       # 1GB par exécuteur (au lieu de 2GB)
SPARK_DRIVER_MEMORY=1g         # 1GB pour le driver
SPARK_EXECUTOR_CORES=2         # 2 cores au lieu de 4
SPARK_SHUFFLE_PARTITIONS=4     # 4 partitions au lieu de 200

STREAM_DELAY=2.0               # Streaming à 2s (moins de bande passante)
UVICORN_WORKERS=1              # 1 worker au lieu de 4
```

### Surveillance Ressources

```bash
# Terminal séparé - Surveiller CPU/Mémoire
watch -n 1 'ps aux | grep -E "spark|java|python" | grep -v grep'

# Ou utiliser top
top -p $(pgrep -d, -f 'spark|java|python')
```

---

## 🎨 Frontend - Changements

### ✨ Nouveaux Éléments

1. **Favicon SVG** - Style moderne avec gradient navigation
2. **Launchpad** - Page d'accueil avec recherche de jonctions
3. **Dashboard** - Carte avec animations Tesla
4. **Journey Config** - Panneau pour configurer trajets
5. **Real-time Predictions** - Affichage live des prédictions

### 🎯 Removed

- ❌ Toggle "Global/Specific Model" (pas nécessaire)
- ❌ Sidebar classique (remplacée par navigation moderne)

### 🆕 Added

- ✅ Animations Tesla fluides (Apple-like)
- ✅ Algos détournement automatique si trafic dense
- ✅ Camera suivante la Tesla + changement d'angle possible
- ✅ Prédictions affichées au-dessus de chaque véhicule

---

## 🆘 Troubleshooting

### Erreur: "Kafka broker not available"

```bash
# Vérifier credentials .env
cat .env | grep KAFKA_

# Tester connexion directe
openssl s_client -connect kafka-4238954-kafka-2c1f.h.aivencloud.com:17498
```

### Erreur: "Spark job fails to start"

```bash
# Vérifier Spark installation
$SPARK_HOME/bin/spark-submit --version

# Vérifier PyTorch
python -c "import torch; print(torch.__version__)"

# Vérifier Model path
ls -la models/global_model.pt
```

### Erreur: "WebSocket connection refused"

```bash
# Vérifier API est bien running
curl http://localhost:8000/health

# Vérifier port 8000 est libre
lsof -i :8000
```

### Frontend affiche "Loading map..."

```bash
# Vérifier que Spark envoie les prédictions
# Dans logs Spark, vous devez voir:
# "🔮 Published X predictions to topic 'traffic_predictions'"

# Vérifier les logs API
tail -f /tmp/uvicorn.log
```

---

## 📈 Performance Attendue

| Metric | Target |
|--------|--------|
| Latency (Kafka→Prédiction) | < 500ms |
| Memory (Spark) | ~800MB |
| CPU (API) | ~5% idle |
| Predictions/sec | ~5-10 |
| WebSocket connections | 100+ simultanées |

---

## 📱 Utilisation Frontend

### Launchpad (Page d'accueil)
1. Recherchez une jonction
2. Cliquez sur "Quick Routes" ou un junction
3. Vous êtes dirigé vers le Dashboard

### Dashboard
1. Cliquez "Start Test" pour activer le simulator
2. Configure votre trajet en bas (start → end)
3. Validez pour spawner une Tesla
4. Observez les prédictions en temps réel
5. La Tesla se détourne auto si trafic dense

---

## 🎬 Next Steps

- [ ] Configurer vraies données (au lieu de simulator)
- [ ] Ajouter persistance prédictions en DB
- [ ] Dashboard analytics (graphiques historique)
- [ ] Alerts SMS/Email si trafic anormal
- [ ] Mobile app (React Native)
- [ ] Intégration Google Maps API

---

## 📞 Support

Si erreurs persistent:
1. Vérifiez les logs: `tail -f /tmp/*.log`
2. Relancez le service concerné
3. Vérifiez `.env` est bien configuré
4. Assurez-vous ports 3000, 8000, 8001 sont libres

---

**Version:** 1.0.0  
**Last Updated:** 2026-05-30  
**Status:** ✅ Ready for Production Testing
