import dotenv from 'dotenv';
import tap from 'tap';
import Fastify from 'fastify';
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

  // Create test server
  fastify = Fastify({
    logger: false,
  });

          // Import route handlers
          const { authenticateApiKey } = await import('../dist/server_auth.js');
  const { bulkInsertSpans, searchSpans } = await import('../dist/db/db_es.js');
  const SearchQuery = (await import('../dist/common/SearchQuery.js')).default;

  // Register span endpoints
  fastify.post('/span', { preHandler: authenticateApiKey }, async (request: AuthenticatedRequest, reply) => {
    const organisationId = request.organisationId!;
    const spans = request.body as Span | Span[];

    const spansArray = Array.isArray(spans) ? spans : [spans];
    
    const spansWithOrg = spansArray.map(span => ({
      ...span,
      organisation: organisationId,
    }));

    await bulkInsertSpans(spansWithOrg);
    return { success: true, count: spansWithOrg.length };
  });

  fastify.get('/span', { preHandler: authenticateApiKey }, async (request: AuthenticatedRequest, reply) => {
    const organisationId = request.organisationId!;
    const query = (request.query as any).q as string | undefined;
    const limit = parseInt((request.query as any).limit || '100');
    const offset = parseInt((request.query as any).offset || '0');

    const searchQuery = query ? new SearchQuery(query) : null;
    const result = await searchSpans(searchQuery, organisationId, limit, offset);
    
    return {
      hits: result.hits,
      total: result.total,
      limit,
      offset,
    };
  });

  await fastify.listen({ port: 0, host: '127.0.0.1' });

  // Create test organisation
  const org = await createOrganisation({
    name: 'Test Organisation',
  });
  testOrgId = org.id;

  // Create test API key
  const apiKey = 'test-api-key-' + Date.now();
  await createApiKey({
    organisation: testOrgId,
  });
  testApiKey = apiKey;
});

tap.after(async () => {
  if (fastify) {
    await fastify.close();
  }
  await closePool();
  await closeClient();
});

tap.test('create a new span and retrieve it by id', async (t) => {
  if (!elasticsearchAvailable) {
    t.skip('Elasticsearch not available');
    return;
  }
  
  if (!fastify || !testOrgId || !testApiKey) {
    t.fail('Test setup failed');
    return;
  }

  const serverUrl = `http://127.0.0.1:${(fastify.server.address() as any)?.port}`;
  const clientSpanId = 'test-span-' + Date.now();
  const traceId = 'test-trace-id-' + Date.now();
  const spanId = 'test-span-id-' + Date.now();
  const now = Date.now();
  const startTime: [number, number] = [Math.floor(now / 1000), (now % 1000) * 1000000];
  const endTime: [number, number] = [Math.floor(now / 1000), (now % 1000) * 1000000];

  // Create a minimal span object that matches the serialized format
  // Based on SerializableSpan interface from aiqa-exporter.ts
  const span = {
    name: 'test-span',
    kind: 1, // SpanKind.INTERNAL
    startTime,
    endTime,
    status: {
      code: 1, // SpanStatusCode.OK
    },
    attributes: {},
    links: [],
    events: [],
    resource: {
      attributes: {},
    },
    traceId,
    spanId,
    traceFlags: 1,
    parentSpanId: undefined,
    instrumentationLibrary: {
      name: 'test',
    },
    clientSpanId: clientSpanId,
  };

  // Create span via POST /span
  const createResponse = await fetch(`${serverUrl}/span`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `ApiKey ${testApiKey}`,
    },
    body: JSON.stringify(span),
  });

  t.equal(createResponse.status, 200, 'should create span successfully');
  const createResult = await createResponse.json() as { success: boolean; count: number };
  t.equal(createResult.success, true, 'should return success');
  t.equal(createResult.count, 1, 'should create one span');

  // Wait a bit for Elasticsearch to index
  await new Promise(resolve => setTimeout(resolve, 1000));

  // Retrieve span by id via GET /span?q=clientSpanId:xxx
  const getResponse = await fetch(`${serverUrl}/span?q=clientSpanId:${clientSpanId}`, {
    method: 'GET',
    headers: {
      'Authorization': `ApiKey ${testApiKey}`,
    },
  });

  t.equal(getResponse.status, 200, 'should retrieve span successfully');
  const getResult = await getResponse.json() as { hits: Span[]; total: number; limit: number; offset: number };
  t.ok(getResult.hits, 'should have hits array');
  t.ok(Array.isArray(getResult.hits), 'hits should be an array');
  t.equal(getResult.hits.length, 1, 'should find exactly one span');
  t.equal(getResult.hits[0].clientSpanId, clientSpanId, 'should match the created span id');
  t.equal(getResult.hits[0].organisation, testOrgId, 'should have correct organisation');
  t.equal(getResult.hits[0].name, 'test-span', 'should have correct name');
});

