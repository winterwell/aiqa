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

**For local development:** No `.env` file needed! Docker Compose uses sensible defaults:
- Server connects to containers via Docker network (postgres, redis, elasticsearch)
- Webapp defaults to `http://localhost:4318` for the server URL
- Server runs on port 4318

**For production/AWS:** Create a `.env` file in the `aiqa/` directory (same level as `docker-compose.yml`):

```env
# Server API URL - REQUIRED for production (browser needs public URL)
VITE_AIQA_SERVER_URL=http://your-server-ip:4318
# Or with domain:
# VITE_AIQA_SERVER_URL=https://api.yourdomain.com

# Auth0 configuration (required for production)
VITE_AUTH0_DOMAIN=your-auth0-domain
VITE_AUTH0_CLIENT_ID=your-auth0-client-id
VITE_AUTH0_AUDIENCE=your-auth0-audience
```

The server configuration is handled automatically via Docker Compose environment variables. You only need to set server-specific variables if you want to override defaults (e.g., custom database URL).

### Changing the Server Port

To change the server port from the default `4318` to a different port (e.g., `4418`):

1. **Create or edit `.env` file** in the `aiqa/` directory (same level as `docker-compose.yml`):
   ```env
   SERVER_PORT=4418
   VITE_AIQA_SERVER_URL=http://localhost:4418
   ```

2. **Rebuild and restart**:
   ```bash
   docker-compose down
   docker-compose up -d --build
   ```

**Note:** You must set both `SERVER_PORT` (for the server container) and `VITE_AIQA_SERVER_URL` (for the webapp build) to the same port. The webapp needs to know which port to call the API on.

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

## AWS Production Deployment

### Prerequisites

1. **AWS EC2 Instance** with Docker and Docker Compose installed
2. **Security Group** configured to allow inbound traffic on ports:
   - `4000` (webapp)
   - `4318` (server HTTP API)
   - `4317` (server gRPC/OTLP)

### Setup Steps

1. **Clone the repository** on your AWS server:
   ```bash
   git clone https://github.com/winterwell/aiqa
   cd aiqa
   ```

2. **Create environment file** for docker-compose (optional for local development):
   ```bash
   # For local development, you can skip this step - defaults will work
   # For AWS/production, create .env file in the aiqa directory:
   cat > .env << EOF
   # Server API URL - REQUIRED for AWS/production (browser needs public URL)
   # For local development, this defaults to http://localhost:4318
   VITE_AIQA_SERVER_URL=http://YOUR_AWS_SERVER_IP:4318
   # Or with domain:
   # VITE_AIQA_SERVER_URL=https://api.yourdomain.com
   
   # Auth0 configuration (required for production)
   VITE_AUTH0_DOMAIN=your-auth0-domain
   VITE_AUTH0_CLIENT_ID=your-auth0-client-id
   VITE_AUTH0_AUDIENCE=your-auth0-audience
   EOF
   ```
   
   **Why is VITE_AIQA_SERVER_URL needed for AWS?**
   
   The webapp runs in the browser (on the user's computer), not in Docker. When a user accesses your AWS server:
   - The browser loads the webapp from `http://your-aws-server:4000`
   - The webapp JavaScript then makes API calls to the server
   - These API calls come from the user's browser, so they need a URL accessible from the internet
   - `VITE_AIQA_SERVER_URL` is baked into the webapp at build time, so it must be set before building
   
   For local development, `http://localhost:4318` works because both the browser and Docker are on the same machine.

3. **Optional: Create server environment file** if you need custom server settings:
   ```bash
   # Create server/.env for additional server configuration
   # Most settings have sensible defaults
   ```

4. **Build and start services**:
   ```bash
   docker-compose up -d --build
   ```

5. **Verify services are running**:
   ```bash
   docker-compose ps
   docker-compose logs -f
   ```

6. **Test the deployment**:
   ```bash
   # Test webapp
   curl http://localhost:4000
   
   # Test server API
   curl http://localhost:4318/version
   
   # Test from external machine (replace with your AWS IP)
   curl http://YOUR_AWS_SERVER_IP:4318/version
   ```

### Exposed Ports

- **4000**: Webapp (React frontend)
- **4318**: Server HTTP API (REST endpoints - OpenTelemetry collector HTTP port convention)
- **4317**: Server gRPC port (OTLP/gRPC for telemetry ingestion - OpenTelemetry collector gRPC port convention)

### Security Considerations

1. **AWS Security Group**: Configure inbound rules to restrict access:
   - Allow ports 4000, 4317, 4318 only from trusted IPs
   - Or use a load balancer/API gateway in front

2. **Firewall (ufw)** on the EC2 instance:
   ```bash
   sudo ufw allow 4000/tcp
   sudo ufw allow 4318/tcp
   sudo ufw allow 4317/tcp
   sudo ufw enable
   ```

3. **HTTPS/SSL**: For production, consider:
   - **For IP address access (no domain)**: See `ssl/README.md` for self-signed certificate setup
   - Using an Application Load Balancer (ALB) with SSL termination
   - Or running nginx as a reverse proxy with Let's Encrypt certificates (requires domain)
   - Update `VITE_AIQA_SERVER_URL` to use `https://` if using SSL

4. **Database Security**: The default PostgreSQL password is `aiqa`. Change it:
   ```bash
   # Edit docker-compose.yml and change POSTGRES_PASSWORD
   # Then update DATABASE_URL in server environment
   ```

5. **Environment Variables**: Never commit `.env` files with secrets to git

### Data Persistence

Docker Compose uses named volumes for data persistence:
- `postgres_data`: PostgreSQL database files
- `es_data`: Elasticsearch indices

These persist across container restarts. To backup:
```bash
# Backup PostgreSQL
docker exec aiqa-postgres pg_dump -U aiqa aiqa > backup.sql

# Backup Elasticsearch (requires additional setup)
```

### Troubleshooting

1. **Check container logs**:
   ```bash
   docker-compose logs server
   docker-compose logs webapp
   ```

2. **gRPC server fails to start** (opentelemetry-proto files missing):
   - The Dockerfile automatically clones `opentelemetry-proto` if it's missing
   - If you see errors about missing proto files, rebuild: `docker-compose build --no-cache server`
   - The HTTP API will still work even if gRPC fails (OTLP/HTTP is still available)

2. **Verify ports are not in use**:
   ```bash
   sudo netstat -tulpn | grep -E ':(4000|4317|4318)'
   ```

3. **Rebuild if environment variables change**:
   ```bash
   docker-compose up -d --build
   ```

4. **Check health of services**:
   ```bash
   docker-compose ps
   # All services should show "healthy" status
   ```

## Notes

- The single Dockerfile approach is simpler but less flexible
- Docker Compose is recommended for production and development
- Data persistence: Docker Compose uses named volumes for PostgreSQL and Elasticsearch data
- The webapp requires the server to be running to function properly
- Make sure to configure Auth0 credentials for authentication to work
- For AWS: The webapp's `VITE_AIQA_SERVER_URL` must be set at build time to your server's public URL
