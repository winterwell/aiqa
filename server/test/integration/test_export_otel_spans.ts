/**
 * Integration test: POST OTLP HTTP/protobuf trace (parent + child span) to a running server
 * and verify spans are stored correctly.
 *
 * Requires: server running, AIQA_API_KEY with trace access.
 * Server URL: SERVER_URL env or http://localhost:4318
 */
import tap from 'tap';
import { encodeOtlpProtobuf } from '../utils-for-tests';

const BASE_URL = process.env.SERVER_URL || 'http://localhost:4318';
const API_KEY = process.env.AIQA_API_KEY;

/**
 * Build OTLP ExportTraceServiceRequest (JSON shape) with a parent and child span.
 */
function createParentChildOtlpRequest(traceId: string, parentSpanId: string, childSpanId: string): any {
  const now = Date.now();
  const startNano = BigInt(now * 1_000_000).toString();
  const endNano = BigInt((now + 50) * 1_000_000).toString();
  const childStartNano = BigInt((now + 10) * 1_000_000).toString();
  const childEndNano = BigInt((now + 40) * 1_000_000).toString();

  const toBase64 = (hex: string) => Buffer.from(hex, 'hex').toString('base64');

  return {
    resourceSpans: [
      {
        resource: {
          attributes: [{ key: 'service.name', value: { stringValue: 'integration-test-service' } }],
        },
        scopeSpans: [
          {
            scope: { name: 'integration-test', version: '1.0.0' },
            spans: [
              {
                traceId: toBase64(traceId),
                spanId: toBase64(parentSpanId),
                parentSpanId: undefined,
                name: 'parent-span',
                kind: 1,
                startTimeUnixNano: startNano,
                endTimeUnixNano: endNano,
                attributes: [{ key: 'span.type', value: { stringValue: 'parent' } }],
                status: { code: 1, message: '' },
                flags: 1,
              },
              {
                traceId: toBase64(traceId),
                spanId: toBase64(childSpanId),
                parentSpanId: toBase64(parentSpanId),
                name: 'child-span',
                kind: 1,
                startTimeUnixNano: childStartNano,
                endTimeUnixNano: childEndNano,
                attributes: [{ key: 'span.type', value: { stringValue: 'child' } }],
                status: { code: 1, message: '' },
                flags: 1,
              },
            ],
          },
        ],
      },
    ],
  };
}

tap.test('OTLP HTTP/protobuf: post parent+child trace, verify spans created', async (t) => {
  if (!API_KEY) {
    t.skip('AIQA_API_KEY not set - set it to run against a running server');
    return;
  }

  const traceId = 'a1b2c3d4e5f607182930415263748596';
  const parentSpanId = '0102030405060708';
  const childSpanId = '090a0b0c0d0e0f10';

  const otlpJson = createParentChildOtlpRequest(traceId, parentSpanId, childSpanId);
  const body = encodeOtlpProtobuf(otlpJson);

  const postRes = await fetch(`${BASE_URL}/v1/traces`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-protobuf',
      Authorization: `ApiKey ${API_KEY}`,
    },
    body,
  });

  t.equal(postRes.status, 200, 'POST /v1/traces returns 200');
  const postBody = await postRes.json();
  t.same(postBody, {}, 'response is empty ExportTraceServiceResponse');

  // Allow index refresh (server may use refresh_after or immediate)
  await new Promise((r) => setTimeout(r, 500));

  const getRes = await fetch(
    `${BASE_URL}/span?q=trace:${traceId}&limit=10`,
    { headers: { Authorization: `ApiKey ${API_KEY}` } }
  );
  t.equal(getRes.status, 200, 'GET /span returns 200');
  const { hits, total } = (await getRes.json()) as { hits: Array<{ id: string; trace: string; parent?: string; name?: string }>; total: number };

  t.equal(total, 2, 'two spans stored');
  t.equal(hits.length, 2, 'two hits returned');

  const byId = Object.fromEntries(hits.map((s) => [s.id, s]));
  const parent = byId[parentSpanId];
  const child = byId[childSpanId];

  t.ok(parent, 'parent span exists');
  t.ok(child, 'child span exists');
  t.equal(parent?.trace, traceId, 'parent has correct trace');
  t.equal(child?.trace, traceId, 'child has correct trace');
  t.ok(parent?.parent === undefined || parent?.parent === null || parent?.parent === '', 'parent has no parent');
  t.equal(child?.parent, parentSpanId, 'child has parent set to parent span id');
});
