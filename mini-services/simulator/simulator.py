import pandas as pd
import json
import time
import os
from kafka import KafkaProducer
from fastapi import FastAPI, BackgroundTasks
import uvicorn

app = FastAPI()

KAFKA_HOST = os.getenv("KAFKA_HOST", "localhost:9092")
TOPIC = "traffic_data"
CSV_PATH = "data/test.csv"

class TrafficSimulator:
    def __init__(self):
        self.producer = None
        self.is_running = False

    def connect_kafka(self):
        retries = 5
        while retries > 0:
            try:
                self.producer = KafkaProducer(
                    bootstrap_servers=[KAFKA_HOST],
                    value_serializer=lambda x: json.dumps(x).encode('utf-8')
                )
                print("Connected to Kafka")
                return True
            except Exception as e:
                print(f"Failed to connect to Kafka: {e}. Retrying...")
                retries -= 1
                time.sleep(5)
        return False

    def run(self):
        if not self.producer:
            if not self.connect_kafka():
                return

        self.is_running = True
        df = pd.read_csv(CSV_PATH)
        # Sort by DateTime to simulate chronologically
        df['DateTime'] = pd.to_datetime(df['DateTime'])
        df = df.sort_values('DateTime')

        print(f"Starting simulation with {len(df)} rows")
        for _, row in df.iterrows():
            if not self.is_running:
                break

            data = row.to_dict()
            data['DateTime'] = data['DateTime'].strftime('%Y-%m-%d %H:%M:%S')

            self.producer.send(TOPIC, value=data)
            # print(f"Sent: {data}")

            # Control frequency: 1 row per second
            time.sleep(1)

        self.is_running = False
        print("Simulation finished")

simulator = TrafficSimulator()

@app.post("/start")
async def start_simulation(background_tasks: BackgroundTasks):
    if simulator.is_running:
        return {"status": "already running"}
    background_tasks.add_task(simulator.run)
    return {"status": "started"}

@app.post("/stop")
async def stop_simulation():
    simulator.is_running = False
    return {"status": "stopped"}

@app.get("/status")
async def get_status():
    return {"is_running": simulator.is_running}

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8001)
