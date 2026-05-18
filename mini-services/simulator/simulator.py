import pandas as pd
import json
import time
import os
import asyncio
from kafka import KafkaProducer
from fastapi import FastAPI, BackgroundTasks
import uvicorn

app = FastAPI(title="Road Traffic Simulator - Kafka Broker Connected")

KAFKA_HOST = os.getenv("KAFKA_HOST", "kafka:29092")
TOPIC = "traffic_stream"
CSV_PATH = os.getenv("CSV_PATH", "data/test.csv")
STREAM_DELAY = float(os.getenv("STREAM_DELAY", "1.0"))  # Seconds between each row

class TrafficSimulator:
    def __init__(self):
        self.producer = None
        self.is_running = False

    def connect_kafka(self):
        retries = 10
        while retries > 0:
            try:
                self.producer = KafkaProducer(
                    bootstrap_servers=[KAFKA_HOST],
                    value_serializer=lambda x: json.dumps(x).encode('utf-8')
                )
                print("✅ Connected to Kafka Broker successfully.")
                return True
            except Exception as e:
                print(f"⚠️ Failed to connect to Kafka at {KAFKA_HOST}: {e}. Retrying in 5s...")
                retries -= 1
                time.sleep(5)
        return False

    async def run(self):
        if not self.producer:
            # Run blocking connection check in separate thread to avoid freezing FastAPI
            loop = asyncio.get_event_loop()
            connected = await loop.run_in_executor(None, self.connect_kafka)
            if not connected:
                print("❌ Critical: Could not connect to Kafka broker. Simulation aborted.")
                self.is_running = False
                return

        self.is_running = True
        print(f"🚀 Starting Kafka simulation. Reading {CSV_PATH}...")
        
        try:
            df = pd.read_csv(CSV_PATH)
        except Exception as e:
            print(f"❌ Error: Could not read CSV file at {CSV_PATH}: {e}")
            self.is_running = False
            return

        # Sort by DateTime to simulate chronologically
        df['DateTime'] = pd.to_datetime(df['DateTime'])
        df = df.sort_values('DateTime')

        print(f"📈 Loaded {len(df)} rows. Publishing to Kafka topic '{TOPIC}' every {STREAM_DELAY}s...")
        
        for _, row in df.iterrows():
            if not self.is_running:
                print("🛑 Simulation stopped by user request.")
                break

            data = row.to_dict()
            # Format DateTime as string
            data['DateTime'] = data['DateTime'].strftime('%Y-%m-%d %H:%M:%S')
            
            # Convert NaN to None for JSON compliance
            for k, v in list(data.items()):
                if pd.isna(v):
                    data[k] = None

            try:
                # Send asynchronously to Kafka
                self.producer.send(TOPIC, value=data)
                print(f"✅ Published: DateTime={data['DateTime']}, Junction={data['Junction']}, Vehicles={data['Vehicles']}")
            except Exception as e:
                print(f"⚠️ Failed to send row to Kafka: {e}")

            await asyncio.sleep(STREAM_DELAY)

        self.is_running = False
        print("🏁 Kafka Simulation loop terminated.")

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
