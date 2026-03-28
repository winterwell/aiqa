# Deployment Files Overview

This directory contains all files needed for 24x7 deployment of the AIQA server and webapp on Ubuntu.

Do NOT use this for personal deployments. 

## Files

### Service Files
- **aiqa-server.service** - Systemd unit for the Node API (`/opt/aiqa/server`)
- **aiqa-report-worker.service** - Systemd unit for the Python report-analysis worker (`/opt/aiqa/server-python`, listens on `127.0.0.1:8765`). Required for report embedding analysis endpoints unless you run the worker some other way.
- **aiqa-mcp.service** - Systemd unit for the MCP HTTP/SSE server (`/opt/aiqa/mcp`, default port **4319**). Deployed by `.github/workflows/mcp-deploy.yml`; nginx front-end: **mcp-aiqa.nginx.conf**.
- **app-aiqa.nginx.conf** - Nginx site configuration for serving the webapp (recommended)
- **server-aiqa.nginx.conf** - Nginx site configuration for serving the server API (optional)
- **website-aiqa.nginx.conf** - Nginx site configuration for serving the website
- **mcp-aiqa.nginx.conf** - Nginx TLS + SSE proxy for `mcp-aiqa.winterwell.com` → `localhost:4319`
- **aiqa-webapp.optional.service** - Alternative systemd service (optional, uses custom nginx config)

### CI/CD Workflows
- **.github/workflows/server-deploy.yml** - Auto-deploys server on changes to `server/`
- **.github/workflows/webapp-deploy.yml** - Auto-deploys webapp on changes to `webapp/`

### Documentation
- **DEPLOYMENT.md** - Complete deployment guide
- **CHECKLIST.md** - Step-by-step deployment checklist
- **setup.sh** - Quick setup script for initial server configuration

## Quick Start

1. **On your server**, run:
   ```bash
   ./deploy/setup.sh
   ```

2. **Configure GitHub Secrets and Variables** (Settings → Secrets and variables → Actions):
   - **Variables**: `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_PORT`, `VITE_AIQA_SERVER_URL`, `VITE_AUTH0_DOMAIN`, `VITE_AUTH0_AUDIENCE`
   - **Secrets**: `DEPLOY_SSH_KEY`, `VITE_AUTH0_CLIENT_ID`

3. **Create `/opt/aiqa/server/.env`** with your database credentials

4. **Enable and start services**:
   ```bash
   sudo systemctl enable aiqa-server
   sudo systemctl start aiqa-server
   sudo systemctl reload nginx
   ```

5. **Push changes** to `server/` or `webapp/` to trigger automatic deployments!

## Architecture

- **Server**: Systemd `aiqa-server` on port 4318 (configurable), auto-restarts on failure
- **Report worker**: Optional separate process; Node uses `REPORT_WORKER_URL` (default `http://127.0.0.1:8765`). Use `aiqa-report-worker.service` or run uvicorn manually.
- **MCP**: Optional `aiqa-mcp` on port 4319; public traffic typically via nginx + TLS (`mcp-aiqa.nginx.conf`).
- **Webapp**: Served by nginx on ports 80/443 (HTTP/HTTPS), static files from `/opt/aiqa/webapp/dist`
- **CI/CD**: GitHub Actions deploy server, webapp, and MCP on changes under `server/`, `webapp/`, `mcp/`

See [DEPLOYMENT.md](DEPLOYMENT.md) for detailed instructions.

