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
- `server`: Fastify backend API (port 4318 HTTP, 4317 gRPC)
- `nginx`: React frontend (port 4000)

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
   docker-compose ps
   curl http://localhost:4318/version
   ```

### Security

- **AWS Security Group**: Allow ports 4000, 4317, 4318
- **Firewall**: `sudo ufw allow 4000/tcp 4318/tcp 4317/tcp && sudo ufw enable`
- **HTTPS**: Use ALB with SSL termination or nginx reverse proxy with Let's Encrypt
- **Database**: Change default `POSTGRES_PASSWORD` in `docker-compose.yml`

### Ports

Typically you will have a web-server like nginx that listens for incoming traffic, handles SSL, and forwards to these ports.

- **4000**: Webapp (React frontend)
- **4318**: Server HTTP API
- **4317**: Server gRPC (OTLP)
