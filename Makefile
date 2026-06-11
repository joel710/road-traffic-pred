.PHONY: up down rebuild logs ps

# ─── 🚀 Full stack (Frontend + Backend + Kafka + Simulator + Spark) ───
up:
	docker compose --profile full up --build -d
	@echo ""
	@echo "  ✅ Stack launched!"
	@echo "  🌐 Frontend : http://localhost:3000"
	@echo "  🔌 API      : http://localhost:8000"
	@echo "  📡 Simulator: http://localhost:8001"
	@echo ""

# ─── 🎯 Core only (no simulator / spark) ─────────────────────────
up-core:
	docker compose up --build -d
	@echo ""
	@echo "  ✅ Core stack launched!"
	@echo "  🌐 Frontend: http://localhost:3000"
	@echo "  🔌 API     : http://localhost:8000"
	@echo ""

# ─── 🛑 Stop everything ──────────────────────────────────────────
down:
	docker compose --profile full down

# ─── 📋 Live logs ────────────────────────────────────────────────
logs:
	docker compose --profile full logs -f

# ─── 📊 Container status ─────────────────────────────────────────
ps:
	docker compose --profile full ps

# ─── ♻️  Rebuild and restart ──────────────────────────────────────
rebuild: down up
