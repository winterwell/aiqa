#!/usr/bin/env node

import { createHash, timingSafeEqual } from 'node:crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import { AiqaApiClient } from './client.js';
import {
  discoverUpstream,
  loadOAuthConfig,
  registerOAuthProxy,
  type OAuthState,
} from './oauth.js';

const SERVER_NAME = 'aiqa-mcp-server';
const SERVER_VERSION = '0.9.2';

// Get configuration from environment variables
const API_BASE_URL = process.env.AIQA_API_BASE_URL || 'http://localhost:4318';
const MCP_PORT = parseInt(process.env.MCP_PORT || '4319', 10);

// Optional OAuth support, configured via AIQA_OAUTH_ISSUER and
// AIQA_OAUTH_AUDIENCE (see oauth.ts). Until both are set the server only
// accepts pre-issued AIQA API keys, and its metadata says so rather than
// pointing clients at an authorization server that does not exist.
// Set during startup, before any request can be served.
let oauthState: OAuthState = 'disabled';

// Public base URL, used in the discovery document. Derived from the request when
// unset, so it stays correct behind nginx without extra configuration.
const PUBLIC_URL = process.env.MCP_PUBLIC_URL;

// X-Forwarded-* headers are only trustworthy when we know a proxy sets them.
// Off by default: otherwise any client could rewrite the URLs we advertise.
// Accepts 'true' (trust whatever peer connects) or a comma-separated IP/CIDR
// allowlist. Fastify rejects hop-count trust as unsafe, so a bare number here
// trusts nothing, and an unparseable value fails at startup.
// Setting MCP_PUBLIC_URL is preferable: it doesn't depend on request headers.
const TRUST_PROXY = process.env.MCP_TRUST_PROXY;

