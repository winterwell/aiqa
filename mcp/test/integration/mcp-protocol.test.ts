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
const STUB_PORT = 4398;
const MCP_PORT = 4397;
// Second MCP instance for the issuer-configured case; kept clear of the ports above.
const MCP_PORT_ALT = 4396;

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

    // Test 9: with an issuer configured, it is advertised.
    console.log('\nTest 9: configured issuer is advertised...');
    const issuer = 'https://auth.example.com';
    const withIssuer = await startMcpServer({ AIQA_OAUTH_ISSUER: issuer }, MCP_PORT_ALT);
    try {
      const res = await fetch(
        `http://localhost:${MCP_PORT_ALT}/.well-known/oauth-protected-resource`,
      );
      const body: any = await res.json();
      check(
        Array.isArray(body.authorization_servers) && body.authorization_servers[0] === issuer,
        'advertises the configured authorization server',
      );
    } finally {
      withIssuer.kill();
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
