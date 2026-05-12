# 🏗️ Architecture Backend & Streaming - Road Traffic Prediction

Ce document détaille l'architecture complète du backend et du pipeline de streaming pour la simulation et la prédiction du trafic en temps réel.

## 📋 Présentation Globale
L'objectif est de transformer un dataset statique en un flux dynamique traité par **Spark Streaming**, avec une exposition via **FastAPI** pour le monitoring et la visualisation frontend.

---

## 🛠️ Stack Technique
- **Backend API** : FastAPI (Python)
- **Traitement de Flux** : Apache Spark (Structured Streaming)
- **Message Broker** : Apache Kafka (pour le découplage producteur/consommateur)
- **Stockage Temps Réel** : Redis (pour les états actuels des jonctions)
- **Base de Données** : PostgreSQL (historique des prédictions)
- **Conteneurisation** : Docker & Docker Compose

---

## 🛰️ Architecture du Pipeline

### 1. Simulateur de Flux (Producer)
Un script Python dédié lit le fichier `data/test.csv` et simule l'envoi de données vers Kafka.
- **Fréquence** : Configurable (ex: 1 ligne par seconde = 1 heure de trafic simulée).
- **Format** : JSON (DateTime, Junction, lag features).

### 2. Moteur de Streaming (Spark)
C'est le cœur analytique.
- **Ingestion** : Consomme les messages Kafka.
- **State Management** : Utilise les `watermarks` et le `stateful processing` pour maintenir les variables `veh_lag_n` nécessaires au modèle LSTM.
- **Inférence** : Charge le modèle `global_model.pt` (PyTorch) via une UDF (User Defined Function) Pandas pour prédire le nombre de véhicules à T+1.
- **Sink** : Envoie les résultats vers Redis (clé: `junction:{id}:status`) et PostgreSQL.

### 3. API Backend (FastAPI)
- **WebSockets/SSE** : Pousse les mises à jour en temps réel au frontend Next.js.
- **Endpoints REST** :
    - `GET /traffic/current` : Récupère l'état actuel de toutes les jonctions depuis Redis.
    - `GET /traffic/history/{junction_id}` : Historique depuis PostgreSQL.
    - `POST /simulation/start` : Lance le script de simulation.

---

## 🐳 Déploiement Docker

L'architecture est orchestrée via `docker-compose.yml` avec les services suivants :

| Service | Image / Dockerfile | Rôle |
|---------|---------------------|------|
| `kafka` | `confluentinc/cp-kafka` | Gestion des messages |
| `zookeeper` | `confluentinc/cp-zookeeper` | Coordination Kafka |
| `spark-master` | `bitnami/spark:latest` | Cluster Spark (Gestionnaire) |
| `spark-worker` | `bitnami/spark:latest` | Cluster Spark (Exécution) |
| `redis` | `redis:alpine` | Cache de statut live |
| `backend` | `./mini-services/api/Dockerfile` | API FastAPI |
| `simulator` | `./mini-services/simulator/Dockerfile` | Script d'envoi CSV -> Kafka |

---

## ⚠️ Contraintes & Besoins Spark Streaming

1. **Checkpointing** : Indispensable pour la tolérance aux pannes du streaming. Un volume Docker doit être monté pour stocker l'état.
2. **PyTorch Integration** : Les Workers Spark doivent avoir `torch` et `numpy` installés dans leur environnement Python.
3. **Pandas UDF** : Utilisation de `applyInPandasWithState` pour une performance optimale lors de l'inférence par lots sur les flux.
4. **Latency** : Le batch interval doit être réglé entre 500ms et 2s pour assurer une fluidité visuelle sur la carte.

---

## 🧪 Jeu de Test (Streaming Flow)

Le fichier `data/test.csv` servira de base. Pour simuler un flux réaliste :
- Les données seront envoyées dans l'ordre chronologique de la colonne `DateTime`.
- On injectera des anomalies (pics de trafic) pour tester la réactivité des alertes visuelles sur la carte (ex: passage au rouge si `Vehicles` > 80).

---

## ⏭️ Prochaines Étapes
1. Création des `Dockerfiles` spécifiques pour l'API et le Simulateur.
2. Écriture du script `spark_processor.py`.
3. Configuration du `docker-compose.yml` global.
