/**
 * Protocol-level tests for the MCP server.
 *
 * Unlike the other tests in here, these exercise the MCP server itself over a
 * real SSE transport: they start the built server, point it at a stub AIQA API,
 * and drive it with the SDK's own MCP client. That covers tools/list and
 * tools/call, including the client->server POST routing that the plain
 * AiqaApiClient tests never touch.
 *
 * Run with: pnpm run test:protocol
 */

import { createServer, type Server as HttpServer } from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

const API_KEY = 'test-key';
// A key the stub API refuses, so the connect-time check has something to reject.
const BAD_KEY = 'not-a-real-key';
const STUB_PORT = 4398;
const MCP_PORT = 4397;
// Extra MCP instances for the OAuth cases; kept clear of the ports above.
const MCP_PORT_ALT = 4396;
const MCP_PORT_OAUTH = 4395;
const MCP_PORT_BROKEN = 4394;
// Stub identity provider, standing in for Auth0.
const IDP_PORT = 4392;
// Deliberately never bound, for the unreachable-provider case.
const IDP_PORT_UNUSED = 4391;

// A broken server tends to hang rather than refuse, so every test run is
// bounded: CI should get a failure, not a stuck job.
const TEST_TIMEOUT_MS = 30_000;

let failures = 0;

function withTimeout<T>(promise: Promise<T>, label: string, ms = 10_000): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Timed out after ${ms}ms: ${label}`)), ms).unref(),
    ),
  ]);
}

function check(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✓ ${message}`);
  } else {
    failures++;
    console.error(`  ✗ ${message}`);
  }
}

/** Every request the MCP server made upstream, for leak assertions. */
const upstreamCalls: Array<{ url: string; auth?: string }> = [];

/** The session id the server handed our client, observed from its POST URLs. */
let capturedSessionId: string | undefined;

/** Minimal stand-in for server-aiqa, so these tests need no real backend. */
function startStubApi(): Promise<HttpServer> {
  const server = createServer((req, res) => {
    upstreamCalls.push({ url: req.url ?? '', auth: req.headers.authorization });
    const url = new URL(req.url ?? '/', 'http://localhost');
    res.setHeader('Content-Type', 'application/json');

    // Mirror server-aiqa's 401 for a credential it does not recognise.
    if (req.headers.authorization === `Bearer ${BAD_KEY}`) {
      res.writeHead(401).end(JSON.stringify({ error: 'Invalid Bearer token (JWT or API key).' }));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/dataset') {
      res.end(JSON.stringify({ hits: [{ id: 'ds-1', name: 'stub-dataset' }], total: 1 }));
      return;
    }
    if (req.method === 'POST' && url.pathname === '/dataset') {
      res.end(JSON.stringify({ id: 'ds-new', name: 'created-by-test' }));
      return;
    }
    res.writeHead(404).end(JSON.stringify({ error: `no stub for ${req.method} ${url.pathname}` }));
  });
  return new Promise(resolve => server.listen(STUB_PORT, () => resolve(server)));
}

/** Every request the MCP server made to the identity provider. */
const idpCalls: Array<{ method: string; url: string; body: string; contentType?: string }> = [];

/**
 * Minimal stand-in for Auth0. Only has to be shaped like an OAuth provider:
 * these tests are about what this server advertises, not about Auth0.
 *
 * Two issuers are served: the root one supports dynamic registration, and
 * /no-dcr does not, which is the difference between OAuth being offered and
 * being reported as broken.
 */
