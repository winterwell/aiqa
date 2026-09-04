/**
 * SPIKE - not part of the shipped server.
 *
 * Question: can we use the MCP SDK's Express-based OAuth routers from our
 * Fastify server, instead of migrating the MCP server to Express?
 *
 * The SDK's transports are framework-agnostic (raw Node req/res), but its auth
 * layer is Express: `mcpAuthRouter` returns an Express RequestHandler and must
 * be mounted at the application root. This spike mounts it inside Fastify via
 * @fastify/express and checks that:
 *   1. the OAuth endpoints work (metadata, DCR, authorize),
 *   2. Fastify's own routes still work alongside it,
 *   3. the resource-server-only router (the likely real target for AIQA) works,
 *   4. Fastify's body parsing doesn't fight Express's.
 *
 * Run with: pnpm run spike:oauth
 */

import { createServer, type Server as HttpServer } from 'node:http';
import Fastify from 'fastify';
import fastifyExpress from '@fastify/express';
import { mcpAuthRouter, mcpAuthMetadataRouter } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { ProxyOAuthServerProvider } from '@modelcontextprotocol/sdk/server/auth/providers/proxyProvider.js';

const PORT = 4395;
const RS_PORT = 4394;
const UPSTREAM_PORT = 4393;
const UPSTREAM = 'https://auth.example.com';
// Dynamic client registration is proxied upstream, so it needs a reachable
// endpoint; otherwise a 500 here would only tell us auth.example.com does not
// resolve, not whether Fastify and Express can share a request body.
const UPSTREAM_LOCAL = `http://127.0.0.1:${UPSTREAM_PORT}`;

let failures = 0;
function check(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✓ ${message}`);
  } else {
    failures++;
    console.error(`  ✗ ${message}`);
  }
}

/** Stands in for AIQA's real identity provider. */
const provider = new ProxyOAuthServerProvider({
  endpoints: {
    authorizationUrl: `${UPSTREAM}/authorize`,
    tokenUrl: `${UPSTREAM}/token`,
    registrationUrl: `${UPSTREAM_LOCAL}/register`,
  },
  verifyAccessToken: async token => ({
    token,
    clientId: 'spike-client',
    scopes: ['mcp:read'],
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
  }),
  getClient: async clientId => ({
    client_id: clientId,
    redirect_uris: ['http://localhost:9999/callback'],
  }),
});

/** Minimal upstream authorization server, just enough to accept a DCR POST. */
function startUpstream(): Promise<HttpServer> {
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', c => (raw += c));
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      if (req.method === 'POST' && req.url?.startsWith('/register')) {
        // Echo back what the router forwarded, so we can confirm the body survived.
        const forwarded = raw ? JSON.parse(raw) : {};
        res.writeHead(201).end(
          JSON.stringify({
            client_id: 'issued-by-upstream',
            client_name: forwarded.client_name,
            redirect_uris: forwarded.redirect_uris ?? [],
          }),
        );
        return;
      }
      res.writeHead(404).end(JSON.stringify({ error: 'not_found' }));
    });
  });
  return new Promise(resolve => server.listen(UPSTREAM_PORT, '127.0.0.1', () => resolve(server)));
}

/** Case A: full authorization-server router mounted at the Fastify root. */
async function buildFullAsServer() {
  const app = Fastify({ logger: false });
  await app.register(fastifyExpress);

  // The SDK requires this at the application root.
  app.use(
    mcpAuthRouter({
      provider,
      issuerUrl: new URL(`http://localhost:${PORT}`),
      scopesSupported: ['mcp:read', 'mcp:write'],
      resourceName: 'AIQA MCP',
    }),
  );

  // A pre-existing Fastify route, to prove the two coexist.
  app.get('/health', async () => ({ status: 'ok', service: 'spike' }));

  await app.listen({ port: PORT, host: '127.0.0.1' });
  return app;
}

