# Deployment Checklist

Use this checklist to verify your deployment setup is complete.

## Pre-Deployment

- [ ] Ubuntu server (20.04+) is set up and accessible via SSH
- [ ] Node.js 20+ is installed on the server
- [ ] pnpm is installed globally on the server (or will be auto-installed by workflow)
- [ ] Nginx is installed on the server
- [ ] GitHub repository has Actions enabled
- [ ] SSH key pair generated for GitHub Actions
- [ ] Public SSH key added to server's `~/.ssh/authorized_keys`

## GitHub Secrets / Variables Configuration

**Variables** (Settings → Secrets and variables → Actions → Variables tab):
- [ ] `DEPLOY_HOST` - Server IP/hostname
- [ ] `DEPLOY_USER` - SSH username
- [ ] `DEPLOY_PORT` - SSH port (optional, defaults to 22)
- [ ] `VITE_AIQA_SERVER_URL` - Server API URL for webapp
- [ ] `VITE_AUTH0_DOMAIN` - Auth0 domain
- [ ] `VITE_AUTH0_AUDIENCE` - Auth0 audience
- [ ] `AUTH0_DOMAIN` - Auth0 domain for the server (no VITE_ prefix)
- [ ] `AUTH0_AUDIENCE` - accepted JWT audiences for the server, comma-separated,
      **no spaces**. First entry keeps admin. Leaving this unset means audiences
      are not verified at all and every JWT caller drops to developer - the
      server logs a warning at startup if so
- [ ] (Optional, MCP OAuth) `AIQA_OAUTH_ISSUER` - Auth0 issuer URL, e.g. `https://winterstein.eu.auth0.com/`.
      There is no audience variable: clients send the MCP server's own public URL as
      RFC 8707 `resource`, so `MCP_PUBLIC_URL` is the audience

**Secrets** (Settings → Secrets and variables → Actions → Secrets tab):
- [ ] `DEPLOY_SSH_KEY` - Private SSH key (full content)
- [ ] `VITE_AUTH0_CLIENT_ID` - Auth0 client ID

## Server Setup

- [ ] Run `./deploy/setup.sh` on the server (or follow manual steps)
- [ ] Created `/opt/aiqa/server/.env` with database credentials
- [ ] Server service file installed: `/etc/systemd/system/aiqa-server.service`
- [ ] Nginx config installed: `/etc/nginx/sites-available/app-aiqa.nginx.conf` (from `deploy/app-aiqa.nginx.conf`)
- [ ] Nginx config symlinked: `/etc/nginx/sites-enabled/app-aiqa.nginx.conf`
- [ ] Server nginx config installed (optional): `/etc/nginx/sites-available/server-aiqa.nginx.conf` (from `deploy/server-aiqa.nginx.conf`)
- [ ] Server nginx config symlinked (optional): `/etc/nginx/sites-enabled/server-aiqa.nginx.conf`
- [ ] Website nginx config installed (optional): `/etc/nginx/sites-available/website` (from `deploy/website-aiqa.nginx.conf`)
- [ ] Nginx log directories created: `/var/log/nginx/app-aiqa.winterwell.com`, `/var/log/nginx/aiqa.winterwell.com`, `/var/log/nginx/server-aiqa.winterwell.com` (if using server domain), `/var/log/nginx/mcp-aiqa.winterwell.com` (if using MCP site)
- [ ] (Optional, reports) Report worker: `/opt/aiqa/server-python` venv + code, `aiqa-report-worker.service` installed, `REPORT_WORKER_URL` in server `.env`
- [ ] (Optional) MCP: `/opt/aiqa/mcp` deployed, `aiqa-mcp.service` enabled, `mcp-aiqa.nginx.conf` enabled if exposing MCP publicly
- [ ] Website nginx config symlinked (optional): `/etc/nginx/sites-enabled/website`
- [ ] Default nginx site disabled (if exists)
- [ ] Nginx config tested: `sudo nginx -t`
- [ ] Services enabled: `sudo systemctl enable aiqa-server`
- [ ] Directories have correct permissions

## First Deployment

- [ ] Push a change to `server/` directory to trigger server deployment
- [ ] Verify server deployment workflow completes successfully
- [ ] Check server is running: `sudo systemctl status aiqa-server`
- [ ] Check server logs: `sudo journalctl -u aiqa-server -n 50`
- [ ] Test server API: `curl http://localhost:4318/version`

- [ ] Push a change to `webapp/` directory to trigger webapp deployment
- [ ] Verify webapp deployment workflow completes successfully
- [ ] Check nginx is running: `sudo systemctl status nginx`
- [ ] Test webapp: `curl http://localhost` or `curl https://app-aiqa.winterwell.com`
- [ ] Verify webapp can connect to server API

## MCP OAuth (optional - lets Cursor/Claude users log in instead of pasting an API key)

Skip all of this to stay API-key only, which is the default. Full detail in
`mcp/DEPLOYMENT.md`.

- [ ] Auth0: **Resource Parameter Compatibility Profile** on (Settings → Advanced),
      or Auth0 ignores the `resource` clients send and issues an opaque token
      server-aiqa cannot verify - **outstanding**, confirmed 2026-09-08: an
      `/authorize` probe sending `resource=<MCP URL>` reached the login page
      instead of failing, i.e. Auth0 is still ignoring `resource` (see
      *Verifying the Auth0 side* below)
