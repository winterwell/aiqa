# Deployment Guide

This guide explains how to set up 24x7 operation of the AIQA server and webapp on a Linux Ubuntu server.

## Prerequisites

- Ubuntu server (20.04 or later)
- Node.js 20+ installed
- pnpm installed globally: `npm install -g pnpm`
- Nginx installed: `sudo apt-get install nginx`
- SSH access to the server
- GitHub repository with Actions enabled
- Git submodule configured (for OTLP/gRPC support): The `opentelemetry-proto` submodule is automatically initialized during CI/CD deployments

## Initial Server Setup

### 1. Create deployment directories

```bash
sudo mkdir -p /opt/aiqa/server
sudo mkdir -p /opt/aiqa/webapp
sudo chown -R $USER:$USER /opt/aiqa
```

### 2. Install systemd service files

**Note:** These commands assume you're running from the repository root directory.

```bash
# Copy server service file
sudo cp deploy/aiqa-server.service /etc/systemd/system/

# For webapp, use standard nginx service (recommended)
sudo cp deploy/app-aiqa.nginx.conf /etc/nginx/sites-available/app-aiqa.nginx.conf
sudo ln -s /etc/nginx/sites-available/app-aiqa.nginx.conf /etc/nginx/sites-enabled/

# For server API domain (optional - provides direct access via server-aiqa.winterwell.com)
# sudo cp deploy/server-aiqa.nginx.conf /etc/nginx/sites-available/server-aiqa.nginx.conf
# sudo ln -s /etc/nginx/sites-available/server-aiqa.nginx.conf /etc/nginx/sites-enabled/

# For website (optional - proxies to server if file not found)
# sudo cp deploy/website-aiqa.nginx.conf /etc/nginx/sites-available/website
# sudo ln -s /etc/nginx/sites-available/website /etc/nginx/sites-enabled/

# Create nginx log directories (REQUIRED - nginx will fail to start without these)
sudo mkdir -p /var/log/nginx/app-aiqa.winterwell.com
sudo mkdir -p /var/log/nginx/aiqa.winterwell.com
sudo mkdir -p /var/log/nginx/server-aiqa.winterwell.com  # if using server domain
sudo chown -R www-data:www-data /var/log/nginx/

# Test nginx configuration
sudo nginx -t

# Reload systemd
sudo systemctl daemon-reload
```

### 3. Configure DNS

Before the webapp and server domains will be accessible, you need to create DNS A records pointing to your server's IP address.

**For the webapp domain** (`app-aiqa.winterwell.com` or your custom domain):
- **Cloudflare DNS**: Create an A record with:
  - Name: `app-aiqa` (this creates `app-aiqa.winterwell.com`)
  - Type: A
  - Content: Your server's IP address (e.g., `65.109.140.6`)
- **Other DNS providers**: Create an A record with name `app-aiqa` pointing to your server's IP address
- If using a different subdomain structure, adjust the `server_name` in `app-aiqa.nginx.conf` accordingly

**For the server API domain** (optional, for direct API access):
- **Cloudflare DNS**: 
  - Option 1: `server-aiqa.winterwell.com` - Create an A record with name `server-aiqa` → your server's IP address
- **Wildcard option** (Cloudflare): Instead of individual records, create a single wildcard A record:
  - Name: `*`
  - Type: A
  - Content: Your server's IP address
  - This covers all `*.winterwell.com` subdomains (app-aiqa, server-aiqa, etc.). Specific records take precedence over wildcards.
- Note: If you want a dedicated server domain (`server-aiqa.winterwell.com`), install the nginx configuration from `deploy/server-aiqa.nginx.conf` (see step 2 above). Otherwise, the server API is accessible via:
  - The main domain (`aiqa.winterwell.com`) which proxies to the server as a fallback when static files aren't found
  - Direct access via `http://localhost:4001` on the server itself

**Verify DNS resolution:**
```bash
nslookup app-aiqa.winterwell.com
nslookup server-aiqa.winterwell.com  # if using server subdomain
# or
dig app-aiqa.winterwell.com +short
dig server-aiqa.winterwell.com +short
```

