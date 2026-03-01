# ── Build stage: compile native node-pty against Alpine/musl ──────────────────
FROM node:20-alpine AS builder

RUN apk add --no-cache python3 make g++

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev

# ── Runtime stage ──────────────────────────────────────────────────────────────
FROM node:20-alpine

# docker CLI so we can spawn: docker exec -it <container> /bin/bash
RUN apk add --no-cache docker-cli

WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY src/ ./src/

EXPOSE 3000
CMD ["node", "src/index.js"]
