# Wieloetapowy build: buduje frontend, potem serwuje go z backendu FastAPI
# jako JEDNA usługa pod jednym adresem URL.

# --- Etap 1: build frontendu (React + Vite) --------------------------------- #
FROM node:20-slim AS frontend
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# --- Etap 2: backend (Python + FastAPI) + statyczny frontend ---------------- #
FROM python:3.11-slim
WORKDIR /app

# Zależności Pythona
COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

# Kod backendu + zbudowany frontend (ścieżka zgodna z FRONTEND_DIST w main.py)
COPY backend/ backend/
COPY --from=frontend /app/frontend/dist frontend/dist

# Trwałe miejsce na lokalną historię (SQLite)
ENV FSA_DB_PATH=/app/data/history.db
RUN mkdir -p /app/data

WORKDIR /app/backend
EXPOSE 8000
# Hosty (Render/Railway/HF) wstrzykują $PORT; lokalnie domyślnie 8000.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