// Function to set up tool handlers for a server instance
function setupToolHandlers(server: Server, apiKey: string) {
  const client = new AiqaApiClient(API_BASE_URL, apiKey);

  // Tool: create_dataset
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'create_dataset',
      description: 'Create a new dataset. Datasets are collections of examples used for evaluation.',
      inputSchema: {
        type: 'object',
        properties: {
          organisation: {
            type: 'string',
            description: 'Organisation ID (UUID)',
          },
          name: {
            type: 'string',
            description: 'Dataset name (required)',
          },
          description: {
            type: 'string',
            description: 'Optional description',
          },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional tags',
          },
        },
        required: ['organisation', 'name'],
      },
    },
    {
      name: 'create_example',
      description: 'Create a new example (eval) in a dataset. Examples represent test cases for evaluation.',
      inputSchema: {
        type: 'object',
        properties: {
          dataset: {
            type: 'string',
            description: 'Dataset ID (UUID) - required',
          },
          organisation: {
            type: 'string',
            description: 'Organisation ID (UUID) - required',
          },
          name: {
            type: 'string',
            description: 'Optional example name',
          },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional tags',
          },
          input: {
            description: 'Input data for the example (alternative to spans)',
          },
          spans: {
            type: 'array',
            description: 'Spans from a trace to use as input (alternative to input)',
          },
          trace: {
            type: 'string',
            description: 'Trace ID if creating from a trace',
          },
          outputs: {
            type: 'object',
            properties: {
              good: { description: 'Example of good output' },
              bad: { description: 'Example of bad output' },
            },
          },
        },
        required: ['dataset', 'organisation'],
      },
    },
    {
      name: 'create_experiment',
      description: 'Create a new experiment. Experiments run datasets of examples and score the outputs.',
      inputSchema: {
        type: 'object',
        properties: {
          dataset: {
            type: 'string',
            description: 'Dataset ID (UUID) - required',
          },
          organisation: {
            type: 'string',
            description: 'Organisation ID (UUID) - required',
          },
          name: {
            type: 'string',
            description: 'Optional experiment name',
          },
          batch: {
            type: 'string',
            description: 'Optional batch ID to group experiments together',
          },
          parameters: {
            type: 'object',
            description: 'Optional parameters (e.g. model, temperature)',
          },
        },
        required: ['dataset', 'organisation'],
      },
    },
    {
      name: 'query_datasets',
      description: 'Query datasets with optional filters. Returns list of datasets matching criteria.',
      inputSchema: {
        type: 'object',
        properties: {
          organisation: {
            type: 'string',
            description: 'Organisation ID (UUID) - optional, filters by organisation',
          },
          query: {
            type: 'string',
            description: 'Optional search query (Gmail-style)',
          },
          limit: {
            type: 'number',
            description: 'Maximum number of results (default: 100)',
            default: 100,
          },
          offset: {
            type: 'number',
            description: 'Pagination offset (default: 0)',
            default: 0,
          },
        },
      },
    },
    {
      name: 'query_examples',
      description: 'Query examples with optional filters. Returns list of examples matching criteria. Use dataset filter to reduce token usage.',
      inputSchema: {
        type: 'object',
        properties: {
          dataset: {
            type: 'string',
            description: 'Dataset ID (UUID) - recommended to filter by dataset to reduce token usage',
          },
          query: {
            type: 'string',
            description: 'Optional search query (Gmail-style)',
          },
          limit: {
            type: 'number',
            description: 'Maximum number of results (default: 20, max recommended: 100)',
            default: 20,
          },
          offset: {
            type: 'number',
            description: 'Pagination offset (default: 0)',
            default: 0,
          },
        },
      },
    },
    {
      name: 'query_experiments',
      description: 'Query experiments with optional filters. Returns list of experiments matching criteria.',
      inputSchema: {
        type: 'object',
        properties: {
          dataset: {
            type: 'string',
            description: 'Dataset ID (UUID) - optional, filters by dataset',
          },
          organisation: {
            type: 'string',
            description: 'Organisation ID (UUID) - optional, filters by organisation',
          },
          query: {
            type: 'string',
            description: 'Optional search query (Gmail-style)',
          },
          limit: {
            type: 'number',
            description: 'Maximum number of results (default: 100)',
            default: 100,
          },
          offset: {
            type: 'number',
            description: 'Pagination offset (default: 0)',
            default: 0,
          },
        },
      },
    },
    {
      name: 'query_traces',
      description: 'Query traces (spans) with optional filters. Returns list of spans matching criteria. Use isRoot=true and limit to reduce token usage.',
      inputSchema: {
        type: 'object',
        properties: {
          organisation: {
            type: 'string',
            description: 'Organisation ID (UUID) - required',
          },
          query: {
            type: 'string',
            description: 'Optional search query (Gmail-style, e.g. "name:llm" or "trace:abc-123")',
          },
          isRoot: {
            type: 'boolean',
            description: 'If true, only return root spans (recommended to reduce token usage, default: true)',
            default: true,
          },
          limit: {
            type: 'number',
            description: 'Maximum number of results (default: 20, max recommended: 100)',
            default: 20,
          },
          offset: {
            type: 'number',
            description: 'Pagination offset (default: 0)',
            default: 0,
          },
          fields: {
            type: 'string',
            description: 'Comma-separated fields to include, or "*" for all (default excludes attributes)',
          },
          exclude: {
            type: 'string',
            description: 'Comma-separated fields to exclude (e.g. "attributes.input,attributes.output")',
          },
        },
        required: ['organisation'],
      },
    },
    {
      name: 'get_trace_stats',
      description: 'Get trace dashboard statistics including duration, tokens, cost, and feedback metrics.',
      inputSchema: {
        type: 'object',
        properties: {
          organisation: {
            type: 'string',
            description: 'Organisation ID (UUID) - required',
          },
          query: {
            type: 'string',
            description: 'Optional search query to filter traces (Gmail-style)',
          },
          limit: {
            type: 'number',
            description: 'Maximum number of traces to analyze (default: 20)',
            default: 20,
          },
        },
        required: ['organisation'],
      },
    },
  ],
}));

  // Handle tool calls - use the client created for this connection
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;

  try {
    switch (name) {
      case 'create_dataset': {
        const dataset = await client.createDataset({
          organisation: args.organisation as string,
          name: args.name as string,
          description: args.description as string | undefined,
          tags: args.tags as string[] | undefined,
        });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(dataset, null, 2),
            },
          ],
        };
      }

      case 'create_example': {
        const example = await client.createExample({
          dataset: args.dataset as string,
          organisation: args.organisation as string,
          name: args.name as string | undefined,
          tags: args.tags as string[] | undefined,
          input: args.input,
          spans: args.spans as any[] | undefined,
          trace: args.trace as string | undefined,
          outputs: args.outputs as { good: any; bad: any } | undefined,
        });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(example, null, 2),
            },
          ],
        };
      }

      case 'create_experiment': {
        const experiment = await client.createExperiment({
          dataset: args.dataset as string,
          organisation: args.organisation as string,
          name: args.name as string | undefined,
          batch: args.batch as string | undefined,
          parameters: args.parameters as Record<string, any> | undefined,
        });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(experiment, null, 2),
            },
          ],
        };
      }

      case 'query_datasets': {
        const datasets = await client.listDatasets(
          args.organisation as string | undefined,
          args.query as string | undefined,
          args.limit as number | undefined,
          args.offset as number | undefined
        );
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(datasets, null, 2),
            },
          ],
        };
      }

      case 'query_examples': {
        const examples = await client.listExamples(
          args.dataset as string | undefined,
          args.query as string | undefined,
          args.limit as number | undefined,
          args.offset as number | undefined
        );
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(examples, null, 2),
            },
          ],
        };
      }

      case 'query_experiments': {
        const experiments = await client.listExperiments(
          args.dataset as string | undefined,
          args.organisation as string | undefined,
          args.query as string | undefined,
          args.limit as number | undefined,
          args.offset as number | undefined
        );
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(experiments, null, 2),
            },
          ],
        };
      }

      case 'query_traces': {
        const traces = await client.queryTraces(
          args.organisation as string,
          args.query as string | undefined,
          args.limit as number | undefined,
          args.offset as number | undefined,
          args.fields as string | undefined,
          args.exclude as string | undefined,
          args.isRoot !== undefined ? (args.isRoot as boolean) : true
        );
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(traces, null, 2),
            },
          ],
        };
      }

      case 'get_trace_stats': {
        const stats = await client.getTraceStats(
          args.organisation as string,
          args.query as string | undefined,
          args.limit as number | undefined
        );
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(stats, null, 2),
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${errorMessage}`,
        },
      ],
      isError: true,
    };
  }
  });
}

// Create Fastify server for HTTP/SSE transport
const fastify = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || 'info',
  },
  trustProxy: TRUST_PROXY === 'true' ? true : TRUST_PROXY || false,
});

// Register CORS
fastify.register(cors, {
  origin: true, // Allow all origins
  credentials: true,
});

// Active SSE sessions, keyed by session ID. Client->server messages arrive as
// separate POSTs, so they can only be delivered to the right MCP server instance
// by looking the session up here. The key that opened the session is kept with
// it: the session's tool handlers are already bound to that key, so a POST
// carrying any other key must not be allowed to drive it.
interface McpSession {
  transport: SSEServerTransport;
  apiKey: string;
}

const sessions = new Map<string, McpSession>();

// Compare in constant time, so this can't be used as an oracle for guessing keys.
function keysMatch(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

// Validating every connection means an upstream call per connect, and clients
// reconnect often, so verdicts are cached briefly - short enough that a revoked
// key stops working promptly.
const KEY_CACHE_TTL_MS = 60_000;
const KEY_CACHE_MAX = 1000;
const keyCache = new Map<string, { valid: boolean; expires: number }>();

// Keyed by hash, so the cache never holds a user's key in memory.
function keyCacheId(apiKey: string): string {
  return createHash('sha256').update(apiKey).digest('hex');
}

// Ask server-aiqa whether this key is real before handing out a session.
// Without this any non-empty string connects: the client reports success and
// lists the tools, then fails on every call with an upstream 401 buried in a
// tool result, which is not something a client can re-authenticate from.
async function isKeyAccepted(apiKey: string): Promise<boolean> {
  const id = keyCacheId(apiKey);
  const cached = keyCache.get(id);
  if (cached && cached.expires > Date.now()) {
    return cached.valid;
  }

  const result = await new AiqaApiClient(API_BASE_URL, apiKey).validateCredential();
  if (result === 'unknown') {
    // server-aiqa is unreachable. Refusing every connection would turn its
    // outage into an MCP outage for no security gain - the tool calls fail
    // either way - so let this one through, and don't cache the non-answer.
    fastify.log.warn('Could not validate API key: server-aiqa did not respond');
    return true;
  }

  // Bounded so a flood of junk keys cannot grow the map without limit. Clearing
  // wholesale is crude, but the only cost is a round of re-validation.
  if (keyCache.size >= KEY_CACHE_MAX) {
    keyCache.clear();
  }
  keyCache.set(id, { valid: result === 'valid', expires: Date.now() + KEY_CACHE_TTL_MS });
  return result === 'valid';
}

// reply.hijack() skips Fastify's send path, which is where plugin headers (CORS,
// most importantly) would have been flushed. Copy them onto the raw response
// first, or cross-origin clients get a response the browser refuses to read.
function hijackPreservingHeaders(reply: FastifyReply): void {
  if (!reply.raw.headersSent) {
    for (const [name, value] of Object.entries(reply.getHeaders())) {
      if (value !== undefined) {
        reply.raw.setHeader(name, value);
      }
    }
  }
  reply.hijack();
}

// Extract the API key from the Authorization header, falling back to a query
// parameter (less secure, but some clients need it).
function getApiKey(request: { headers: Record<string, any>; query?: unknown }): string | undefined {
  const authHeader = request.headers.authorization as string | undefined;
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.substring(7).trim();
  }
  if (authHeader?.startsWith('ApiKey ')) { // backward compatibility
    return authHeader.substring(7).trim();
  }
  return (request.query as any)?.apiKey;
}

// The discovery documents are only cacheable when their URLs come from config.
// Otherwise they vary by request host, and a shared cache could serve one
// host's document to another.
const DISCOVERY_CACHE_CONTROL = PUBLIC_URL ? 'public, max-age=3600' : 'no-store';

function publicBaseUrl(request: FastifyRequest): string {
  if (PUBLIC_URL) {
    return PUBLIC_URL.replace(/\/$/, '');
  }
  // request.protocol/host reflect X-Forwarded-* only when trustProxy is
  // configured, so an untrusted client cannot redirect the URLs we advertise.
  return `${request.protocol}://${request.host}`;
}

