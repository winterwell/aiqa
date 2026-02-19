#!/bin/bash

# Rebuild and restart nginx and server containers when code changes
# Docker Compose build automatically detects code changes via layer caching

set -e  # Exit on error

# echo "Ensuring dependencies (postgres, redis, elasticsearch) are running..."
# docker-compose up -d postgres redis elasticsearch
# 
# echo "Waiting for dependencies to be healthy..."
# # Wait for health checks (max 60 seconds)
# timeout=60
# elapsed=0
# while [ $elapsed -lt $timeout ]; do
#   if docker-compose ps | grep -q "aiqa-postgres.*healthy" && \
#      docker-compose ps | grep -q "aiqa-redis.*healthy" && \
#      docker-compose ps | grep -q "aiqa-elasticsearch.*healthy"; then
#     echo "Dependencies are healthy"
#     break
#   fi
#   sleep 2
#   elapsed=$((elapsed + 2))
# done
# 
# if [ $elapsed -ge $timeout ]; then
#   echo "Warning: Dependencies may not be fully healthy, but continuing..."
# fi

echo "Building nginx and server containers (will rebuild if code changed)..."
docker compose build nginx server

echo "Restarting containers with new images..."
# up -d will recreate containers if images changed (detected by build above)
# --no-deps ensures we don't restart dependencies unnecessarily
docker compose up -d --no-deps nginx server

echo "Done! Containers rebuilt and restarted."
echo ""
echo "Container status:"
docker compose ps nginx server
