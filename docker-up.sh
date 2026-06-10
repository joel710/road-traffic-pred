#!/bin/bash
# Road Flow — One-command Docker launch
# Usage: ./docker-up.sh           # Frontend + API only
#        ./docker-up.sh --full    # Full stack (incl. Spark + Simulator)

set -e

# ─── Env Setup ──────────────────────────────────────────────────
if [ ! -f .env ]; then
  echo "📝 .env file not found. Creating from .env.example..."
  cp .env.example .env
  echo "✅ .env created. You can edit it if you want to use Aiven Kafka."
fi

COMPOSE_ARGS="up --build -d"


if [ "$1" = "--full" ]; then
  echo "🚀 Launching FULL stack: Frontend + API + Spark + Simulator"
  docker compose --profile full $COMPOSE_ARGS
else
  echo "🚀 Launching: Frontend + API (use --full for Spark + Simulator)"
  docker compose $COMPOSE_ARGS
fi

echo ""
echo "✅ Services:"
echo "   Frontend:  http://localhost:3000"
echo "   API:       http://localhost:8000"
echo "   API Docs:  http://localhost:8000/docs"

if [ "$1" = "--full" ]; then
  echo "   Simulator: http://localhost:8001"
  echo "   Spark UI:  http://localhost:4040"
fi

echo ""
echo "📋 docker compose logs -f     # Follow all logs"
echo "   docker compose down        # Stop all services"
