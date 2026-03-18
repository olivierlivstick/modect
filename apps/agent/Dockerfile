# ── Runtime (tsx, pas de compilation TypeScript) ─────────────────────────────
FROM node:20-slim

# Outils nécessaires pour compiler @livekit/rtc-node (addon natif Rust/N-API)
RUN apt-get update && apt-get install -y \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Arg pour forcer le bust de cache Railway
ARG CACHEBUST=1

# Installer TOUTES les dépendances (tsx est en devDep)
COPY apps/agent/package*.json ./
RUN npm install

# Copier les sources TypeScript
COPY apps/agent/tsconfig.json ./
COPY apps/agent/src ./src

EXPOSE 3001
ENV NODE_ENV=production

# Lancer directement avec tsx (pas de compilation)
CMD ["node", "--import", "tsx/esm", "src/index.ts"]