- [ ] Auth0: API created whose identifier is the MCP server's public URL **with a
      trailing slash** (`https://mcp-aiqa.winterwell.com/`), RS256, *Allow Offline
      Access* on for refresh tokens - **outstanding**; until it exists Auth0 fails
      the login with `Service not found`. The slash matters: Auth0 matches
      identifiers exactly and Claude Code sends the slash form. Note this is the
      MCP server's URL, not server-aiqa's. **Outstanding**, confirmed 2026-09-08:
      both spellings return `Service not found`, identically to a made-up
      audience (see *Verifying the Auth0 side* below)
- [x] Auth0: OIDC Dynamic Application Registration enabled (Settings → Advanced)
- [ ] Auth0: tenant-wide Classic login page cleared - `custom_login_page_on: false`
      on the global *All Applications* client, and on any existing `tpc_` client.
      Third-party clients (which all DCR clients are) cannot use Classic, so every
      login fails until this is done - **outstanding**
- [ ] Auth0: login connection promoted to domain level (DCR clients are third-party
      applications, which can only use domain-level connections)
- [ ] Auth0: delete the `aiqa-mcp-DCR-PROBE*-delete-me` applications left by testing
- [x] GitHub **Variables**: `AIQA_OAUTH_ISSUER` set, and `MCP_PUBLIC_URL` appended to
      `AUTH0_AUDIENCE` in **both** spellings, with and without the trailing slash
      (after the first entry, so they get developer not admin). Both
      deploy workflows rewrite `.env` on the box from scratch, so editing `.env` on
      the server by hand is lost on the next deploy.
      Done 2026-09-08 on the `prod` environment; the pre-existing
      `https://server-aiqa.winterwell.com` entry was kept, and the stale
      `AIQA_OAUTH_AUDIENCE` variable (the old broker's, read by nothing) deleted
- [x] Deploy the server *before* the MCP server, so the new audience is accepted
      by the time OAuth clients can reach it - done 2026-09-08
- [ ] nginx config re-copied and reloaded (no workflow triggers on `deploy/**`),
      or the discovery documents 404
- [x] `curl https://mcp-aiqa.winterwell.com/health` reports `"oauth":"enabled"`
- [ ] Connected once from a real client end to end, in a browser

### Verifying the Auth0 side

Both Auth0 items above can be checked without a browser, using any existing
first-party client id and one of its registered callback URLs. Auth0 resolves
the API *before* asking anyone to log in, so nothing is signed in and no state
changes:

```bash
CID=<a first-party Auth0 client id>
RU=https://app-aiqa.winterwell.com   # must already be a callback URL on CID

# Does the API exist? Compare against a deliberately made-up identifier.
for A in 'https://mcp-aiqa.winterwell.com/' 'https://nope.invalid/'; do
  curl -sD- -o/dev/null "https://winterstein.eu.auth0.com/authorize?client_id=$CID\
&response_type=code&redirect_uri=$RU&scope=openid&audience=$A" | grep -i '^location:'
done
```

`Service not found: <identifier>` means no such API. A redirect to `/u/login`
means it exists.

Then swap `audience=` for `resource=` and re-run. While the API is still
missing, the two answers differ diagnostically:

- `Service not found` - the compatibility profile is **on** (it resolved
  `resource` to an API and found none)
- a redirect to `/u/login` - the profile is **off**, `resource` was ignored

Once both items are done, `resource=<MCP URL>` should redirect to `/u/login`,
and the issued token should be a JWT whose `aud` is the MCP URL.

## Post-Deployment Verification

Run `./scripts/check-live.sh` from the repo root to check all four live services are up
and running the local version (see `--help` for options).

- [ ] Server responds to API requests
- [ ] Webapp loads in browser
- [ ] Webapp can authenticate with Auth0
- [ ] Webapp can make API calls to server
- [ ] Services restart automatically on server reboot
- [ ] Services restart automatically on failure (test by killing process)

## Troubleshooting

If something doesn't work:

1. **Server won't start:**
   - Check logs: `sudo journalctl -u aiqa-server -n 100`
   - Verify `.env` file exists and has correct values
   - Check file permissions: `ls -la /opt/aiqa/server`
   - Verify Node.js: `node --version`
   - Test manually: `cd /opt/aiqa/server && node dist/index.js`

2. **Webapp won't load:**
   - Check nginx status: `sudo systemctl status nginx`
   - Check nginx logs: `sudo tail -f /var/log/nginx/error.log`
   - Verify files exist: `ls -la /opt/aiqa/webapp/dist`
   - Test nginx config: `sudo nginx -t`
   - Check nginx is listening on ports 80/443: `sudo netstat -tulpn | grep nginx`

3. **Deployment fails:**
   - Check GitHub Actions logs for errors
   - Verify SSH connection works: `ssh -i key user@host`
   - Verify secrets are set correctly in GitHub
   - Check server has enough disk space
   - Verify pnpm is installed or can be installed

4. **Webapp can't connect to server:**
   - Verify `VITE_AIQA_SERVER_URL` is correct in GitHub Secrets
   - Check server is running and accessible
   - Verify CORS is enabled on server (it is by default)
   - Check firewall rules allow connections