DNS propagation typically takes a few minutes to a few hours. The domain must resolve before HTTPS certificates can be issued (if using Let's Encrypt) and before the domains will be accessible.

### 4. Configure environment variables

**For CI/CD deployments (recommended):** The `.env` file is automatically created by the GitHub Actions workflow from your GitHub secrets and variables. Skip to step 5 to configure them.

**For manual deployments:** You need to create the `.env` file manually:

```bash
# Copy and edit server environment file
cp server/env.example /opt/aiqa/server/.env
nano /opt/aiqa/server/.env
# Edit with your database credentials, port, etc.
```

### 5. Set up GitHub Secrets and Variables

In your GitHub repository, go to Settings → Secrets and variables → Actions:

**Add as Variables** (Settings → Secrets and variables → Actions → Variables tab):

*Deployment variables:*
- `DEPLOY_HOST`: Your server's IP address or hostname
- `DEPLOY_USER`: SSH username (e.g., `ubuntu` or `deploy`)
- `DEPLOY_PORT`: SSH port (optional, defaults to 22)

*Server environment variables:*
- `SERVER_PORT`: Server port (optional, defaults to 4001)
- `PGSSLMODE`: PostgreSQL SSL mode (optional, defaults to `require`)
- `PGCHANNELBINDING`: PostgreSQL channel binding (optional, defaults to `require`)
- `ELASTICSEARCH_URL`: Elasticsearch URL (optional, defaults to `http://localhost:9200`)
- `SPANS_INDEX`: Elasticsearch index for spans (optional, defaults to `aiqa_spans`)
- `SPANS_INDEX_ALIAS`: Elasticsearch alias for spans (optional, defaults to `aiqa_spans_alias`)
- `DATASET_EXAMPLES_INDEX`: Elasticsearch index for examples (optional, defaults to `aiqa_dataset_examples`)
- `DATASET_EXAMPLES_INDEX_ALIAS`: Elasticsearch alias for examples (optional, defaults to `aiqa_dataset_examples_alias`)
- `AUTH0_DOMAIN`: Your Auth0 domain (required)
- `AUTH0_AUDIENCE`: Your Auth0 audience (required)
- `AZURE_OPENAI_ENDPOINT`: Azure OpenAI endpoint (optional, for Azure OpenAI scoring)

*Webapp build variables:*
- `VITE_AIQA_SERVER_URL`: Server API URL (e.g., `http://your-server:4001` or `https://api.yourdomain.com`)
- `VITE_AUTH0_DOMAIN`: Your Auth0 domain
- `VITE_AUTH0_AUDIENCE`: Your Auth0 audience

**Add as Secrets** (Settings → Secrets and variables → Actions → Secrets tab):

*Deployment secrets:*
- `DEPLOY_SSH_KEY`: Private SSH key for authentication

*Server environment secrets:*
- `DATABASE_URL`: PostgreSQL connection string (optional, alternative to individual PG vars)
- `PGHOST`: PostgreSQL host
- `PGDATABASE`: PostgreSQL database name
- `PGUSER`: PostgreSQL username
- `PGPASSWORD`: PostgreSQL password

*Webapp build secrets:*
- `VITE_AUTH0_CLIENT_ID`: Your Auth0 client ID (sensitive)

To generate an SSH key pair if you don't have one:

```bash
ssh-keygen -t ed25519 -C "github-actions" -f ~/.ssh/github_actions
# Add the public key to ~/.ssh/authorized_keys on the server
# Use the private key content as DEPLOY_SSH_KEY secret
```

### 6. Enable and start services

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
# Initialize git submodules (required for OTLP/gRPC support)
git submodule update --init --recursive
pnpm install --prod
pnpm run build
# Copy dist/, package.json, pnpm-lock.yaml, and opentelemetry-proto/ to /opt/aiqa/server
# Create .env file (see step 4 above) if not using CI/CD
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
2. Verify environment variables in `/opt/aiqa/server/.env` (if using CI/CD, check GitHub secrets/variables are set correctly)
3. Check file permissions: `ls -la /opt/aiqa/server` (should be owned by www-data:www-data)
4. Verify Node.js is installed: `node --version`
5. Check if `.env` file exists: `ls -la /opt/aiqa/server/.env` (CI/CD creates this automatically)
6. Verify systemd service file has optional EnvironmentFile: `grep EnvironmentFile /etc/systemd/system/aiqa-server.service` (should show `EnvironmentFile=-/opt/aiqa/server/.env` with the `-` prefix)

### Missing dependencies (MODULE_NOT_FOUND errors)

If you see errors like `Error: Cannot find module 'fastify'`, the dependencies haven't been installed:

```bash
cd /opt/aiqa/server
# Ensure pnpm is available
if ! command -v pnpm &> /dev/null; then
  sudo npm install -g pnpm
fi
# Temporarily change ownership to install dependencies
sudo chown -R $USER:$USER /opt/aiqa/server
# Install production dependencies
pnpm install --prod --no-frozen-lockfile
# Restore ownership to www-data
sudo chown -R www-data:www-data /opt/aiqa/server
# Verify fastify is installed
ls -d node_modules/fastify || echo "ERROR: fastify still missing!"
# Restart service
sudo systemctl restart aiqa-server
```

### Missing proto files (OTLP/gRPC errors)

If you see errors about missing OTLP proto files when starting the gRPC server:

```bash
cd /opt/aiqa/server
# Verify opentelemetry-proto directory exists
if [ ! -d opentelemetry-proto ]; then
  echo "ERROR: opentelemetry-proto directory not found!"
  echo "If using git, run: git submodule update --init --recursive"
  echo "Otherwise, ensure proto files are copied to opentelemetry-proto/ directory"
  exit 1
fi
# Verify trace_service.proto exists
if [ ! -f opentelemetry-proto/opentelemetry/proto/collector/trace/v1/trace_service.proto ]; then
  echo "ERROR: trace_service.proto not found in opentelemetry-proto directory!"
  exit 1
fi
```

### Port conflicts

- Server defaults to port 4001 (set via `PORT` in `.env`)
- Webapp is served by nginx on ports 80 (HTTP) and 443 (HTTPS) - see `app-aiqa.nginx.conf`
- Check if ports are in use: `sudo netstat -tulpn | grep :4001` (server) or `sudo netstat -tulpn | grep :80` (nginx)

### Permission issues

```bash
sudo chown -R www-data:www-data /opt/aiqa
```

### Nginx log directory errors

If nginx fails to start with errors like:
```
nginx: [emerg] open() "/var/log/nginx/aiqa.winterwell.com/access.log" failed (2: No such file or directory)
```

Create the required log directories:

```bash
# Create log directories for all nginx sites
sudo mkdir -p /var/log/nginx/app-aiqa.winterwell.com
sudo mkdir -p /var/log/nginx/aiqa.winterwell.com
sudo mkdir -p /var/log/nginx/server-aiqa.winterwell.com  # if using server domain
sudo chown -R www-data:www-data /var/log/nginx/

# Test nginx configuration
sudo nginx -t

# If test passes, restart nginx
sudo systemctl restart nginx
```

**Note:** Check your nginx configuration files for any other custom log paths and create those directories as well.

### Verify deployment files

After deployment, verify files are in the correct locations:

```bash
# Server files
ls -la /opt/aiqa/server/
# Should see: dist/, package.json, pnpm-lock.yaml, .env, node_modules/, opentelemetry-proto/

# Webapp files
ls -la /opt/aiqa/webapp/dist/
# Should see: index.html and other built files
```

## CI/CD Pipeline

The GitHub Actions workflows automatically:
1. Build the application when code is pushed to the `server/` or `webapp/` directories
2. Deploy via SCP to `/opt/aiqa/server` or `/opt/aiqa/webapp`
3. **For server deployments:** Create `.env` file from GitHub secrets and variables
4. Install dependencies and restart the service

Workflows trigger on:
- Push to `server/**` → server deployment
- Push to `webapp/**` → webapp deployment
- Manual trigger via GitHub Actions UI

### Server Environment Variables

The server deployment workflow automatically creates `/opt/aiqa/server/.env` from your GitHub secrets and variables. The `.env` file is:
- Created with proper permissions (600, owned by www-data)
- Generated on every deployment
- Never committed to the repository

**Required secrets/variables for server:**
- Database: Either `DATABASE_URL` (secret) OR `PGHOST`, `PGDATABASE`, `PGUSER`, `PGPASSWORD` (secrets)
- Auth: `AUTH0_DOMAIN`, `AUTH0_AUDIENCE` (variables)

**Optional variables:** All other server environment variables have sensible defaults and are optional.

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
- Server runs on port 4001 (configurable via `PORT` in `.env`)
- Webapp is served by nginx on ports 80 (HTTP) and 443 (HTTPS)

**Note:** Port 4000 is only used in development mode (`pnpm dev`). In production, nginx serves the webapp on standard HTTP/HTTPS ports.

### Server API Access Methods

The server API can be accessed via three methods:

1. **Direct localhost access**: `http://localhost:4001` (on the server itself)
2. **Via website proxy**: `https://aiqa.winterwell.com` (proxies to server when static files aren't found)
3. **Via dedicated server domain**: `https://server-aiqa.winterwell.com` (requires DNS A record and nginx config from `deploy/server-aiqa.nginx.conf`)

**For webapp configuration:**
- If the webapp and server are on the same server, use `VITE_AIQA_SERVER_URL=http://localhost:4001` for direct access
- If using the website proxy, use `VITE_AIQA_SERVER_URL=https://aiqa.winterwell.com`
- If using the dedicated server domain, use `VITE_AIQA_SERVER_URL=https://server-aiqa.winterwell.com`

The server has CORS enabled, so cross-origin requests are allowed from any of these endpoints.

