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

For a local run that is all you need. For anything served through a proxy, also
set the URL configuration below.

4. Run the server:
```bash
pnpm start          # uses whatever is already exported
pnpm run start:local # loads mcp/.env (needs Node 20.6+ for --env-file)
```

`pnpm start` does not read `.env` - nothing in the package does. In production
systemd supplies the environment via `EnvironmentFile`, so `start:local` exists
to get the same thing on a development machine.

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

## Public URL and Proxy Configuration

The server advertises its own URL in two places:

- the `resource_metadata` pointer in the `WWW-Authenticate` header sent with a `401`
- the `resource` field of `GET /.well-known/oauth-protected-resource`

MCP clients follow those to work out how to authenticate, so the URL has to be
the one clients actually reach. Two variables control it.

With OAuth enabled this URL does more than point clients at the right host: it
is what they send as RFC 8707 `resource`, and therefore the audience Auth0
issues tokens for. It has to match an Auth0 API identifier and an audience
server-aiqa accepts, so getting it wrong there fails *after* a successful login
rather than during discovery. See [OAuth](#oauth-self-connection-from-cursor--claude).

### `MCP_PUBLIC_URL` (recommended in production)

The public base URL, e.g. `https://mcp-aiqa.winterwell.com`. When set, the
advertised URL is exactly this value and does not depend on request headers.

If unset, the URL is derived from the incoming request. Behind TLS-terminating
nginx that produces `http://...` rather than `https://...`, pointing clients at
the wrong scheme. Setting it also makes the discovery document cacheable
(`max-age=3600` instead of `no-store`), because the response no longer varies by
request host.

The server logs a warning at startup if neither this nor `MCP_TRUST_PROXY` is set.

### `MCP_TRUST_PROXY` (optional)

Whether to trust `X-Forwarded-*` headers. **Default: off.** These headers are
client-supplied, so trusting them unconditionally would let any caller choose
the URLs advertised to other clients.

Accepted values:

| Value | Effect |
|-------|--------|
| unset / `false` | Forwarded headers ignored. Safe default. |
| `127.0.0.1` (IP/CIDR, comma-separated) | Trusted only when the connecting peer matches. |
| `true` | Trusts whatever connects - only safe if nothing but the proxy can reach the port. |
| a number, e.g. `2` | **Silently trusts nothing.** Fastify rejects hop-count trust as unsafe. |
| anything unparseable | Fails at startup with `invalid IP address`. |

`deploy/mcp-aiqa.nginx.conf` proxies from the same host
(`proxy_pass http://localhost:4319`) and sets `X-Forwarded-For` and
`X-Forwarded-Proto`, so the correct value there is:

```bash
export MCP_TRUST_PROXY=127.0.0.1
```

This is what makes `X-Forwarded-For` take effect, so request logs show the real
client IP instead of the proxy's. It is **not** required for correct URLs when
`MCP_PUBLIC_URL` is set - the two solve different problems, and setting both is
the recommended production configuration:

```bash
export MCP_PUBLIC_URL=https://mcp-aiqa.winterwell.com   # correct advertised URLs
export MCP_TRUST_PROXY=127.0.0.1                        # real client IPs in logs
```

## Production Deployment

### Automated Deployment (GitHub Actions)

The repository includes a GitHub Actions workflow (`.github/workflows/mcp-deploy.yml`) that automatically deploys when changes are pushed to the `mcp/` directory.

**Required GitHub Secrets:**
- `DEPLOY_SSH_KEY`: SSH private key for deployment

**Required GitHub Variables:**
- `DEPLOY_HOST`: Deployment server hostname
- `DEPLOY_USER`: SSH username for deployment
- `DEPLOY_PORT`: SSH port (default: 22)
- `AIQA_API_BASE_URL`: Base URL for server-aiqa API (default: https://server-aiqa.winterwell.com)
- `MCP_PORT`: Port for MCP server (default: 4319)
- `LOG_LEVEL`: Log level (default: info)
- `MCP_PUBLIC_URL`: Public base URL used in the discovery document, and the OAuth audience (e.g. `https://mcp-aiqa.winterwell.com`). See [Public URL and Proxy Configuration](#public-url-and-proxy-configuration).
- `MCP_TRUST_PROXY`: Proxy addresses whose `X-Forwarded-*` headers are trusted (`127.0.0.1` for the bundled nginx config). Optional; off by default.

## Systemd Service

Install deploy/aiqa-mcp.service
TODO how?

Create `/etc/systemd/system/aiqa-mcp.service`:

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
- Discovery documents (`/.well-known/`) - required: the `401` from `/sse` points
  clients at `/.well-known/oauth-protected-resource`, so without this location
  block a client that follows the pointer gets nginx's 404 page
- Health check endpoint (`/health`)
- CORS headers for MCP clients
- SSL/TLS with modern best practices

Verify all of these after a deploy with `./scripts/check-live.sh` from the repo root.

Enable and start:
```bash
sudo systemctl daemon-reload
sudo systemctl enable aiqa-mcp
sudo systemctl start aiqa-mcp
```

**Important:** Make sure nginx is configured and running before starting the MCP service, as clients will connect through nginx.

## Key Validation

When a client connects to `/sse`, the server checks the supplied credential
against server-aiqa before creating a session, and refuses the connection with a
`401` if it is rejected. The check is a `GET /dataset` with the `organisation`
parameter left off, so server-aiqa authenticates the caller and then refuses the
request with a `400` before doing any work - only the authentication outcome is
of interest.

This is about diagnosability as much as access control. Without the check any
non-empty string opened a session: the client reported a healthy connection and
a working `tools/list`, then failed on every tool call with an upstream `401`
wrapped inside a tool result - which is not something a client can
re-authenticate from, and reads to the user as "the MCP server is broken".

Two consequences worth knowing:

- Verdicts are cached for 60s, keyed by a hash of the key. A revoked key keeps
  working for up to a minute on new connections.
- If server-aiqa cannot be reached, the connection is allowed and a warning is
  logged. Refusing would turn a server outage into an MCP outage for no gain,
  since the tool calls fail either way. It also means a local MCP run with no
  backend still accepts connections.

The expected `400`, and a `403` from a credential that authenticated but lacks
the role, both count as valid: what a credential may actually do stays the API's
decision, per request. One consequence worth knowing is that a `trace`-role key,
or an OAuth token for a user who has never logged into the webapp, will connect
successfully and then fail on each tool call with server-aiqa's own message.
Refusing those at connect time would be tidier, but a `401` tells a client to go
and get a new token, which in neither case would help.

## OAuth (self-connection from Cursor / Claude)

By default the MCP server only accepts pre-issued AIQA API keys: a user creates
a key in the webapp and pastes it into their client config. With OAuth
configured, a user instead points their client at the server URL, logs in
through Auth0 in a browser, and the client obtains a token by itself. No key
handling.

**Status: the code is complete, and verified against the live tenant as far as
it can be without a browser login.** Dynamic client registration is enabled on
winterstein.eu.auth0.com and works; registration was exercised against the real
Auth0. What remains is the tenant configuration in *Auth0 setup* below - until
it is done, Auth0 fails the login and no token is issued.

### Why clients go straight to Auth0

They did not always. Auth0 only issues a verifiable JWT when the request names
a registered API, and it historically read that from its own non-standard
`audience` parameter. MCP clients do not send `audience` - they send RFC 8707
`resource`. A client talking to Auth0 directly came back holding an opaque
token that server-aiqa could not verify, so this server used to broker the
whole flow, forwarding `/authorize`, `/token`, `/register` and `/revoke` with
`audience` added on the way through.

Auth0's **Resource Parameter Compatibility Profile** makes Auth0 read
`resource` and use it as the token's audience. That removes the reason for the
broker, so it is gone: no proxied endpoints, no authorization server metadata
of our own, and nothing of ours in the login path. Auth0 is the authorization
server clients discover and talk to, which is what RFC 9728 describes.

```
/.well-known/oauth-protected-resource  ->  resource: this server's public URL
                                           authorization_servers: [Auth0]
```

The trade is that Auth0 now sees the `resource` the *client* chose, where the
broker used to overwrite it. So the value this server advertises has to line up
with an Auth0 API identifier, and a client that sends something else - the
`/sse` path appended, say - gets `access_denied` rather than being silently
corrected. That is the one regression risk in dropping the broker, and the
`resource` check in `./scripts/check-live.sh` is there to catch the half of it
that is our own misconfiguration.

### Auth0 setup

1. **Enable the Resource Parameter Compatibility Profile.** Settings ->
   Advanced -> *Resource Parameter Compatibility Profile*. Without it Auth0
   ignores `resource`, and every client gets an opaque token that server-aiqa
   rejects. Auth0 also recommends enabling *Include Issuer in Authorization
   Responses* (RFC 9207) alongside it.
2. **Create an API** (Applications -> APIs) with identifier exactly
   `https://mcp-aiqa.winterwell.com` - the MCP server's public URL, i.e.
   `MCP_PUBLIC_URL`, because that is the `resource` its clients ask for. Signing
   algorithm RS256. Enable *Allow Offline Access*, or refresh tokens are never
   issued and users get sent back to the browser whenever a token expires.

   Note this is **not** the existing `https://server-aiqa.winterwell.com` API.
   The audience identifies the resource the client is talking to, which is the
   MCP server; server-aiqa is told to accept it (see below). Reusing the
   server-aiqa identifier would mean advertising a `resource` that is not this
   server's own URL, which clients are entitled to reject.
3. **Enable dynamic client registration** - done. Settings -> Advanced -> *OIDC
   Dynamic Application Registration*. Equivalent Management API call:
   `PATCH /api/v2/tenants/settings` with
   `{"flags":{"enable_dynamic_client_registration":true}}`.
   Note this leaves an unauthenticated registration endpoint open on the tenant:
   anyone may POST to `/oidc/register` and create third-party application
   entries (they appear with a `tpc_` client_id prefix). That is inherent to
   DCR, and it is what lets clients self-register.
4. **Turn off the tenant-wide Classic login page.** The global *All
   Applications* client carries `custom_login_page_on: true` with no page
   behind it, which forces the Classic experience, and Auth0 refuses to serve
   Classic to third-party clients: *"Third Party clients are not allowed to use
   the Classic Universal Login experience."* DCR clients are all third-party, so
   login fails for every one of them until this is cleared:
   `PATCH /api/v2/clients/efvPvXGgmdOYVMd6jGc18eGPIexaJ_Z0` with
   `{"custom_login_page_on":false}`. Existing `tpc_` clients need the same patch
   individually; the tenant flags themselves are already correct
   (`new_universal_login_experience_enabled: true`).
5. **Promote the login connection to domain level.** Third-party applications
   can only use domain-level connections. Whichever connection your users log in
   with needs this, or registration succeeds and login then fails. This cannot
   be checked without a browser login, so it is the most likely remaining
   surprise.
6. Users will see Auth0's **consent screen** - third-party applications cannot
   skip it. For a connector granting access to an editor, that is arguably
   right, but it is a visible change.

Observed from the live tenant: DCR accepts `http://localhost:9999/callback` as a
redirect URI, accepts `token_endpoint_auth_method: none` (public client + PKCE,
which is what MCP clients use), and grants `refresh_token` to a client that asks
for it - but only `authorization_code` to one that does not.

### Server configuration

MCP server (`mcp/.env`, or the GitHub Actions variables of the same names):

```bash
AIQA_OAUTH_ISSUER=https://winterstein.eu.auth0.com/
```

There is no audience variable. The audience is `MCP_PUBLIC_URL`, because that is
what clients send as `resource` - so **`MCP_PUBLIC_URL` must be set in
production**, and must match the Auth0 API identifier from step 2. Everything
else about Auth0 is read from its `/.well-known/openid-configuration` at
startup, so nothing is hardcoded to Auth0's URL shapes.

(`AIQA_OAUTH_AUDIENCE` was the broker's audience setting. It is no longer read;
the server logs a warning if it is still set, and it can be deleted from the
GitHub Actions variables.)

server-aiqa (`server/.env`) must accept tokens for that audience. Add it to the
existing list rather than replacing the value, so webapp tokens keep verifying:

```bash
AUTH0_AUDIENCE=https://winterstein.eu.auth0.com/api/v2/,https://mcp-aiqa.winterwell.com
```

The **first** audience in that list gets admin access; the ones after it get
developer. That is deliberate: an OAuth-connected editor should not be able to
delete users or organisations (the only two admin-only endpoints), while the
webapp keeps working exactly as before. `AUTH0_ADMIN_AUDIENCES` overrides the
split if you need something else. Both servers log what they resolved at
startup.

### Deployment order

The pieces have to land in this order, or there is a window where login
succeeds and every tool call then 401s:

1. Auth0: the compatibility profile, the API, and the Classic login page fix.
2. server-aiqa: `AUTH0_AUDIENCE` extended, deployed.
3. MCP server: this code, deployed.

### Failure behaviour

OAuth is additive and switched off by default, so a problem with it cannot take
API-key clients down:

- Unset `AIQA_OAUTH_ISSUER` and restart: back to API-key-only, immediately.
- If Auth0's metadata cannot be read at startup, or it does not advertise
  dynamic registration, OAuth stays off, `/health` reports `oauth: "error"`,
  and the reason is logged. The server does not exit: the unit restarts on
  failure, so exiting would mean a crash loop over a fault that is not the
  API-key users'. `./scripts/check-live.sh` fails on this state.
- `/health` reports `oauth` as `disabled`, `enabled` or `error`.

What startup checks *cannot* catch is a missing or mismatched Auth0 API - that
needs a browser login. It shows up as `access_denied: Service not found:
<resource>` from Auth0, or as a clean login followed by 401s from server-aiqa.

### Client configuration

With OAuth enabled, the config carries no secret:

```json
{
  "mcpServers": {
    "aiqa": {
      "url": "https://mcp-aiqa.winterwell.com/sse"
    }
  }
}
```

The client discovers it needs a token from the `401`, follows the metadata to
Auth0, registers itself there, opens a browser for login, and stores the token.
API keys continue to work unchanged for anyone who prefers them, or for scripted
use:

```json
{
  "mcpServers": {
    "aiqa": {
      "url": "https://mcp-aiqa.winterwell.com/sse",
      "headers": { "Authorization": "Bearer YOUR_API_KEY_HERE" }
    }
  }
}
```

### Testing without Auth0

`pnpm run test:protocol` covers the discovery handoff against a stub identity
provider: that clients are pointed at the provider's own issuer, that the
`resource` is this server's public URL, that none of the old broker endpoints
are served, that nothing is forwarded to the provider, and both failure modes.
It needs no tenant and no network.

## User Configuration (Cursor/Claude Code)

Users configure their Cursor or Claude Code clients to connect to the hosted MCP server.

### Configuring Cursor / Claude Code / Other Tools

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

**Important:** Users should replace `YOUR_API_KEY_HERE` with their actual API key from server-aiqa.

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
- Verify API key is valid: `curl -H "Authorization: Bearer $AIQA_API_KEY" $AIQA_API_BASE_URL/health`
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
