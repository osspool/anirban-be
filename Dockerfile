# Multi-stage Dockerfile for Arc + Fastify
# Optimized for production and caching

# 1. Build Stage
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
COPY tsconfig*.json ./
# If using pnpm, bun, or yarn, adjust the lockfile here
RUN npm ci

COPY . .
RUN npm run build

# 2. Production Stage
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --only=production

COPY --from=builder /app/dist ./dist

EXPOSE 8040
CMD ["npm", "start"]
