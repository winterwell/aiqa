# Docker Setup for AIQA

## Quick Start

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

## Services

- `postgres`: PostgreSQL database
- `redis`: Redis cache
- `elasticsearch`: Elasticsearch search engine
- `report-worker`: Python FastAPI service for report embedding analysis (PCA, drift, coverage); internal URL `http://report-worker:8765`, host port **8765**
- `server`: Fastify backend API — from the host, HTTP **4418** → container `SERVER_PORT` (default 4318), gRPC **4417** → `GRPC_PORT` (default 4317). Sets `REPORT_WORKER_URL` to the report worker automatically.
- `mcp`: MCP HTTP/SSE server for Cursor / Claude Code — host **4419** → `MCP_PORT` (default 4319); calls the API at `http://server:<SERVER_PORT>` inside the compose network.
- `nginx`: React frontend (port 4000)

**Browser vs compose:** The webapp build defaults `VITE_AIQA_SERVER_URL` to `http://localhost:4318`. On the host, the API is published on **4418** by default, so for local Docker builds either pass `VITE_AIQA_SERVER_URL=http://localhost:4418` as a build arg for `nginx`, or use a reverse proxy that exposes the API on 4318.

## Environment Variables

**Local development:** No `.env` file needed. Defaults work:
- Server connects to containers via Docker network
- Webapp defaults to `http://localhost:4318` for server URL

**Production/AWS:** Create `.env` in `aiqa/` directory:

```env
# Required: Public server URL (browser needs this at build time)
VITE_AIQA_SERVER_URL=https://your-domain:4318

# Required: Auth0 configuration
VITE_AUTH0_DOMAIN=your-auth0-domain
VITE_AUTH0_CLIENT_ID=your-auth0-client-id
VITE_AUTH0_AUDIENCE=your-auth0-audience

# Optional: Change server port (must match VITE_AIQA_SERVER_URL port)
SERVER_PORT=4418
```

## AWS Deployment

0. **Setup your SSL handling**:
Setup nginx or similar to handle ssl for your-domain.
E.g. if the server is myserver.mydomain.com, then nginx
would typically listen on ports 80, 443, 4317, and 4318
and do: port 80: redirect, port 443 proxy pass to port 4000, port 4318 proxy pass to port 4318, port 4317 proxy pass to port 4317.

0.2. **Configure the nginx gateway to allow large files**
The internal nginx config is set to 50m, but the gateway nginx
on your server is likely lower. This can lead to spans being dropped.
TODO notes

1. **Clone repository**:
   ```bash
   git clone https://github.com/winterwell/aiqa
   cd aiqa
   ```

2. **Create `.env` file** with production values (see above)

3. **Build and start**:
   ```bash
   docker-compose up -d --build
   ```

4. **Verify**:
   ```bash
   docker compose ps
   curl http://localhost:4418/version
   curl http://localhost:8765/health
   curl http://localhost:4419/health
   ```

### Security

- **AWS Security Group**: Allow ports 4000, 4317, 4318
- **Firewall**: `sudo ufw allow 4000/tcp 4318/tcp 4317/tcp && sudo ufw enable`
- **HTTPS**: Use ALB with SSL termination or nginx reverse proxy with Let's Encrypt
- **Database**: Change default `POSTGRES_PASSWORD` in `docker-compose.yml`

### Ports (default `docker compose` host mappings)

Typically you will have a web-server like nginx that listens for incoming traffic, handles SSL, and forwards to these ports.

- **4000**: Webapp (React frontend)
- **4418**: Server HTTP API (maps to container port `SERVER_PORT`, default 4318)
- **4417**: Server gRPC (OTLP)
- **8765**: Report worker (`/health`, `/analyze`)
- **4419**: MCP server (`/health`, `/sse`, `/message`)
