import dotenv from 'dotenv';
import tap from 'tap';
import { initClient, createIndices, closeClient, bulkInsertSpans, searchSpans, deleteIndex } from '../dist/db/db_es.js';
import type { Span } from '../dist/common/types/index.js';

dotenv.config();

tap.test('Elasticsearch: Insert and Query Spans', async t => {
  const SearchQuery = (await import('../dist/common/SearchQuery.js')).default;
  const esUrl = process.env.ELASTICSEARCH_URL || 'http://localhost:9200';
  initClient(esUrl);

//   // Delete existing indices to ensure clean state
// No - too dangerous - might delete real data
//   await deleteIndex('spans');
//   await deleteIndex('DATASET_EXAMPLES');
  
  await createIndices();

  // Insert a couple of spans
  const orgId = 'es_test_org_1';
  const now = Date.now();
  const startTime1: [number, number] = [Math.floor(now / 1000), (now % 1000) * 1000000];
  const endTime1: [number, number] = [Math.floor(now / 1000), (now % 1000) * 1000000];
  const startTime2: [number, number] = [Math.floor((now - 1000) / 1000), ((now - 1000) % 1000) * 1000000];
  const endTime2: [number, number] = [Math.floor((now - 1000) / 1000), ((now - 1000) % 1000) * 1000000];
  
  const spans: Span[] = [
    {
      traceId: 'tr1',
      spanId: 'sp1',
      name: 'Test operation one',
      kind: 1, // SpanKind.INTERNAL
      startTime: startTime1,
      endTime: endTime1,
      duration: [0, 1000000], // HrTime tuple
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
    },
    {
      traceId: 'tr1',
      spanId: 'sp2',
      name: 'Another operation',
      kind: 1, // SpanKind.INTERNAL
      startTime: startTime2,
      endTime: endTime2,
      duration: [0, 1000000], // HrTime tuple
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
    }
  ];

  await bulkInsertSpans(spans);

  // Query all
  let result = await searchSpans(null, orgId, 10, 0);
  t.ok(result.total >= 2, 'Should return at least 2 spans for the org');
  t.same(result.hits.find(s => s.spanId === 'sp1')?.name, 'Test operation one');

  // Query with SearchQuery string for status code
  result = await searchSpans('status.code:2', orgId, 10, 0);
  t.equal(result.total, 1, 'Should find 1 ERROR span');
  t.equal(result.hits[0].spanId, 'sp2', 'Found the correct ERROR span');

  // Query by attributes.input.foo (attributes is mapped as flattened)
  result = await searchSpans('attributes.input.foo:bar', orgId, 10, 0);
  t.equal(result.total, 1, 'Should find span with attributes.input.foo=bar');
  t.equal(result.hits[0].spanId, 'sp1');

  // Complex OR query
  const sq = new SearchQuery('status.code:2 OR attributes.input.foo:bar');
  result = await searchSpans(sq, orgId, 10, 0);
  t.equal(result.total, 2, 'Should find both spans with OR query');

  await closeClient();
  t.end();
});
