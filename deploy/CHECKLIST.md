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

**Secrets** (Settings → Secrets and variables → Actions → Secrets tab):
- [ ] `DEPLOY_SSH_KEY` - Private SSH key (full content)
- [ ] `VITE_AUTH0_CLIENT_ID` - Auth0 client ID

## Server Setup

- [ ] Run `./deploy/setup.sh` on the server (or follow manual steps)
- [ ] Created `/opt/aiqa/server/.env` with database credentials
- [ ] Server service file installed: `/etc/systemd/system/aiqa-server.service`
- [ ] Nginx config installed: `/etc/nginx/sites-available/webapp` (from `deploy/aiqa-webapp.nginx.conf`)
- [ ] Nginx config symlinked: `/etc/nginx/sites-enabled/webapp`
- [ ] Website nginx config installed (optional): `/etc/nginx/sites-available/website` (from `deploy/aiqa-website.nginx.conf`)
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
- [ ] Test server API: `curl http://localhost:4001/version`

- [ ] Push a change to `webapp/` directory to trigger webapp deployment
- [ ] Verify webapp deployment workflow completes successfully
- [ ] Check nginx is running: `sudo systemctl status nginx`
- [ ] Test webapp: `curl http://localhost:4000`
- [ ] Verify webapp can connect to server API

## Post-Deployment Verification

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
   - Check port 4000 is not in use: `sudo netstat -tulpn | grep :4000`

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