function resourceMetadataUrl(request: FastifyRequest): string {
  return `${publicBaseUrl(request)}/.well-known/oauth-protected-resource`;
}

// Reject with a Bearer challenge. Without this header a client has no
// standards-defined way to discover that it needs a token, or where to look for
// the details, so it can only fail with an opaque error.
function sendUnauthorized(request: FastifyRequest, reply: FastifyReply, description: string) {
  reply
    .code(401)
    .header(
      'WWW-Authenticate',
      `Bearer error="invalid_token", error_description="${description}", resource_metadata="${resourceMetadataUrl(request)}"`,
    )
    .send({ error: 'invalid_token', error_description: description });
}

// RFC 9728 protected resource metadata - the document MCP clients look for when
// they get a 401. `authorization_servers` names this server, because clients
// have to come through its brokered endpoints for the provider's `audience` to
// be added (see oauth.ts). The field is optional, and is omitted while OAuth is
// off rather than sending clients into a flow that cannot succeed.
fastify.get('/.well-known/oauth-protected-resource', async (request, reply) => {
  reply.header('Cache-Control', DISCOVERY_CACHE_CONTROL);
  return {
    resource: publicBaseUrl(request),
    ...(oauthState === 'enabled' ? { authorization_servers: [publicBaseUrl(request)] } : {}),
    bearer_methods_supported: ['header'],
  };
});