/** Case B: resource-server-only metadata router, the likely real shape for AIQA. */
async function buildResourceServer() {
  const app = Fastify({ logger: false });
  await app.register(fastifyExpress);

  app.use(
    mcpAuthMetadataRouter({
      oauthMetadata: {
        issuer: UPSTREAM,
        authorization_endpoint: `${UPSTREAM}/authorize`,
        token_endpoint: `${UPSTREAM}/token`,
        response_types_supported: ['code'],
      },
      resourceServerUrl: new URL(`http://localhost:${RS_PORT}`),
      resourceName: 'AIQA MCP',
      scopesSupported: ['mcp:read'],
    }),
  );

  await app.listen({ port: RS_PORT, host: '127.0.0.1' });
  return app;
}

async function run() {
  console.log('SPIKE: MCP SDK OAuth routers inside Fastify\n');

  console.log('Case A: full mcpAuthRouter mounted at the Fastify root...');
  const upstream = await startUpstream();
  const asApp = await buildFullAsServer();
  try {
    const meta = await fetch(`http://localhost:${PORT}/.well-known/oauth-authorization-server`);
    check(meta.status === 200, `AS metadata returns HTTP ${meta.status}`);
    const metaBody: any = await meta.json();
    check(metaBody.issuer === `http://localhost:${PORT}/`, `issuer advertised (${metaBody.issuer})`);
    check(
      typeof metaBody.authorization_endpoint === 'string' && typeof metaBody.token_endpoint === 'string',
      'authorize + token endpoints advertised',
    );
    check(
      Array.isArray(metaBody.code_challenge_methods_supported) &&
        metaBody.code_challenge_methods_supported.includes('S256'),
      'PKCE S256 advertised',
    );

    // Dynamic client registration - a POST, so this also exercises body parsing.
    const reg = await fetch(`http://localhost:${PORT}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_name: 'spike',
        redirect_uris: ['http://localhost:9999/callback'],
      }),
    });
    const regBody = await reg.text();
    check(
      reg.status !== 400 && reg.status !== 500,
      `DCR endpoint parsed the JSON body (HTTP ${reg.status}) ${reg.status >= 400 ? regBody.slice(0, 300) : ''}`,
    );
    check(
      regBody.includes('spike') || regBody.includes('issued-by-upstream'),
      'the POST body survived the Fastify -> Express hand-off',
    );

    // Authorize should redirect to the upstream provider.
    const authorize = await fetch(
      `http://localhost:${PORT}/authorize?client_id=spike-client&response_type=code` +
        `&redirect_uri=${encodeURIComponent('http://localhost:9999/callback')}` +
        `&code_challenge=abc&code_challenge_method=S256`,
      { redirect: 'manual' },
    );
    check(
      authorize.status >= 300 && authorize.status < 400,
      `authorize redirects (HTTP ${authorize.status})`,
    );
    check(
      (authorize.headers.get('location') ?? '').startsWith(`${UPSTREAM}/authorize`),
      'authorize redirects to the upstream provider',
    );

    // The important compatibility question.
    const health = await fetch(`http://localhost:${PORT}/health`);
    const healthBody: any = await health.json();
    check(health.status === 200 && healthBody.status === 'ok', 'existing Fastify route still works');
  } finally {
    await asApp.close();
    upstream.close();
  }

  console.log('\nCase B: mcpAuthMetadataRouter (resource server only)...');
  const rsApp = await buildResourceServer();
  try {
    const prm = await fetch(`http://localhost:${RS_PORT}/.well-known/oauth-protected-resource`);
    check(prm.status === 200, `protected resource metadata returns HTTP ${prm.status}`);
    const prmBody: any = await prm.json();
    check(
      Array.isArray(prmBody.authorization_servers) && prmBody.authorization_servers[0] === UPSTREAM,
      'advertises the upstream authorization server',
    );
    check(prmBody.resource_name === 'AIQA MCP', 'advertises the resource name');
  } finally {
    await rsApp.close();
  }

  console.log(failures === 0 ? '\nSPIKE PASSED: no framework switch needed.' : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

const guard = setTimeout(() => {
  console.error('\nSpike timed out');
  process.exit(1);
}, 30_000);
guard.unref();

run().catch(error => {
  console.error('\nSpike errored:', error);
  process.exit(1);
});
