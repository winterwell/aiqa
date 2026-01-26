# Docker Setup for AIQA

This directory contains Docker configurations for running the complete AIQA stack.

## Option 1: Single Dockerfile (All-in-One)

The main `Dockerfile` includes all services in a single container:
- PostgreSQL
- Redis
- Elasticsearch
- Fastify backend server
- React webapp (built and served)

### Build and Run

```bash
# Build the image
docker build -t aiqa:latest .

# Run the container
docker run -d \
  --name aiqa \
  -p 4318:4318 \
  -p 4000:4000 \
  -p 5432:5432 \
  -p 6379:6379 \
  -p 9200:9200 \
  aiqa:latest
```

### Access Services

- **Webapp**: http://localhost:4000
- **Backend API**: http://localhost:4318
- **PostgreSQL**: localhost:5432 (user: `aiqa`, password: `aiqa`, database: `aiqa`)
- **Redis**: localhost:6379
- **Elasticsearch**: http://localhost:9200

### Environment Variables

You can override default settings:

```bash
docker run -d \
  --name aiqa \
  -p 4318:4318 \
  -p 4000:4000 \
  -e PORT=4318 \
  -e DATABASE_URL=postgresql://aiqa:aiqa@localhost:5432/aiqa \
  -e REDIS_URL=redis://localhost:6379 \
  -e ELASTICSEARCH_URL=http://localhost:9200 \
  aiqa:latest
```

## Option 2: Docker Compose (Recommended)

The `docker-compose.yml` file provides a better architecture with separate containers for each service.

### Build and Run

```bash
# Build and start all services
docker-compose up -d

# View logs
docker-compose logs -f

# Stop all services
docker-compose down

# Stop and remove volumes (clean slate)
docker-compose down -v
```

### Services

- `postgres`: PostgreSQL database
- `redis`: Redis cache
- `elasticsearch`: Elasticsearch search engine
- `server`: Fastify backend API
- `webapp`: React frontend

### Access Services

Same ports as Option 1, but services are in separate containers.

### Environment Variables

Create a `.env` file in the `server/` directory for server configuration:

```env
DATABASE_URL=postgresql://aiqa:aiqa@postgres:5432/aiqa
REDIS_URL=redis://redis:6379
ELASTICSEARCH_URL=http://elasticsearch:9200
PORT=4318
ENVIRONMENT=production
AUTH0_DOMAIN=your-auth0-domain
AUTH0_AUDIENCE=your-auth0-audience
```

For the webapp, create a `.env` file in the `webapp/` directory:

```env
VITE_AIQA_SERVER_URL=http://localhost:4318
VITE_AUTH0_DOMAIN=your-auth0-domain
VITE_AUTH0_CLIENT_ID=your-auth0-client-id
VITE_AUTH0_AUDIENCE=your-auth0-audience
```

## Development Mode

For development with hot-reload, you can mount your source code:

```bash
# Using docker-compose
docker-compose up

# Or with the single Dockerfile, mount volumes
docker run -d \
  --name aiqa \
  -p 4318:4318 \
  -p 4000:4000 \
  -v $(pwd)/server:/app/server \
  -v $(pwd)/webapp:/app/webapp \
  aiqa:latest
```

## Notes

- The single Dockerfile approach is simpler but less flexible
- Docker Compose is recommended for production and development
- Data persistence: Docker Compose uses named volumes for PostgreSQL and Elasticsearch data
- The webapp requires the server to be running to function properly
- Make sure to configure Auth0 credentials for authentication to work