// MCP SSE endpoint - handles server-to-client messages
fastify.get('/sse', async (request, reply) => {
  const apiKey = getApiKey(request);

  if (!apiKey) {
    sendUnauthorized(request, reply, 'API key required. Provide via Authorization header (Bearer <key>) or ?apiKey= query parameter');
    return;
  }

  // Check the key before the reply is hijacked: once the SSE transport owns the
  // socket there is no way left to send a 401.
  if (!(await isKeyAccepted(apiKey))) {
    sendUnauthorized(request, reply, 'API key was rejected by server-aiqa. Check the key is correct and still active.');
    return;
  }

  // Disable nginx buffering; the transport's start() writes the other SSE headers.
  reply.raw.setHeader('X-Accel-Buffering', 'no');

  // The transport owns this socket from here on, so stop Fastify from also
  // trying to send a response on it.
  hijackPreservingHeaders(reply);

  // Tell the client to POST its messages to /message?sessionId=...
  // If the key came from the query string rather than a header, carry it over:
  // the client posts back to exactly this URL and would otherwise be unauthorised.
  const keyFromQuery = !request.headers.authorization && (request.query as any)?.apiKey;
  const messageEndpoint = keyFromQuery
    ? `/message?apiKey=${encodeURIComponent(apiKey)}`
    : '/message';
  const transport = new SSEServerTransport(messageEndpoint, reply.raw);

  // Create a new server instance for this connection (MCP servers are typically per-connection)
  const connectionServer = new Server(
    {
      name: SERVER_NAME,
      version: SERVER_VERSION,
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Register tool handlers on this connection's server
  setupToolHandlers(connectionServer, apiKey);

  // Registered before connect() so the session is always known, but note the
  // transport only accepts messages once connect() has called start(): a POST
  // arriving in that window is rejected by the SDK rather than 404-ing here.
  sessions.set(transport.sessionId, { transport, apiKey });

  // Clean up on connection close
  reply.raw.on('close', () => {
    sessions.delete(transport.sessionId);
  });

  try {
    await connectionServer.connect(transport);
  } catch (error) {
    sessions.delete(transport.sessionId);
    fastify.log.error({ err: error }, 'Failed to establish MCP SSE connection');
    reply.raw.end();
  }
});

// MCP message endpoint - handles client-to-server messages
fastify.post('/message', async (request, reply) => {
  const apiKey = getApiKey(request);

  if (!apiKey) {
    sendUnauthorized(request, reply, 'API key required in Authorization header');
    return;
  }

  const sessionId = (request.query as any)?.sessionId;
  if (!sessionId) {
    reply.code(400).send({ error: 'sessionId query parameter required. Use the endpoint URL sent by the SSE connection.' });
    return;
  }

  const session = sessions.get(sessionId);
  if (!session) {
    reply.code(404).send({ error: 'Unknown or expired sessionId. Re-connect to /sse.' });
    return;
  }

  // The session's tool handlers run with the key that opened it, so only that
  // key may drive it. Without this check, knowing a session ID would be enough
  // to act as its owner against server-aiqa.
  if (!keysMatch(apiKey, session.apiKey)) {
    sendUnauthorized(request, reply, 'API key does not match this session');
    return;
  }

  // handlePostMessage writes the response itself, so Fastify must not.
  hijackPreservingHeaders(reply);

  try {
    // Pass the already-parsed body: Fastify has consumed the raw stream.
    await session.transport.handlePostMessage(request.raw, reply.raw, request.body);
  } catch (error) {
    // handlePostMessage has already written a response, so just record it
    // rather than letting it surface as an unhandled rejection.
    fastify.log.error({ err: error, sessionId }, 'Failed to deliver MCP message');
  }
});

// Health check endpoint
fastify.get('/health', async () => {
  // oauth is reported so a misconfigured deploy is visible here rather than
  // only when a user tries to connect: 'error' means configured but not usable.
  return { status: 'ok', service: SERVER_NAME, version: SERVER_VERSION, oauth: oauthState };
});

/**
 * Set up the brokered OAuth endpoints, if OAuth is configured.
 *
 * Nothing here is fatal. A bad OAuth configuration and an unreachable provider
 * both leave the server running as API-key only: the unit restarts on failure,
 * so exiting would turn either into a crash loop and take API-key clients down
 * over a fault that is not theirs. Both are instead reported loudly - in the
 * log, and as oauth: 'error' on /health, which check-live.sh asserts on.
 */
async function setupOAuth(): Promise<void> {
  try {
    const config = loadOAuthConfig();
    if (!config) {
      return;
    }
    const endpoints = await discoverUpstream(config.issuer);
    registerOAuthProxy(fastify, {
      config,
      endpoints,
      publicBaseUrl,
      cacheControl: DISCOVERY_CACHE_CONTROL,
    });
    oauthState = 'enabled';
    console.log(`OAuth enabled: brokering to ${config.issuer} for audience ${config.audience}`);
  } catch (error) {
    // Advertising an authorization server we cannot broker to would send every
    // client into a dead end, so stay API-key only and say so loudly.
    oauthState = 'error';
    console.error(
      'OAuth DISABLED by a configuration or provider error.',
      'API keys still work; OAuth clients cannot connect.',
      error,
    );
  }
}

// Start server
async function main() {
  try {
    // Before listen(): routes cannot be added once the server is accepting.
    await setupOAuth();

    await fastify.listen({ port: MCP_PORT, host: '0.0.0.0' });
    console.log(`${SERVER_NAME} v${SERVER_VERSION} listening on port ${MCP_PORT}`);
    console.log(`MCP SSE endpoint: http://localhost:${MCP_PORT}/sse`);
    console.log(`MCP message endpoint: http://localhost:${MCP_PORT}/message`);
    console.log(`Health check: http://localhost:${MCP_PORT}/health`);

    // Behind TLS termination the advertised scheme comes out as http unless one
    // of these is set, and clients would be pointed at the wrong URL. Warn
    // rather than fail, since neither is needed for a direct local run.
    if (!PUBLIC_URL && !TRUST_PROXY) {
      console.warn(
        'WARNING: neither MCP_PUBLIC_URL nor MCP_TRUST_PROXY is set. Discovery URLs ' +
          '(WWW-Authenticate and /.well-known/oauth-protected-resource) will be derived ' +
          'from the request, which gives the wrong scheme behind an HTTPS proxy. ' +
          'Set MCP_PUBLIC_URL to the public base URL in production.',
      );
    }
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

main();
