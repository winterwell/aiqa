# MCP Server Deployment Guide

This guide covers deploying the AIQA MCP (Model Context Protocol) server as a hosted service for Cursor and Claude Code users.

## Overview

The MCP server is a hosted service that acts as a middleman between external AI agents (like Cursor or Claude Code) and the server-aiqa API. Users configure their Cursor/Claude Code clients to connect to the hosted MCP server endpoint, providing their API key for authentication.

The server provides tools for:
- Creating datasets, examples, and experiments
- Querying traces, experiments, datasets, and examples (with filters/limits)
- Getting trace dashboard statistics

## Architecture

- **AIQA hosts** the MCP server as an HTTP/SSE service
- **Users configure** Cursor/Claude Code to connect to the hosted endpoint
- **Users provide** their API key in the client configuration
- **MCP server** uses the user's API key to authenticate requests to server-aiqa

## Prerequisites for Deployment

- Node.js 20+ and pnpm installed
- Access to a running server-aiqa instance
- Server should be accessible from the internet (or VPN) for users to connect

## Local Development

### Setup

1. Install dependencies:
```bash
cd aiqa/mcp
pnpm install
```

2. Build the server:
```bash
pnpm run build
```

3. Set environment variables:
```bash
export AIQA_API_BASE_URL=http://localhost:4318
export MCP_PORT=4319
```

Note: The MCP server doesn't need an API key in its environment - users provide their API keys when connecting.

4. Run the server:
```bash
pnpm start
```

The server runs as an HTTP service on port 4319 (configurable via MCP_PORT).

## Testing

### Unit Tests

Run unit tests:
```bash
pnpm run test:unit
```

### Integration Tests

Integration tests require a running server-aiqa instance and an API key. The tests read from environment variables (not from `.env` file):

```bash
export AIQA_API_BASE_URL=http://your-server:4318
export AIQA_API_KEY=your-api-key  # Required - must have developer or admin role
export TEST_ORG_ID=your-org-id     # Optional, for dataset tests
pnpm run test:integration
```

**Note:** The `.env` file is for the MCP server runtime configuration, not for tests. Integration tests read API keys directly from environment variables.

## Production Deployment

### Manual Deployment

1. Build the server:
```bash
cd aiqa/mcp
pnpm install
pnpm run build
```

2. Copy files to server:
```bash
scp -r dist package.json pnpm-lock.yaml user@server:/opt/aiqa/mcp/
```

3. On the server, install dependencies:
```bash
cd /opt/aiqa/mcp
pnpm install --prod
```

4. Create `.env` file:
```bash
cat > .env << EOF
AIQA_API_BASE_URL=https://server-aiqa.winterwell.com
MCP_PORT=4319
LOG_LEVEL=info
EOF
chmod 600 .env
```

Note: No API key is needed in the server's environment - users provide their API keys when connecting via Cursor/Claude Code.

5. Set up nginx configuration (see below)

6. Create systemd service (see below)

### Automated Deployment (GitHub Actions)

The repository includes a GitHub Actions workflow (`.github/workflows/mcp-deploy.yml`) that automatically deploys when changes are pushed to the `mcp/` directory.

**Required GitHub Secrets:**
- `DEPLOY_SSH_KEY`: SSH private key for deployment

