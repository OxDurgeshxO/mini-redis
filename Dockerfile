# Multi-stage production Docker build
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm ci || npm install
COPY src ./src
COPY benchmarks ./benchmarks
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache curl

COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev
COPY --from=builder /app/dist ./dist

# Create persistent storage mount point
RUN mkdir -p /data && chown -R node:node /data /app
USER node

EXPOSE 6379 9121

HEALTHCHECK --interval=15s --timeout=5s --start-period=5s --retries=3 \
  CMD curl -f http://127.0.0.1:9121/healthz || exit 1

CMD ["node", "dist/index.js"]
