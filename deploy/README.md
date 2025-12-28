# Deployment Files Overview

This directory contains all files needed for 24x7 deployment of the AIQA server and webapp on Ubuntu.

## Files

### Service Files
- **aiqa-server.service** - Systemd service file for the server (auto-restart on failure)
- **aiqa-webapp.nginx.conf** - Nginx site configuration for serving the webapp (recommended)
- **aiqa-website.nginx.conf** - Nginx site configuration for serving the website
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

- **Server**: Runs as systemd service on port 4001, auto-restarts on failure
- **Webapp**: Served by nginx on port 4000, static files from `/opt/aiqa/webapp/dist`
- **CI/CD**: GitHub Actions builds and deploys automatically on code changes

See [DEPLOYMENT.md](DEPLOYMENT.md) for detailed instructions.