**Required GitHub Variables:**
- `DEPLOY_HOST`: Deployment server hostname
- `DEPLOY_USER`: SSH username for deployment
- `DEPLOY_PORT`: SSH port (default: 22)
- `AIQA_API_BASE_URL`: Base URL for server-aiqa API (default: http://localhost:4318)
- `MCP_PORT`: Port for MCP server (default: 4319)
- `LOG_LEVEL`: Log level (default: info)

## Systemd Service

Create `/etc/systemd/system/aiqa-mcp.service`:

```ini
[Unit]
Description=AIQA MCP Server
After=network.target

[Service]
Type=simple
User=winterwell
WorkingDirectory=/opt/aiqa/mcp
Environment="NODE_ENV=production"
EnvironmentFile=/opt/aiqa/mcp/.env
ExecStart=/usr/bin/node /opt/aiqa/mcp/dist/index.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
# Limit resources
MemoryLimit=512M
CPUQuota=50%

[Install]
WantedBy=multi-user.target
```

### Nginx Configuration

The nginx configuration file is provided at `aiqa/deploy/mcp-aiqa.nginx.conf`. 

To set it up:

1. Copy the configuration file:
```bash
sudo cp aiqa/deploy/mcp-aiqa.nginx.conf /etc/nginx/sites-available/
```

2. Create a symlink to enable it:
```bash
sudo ln -s /etc/nginx/sites-available/mcp-aiqa.nginx.conf /etc/nginx/sites-enabled/
```

3. Create log directory:
```bash
sudo mkdir -p /var/log/nginx/mcp-aiqa.winterwell.com
```

4. Test nginx configuration:
```bash
sudo nginx -t
```

5. Reload nginx:
```bash
sudo systemctl reload nginx
```

The configuration handles:
- HTTP to HTTPS redirect
- SSE endpoint (`/sse`) with proper buffering disabled
- Message endpoint (`/message`) for client-to-server communication
- Health check endpoint (`/health`)
- CORS headers for MCP clients
- SSL/TLS with modern best practices

Enable and start:
```bash
sudo systemctl daemon-reload
sudo systemctl enable aiqa-mcp
sudo systemctl start aiqa-mcp
```

**Important:** Make sure nginx is configured and running before starting the MCP service, as clients will connect through nginx.

## User Configuration (Cursor/Claude Code)

Users configure their Cursor or Claude Code clients to connect to the hosted MCP server.

### Configuring Cursor

1. Open Cursor settings
2. Navigate to MCP settings
3. Add a new MCP server with HTTP/SSE transport:

```json
{
  "mcpServers": {
    "aiqa": {
      "url": "https://mcp-aiqa.winterwell.com/sse",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY_HERE"
      }
    }
  }
}
```

Or using the ApiKey format:
```json
{
  "mcpServers": {
    "aiqa": {
      "url": "https://mcp-aiqa.winterwell.com/sse",
      "headers": {
        "Authorization": "ApiKey YOUR_API_KEY_HERE"
      }
    }
  }
}
```

**Important:** Users should replace `YOUR_API_KEY_HERE` with their actual API key from server-aiqa.

### Configuring Claude Code

Similar configuration applies for Claude Code. Configure the MCP server to connect via HTTP/SSE to `https://mcp-aiqa.winterwell.com/sse` with the user's API key in the Authorization header.

### Getting an API Key

Users need to:
1. Log into the AIQA webapp
2. Navigate to API Keys section
3. Create a new API key with appropriate permissions (developer or admin role)
4. Use that API key in their Cursor/Claude Code configuration

## Available Tools

The MCP server provides the following tools:

1. **create_dataset** - Create a new dataset
2. **create_example** - Create a new example (eval) in a dataset
3. **create_experiment** - Create a new experiment
4. **query_datasets** - Query datasets with filters
5. **query_examples** - Query examples with filters (recommended: filter by dataset)
6. **query_experiments** - Query experiments with filters
7. **query_traces** - Query traces/spans (recommended: use isRoot=true and limit)
8. **get_trace_stats** - Get trace dashboard statistics

All query tools support:
- `limit` parameter to reduce token usage (defaults vary by tool)
- `offset` for pagination
- `query` parameter for Gmail-style search queries

## Troubleshooting

### Server won't start

- Check `.env` file exists and has correct permissions (600)
- Verify API key is valid: `curl -H "Authorization: ApiKey $AIQA_API_KEY" $AIQA_API_BASE_URL/health`
- Check systemd logs: `sudo journalctl -u aiqa-mcp -f`

### Tools not appearing in Cursor/Claude Code

- Verify the MCP server is running: `sudo systemctl status aiqa-mcp`
- Check that nginx is properly configured and running: `sudo systemctl status nginx`
- Verify the endpoint is accessible: `curl https://mcp-aiqa.winterwell.com/health`
- Check Cursor/Claude Code MCP configuration (ensure URL is `https://mcp-aiqa.winterwell.com/sse`)
- Verify API key is correct and has proper permissions
- Restart Cursor/Claude Code after configuration changes
- Check server logs for errors: `sudo journalctl -u aiqa-mcp -f`
- Check nginx logs: `sudo tail -f /var/log/nginx/mcp-aiqa.winterwell.com/error.log`

### API errors

- Verify `AIQA_API_BASE_URL` is correct and points to the server-aiqa instance
- Users should check their API key has required permissions (developer or admin role)
- Users should verify their organisation ID is correct for their API key
- Check server logs for authentication failures: `sudo journalctl -u aiqa-mcp -f`

## Security Notes

- The `.env` file should have 600 permissions (though it doesn't contain user API keys)
- **Users' API keys** are provided by clients in Authorization headers - never logged or stored
- Each connection uses the user's API key to authenticate with server-aiqa
- The MCP server runs with the permissions of the configured user (winterwell in production)
- Use HTTPS in production (via nginx reverse proxy)
- Consider rate limiting per API key if needed

## Rollback

If deployment fails, rollback using backups:

```bash
cd /opt/aiqa/mcp
sudo systemctl stop aiqa-mcp
sudo mv dist dist.broken
sudo mv dist.old dist
sudo systemctl start aiqa-mcp
```

## Support

For issues or questions:
- Check server logs: `sudo journalctl -u aiqa-mcp -f`
- Verify API connectivity: Test with curl using the API key
- Review MCP server configuration in Cursor/Claude Code
