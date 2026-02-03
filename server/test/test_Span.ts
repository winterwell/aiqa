import dotenv from 'dotenv';
import tap from 'tap';
import Fastify from 'fastify';
import * as crypto from 'crypto';
import { initPool, createTables, closePool, createOrganisation, createApiKey } from '../dist/db/db_sql.js';
import { initClient, createIndices, closeClient, checkElasticsearchAvailable } from '../dist/db/db_es.js';
import type { Span } from '../dist/common/types/index.js';
import type { AuthenticatedRequest } from '../src/server_auth.js';

dotenv.config();

// Test server setup
let fastify: ReturnType<typeof Fastify> | null = null;
let testOrgId: string | null = null;
let testApiKey: string | null = null;
let elasticsearchAvailable = false;

tap.before(async () => {
  // Initialize databases
  const pgConnectionString = process.env.DATABASE_URL || 
    `postgresql://${process.env.PGUSER}:${process.env.PGPASSWORD}@${process.env.PGHOST}/${process.env.PGDATABASE}?sslmode=${process.env.PGSSLMODE || 'require'}`;
  const esUrl = process.env.ELASTICSEARCH_URL || 'http://localhost:9200';

  initPool(pgConnectionString);
  initClient(esUrl);

  // Check if Elasticsearch is available
  elasticsearchAvailable = await checkElasticsearchAvailable();
  if (!elasticsearchAvailable) {
    return; // Skip setup if Elasticsearch is not available
  }

  // Create schemas
  await createTables();
  await createIndices();

  // Create test server (forceCloseConnections so teardown completes without waiting for keep-alive)
  fastify = Fastify({
    logger: false,
    forceCloseConnections: true,
  });

          // Import route handlers
          const { authenticateApiKey } = await import('../dist/server_auth.js');
  const { bulkInsertSpans, searchSpans, getSpan } = await import('../dist/db/db_es.js');
  const SearchQuery = (await import('../dist/common/SearchQuery.js')).default;

  // Register span endpoints (AuthenticatedRequest uses organisation, not organisationId)
  fastify.post('/span', { preHandler: authenticateApiKey }, async (request: AuthenticatedRequest, reply) => {
    const organisation = request.organisation!;
    const spans = request.body as Span | Span[];

    const spansArray = Array.isArray(spans) ? spans : [spans];
    
    const spansWithOrg = spansArray.map(span => ({
      ...span,
      organisation,
    }));

    await bulkInsertSpans(spansWithOrg);
    return { success: true, count: spansWithOrg.length };
  });

  fastify.get('/span', { preHandler: authenticateApiKey }, async (request: AuthenticatedRequest, reply) => {
    const organisation = request.organisation!;
    const query = (request.query as any).q as string | undefined;
    const limit = parseInt((request.query as any).limit || '100');
    const offset = parseInt((request.query as any).offset || '0');

    const searchQuery = query ? new SearchQuery(query) : null;
    const result = await searchSpans(searchQuery, organisation, limit, offset);
    
    return {
      hits: result.hits,
      total: result.total,
      limit,
      offset,
    };
  });

  fastify.get('/span/:id', { preHandler: authenticateApiKey }, async (request: AuthenticatedRequest, reply) => {
    const organisation = request.organisation!;
    const { id } = request.params as { id: string };
    const span = await getSpan(id, organisation);
    if (!span) {
      return reply.code(404).send({ error: 'Span not found or does not belong to your organisation' });
    }
    return span;
  });

  await fastify.listen({ port: 0, host: '127.0.0.1' });

  // Create test organisation
  const org = await createOrganisation({
    name: 'Test Organisation',
  });
  testOrgId = org.id;

  // Create test API key (hash is required; auth uses plain key, DB stores hash)
  const apiKey = 'test-api-key-' + Date.now();
  const hash = crypto.createHash('sha256').update(apiKey).digest('hex');
  await createApiKey({
    organisation: testOrgId,
    hash,
    keyEnd: apiKey.substring(apiKey.length - 4),
    role: 'developer',
  });
  testApiKey = apiKey;
});

const TEARDOWN_STEP_MS = 2000;

tap.after(async () => {
  if (fastify) {
    const server = fastify.server as import('http').Server & { closeAllConnections?: () => void };
    if (typeof server?.closeAllConnections === 'function') {
      server.closeAllConnections();
    }
    await Promise.race([
      new Promise<void>((resolve) => server.close(() => resolve())),
      new Promise<void>((_, rej) => setTimeout(() => rej(new Error('server.close timeout')), TEARDOWN_STEP_MS)),
    ]).catch(() => {});
  }
  await Promise.race([closePool(), new Promise<void>((_, rej) => setTimeout(() => rej(new Error('closePool timeout')), TEARDOWN_STEP_MS))]).catch(() => {});
  await Promise.race([closeClient(), new Promise<void>((_, rej) => setTimeout(() => rej(new Error('closeClient timeout')), TEARDOWN_STEP_MS))]).catch(() => {});
  // Tap runs this file in a subprocess and waits for exit; open handles (e.g. fetch keep-alive) can prevent exit
  setImmediate(() => process.exit(0));
});

tap.test('create a new span and retrieve it by id', { timeout: 10000 }, async (t) => {
  if (!elasticsearchAvailable) {
    t.skip('Elasticsearch not available');
    return;
  }
  
  if (!fastify || !testOrgId || !testApiKey) {
    t.fail('Test setup failed');
    return;
  }

  const serverUrl = `http://127.0.0.1:${(fastify.server.address() as any)?.port}`;
  const traceId = 'test-trace-id-' + Date.now();
  const spanId = 'test-span-id-' + Date.now();
  const now = Date.now();

  // Create a minimal span object matching Span type (trace, id, start, end)
  const span = {
    name: 'test-span',
    kind: 1, // SpanKind.INTERNAL
    start: now,
    end: now,
    status: {
      code: 1, // SpanStatusCode.OK
    },
    attributes: {},
    links: [],
    events: [],
    resource: {
      attributes: {},
    },
    trace: traceId,
    id: spanId,
    traceFlags: 1,
    parent: undefined,
    instrumentationLibrary: {
      name: 'test',
    },
    starred: false,
  };

  // Connection: close so teardown can finish (avoid keep-alive holding server open)
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `ApiKey ${testApiKey}`,
    'Connection': 'close',
  };

  const createResponse = await fetch(`${serverUrl}/span`, {
    method: 'POST',
    headers: { ...headers },
    body: JSON.stringify(span),
  });

  t.equal(createResponse.status, 200, 'should create span successfully');
  const createResult = await createResponse.json() as { success: boolean; count: number };
  t.equal(createResult.success, true, 'should return success');
  t.equal(createResult.count, 1, 'should create one span');

  // ES visibility: with REFRESH_AFTER_INDEX (npm test) doc is visible immediately; otherwise wait_for ~1s
  const indexWaitMs = process.env.REFRESH_AFTER_INDEX === 'true' ? 200 : 1100;
  await new Promise(resolve => setTimeout(resolve, indexWaitMs));

  const getResponse = await fetch(`${serverUrl}/span/${encodeURIComponent(spanId)}`, {
    method: 'GET',
    headers: { 'Authorization': `ApiKey ${testApiKey}`, 'Connection': 'close' },
  });

  t.equal(getResponse.status, 200, 'should retrieve span successfully');
  const spanResult = await getResponse.json() as Span;
  t.equal(spanResult.id, spanId, 'should match the created span id');
  t.equal(spanResult.organisation, testOrgId, 'should have correct organisation');
  t.equal(spanResult.name, 'test-span', 'should have correct name');
});

