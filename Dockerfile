# DORMEX Backend Production Dockerfile
FROM node:22-alpine AS builder

WORKDIR /app

# Install build dependencies
COPY package*.json ./
RUN npm ci

# Copy source code and build client & server
COPY . .
RUN npm run build:server
RUN npm run build:client

# Production Runner stage
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

# Install production dependencies only
COPY package*.json ./
RUN npm ci --omit=dev

# Copy compiled assets from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public ./public

# Expose server port
EXPOSE 3000

# Non-root user for security hardening
USER node

# Start DORMEX Fastify Server
CMD ["node", "dist/server.js"]