function startStubIdp(): Promise<HttpServer> {
  const base = `http://localhost:${IDP_PORT}`;
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', () => {
      idpCalls.push({
        method: req.method ?? '',
        url: req.url ?? '',
        body,
        contentType: req.headers['content-type'] as string | undefined,
      });
      const url = new URL(req.url ?? '/', base);
      res.setHeader('Content-Type', 'application/json');

      if (url.pathname === '/.well-known/openid-configuration') {
        res.end(
          JSON.stringify({
            // Deliberately carries the trailing slash the configured issuer
            // lacks: this is the value clients must be given.
            issuer: `${base}/`,
            authorization_endpoint: `${base}/authorize`,
            token_endpoint: `${base}/oauth/token`,
            registration_endpoint: `${base}/oidc/register`,
            revocation_endpoint: `${base}/oauth/revoke`,
            scopes_supported: ['openid', 'email'],
            token_endpoint_auth_methods_supported: ['client_secret_post', 'none'],
          }),
        );
        return;
      }
      // A provider with no dynamic registration. Clients cannot self-register
      // against it, so OAuth must not be offered.
      if (url.pathname === '/no-dcr/.well-known/openid-configuration') {
        res.end(
          JSON.stringify({
            issuer: `${base}/no-dcr`,
            authorization_endpoint: `${base}/authorize`,
            token_endpoint: `${base}/oauth/token`,
          }),
        );
        return;
      }
      // These are no longer called - clients talk to the provider directly.
      // Kept so that a regression which starts proxying again is recorded as a
      // call rather than vanishing into a 404.
      if (url.pathname === '/oidc/register') {
        res.writeHead(201).end(JSON.stringify({ client_id: 'stub-client-id', client_secret: 'stub-secret' }));
        return;
      }
      if (url.pathname === '/oauth/token') {
        res.end(JSON.stringify({ access_token: 'stub-access-token', token_type: 'Bearer', expires_in: 86400 }));
        return;
      }
      res.writeHead(404).end(JSON.stringify({ error: `no idp stub for ${req.method} ${url.pathname}` }));
    });
  });
  return new Promise(resolve => server.listen(IDP_PORT, () => resolve(server)));
}

