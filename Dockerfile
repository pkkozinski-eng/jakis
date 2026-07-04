# Uniwersalny obraz do wdrozenia na dowolnym hostingu kontenerow
# (Fly.io, Railway, Google Cloud Run, VPS z Dockerem itp.).
FROM node:22-slim

WORKDIR /app

# better-sqlite3 kompiluje sie z prebuild; narzedzia budowania na wszelki wypadek.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

# Trwale dane trzymamy w /data (zamontuj wolumen na ten katalog).
ENV DATABASE_FILE=/data/typer.db
ENV PORT=3000
VOLUME /data
EXPOSE 3000

CMD ["npm", "start"]
