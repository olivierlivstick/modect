# ── Build stage ──────────────────────────────────────────────────────────────
FROM node:20-slim AS builder

# Outils nécessaires pour compiler @livekit/rtc-node (addon natif Rust/N-API)
RUN apt-get update && apt-get install -y \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Installer les dépendances (avec les devDeps pour la compilation TypeScript)
# Les chemins sont relatifs à la racine du repo (build context = racine)
COPY apps/agent/package*.json ./
RUN npm ci

# Copier les sources et compiler
COPY apps/agent/tsconfig.json ./
COPY apps/agent/src ./src
RUN npm run build

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM node:20-slim AS runner

RUN apt-get update && apt-get install -y \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Uniquement les dépendances de production
COPY apps/agent/package*.json ./
RUN npm install --omit=dev

# Copier le build compilé depuis le builder
COPY --from=builder /app/dist ./dist

# Port exposé (doit correspondre à PORT dans src/index.ts)
EXPOSE 3001

ENV NODE_ENV=production

CMD ["node", "dist/index.js"]