/** Start the built MCP server and wait for it to accept connections. */
async function startMcpServer(
  extraEnv: Record<string, string> = {},
  port = MCP_PORT,
): Promise<ChildProcess> {
  const child = spawn(process.execPath, ['dist/index.js'], {
    env: {
      ...process.env,
      MCP_PORT: String(port),
      AIQA_API_BASE_URL: `http://localhost:${STUB_PORT}`,
      LOG_LEVEL: 'warn',
      // Cleared so a developer's own exported OAuth settings cannot change what
      // these tests exercise; empty reads the same as unset.
      AIQA_OAUTH_ISSUER: '',
      AIQA_OAUTH_AUDIENCE: '',
      ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr?.on('data', d => process.stderr.write(`[mcp] ${d}`));

  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(`http://localhost:${port}/health`);
      if (res.ok) return child;
    } catch {
      // not up yet
    }
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error(`MCP server did not start on port ${port}`);
}

async function connectClient(): Promise<Client> {
  const transport = new SSEClientTransport(new URL(`http://localhost:${MCP_PORT}/sse`), {
    // Attach the API key to the SSE stream and every subsequent POST.
    // Note: init.headers may be a Headers instance, so merge via the Headers
    // API rather than spreading it (spreading would drop Content-Type).
    fetch: (url, init) => {
      const headers = new Headers(init?.headers as any);
      headers.set('Authorization', `Bearer ${API_KEY}`);
      // The transport posts to the endpoint the server advertised, so this is
      // where the session id becomes visible without touching internals.
      capturedSessionId =
        new URL(String(url), `http://localhost:${MCP_PORT}`).searchParams.get('sessionId') ??
        capturedSessionId;
      return fetch(url as any, { ...init, headers });
    },
  });
  const client = new Client({ name: 'protocol-test', version: '1.0.0' });
  await withTimeout(client.connect(transport), 'MCP connect');
  return client;
}

async function run() {
  console.log('Running MCP protocol tests...\n');
  const stub = await startStubApi();
  const mcp = await startMcpServer();

  try {
    // Test 1: the connection handshake itself. This is what returned HTTP 500
    // when the handlers were registered with method-name strings.
    console.log('Test 1: connect over SSE...');
    const client = await connectClient();
    check(true, 'SSE connection established');

    // Test 2: tools/list
    console.log('\nTest 2: tools/list...');
    const { tools } = await withTimeout(client.listTools(), 'tools/list');
    check(Array.isArray(tools) && tools.length > 0, `returned ${tools.length} tools`);
    const names = tools.map(t => t.name);
    for (const expected of ['create_dataset', 'query_datasets']) {
      check(names.includes(expected), `advertises ${expected}`);
    }
    check(
      tools.every(t => t.inputSchema?.type === 'object'),
      'every tool has an object inputSchema',
    );

    // Test 3: tools/call on a read tool. Proves the POST /message round trip.
    console.log('\nTest 3: tools/call query_datasets...');
    const listed: any = await withTimeout(
      client.callTool({ name: 'query_datasets', arguments: { organisation: 'org-1' } }),
      'tools/call query_datasets',
    );
    check(!listed.isError, 'call did not report an error');
    check(listed.content?.[0]?.type === 'text', 'returned text content');
    check(
      String(listed.content?.[0]?.text).includes('stub-dataset'),
      'response carries data from the API',
    );

    // Test 4: tools/call on a write tool, with arguments forwarded.
    console.log('\nTest 4: tools/call create_dataset...');
    const created: any = await withTimeout(
      client.callTool({ name: 'create_dataset', arguments: { organisation: 'org-1', name: 'created-by-test' } }),
      'tools/call create_dataset',
    );
    check(!created.isError, 'call did not report an error');
    check(
      String(created.content?.[0]?.text).includes('ds-new'),
      'response carries the created dataset',
    );

    // Test 5: an unknown tool should come back as a tool error, not a crash.
    console.log('\nTest 5: unknown tool is reported as an error...');
    const unknown: any = await withTimeout(
      client.callTool({ name: 'no_such_tool', arguments: {} }),
      'tools/call no_such_tool',
    );
    check(unknown.isError === true, 'unknown tool sets isError');

    // Test 6: a session-less POST must not be accepted.
    console.log('\nTest 6: POST /message without a sessionId is rejected...');
    const noSession = await fetch(`http://localhost:${MCP_PORT}/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    });
    check(noSession.status === 400, `got HTTP ${noSession.status}, expected 400`);

    // Test 7: unauthenticated connections are refused, with a usable challenge.
    console.log('\nTest 7: GET /sse without a key is rejected...');
    const noAuth = await fetch(`http://localhost:${MCP_PORT}/sse`);
    check(noAuth.status === 401, `got HTTP ${noAuth.status}, expected 401`);
    const challenge = noAuth.headers.get('www-authenticate');
    check(challenge !== null, 'sends a WWW-Authenticate header');
    check(!!challenge?.startsWith('Bearer '), 'challenge uses the Bearer scheme');
    check(
      !!challenge?.includes('resource_metadata='),
      'challenge points at the protected resource metadata',
    );

    // Test 8: the metadata document the challenge points to must exist and parse.
    console.log('\nTest 8: protected resource metadata is discoverable...');
    const metaUrl = challenge?.match(/resource_metadata="([^"]+)"/)?.[1];
    check(!!metaUrl, `challenge contains a metadata URL (${metaUrl})`);
    const meta = await fetch(metaUrl!);
    check(meta.status === 200, `metadata returns HTTP ${meta.status}, expected 200`);
    const metaBody: any = await meta.json();
    check(typeof metaBody.resource === 'string', 'metadata declares a resource');
    check(
      Array.isArray(metaBody.bearer_methods_supported) &&
        metaBody.bearer_methods_supported.includes('header'),
      'metadata advertises header bearer auth',
    );
    // No authorization server is configured in this test env, so the field must
    // be absent rather than present-but-wrong.
    check(
      metaBody.authorization_servers === undefined,
      'omits authorization_servers when none is configured',
    );

    // Test 9: a provider that cannot serve the flow must be reported, not
    // silently offered - but it must not stop the server, or a bad OAuth
    // setting would take API-key clients down with it (the unit restarts on
    // failure, so exiting would mean a crash loop).
    console.log('\nTest 9: a provider without dynamic registration is reported, not fatal...');
    const noDcrIdp = await startStubIdp();
    const noDcrMcp = await startMcpServer(
      { AIQA_OAUTH_ISSUER: `http://localhost:${IDP_PORT}/no-dcr` },
      MCP_PORT_ALT,
    );
    try {
      const noDcrBase = `http://localhost:${MCP_PORT_ALT}`;
      const health: any = await (await fetch(`${noDcrBase}/health`)).json();
      check(health.oauth === 'error', `health reports oauth=${health.oauth}, expected error`);
      const prm: any = await (await fetch(`${noDcrBase}/.well-known/oauth-protected-resource`)).json();
      check(prm.authorization_servers === undefined, 'advertises no authorization server');
      const keyed = await fetch(`${noDcrBase}/sse`, { headers: { Authorization: `Bearer ${API_KEY}` } });
      check(keyed.status === 200, `API-key connections still work (HTTP ${keyed.status})`);
      await keyed.body?.cancel();
    } finally {
      noDcrMcp.kill();
      noDcrIdp.close();
    }

    // Test 10: a session may only be driven by the key that opened it.
    // Without this, knowing a session ID would be enough to act as its owner.
    console.log('\nTest 10: another key cannot drive this session...');
    const sessionId = capturedSessionId;
    check(!!sessionId, `test captured the session id (${sessionId})`);
    const before = upstreamCalls.length;
    const hijacked = await fetch(`http://localhost:${MCP_PORT}/message?sessionId=${sessionId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer WRONG-KEY',
        Origin: 'http://elsewhere.example',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 99,
        method: 'tools/call',
        params: { name: 'query_datasets', arguments: { organisation: 'someone-elses-org' } },
      }),
    });
    check(hijacked.status === 401, `wrong key rejected with HTTP ${hijacked.status}, expected 401`);
    await new Promise(r => setTimeout(r, 300));
    check(
      upstreamCalls.length === before,
      `no upstream call was made (${upstreamCalls.length - before} made)`,
    );

    // Test 11: hijacking the reply must not strip CORS headers, or browser
    // clients (e.g. MCP Inspector) get a response they are not allowed to read.
    console.log('\nTest 11: CORS headers survive on POST /message...');
    check(
      hijacked.headers.get('access-control-allow-origin') !== null,
      'POST /message carries Access-Control-Allow-Origin',
    );

    // Test 12: forwarded headers must be ignored unless a proxy is configured,
    // otherwise a client can choose the URLs we advertise to other clients.
    console.log('\nTest 12: X-Forwarded-Host is not trusted by default...');
    const spoofed = await fetch(`http://localhost:${MCP_PORT}/sse`, {
      headers: { 'X-Forwarded-Host': 'evil.example', 'X-Forwarded-Proto': 'https' },
    });
    const spoofedChallenge = spoofed.headers.get('www-authenticate') ?? '';
    check(
      !spoofedChallenge.includes('evil.example'),
      `challenge ignores the spoofed host (${spoofedChallenge.match(/resource_metadata="([^"]+)"/)?.[1]})`,
    );

    // Test 13: a key the API does not recognise must be turned away at connect
    // time. Otherwise the client reports a healthy connection, lists the tools,
    // and only fails once a tool is called - with an upstream 401 wrapped in a
    // tool result, which no client can re-authenticate from.
    console.log('\nTest 13: a key server-aiqa rejects cannot connect...');
    const rejected = await fetch(`http://localhost:${MCP_PORT}/sse`, {
      headers: { Authorization: `Bearer ${BAD_KEY}` },
    });
    check(rejected.status === 401, `got HTTP ${rejected.status}, expected 401`);
    check(
      (rejected.headers.get('www-authenticate') ?? '').includes('resource_metadata='),
      'rejection carries a WWW-Authenticate challenge',
    );

    // Tests 14-17: the OAuth handoff, against a stub identity provider. The
    // provider is not under test - what is under test is that clients are sent
    // to it directly, and that this server no longer sits in the flow.
    console.log('\nTests 14-17: OAuth discovery handoff...');
    const idp = await startStubIdp();
    // Test 9 used a stub too, and idpCalls is shared. Reset before the server
    // starts so the counts below describe only this server's traffic.
    idpCalls.length = 0;
    const discoveryCallCount = () =>
      idpCalls.filter(call => call.url.endsWith('/.well-known/openid-configuration')).length;
    const oauthMcp = await startMcpServer(
      { AIQA_OAUTH_ISSUER: `http://localhost:${IDP_PORT}` },
      MCP_PORT_OAUTH,
    );
    const oauthBase = `http://localhost:${MCP_PORT_OAUTH}`;
    try {
      const health: any = await (await fetch(`${oauthBase}/health`)).json();
      check(health.oauth === 'enabled', `health reports oauth=${health.oauth}, expected enabled`);

      const prm: any = await (await fetch(`${oauthBase}/.well-known/oauth-protected-resource`)).json();

      // Clients are pointed at the provider, and at the issuer the provider
      // names itself by - not the string we were configured with. The stub
      // advertises a trailing slash the configured value does not have, so this
      // fails if the configured string is passed through instead.
      check(
        Array.isArray(prm.authorization_servers) &&
          prm.authorization_servers[0] === `http://localhost:${IDP_PORT}/`,
        `advertises the provider's own issuer (${prm.authorization_servers?.[0]})`,
      );

      // The resource is what clients send as RFC 8707 `resource`, and so the
      // audience the provider issues for. If this is not this server's public
      // URL, the provider-side API identifier cannot match it.
      check(prm.resource === oauthBase, `declares its own URL as the resource (${prm.resource})`);

      // The broker is gone: no metadata of our own describing endpoints we no
      // longer serve, and none of the endpoints themselves. A client finding
      // these would be routed back through a server that adds nothing.
      const asm = await fetch(`${oauthBase}/.well-known/oauth-authorization-server`);
      check(
        asm.status === 404,
        `serves no authorization server metadata of its own (HTTP ${asm.status})`,
      );
      for (const path of ['/authorize?client_id=abc', '/token', '/register', '/revoke']) {
        const method = path === '/authorize?client_id=abc' ? 'GET' : 'POST';
        const gone = await fetch(`${oauthBase}${path}`, { method, redirect: 'manual' });
        check(gone.status === 404, `${method} ${path} is not served (HTTP ${gone.status})`);
      }

      // Nothing above should have reached the provider. Discovery at startup is
      // the only call this server makes to it, which is the whole point of the
      // change: the login path no longer passes through here.
      check(
        discoveryCallCount() === 1,
        `contacted the provider once, for discovery (${discoveryCallCount()} calls)`,
      );
      const proxied = idpCalls.filter(
        call => !call.url.endsWith('/.well-known/openid-configuration'),
      );
      check(
        proxied.length === 0,
        `forwarded nothing to the provider (${proxied.map(c => c.url).join(', ') || 'none'})`,
      );
    } finally {
      oauthMcp.kill();
      idp.close();
    }

    // Test 20: a provider that cannot be reached must not leave clients being
    // pointed into a flow that dead-ends - and must not affect API-key clients.
    console.log('\nTest 20: an unreachable provider disables OAuth cleanly...');
    const brokenBase = `http://localhost:${MCP_PORT_BROKEN}`;
    const brokenMcp = await startMcpServer(
      // Nothing is listening on this port, so discovery is refused immediately.
      { AIQA_OAUTH_ISSUER: `http://localhost:${IDP_PORT_UNUSED}` },
      MCP_PORT_BROKEN,
    );
    try {
      const health: any = await (await fetch(`${brokenBase}/health`)).json();
      check(health.oauth === 'error', `health reports oauth=${health.oauth}, expected error`);
      const prm: any = await (await fetch(`${brokenBase}/.well-known/oauth-protected-resource`)).json();
      check(
        prm.authorization_servers === undefined,
        'does not advertise an authorization server it could not reach',
      );
      const keyed = await fetch(`${brokenBase}/sse`, { headers: { Authorization: `Bearer ${API_KEY}` } });
      check(keyed.status === 200, `API-key connections are unaffected (HTTP ${keyed.status})`);
      await keyed.body?.cancel();
    } finally {
      brokenMcp.kill();
    }

    await client.close();
  } finally {
    mcp.kill();
    stub.close();
  }

  console.log(
    failures === 0 ? '\nAll MCP protocol tests passed.' : `\n${failures} check(s) failed.`,
  );
  // Fail loudly, so CI can actually catch a regression.
  process.exit(failures === 0 ? 0 : 1);
}

const overallTimeout = setTimeout(() => {
  console.error(`\nMCP protocol tests exceeded ${TEST_TIMEOUT_MS}ms`);
  process.exit(1);
}, TEST_TIMEOUT_MS);
overallTimeout.unref();

run().catch(error => {
  console.error('\nMCP protocol tests errored:', error);
  process.exit(1);
});
