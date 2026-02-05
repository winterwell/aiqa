import dotenv from 'dotenv';
import tap from 'tap';
import { initClient, createIndices, closeClient, bulkInsertSpans, searchSpans, deleteIndex, checkElasticsearchAvailable } from '../dist/db/db_es.js';
import type { Span } from '../dist/common/types/index.js';

dotenv.config();

tap.test('Elasticsearch: Insert and Query Spans', async t => {
  const SearchQuery = (await import('../dist/common/SearchQuery.js')).default;
  const esUrl = process.env.ELASTICSEARCH_URL || 'http://localhost:9200';
  initClient(esUrl);
  
  const isAvailable = await checkElasticsearchAvailable();
  if (!isAvailable) {
    t.skip('Elasticsearch not available');
    return;
  }

//   // Delete existing indices to ensure clean state
// No - too dangerous - might delete real data
//   await deleteIndex('spans');
//   await deleteIndex('DATASET_EXAMPLES');
  
  await createIndices();

  // Insert a couple of spans
  const orgId = 'es_test_org_1';
  const now = Date.now();
  const startTime1 = now;
  const endTime1 = now + 100;
  const startTime2 = now - 1000;
  const endTime2 = now - 1000 + 200;
  
  const spans: Span[] = [
    {
      id: 'sp1',
      trace: 'tr1',
      name: 'Test operation one',
      kind: 1, // SpanKind.INTERNAL
      start: startTime1,
      end: endTime1,
      duration: endTime1 - startTime1,
      ended: true,
      status: {
        code: 1, // SpanStatusCode.OK
      },
      attributes: {
        input: { foo: 'bar' },
        output: { bar: 'baz' },
        meta: { hello: 'world' }
      },
      links: [],
      events: [],
      resource: {
        attributes: {},
      },
      instrumentationLibrary: {
        name: 'test',
      },
      droppedAttributesCount: 0,
      droppedEventsCount: 0,
      droppedLinksCount: 0,
      organisation: orgId,
      starred: false,
    },
    {
      id: 'sp2',
      trace: 'tr1',
      name: 'Another operation',
      kind: 1, // SpanKind.INTERNAL
      start: startTime2,
      end: endTime2,
      duration: endTime2 - startTime2,
      ended: true,
      status: {
        code: 2, // SpanStatusCode.ERROR
      },
      attributes: {
        input: { foo: 'zot' },
        output: { bar: 'bang' },
        meta: { hello: 'test' }
      },
      links: [],
      events: [],
      resource: {
        attributes: {},
      },
      instrumentationLibrary: {
        name: 'test',
      },
      droppedAttributesCount: 0,
      droppedEventsCount: 0,
      droppedLinksCount: 0,
      organisation: orgId,
      starred: false,
    }
  ];

  await bulkInsertSpans(spans);

  // Query all
  let result = await searchSpans(null, orgId, 10, 0);
  t.ok(result.total >= 2, 'Should return at least 2 spans for the org');
  t.same(result.hits.find(s => s.id === 'sp1')?.name, 'Test operation one');

  // Query with SearchQuery string for status code
  result = await searchSpans('status.code:2', orgId, 10, 0);
  t.equal(result.total, 1, 'Should find 1 ERROR span');
  t.equal(result.hits[0].id, 'sp2', 'Found the correct ERROR span');

  // Query by attributes.input.foo (attributes is mapped as flattened)
  result = await searchSpans('attributes.input.foo:bar', orgId, 10, 0);
  t.equal(result.total, 1, 'Should find span with attributes.input.foo=bar');
  t.equal(result.hits[0].id, 'sp1');

  // Complex OR query
  const sq = new SearchQuery('status.code:2 OR attributes.input.foo:bar');
  result = await searchSpans(sq, orgId, 10, 0);
  t.equal(result.total, 2, 'Should find both spans with OR query');

  // Insert span with input as JSON string (e.g. Python WithTracing filter_input sends serialized dict).
  // normalizeAttributesForFlattened should parse it to an object so we don't store { value: "..." }.
  const spanWithJsonInput: Span = {
    id: 'sp_json_input',
    trace: 'tr1',
    name: 'Span with JSON string input',
    kind: 1,
    start: now,
    end: now + 50,
    duration: 50,
    ended: true,
    status: { code: 1 },
    attributes: {
      input: '{"user_message":"Clara Harrow","mystery_id":9}',
    },
    links: [],
    events: [],
    resource: { attributes: {} },
    instrumentationLibrary: { name: 'test' },
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
    organisation: orgId,
    starred: false,
  };
  await bulkInsertSpans([spanWithJsonInput]);
  result = await searchSpans('attributes.input.user_message:Clara Harrow', orgId, 10, 0);
  t.ok(result.total >= 1, 'JSON string input should be parsed to object and queryable by nested key');
  const hit = result.hits.find((s: any) => s.id === 'sp_json_input');
  t.ok(hit, 'Should find span with JSON input');
  t.same((hit as any).attributes?.input?.user_message, 'Clara Harrow', 'input should be stored as object, not { value: string }');
  t.same((hit as any).attributes?.input?.mystery_id, 9, 'input.mystery_id should be number');

  await closeClient();
  t.end();
});
