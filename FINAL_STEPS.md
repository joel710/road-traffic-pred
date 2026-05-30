# 🔐 ÉTAPES FINALES - Connecter Aiven Kafka

## ✅ Ce qui est déjà fait

- ✅ Venv Python créé
- ✅ Dépendances backend installées (FastAPI, Kafka, etc.)
- ✅ Scripts de démarrage préparés
- ✅ Diagnostic disponible
- ✅ Java + Python configurés
- ⏳ Spark 3.5.0 en téléchargement...

---

## 🔧 CE QU'IL VOUS RESTE À FAIRE

### **ÉTAPE 1: Créer votre .env avec les credentials Aiven**

Allez à https://console.aiven.io et récupérez :

```bash
# 1. Terminal:
cd /home/jojo/road-traffic-pred

# 2. Créer .env:
cp .env.example .env

# 3. Éditer .env avec vos credentials:
nano .env
```

**À remplir dans .env:**
```env
# Remplacez les valeurs par vos credentials Aiven:
KAFKA_HOST=votre-service.a.aivencloud.com
KAFKA_PORT=9092
KAFKA_USERNAME=avnadmin
KAFKA_PASSWORD=votre-mot-de-passe
KAFKA_SSL_CA=/home/jojo/road-traffic-pred/certs/ca.pem
```

### **ÉTAPE 2: Télécharger le certificat SSL Aiven**

```bash
# 1. Dans Aiven Console → Votre service Kafka
#    → "Connection information" → "CA Certificate"
#    → Cliquez "Download" → ca.pem

# 2. Dans terminal:
cp ~/Downloads/ca.pem /home/jojo/road-traffic-pred/certs/ca.pem
chmod 644 /home/jojo/road-traffic-pred/certs/ca.pem
```

### **ÉTAPE 3: Créer les Topics Kafka dans Aiven**

Dans Aiven Console:
1. Allez à votre service Kafka
2. Onglet "Topics"
3. Créez Topic 1:
   - Nom: `flux_data` (ou `FLUX_DATA`)
   - Partitions: 3
   - Replication: 2

4. Créez Topic 2:
   - Nom: `traffic_predictions`
   - Partitions: 3
   - Replication: 2

### **ÉTAPE 4: Vérifier que Spark s'est téléchargé**

```bash
ls -la /home/jojo/tools/spark/bin/spark-submit
# Doit afficher: -rwxr-xr-x ... /home/jojo/tools/spark/bin/spark-submit
```

Si le fichier n'existe pas, attendez ou relancez le téléchargement:
```bash
cd /tmp && wget https://archive.apache.org/dist/spark/spark-3.5.0/spark-3.5.0-bin-hadoop3.tgz
tar -xzf spark-3.5.0-bin-hadoop3.tgz
mv spark-3.5.0-bin-hadoop3 /home/jojo/tools/spark
```

### **ÉTAPE 5: Tester la connexion Kafka**

```bash
cd /home/jojo/road-traffic-pred
./test-kafka.sh
```

**Résultat attendu:**
```
🎉 Test Kafka complété avec succès!
```

### **ÉTAPE 6: Vérifier le diagnostic**

```bash
./diagnose.sh
```

**Résultat attendu:**
- ✅ Java
- ✅ Python 3
- ✅ Virtual Environment
- ✅ Apache Spark
- ✅ All .env checks
- ✅ kafka-python installed

---

## 🚀 Une fois tout configuré: Démarrer les services

Ouvrez **3 terminaux séparés** :

**Terminal 1 - API Backend:**
```bash
cd /home/jojo/road-traffic-pred
source backend_venv/bin/activate
uvicorn mini-services/api/main:app --host 0.0.0.0 --port 8000 --reload
```

**Terminal 2 - Simulator (Kafka Producer):**
```bash
cd /home/jojo/road-traffic-pred
source backend_venv/bin/activate
python mini-services/simulator/main.py
```

Ou avec FastAPI:
```bash
uvicorn mini-services/simulator/simulator:app --host 0.0.0.0 --port 8001
# Puis: curl -X POST http://localhost:8001/start
```

**Terminal 3 - Spark Streaming (LSTM Processing):**
```bash
cd /home/jojo/road-traffic-pred
source backend_venv/bin/activate
export SPARK_HOME=/home/jojo/tools/spark
$SPARK_HOME/bin/spark-submit \
  --master local[*] \
  --packages org.apache.spark:spark-sql-kafka-0-10_2.12:3.5.0 \
  mini-services/spark/spark_processor.py
```

---

## ✅ Vérifier que tout fonctionne

```bash
# Terminal séparé:

# 1. Vérifier API est en ligne:
curl http://localhost:8000/

# 2. Vérifier que les prédictions arrivent:
curl http://localhost:8000/traffic/current

# 3. Vérifier WebSocket frontend:
# Ouvrir frontend sur http://localhost:3000
# La carte devrait recevoir les mises à jour en temps réel
```

---

## 🆘 En cas de problème

### Erreur: "Kafka broker not available"
- Vérifiez .env: KAFKA_HOST, PORT, credentials
- Testez la connexion: `./test-kafka.sh`
- Vérifiez le certificat SSL: `ls certs/ca.pem`

### Erreur: "Spark: command not found"
- Vérifiez: `ls /home/jojo/tools/spark/bin/spark-submit`
- Si absent, relancez le téléchargement

### Erreur: "Model not loading in Spark"
- Vérifiez: `ls models/global_model.pt`
- Vérifiez MODEL_PATH dans .env

### WebSocket pas de messages
- Vérifiez que Spark envoie vers Kafka: voir logs Spark
- Vérifiez que l'API reçoit: curl http://localhost:8000/traffic/current
- Vérifiez WebSocket URL frontend: `ws://localhost:8000/ws/traffic`

---

## 📊 Flux complet une fois démarré

```
CSV (test.csv)
    ↓
Simulator → [KAFKA: flux_data] → Spark Processor
                                        ↓
                                [PyTorch LSTM Inference]
                                        ↓
                                [KAFKA: traffic_predictions]
                                        ↓
                                API Backend → WebSocket
                                        ↓
                                Frontend (3D Map)
```

---

**Besoin d'aide?** Relancez le diagnostic:
```bash
./diagnose.sh
```
