# ── Stage 1: Build dependencies ──
FROM node:20-alpine AS builder

WORKDIR /app

# Install build tools needed for native modules (better-sqlite3, bcrypt)
RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi

# ── Stage 2: Production image ──
FROM node:20-alpine

LABEL maintainer="PDW Monitor"
LABEL description="Pager monitoring web app - POCSAG/FLEX decoder"

# tini for proper PID 1 / signal handling, curl for healthcheck
RUN apk add --no-cache tini curl

# Non-root user
RUN addgroup -S pdw && adduser -S pdw -G pdw

WORKDIR /app

# Copy built node_modules from builder
COPY --from=builder /app/node_modules ./node_modules

# Copy application code
COPY package.json ./
COPY server/ ./server/
COPY public/ ./public/
COPY docker-entrypoint.sh ./

RUN chmod +x docker-entrypoint.sh && chown -R pdw:pdw /app && chown -R pdw:pdw /app

# Data volume mount point (SQLite DB lives here)
RUN mkdir -p /data && chown pdw:pdw /data
VOLUME /data

# Default env vars
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    DB_PATH=/data/pdw.db

EXPOSE 3000

# Use tini as init - handles SIGTERM/SIGINT properly, reaps zombies
ENTRYPOINT ["/sbin/tini", "--"]

USER pdw

CMD ["./docker-entrypoint.sh"]
