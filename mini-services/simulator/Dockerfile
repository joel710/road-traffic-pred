FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .
# The simulator needs access to the data folder
# We will mount it via docker-compose or copy it here if it's small
# Since it's in the root of the project, and we are building from root context
# but COPY . . might not include ../data if context is mini-services/simulator
# In docker-compose.yml, context is .

CMD ["python", "simulator.py"]
