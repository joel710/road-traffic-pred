# 📖 Documentation Technique Backend & Streaming

Ce document fournit une vue d'ensemble détaillée de l'implémentation du backend pour le projet de prédiction du trafic routier.

---

## 1. Architecture Globale
Le système est conçu comme un pipeline de données en temps réel composé de quatre briques principales :
1.  **Simulateur (Producteur)** : Injecte les données du dataset `test.csv` dans Kafka.
2.  **Spark Streaming (Processeur)** : Consomme les données, maintient l'état des jonctions (lags), effectue des prédictions via un modèle PyTorch et distribue les résultats.
3.  **FastAPI (Backend API)** : Sert d'interface pour le frontend, fournissant des données historiques, l'état actuel et un flux WebSocket temps réel.
4.  **Infrastructure de Données** : Kafka (Broker), Redis (Cache & Pub/Sub), PostgreSQL (Historique).

---

## 2. API Backend (FastAPI)
Localisation : `mini-services/api/`

L'API est le point d'entrée pour toutes les requêtes du frontend.

### Points de terminaison (Endpoints)
-   `GET /traffic/current` : Interroge Redis pour récupérer l'état le plus récent de chaque jonction (clé `junction:{id}:status`).
-   `GET /traffic/history/{junction_id}` : Récupère les 100 dernières prédictions et valeurs réelles depuis PostgreSQL pour une jonction spécifique.
-   `POST /simulation/start` : Envoie une requête au service `simulator` pour lancer la lecture du fichier CSV.
-   `WS /ws/traffic` : WebSocket pour recevoir les mises à jour de trafic en temps réel.

### Gestion du Temps Réel
-   **Redis Pub/Sub** : Le backend écoute le canal `traffic_updates`. Dès qu'une nouvelle prédiction est produite par Spark, elle est publiée sur ce canal.
-   **Écoute Asynchrone** : Une tâche de fond `redis_listener` utilise `pubsub.listen()` pour capter ces messages et les diffuser (`broadcast`) à tous les clients WebSockets connectés.

---

## 3. Simulateur de Trafic
Localisation : `mini-services/simulator/`

Le simulateur transforme le fichier statique `data/test.csv` en un flux dynamique.

### Logique de Fonctionnement
1.  **Lecture & Tri** : Charge le CSV avec Pandas et trie les données par `DateTime` pour respecter la chronologie réelle.
2.  **Production Kafka** : Pour chaque ligne, convertit les données en JSON et les envoie au topic `traffic_data`.
3.  **Contrôle de Fréquence** : Une pause de 1 seconde entre chaque envoi simule le passage du temps.
4.  **Interface de Contrôle** : Expose sa propre API (port 8001) avec `/start`, `/stop`, et `/status` pour permettre au Backend principal de piloter la simulation.

---

## 4. Processeur Spark Streaming
Localisation : `mini-services/spark/`

C'est le composant le plus complexe, gérant le calcul distribué et l'inférence.

### Traitement d'État (Stateful Processing)
-   **`applyInPandasWithState`** : Utilisé pour maintenir les variables `veh_lag_n`. Spark regroupe les données par `Junction`. Pour chaque groupe, il maintient un état persistant (une liste des 24 dernières valeurs de trafic).
-   **Mise à jour de l'état** : À chaque nouveau batch, le processeur récupère l'état précédent, calcule la prédiction, met à jour les lags avec les nouvelles valeurs reçues, et sauvegarde le nouvel état.

### Inférence PyTorch
-   **Modèle LSTM** : Charge `global_model.pt` sur chaque worker Spark.
-   **Calcul** : Les caractéristiques (heure, jour, mois, lags) sont transformées en tenseurs PyTorch pour l'inférence. Le modèle prédit le volume de trafic à T+1.

### Sinks (Sorties)
Pour éviter l'anti-pattern `collect()`, le processeur utilise `foreachPartition` :
-   Chaque partition de données ouvre ses propres connexions à Redis et PostgreSQL.
-   Les résultats sont insérés dans PostgreSQL pour l'historique.
-   L'état actuel est mis à jour dans Redis.
-   Un message est publié sur Redis Pub/Sub pour déclencher la mise à jour UI via WebSocket.

---

## 5. Infrastructure & Déploiement

### Base de Données (PostgreSQL)
-   **Table `predictions`** : Stocke `timestamp`, `junction_id`, `actual_vehicles`, et `predicted_vehicles`.
-   **Initialisation** : Script `db/init.sql` exécuté automatiquement au premier lancement.

### Docker Compose
Le fichier `docker-compose.yml` orchestre 8 services :
-   `zookeeper` & `kafka` : Infrastructure de messagerie.
-   `db` & `redis` : Stockage persistant et volatile.
-   `backend` : API FastAPI.
-   `simulator` : Producteur de données.
-   `spark-master` & `spark-worker` : Cluster de traitement.
-   `spark-job` : Conteneur éphémère qui soumet le script `spark_processor.py` au cluster au démarrage.

---

## 6. Guide d'Utilisation
1.  **Lancement** : `docker-compose up --build`
2.  **Initialisation du modèle** : Assurez-vous que `global_model.pt` est présent dans le dossier `models/`.
3.  **Démarrage de la simulation** : Appeler `POST http://localhost:8000/simulation/start`.
4.  **Visualisation** : Connecter le frontend au WebSocket `ws://localhost:8000/ws/traffic`.
