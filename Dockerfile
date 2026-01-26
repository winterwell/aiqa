# Multi-stage Dockerfile for AIQA server + webapp with PostgreSQL, Redis, and Elasticsearch

# Stage 1: Base image with Node.js and system dependencies
FROM node:20-slim AS base

# Install system dependencies for PostgreSQL, Redis, Elasticsearch, and build tools
RUN apt-get update && apt-get install -y \
    postgresql postgresql-contrib \
    redis-server \
    curl \
    wget \
    gnupg \
    git \
    build-essential \
    python3 \
    && rm -rf /var/lib/apt/lists/*

# Install Elasticsearch (using newer method without deprecated apt-key)
RUN wget -qO - https://artifacts.elastic.co/GPG-KEY-elasticsearch | gpg --dearmor -o /usr/share/keyrings/elasticsearch-keyring.gpg \
    && echo "deb [signed-by=/usr/share/keyrings/elasticsearch-keyring.gpg] https://artifacts.elastic.co/packages/8.x/apt stable main" | tee /etc/apt/sources.list.d/elastic-8.x.list \
    && apt-get update \
    && apt-get install -y elasticsearch \
    && rm -rf /var/lib/apt/lists/*

# Install pnpm globally
RUN npm install -g pnpm

# Set working directory
WORKDIR /app

# Stage 2: Build server
FROM base AS server-builder

# Copy server files
COPY server/package.json server/package-lock.json ./server/
COPY server/tsconfig.json ./server/
COPY server/src ./server/src
COPY server/scripts ./server/scripts
COPY server/opentelemetry-proto ./server/opentelemetry-proto
COPY server/src/version.json ./server/src/
COPY server/subscriptions.json ./server/
COPY server/token_costs.csv ./server/

# Install server dependencies and build
WORKDIR /app/server
RUN pnpm install && pnpm run build

# Stage 3: Build webapp
FROM base AS webapp-builder

# Copy webapp files
COPY webapp/package.json webapp/package-lock.json ./webapp/
COPY webapp/tsconfig.json ./webapp/
COPY webapp/tsconfig.node.json ./webapp/
COPY webapp/vite.config.ts ./webapp/
COPY webapp/index.html ./webapp/
COPY webapp/.eslintrc.json ./webapp/
COPY webapp/src ./webapp/src
COPY webapp/public ./webapp/public

# Copy server common code for symlink during build
COPY server/src/common ./server/src/common

# Create symlink for shared common code
WORKDIR /app/webapp
RUN ln -s /app/server/src/common /app/webapp/src/common || true
RUN pnpm install && pnpm run build

# Stage 4: Final runtime image
FROM base AS runtime

# Copy built server
COPY --from=server-builder /app/server/dist ./server/dist
COPY --from=server-builder /app/server/node_modules ./server/node_modules
COPY --from=server-builder /app/server/package.json ./server/
COPY --from=server-builder /app/server/opentelemetry-proto ./server/opentelemetry-proto
COPY --from=server-builder /app/server/src/version.json ./server/src/
COPY --from=server-builder /app/server/subscriptions.json ./server/
COPY --from=server-builder /app/server/token_costs.csv ./server/

# Copy built webapp
COPY --from=webapp-builder /app/webapp/dist ./webapp/dist
COPY --from=webapp-builder /app/webapp/node_modules ./webapp/node_modules
COPY --from=webapp-builder /app/webapp/package.json ./webapp/
COPY --from=webapp-builder /app/webapp/vite.config.ts ./webapp/

# Copy server source for common symlink (needed at runtime)
COPY server/src/common ./server/src/common

# Create startup script
RUN echo '#!/bin/bash\n\
set -e\n\
\n\
# Start PostgreSQL\n\
service postgresql start\n\
\n\
# Wait for PostgreSQL to be ready\n\
until pg_isready -U postgres; do\n\
  echo "Waiting for PostgreSQL..."\n\
  sleep 1\n\
done\n\
\n\
# Create database and user if they don'\''t exist\n\
su - postgres -c "psql -c \\"CREATE USER aiqa WITH PASSWORD '\''aiqa'\'';\\" 2>/dev/null || true"\n\
su - postgres -c "psql -c \\"CREATE DATABASE aiqa OWNER aiqa;\\" 2>/dev/null || true"\n\
su - postgres -c "psql -c \\"ALTER USER aiqa CREATEDB;\\" 2>/dev/null || true"\n\
\n\
# Start Redis\n\
redis-server --daemonize yes\n\
\n\
# Wait for Redis to be ready\n\
until redis-cli ping > /dev/null 2>&1; do\n\
  echo "Waiting for Redis..."\n\
  sleep 1\n\
done\n\
\n\
# Configure Elasticsearch\n\
echo "network.host: 0.0.0.0" >> /etc/elasticsearch/elasticsearch.yml\n\
echo "discovery.type: single-node" >> /etc/elasticsearch/elasticsearch.yml\n\
echo "xpack.security.enabled: false" >> /etc/elasticsearch/elasticsearch.yml\n\
\n\
# Start Elasticsearch\n\
service elasticsearch start\n\
\n\
# Wait for Elasticsearch to be ready\n\
until curl -s http://localhost:9200 > /dev/null; do\n\
  echo "Waiting for Elasticsearch..."\n\
  sleep 2\n\
done\n\
\n\
# Set environment variables\n\
export DATABASE_URL="postgresql://aiqa:aiqa@localhost:5432/aiqa"\n\
export REDIS_URL="redis://localhost:6379"\n\
export ELASTICSEARCH_URL="http://localhost:9200"\n\
export PORT=${PORT:-4318}\n\
\n\
# Note: Common code symlink is not needed at runtime since webapp is pre-built\n\
\n\
# Start Fastify backend in background\n\
cd /app/server\n\
node dist/index.js &\n\
SERVER_PID=$!\n\
\n\
# Start webapp server (serving built files)\n\
cd /app/webapp\n\
pnpm exec vite preview --port 4000 --host 0.0.0.0 &\n\
WEBAPP_PID=$!\n\
\n\
# Wait for servers to start\n\
sleep 3\n\
\n\
echo "========================================="\n\
echo "AIQA Services Started"\n\
echo "========================================="\n\
echo "PostgreSQL: localhost:5432"\n\
echo "Redis: localhost:6379"\n\
echo "Elasticsearch: http://localhost:9200"\n\
echo "Fastify Backend: http://localhost:${PORT:-4318}"\n\
echo "Webapp: http://localhost:4000"\n\
echo "========================================="\n\
\n\
# Keep container running and wait for processes\n\
wait $SERVER_PID $WEBAPP_PID\n\
' > /app/start.sh && chmod +x /app/start.sh

# Expose ports
EXPOSE 4318 4000 5432 6379 9200

# Set default environment variables
ENV DATABASE_URL=postgresql://aiqa:aiqa@localhost:5432/aiqa
ENV REDIS_URL=redis://localhost:6379
ENV ELASTICSEARCH_URL=http://localhost:9200
ENV PORT=4318

# Start all services
CMD ["/app/start.sh"]
