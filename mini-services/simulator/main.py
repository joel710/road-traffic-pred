import pandas as pd
import httpx
import asyncio
import os
import json
from datetime import datetime

# Configuration
API_URL = os.getenv("API_URL", "http://localhost:8000/traffic/ingest")
DATA_PATH = "data/test.csv"
STREAM_DELAY = float(os.getenv("STREAM_DELAY", "1.0")) # secondes entre chaque ligne

async def run_simulation():
    print(f"🚀 Simulation démarrée. Lecture de {DATA_PATH}...")
    
    try:
        df = pd.read_csv(DATA_PATH)
    except FileNotFoundError:
        print(f"❌ Erreur : {DATA_PATH} introuvable.")
        return

    async with httpx.AsyncClient() as client:
        for index, row in df.iterrows():
            payload = row.to_dict()
            # On s'assure que DateTime est au format string
            if 'DateTime' in payload:
                payload['DateTime'] = str(payload['DateTime'])
            
            try:
                response = await client.post(API_URL, json=payload)
                if response.status_code == 200:
                    print(f"✅ [T={payload['DateTime']}] Jonction {payload['Junction']} envoyée.")
                else:
                    print(f"⚠️ Erreur API ({response.status_code}): {response.text}")
            except Exception as e:
                print(f"❌ Erreur de connexion : {e}")
            
            await asyncio.sleep(STREAM_DELAY)

if __name__ == "__main__":
    asyncio.run(run_simulation())
