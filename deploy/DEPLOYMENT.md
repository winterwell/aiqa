# Deployment Guide

This guide explains how to set up 24x7 operation of the AIQA server and webapp on a Linux Ubuntu server.

## Prerequisites

- Ubuntu server (20.04 or later)
- Node.js 20+ installed
- pnpm installed globally: `npm install -g pnpm`
- Nginx installed: `sudo apt-get install nginx`
- SSH access to the server
- GitHub repository with Actions enabled

## Initial Server Setup

### 1. Create deployment directories

```bash
sudo mkdir -p /opt/aiqa/server
sudo mkdir -p /opt/aiqa/webapp
sudo chown -R $USER:$USER /opt/aiqa
```

### 2. Install systemd service files

```bash
# Copy server service file
sudo cp deploy/aiqa-server.service /etc/systemd/system/

# For webapp, use standard nginx service (recommended)
sudo cp deploy/aiqa-webapp.nginx.conf /etc/nginx/sites-available/webapp
sudo ln -s /etc/nginx/sites-available/webapp /etc/nginx/sites-enabled/
sudo nginx -t  # Test configuration

# Reload systemd
sudo systemctl daemon-reload
```

### 3. Configure environment variables

```bash
# Copy and edit server environment file
cp server/.env.example /opt/aiqa/server/.env
nano /opt/aiqa/server/.env
# Edit with your database credentials, port, etc.
```

### 4. Set up GitHub Secrets and Variables

In your GitHub repository, go to Settings → Secrets and variables → Actions:

**Add as Variables** (Settings → Secrets and variables → Actions → Variables tab):
- `DEPLOY_HOST`: Your server's IP address or hostname
- `DEPLOY_USER`: SSH username (e.g., `ubuntu` or `deploy`)
- `DEPLOY_PORT`: SSH port (optional, defaults to 22)
- `VITE_AIQA_SERVER_URL`: Server API URL (e.g., `http://your-server:4001` or `https://api.yourdomain.com`)
- `VITE_AUTH0_DOMAIN`: Your Auth0 domain
- `VITE_AUTH0_AUDIENCE`: Your Auth0 audience

**Add as Secrets** (Settings → Secrets and variables → Actions → Secrets tab):
- `DEPLOY_SSH_KEY`: Private SSH key for authentication
- `VITE_AUTH0_CLIENT_ID`: Your Auth0 client ID (sensitive)

To generate an SSH key pair if you don't have one:

```bash
ssh-keygen -t ed25519 -C "github-actions" -f ~/.ssh/github_actions
# Add the public key to ~/.ssh/authorized_keys on the server
# Use the private key content as DEPLOY_SSH_KEY secret
```

### 5. Enable and start services

```bash
# Enable server service to start on boot
sudo systemctl enable aiqa-server

# Start server
sudo systemctl start aiqa-server

# Nginx should already be running, but reload to apply new config
sudo systemctl reload nginx

# Check status
sudo systemctl status aiqa-server
sudo systemctl status nginx
```

## Manual Deployment (Alternative)

If you prefer to deploy manually instead of using CI/CD:

### Server

```bash
cd server
pnpm install --prod
pnpm run build
# Copy dist/, package.json, pnpm-lock.yaml, .env to /opt/aiqa/server
sudo systemctl restart aiqa-server
```

### Webapp

```bash
cd webapp
pnpm install
pnpm run build
# Copy dist/ to /opt/aiqa/webapp/dist
sudo systemctl reload nginx
```

## Service Management

### View logs

```bash
# Server logs
sudo journalctl -u aiqa-server -f

# Webapp/nginx logs
sudo journalctl -u nginx -f
# Or access logs: sudo tail -f /var/log/nginx/access.log
# Error logs: sudo tail -f /var/log/nginx/error.log
```

### Restart services

```bash
sudo systemctl restart aiqa-server
sudo systemctl reload nginx  # or restart nginx
```

### Stop services

```bash
sudo systemctl stop aiqa-server
sudo systemctl stop nginx  # if you want to stop webapp
```

### Check service status

```bash
sudo systemctl status aiqa-server
sudo systemctl status nginx
```

## Troubleshooting

### Service won't start

1. Check logs: `sudo journalctl -u aiqa-server -n 50`
2. Verify environment variables in `/opt/aiqa/server/.env`
3. Check file permissions: `ls -la /opt/aiqa/server`
4. Verify Node.js is installed: `node --version`

### Port conflicts

- Server defaults to port 4001 (set via `PORT` in `.env`)
- Webapp defaults to port 4000 (configured in `aiqa-webapp.nginx.conf`)
- Check if ports are in use: `sudo netstat -tulpn | grep :4000`

### Permission issues

```bash
sudo chown -R www-data:www-data /opt/aiqa
```

### Verify deployment files

After deployment, verify files are in the correct locations:

```bash
# Server files
ls -la /opt/aiqa/server/
# Should see: dist/, package.json, pnpm-lock.yaml, .env, node_modules/

# Webapp files
ls -la /opt/aiqa/webapp/dist/
# Should see: index.html and other built files
```

## CI/CD Pipeline

The GitHub Actions workflows automatically:
1. Build the application when code is pushed to the `server/` or `webapp/` directories
2. Deploy via SCP to `/opt/aiqa/server` or `/opt/aiqa/webapp`
3. Install dependencies and restart the service

Workflows trigger on:
- Push to `server/**` → server deployment
- Push to `webapp/**` → webapp deployment
- Manual trigger via GitHub Actions UI

### Webapp Environment Variables

The webapp build requires environment variables to be set in GitHub Variables and Secrets:

**GitHub Variables:**
- `VITE_AIQA_SERVER_URL`: The URL where the server API is accessible (e.g., `http://your-server-ip:4001` or `https://api.yourdomain.com`)
- `VITE_AUTH0_DOMAIN`: Your Auth0 domain
- `VITE_AUTH0_AUDIENCE`: Your Auth0 audience

**GitHub Secrets:**
- `VITE_AUTH0_CLIENT_ID`: Your Auth0 client ID (sensitive)

These are baked into the build at compile time, so you need to rebuild and redeploy if they change.

### Network Configuration

By default:
- Server runs on port 4001
- Webapp runs on port 4000

If the webapp and server are on the same server, the webapp can connect directly using `VITE_AIQA_SERVER_URL=http://localhost:4001`. 

If they're on different servers or you want to use a domain, configure accordingly. The server has CORS enabled, so cross-origin requests are allowed.

