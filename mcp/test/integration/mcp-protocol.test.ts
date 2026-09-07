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
const OAUTH_AUDIENCE = 'https://server-aiqa.test';

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
 * these tests are about what the broker forwards and adds, not about Auth0.
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

    // Test 9: half-configured OAuth must be reported, not silently ignored -
    // but it must not stop the server, or a typo in one variable would take
    // API-key clients down with it (the unit restarts on failure, so exiting
    // would mean a crash loop).
    console.log('\nTest 9: half-configured OAuth is reported, not fatal...');
    const halfConfigured = await startMcpServer(
      { AIQA_OAUTH_ISSUER: `http://localhost:${IDP_PORT}` }, // no AIQA_OAUTH_AUDIENCE
      MCP_PORT_ALT,
    );
    try {
      const halfBase = `http://localhost:${MCP_PORT_ALT}`;
      const health: any = await (await fetch(`${halfBase}/health`)).json();
      check(health.oauth === 'error', `health reports oauth=${health.oauth}, expected error`);
      const prm: any = await (await fetch(`${halfBase}/.well-known/oauth-protected-resource`)).json();
      check(prm.authorization_servers === undefined, 'advertises no authorization server');
      const keyed = await fetch(`${halfBase}/sse`, { headers: { Authorization: `Bearer ${API_KEY}` } });
      check(keyed.status === 200, `API-key connections still work (HTTP ${keyed.status})`);
      await keyed.body?.cancel();
    } finally {
      halfConfigured.kill();
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

    // Tests 14-19: the OAuth broker, against a stub identity provider. These
    // cover what the broker forwards and what it adds - Auth0's own behaviour
    // is not under test here.
    console.log('\nTests 14-19: OAuth broker...');
    const idp = await startStubIdp();
    const oauthMcp = await startMcpServer(
      { AIQA_OAUTH_ISSUER: `http://localhost:${IDP_PORT}`, AIQA_OAUTH_AUDIENCE: OAUTH_AUDIENCE },
      MCP_PORT_OAUTH,
    );
    const oauthBase = `http://localhost:${MCP_PORT_OAUTH}`;
    try {
      const health: any = await (await fetch(`${oauthBase}/health`)).json();
      check(health.oauth === 'enabled', `health reports oauth=${health.oauth}, expected enabled`);

      // The protected resource must name this server, not the provider: clients
      // have to come through the broker for the audience to be added.
      const prm: any = await (await fetch(`${oauthBase}/.well-known/oauth-protected-resource`)).json();
      check(
        Array.isArray(prm.authorization_servers) && prm.authorization_servers[0] === oauthBase,
        `advertises itself as the authorization server (${prm.authorization_servers?.[0]})`,
      );

      const asm: any = await (await fetch(`${oauthBase}/.well-known/oauth-authorization-server`)).json();
      check(asm.issuer === oauthBase, 'metadata issuer is this server');
      check(asm.authorization_endpoint === `${oauthBase}/authorize`, 'advertises its own /authorize');
      check(asm.token_endpoint === `${oauthBase}/token`, 'advertises its own /token');
      check(asm.registration_endpoint === `${oauthBase}/register`, 'advertises its own /register');
      check(asm.revocation_endpoint === `${oauthBase}/revoke`, 'advertises /revoke, which upstream has');
      check(
        JSON.stringify(asm.code_challenge_methods_supported) === '["S256"]',
        'requires S256 PKCE only, so a client cannot downgrade to plain',
      );
      check(
        JSON.stringify(asm.token_endpoint_auth_methods_supported) === '["client_secret_post","none"]',
        'mirrors the provider\'s client authentication methods',
      );

      // /authorize hands off to the provider with the audience added - the whole
      // reason this broker exists.
      const authorize = await fetch(
        `${oauthBase}/authorize?response_type=code&client_id=abc` +
          `&redirect_uri=${encodeURIComponent('http://localhost:9999/callback')}` +
          '&state=xyz&code_challenge=CH&code_challenge_method=S256',
        { redirect: 'manual' },
      );
      check(authorize.status === 302, `redirects (HTTP ${authorize.status})`);
      const handoff = new URL(authorize.headers.get('location') ?? 'http://invalid');
      check(handoff.origin === `http://localhost:${IDP_PORT}`, 'redirects to the provider');
      check(handoff.searchParams.get('audience') === OAUTH_AUDIENCE, 'adds the audience');
      check(
        handoff.searchParams.get('state') === 'xyz' &&
          handoff.searchParams.get('code_challenge') === 'CH' &&
          handoff.searchParams.get('redirect_uri') === 'http://localhost:9999/callback',
        'passes the client\'s own parameters through untouched',
      );

      // A client must not be able to choose the audience: that would be asking
      // for a token valid against a different API.
      const spoofed = await fetch(
        `${oauthBase}/authorize?client_id=abc&audience=${encodeURIComponent('https://elsewhere.example')}`,
        { redirect: 'manual' },
      );
      const spoofedAudience = new URL(spoofed.headers.get('location') ?? 'http://invalid').searchParams.get(
        'audience',
      );
      check(spoofedAudience === OAUTH_AUDIENCE, `client-supplied audience overridden (got ${spoofedAudience})`);

      // Registration is the whole point of DCR: the client self-registers
      // through us, and the provider's answer comes back untouched.
      const registration = await fetch(`${oauthBase}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_name: 'test-client', redirect_uris: ['http://localhost:9999/callback'] }),
      });
      check(registration.status === 201, `register returns the provider's status (${registration.status})`);
      check((await registration.json() as any).client_id === 'stub-client-id', "returns the provider's client_id");
      const registerCall = idpCalls.find(call => call.url === '/oidc/register');
      check(
        !!registerCall && JSON.parse(registerCall.body).client_name === 'test-client',
        'the registration body reached the provider intact',
      );

      // The token endpoint is form-encoded, and the provider is the one
      // validating PKCE, so the bytes must arrive unaltered.
      const form = 'grant_type=authorization_code&code=abc&code_verifier=v&client_id=abc';
      const token = await fetch(`${oauthBase}/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form,
      });
      check(token.status === 200, `token returns the provider's status (${token.status})`);
      check((await token.json() as any).access_token === 'stub-access-token', 'the token response is passed back');
      const tokenCall = idpCalls.find(call => call.url === '/oauth/token');
      check(tokenCall?.body === form, 'the form body was forwarded byte for byte');
      check(
        tokenCall?.contentType === 'application/x-www-form-urlencoded',
        'the content type was preserved',
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
      { AIQA_OAUTH_ISSUER: `http://localhost:${IDP_PORT_UNUSED}`, AIQA_OAUTH_AUDIENCE: OAUTH_AUDIENCE },
      MCP_PORT_BROKEN,
    );
    try {
      const health: any = await (await fetch(`${brokenBase}/health`)).json();
      check(health.oauth === 'error', `health reports oauth=${health.oauth}, expected error`);
      const prm: any = await (await fetch(`${brokenBase}/.well-known/oauth-protected-resource`)).json();
      check(
        prm.authorization_servers === undefined,
        'does not advertise an authorization server it cannot broker to',
      );
      const authorize = await fetch(`${brokenBase}/authorize?client_id=abc`, { redirect: 'manual' });
      check(authorize.status === 404, `/authorize is not served at all (HTTP ${authorize.status})`);
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
