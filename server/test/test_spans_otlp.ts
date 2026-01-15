import dotenv from 'dotenv';
import tap from 'tap';
import Fastify from 'fastify';
import * as grpc from '@grpc/grpc-js';
import { initPool, createTables, closePool, createOrganisation, createApiKey, getApiKeyByHash } from '../dist/db/db_sql.js';
import { initClient, createIndices, closeClient, checkElasticsearchAvailable, searchSpans } from '../dist/db/db_es.js';
import { initRedis, closeRedis } from '../dist/rate_limit.js';
import { registerSpanRoutes } from '../dist/routes/spans.js';
import { parseOtlpProtobuf } from '../dist/utils/otlp_protobuf.js';
import SearchQuery from '../dist/common/SearchQuery.js';
import * as crypto from 'crypto';

dotenv.config();

// Test server setup
let fastify: ReturnType<typeof Fastify> | null = null;
let grpcServer: grpc.Server | null = null;
let testOrgId: string | null = null;
let testApiKey: string | null = null;
let testApiKeyHash: string | null = null;
let elasticsearchAvailable = false;
let httpPort = 0;
let grpcPort = 0;

/**
 * Create a test OTLP ExportTraceServiceRequest in JSON format
 */
function createTestOtlpRequest(traceId: string, spanId: string, parentSpanId?: string): any {
  const now = Date.now();
  const startTimeUnixNano = BigInt(now * 1_000_000).toString();
  const endTimeUnixNano = BigInt((now + 100) * 1_000_000).toString();
  
  // Convert trace/span IDs to base64 (OTLP JSON format uses base64 for bytes)
  const traceIdBytes = Buffer.from(traceId, 'hex').toString('base64');
  const spanIdBytes = Buffer.from(spanId, 'hex').toString('base64');
  const parentSpanIdBytes = parentSpanId ? Buffer.from(parentSpanId, 'hex').toString('base64') : undefined;
  
  return {
    resourceSpans: [
      {
        resource: {
          attributes: [
            {
              key: 'service.name',
              value: { stringValue: 'test-service' }
            }
          ]
        },
        scopeSpans: [
          {
            scope: {
              name: 'test-instrumentation',
              version: '1.0.0'
            },
            spans: [
              {
                traceId: traceIdBytes,
                spanId: spanIdBytes,
                parentSpanId: parentSpanIdBytes,
                name: 'test-span',
                kind: 1, // SPAN_KIND_INTERNAL
                startTimeUnixNano: startTimeUnixNano,
                endTimeUnixNano: endTimeUnixNano,
                attributes: [
                  {
                    key: 'test.attribute',
                    value: { stringValue: 'test-value' }
                  }
                ],
                status: {
                  code: 1, // STATUS_CODE_OK
                  message: ''
                },
                flags: 1
              }
            ]
          }
        ]
      }
    ]
  };
}

/**
 * Convert OTLP JSON request to Protobuf binary
 * Uses the same proto definitions as the server
 */
async function jsonToProtobuf(jsonRequest: any): Promise<Buffer> {
  const protobuf = await import('protobufjs');
  
  // Create proto definition matching the server's embedded definition
  const root = protobuf.default.Root.fromJSON({
    nested: {
      opentelemetry: {
        nested: {
          proto: {
            nested: {
              collector: {
                nested: {
                  trace: {
                    nested: {
                      v1: {
                        nested: {
                          ExportTraceServiceRequest: {
                            fields: {
                              resourceSpans: {
                                type: 'ResourceSpans',
                                id: 1,
                                rule: 'repeated'
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                },
                common: {
                  nested: {
                    v1: {
                      nested: {
                        Resource: {
                          fields: {
                            attributes: {
                              type: 'KeyValue',
                              id: 1,
                              rule: 'repeated'
                            }
                          }
                        },
                        KeyValue: {
                          fields: {
                            key: { type: 'string', id: 1 },
                            value: { type: 'AnyValue', id: 2 }
                          }
                        },
                        AnyValue: {
                          oneof: ['value'],
                          fields: {
                            stringValue: { type: 'string', id: 1, oneof: 'value' },
                            boolValue: { type: 'bool', id: 2, oneof: 'value' },
                            intValue: { type: 'int64', id: 3, oneof: 'value' },
                            doubleValue: { type: 'double', id: 4, oneof: 'value' },
                            arrayValue: { type: 'ArrayValue', id: 5, oneof: 'value' },
                            kvlistValue: { type: 'KeyValueList', id: 6, oneof: 'value' },
                            bytesValue: { type: 'bytes', id: 7, oneof: 'value' }
                          }
                        },
                        ArrayValue: {
                          fields: {
                            values: { type: 'AnyValue', id: 1, rule: 'repeated' }
                          }
                        },
                        KeyValueList: {
                          fields: {
                            values: { type: 'KeyValue', id: 1, rule: 'repeated' }
                          }
                        },
                        InstrumentationScope: {
                          fields: {
                            name: { type: 'string', id: 1 },
                            version: { type: 'string', id: 2 }
                          }
                        }
                      }
                    }
                  }
                },
                trace: {
                  nested: {
                    v1: {
                      nested: {
                        ResourceSpans: {
                          fields: {
                            resource: { type: 'Resource', id: 1 },
                            scopeSpans: { type: 'ScopeSpans', id: 2, rule: 'repeated' }
                          }
                        },
                        ScopeSpans: {
                          fields: {
                            scope: { type: 'InstrumentationScope', id: 1 },
                            spans: { type: 'Span', id: 2, rule: 'repeated' }
                          }
                        },
                        Span: {
                          fields: {
                            traceId: { type: 'bytes', id: 1 },
                            spanId: { type: 'bytes', id: 2 },
                            parentSpanId: { type: 'bytes', id: 3 },
                            name: { type: 'string', id: 4 },
                            kind: { type: 'SpanKind', id: 5 },
                            startTimeUnixNano: { type: 'fixed64', id: 6 },
                            endTimeUnixNano: { type: 'fixed64', id: 7 },
                            attributes: { type: 'KeyValue', id: 8, rule: 'repeated' },
                            status: { type: 'Status', id: 11 },
                            flags: { type: 'uint32', id: 12 }
                          }
                        },
                        Status: {
                          fields: {
                            code: { type: 'StatusCode', id: 1 },
                            message: { type: 'string', id: 2 }
                          }
                        },
                        SpanKind: {
                          values: {
                            SPAN_KIND_UNSPECIFIED: 0,
                            SPAN_KIND_INTERNAL: 1,
                            SPAN_KIND_SERVER: 2,
                            SPAN_KIND_CLIENT: 3,
                            SPAN_KIND_PRODUCER: 4,
                            SPAN_KIND_CONSUMER: 5
                          }
                        },
                        StatusCode: {
                          values: {
                            STATUS_CODE_UNSET: 0,
                            STATUS_CODE_OK: 1,
                            STATUS_CODE_ERROR: 2
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  } as any);
  
  // Convert JSON request to protobuf format (bytes need to be converted from base64)
  const protoRequest: any = {
    resourceSpans: jsonRequest.resourceSpans.map((rs: any) => ({
      resource: {
        attributes: rs.resource.attributes.map((attr: any) => ({
          key: attr.key,
          value: attr.value
        }))
      },
      scopeSpans: rs.scopeSpans.map((ss: any) => ({
        scope: {
          name: ss.scope.name,
          version: ss.scope.version
        },
        spans: ss.spans.map((span: any) => ({
          traceId: Buffer.from(span.traceId, 'base64'),
          spanId: Buffer.from(span.spanId, 'base64'),
          parentSpanId: span.parentSpanId ? Buffer.from(span.parentSpanId, 'base64') : undefined,
          name: span.name,
          kind: span.kind,
          startTimeUnixNano: span.startTimeUnixNano,
          endTimeUnixNano: span.endTimeUnixNano,
          attributes: span.attributes.map((attr: any) => ({
            key: attr.key,
            value: attr.value
          })),
          status: {
            code: span.status.code,
            message: span.status.message || ''
          },
          flags: span.flags
        }))
      }))
    }))
  };
  
  const ExportTraceServiceRequest = root.lookupType('opentelemetry.proto.collector.trace.v1.ExportTraceServiceRequest');
  
  // Validate and create message
  const errMsg = ExportTraceServiceRequest.verify(protoRequest);
  if (errMsg) {
    throw new Error(`Invalid protobuf request: ${errMsg}`);
  }
  
  const message = ExportTraceServiceRequest.create(protoRequest);
  const buffer = ExportTraceServiceRequest.encode(message).finish();
  return Buffer.from(buffer);
}

tap.before(async () => {
  // Initialize databases
  const pgConnectionString = process.env.DATABASE_URL || 
    `postgresql://${process.env.PGUSER}:${process.env.PGPASSWORD}@${process.env.PGHOST}/${process.env.PGDATABASE}?sslmode=${process.env.PGSSLMODE || 'require'}`;
  const esUrl = process.env.ELASTICSEARCH_URL || 'http://localhost:9200';
  const redisUrl = process.env.REDIS_URL;

  initPool(pgConnectionString);
  initClient(esUrl);
  if (redisUrl) {
    await initRedis(redisUrl).catch(() => {
      // Redis is optional
    });
  }

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

  // Register span routes
  await registerSpanRoutes(fastify);

  await fastify.listen({ port: 0, host: '127.0.0.1' });
  httpPort = (fastify.server.address() as any)?.port;

  // Create test organisation
  const org = await createOrganisation({
    name: 'Test OTLP Organisation',
  });
  testOrgId = org.id;

  // Create test API key
  const apiKey = 'test-otlp-api-key-' + Date.now();
  testApiKeyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
  await createApiKey({
    organisation: testOrgId,
    name: 'Test OTLP API Key',
    key_hash: testApiKeyHash,
    key_end: apiKey.substring(apiKey.length - 4),
    role: 'developer',
  });
  testApiKey = apiKey;
});

tap.after(async () => {
  if (fastify) {
    await fastify.close();
  }
  if (grpcServer) {
    await new Promise<void>((resolve) => {
      grpcServer!.tryShutdown(() => resolve());
    });
  }
  await closePool();
  await closeClient();
  await closeRedis();
});

// ===== HTTP + JSON Tests =====

tap.test('OTLP HTTP + JSON: successful trace export', async (t) => {
  if (!elasticsearchAvailable) {
    t.skip('Elasticsearch not available');
    return;
  }
  
  if (!fastify || !testOrgId || !testApiKey) {
    t.fail('Test setup failed');
    return;
  }

  const traceId = 'a1b2c3d4e5f6789012345678901234ab';
  const spanId = '1234567890abcdef';
  const otlpRequest = createTestOtlpRequest(traceId, spanId);

  const response = await fetch(`http://127.0.0.1:${httpPort}/v1/traces`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `ApiKey ${testApiKey}`,
    },
    body: JSON.stringify(otlpRequest),
  });

  t.equal(response.status, 200, 'should return 200 on success');
  const result = await response.json();
  t.same(result, {}, 'should return empty ExportTraceServiceResponse');

  // Wait for Elasticsearch to index
  await new Promise(resolve => setTimeout(resolve, 1000));

  // Verify span was stored
  const searchQuery = new SearchQuery(`traceId:${traceId}`);
  const searchResult = await searchSpans(searchQuery, testOrgId!, 10, 0);
  t.equal(searchResult.hits.length, 1, 'should find the stored span');
  t.equal(searchResult.hits[0].traceId, traceId, 'should have correct traceId');
  t.equal(searchResult.hits[0].organisation, testOrgId, 'should have correct organisation');
});

tap.test('OTLP HTTP + JSON: empty request', async (t) => {
  if (!elasticsearchAvailable) {
    t.skip('Elasticsearch not available');
    return;
  }
  
  if (!fastify || !testOrgId || !testApiKey) {
    t.fail('Test setup failed');
    return;
  }

  const response = await fetch(`http://127.0.0.1:${httpPort}/v1/traces`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `ApiKey ${testApiKey}`,
    },
    body: JSON.stringify({ resourceSpans: [] }),
  });

  t.equal(response.status, 200, 'should return 200 for empty request');
  const result = await response.json();
  t.same(result, {}, 'should return empty ExportTraceServiceResponse');
});

tap.test('OTLP HTTP + JSON: authentication required', async (t) => {
  if (!fastify) {
    t.fail('Test setup failed');
    return;
  }

  const traceId = 'a1b2c3d4e5f6789012345678901234ab';
  const spanId = '1234567890abcdef';
  const otlpRequest = createTestOtlpRequest(traceId, spanId);

  const response = await fetch(`http://127.0.0.1:${httpPort}/v1/traces`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(otlpRequest),
  });

  t.equal(response.status, 401, 'should return 401 without authentication');
});

tap.test('OTLP HTTP + JSON: invalid API key', async (t) => {
  if (!fastify) {
    t.fail('Test setup failed');
    return;
  }

  const traceId = 'a1b2c3d4e5f6789012345678901234ab';
  const spanId = '1234567890abcdef';
  const otlpRequest = createTestOtlpRequest(traceId, spanId);

  const response = await fetch(`http://127.0.0.1:${httpPort}/v1/traces`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'ApiKey invalid-key',
    },
    body: JSON.stringify(otlpRequest),
  });

  t.equal(response.status, 401, 'should return 401 with invalid API key');
});

// ===== HTTP + Protobuf Tests =====

tap.test('OTLP HTTP + Protobuf: successful trace export', async (t) => {
  if (!elasticsearchAvailable) {
    t.skip('Elasticsearch not available');
    return;
  }
  
  if (!fastify || !testOrgId || !testApiKey) {
    t.fail('Test setup failed');
    return;
  }

  const traceId = 'b2c3d4e5f6789012345678901234abcd';
  const spanId = '234567890abcdef1';
  const otlpRequestJson = createTestOtlpRequest(traceId, spanId);
  const protobufBuffer = await jsonToProtobuf(otlpRequestJson);

  const response = await fetch(`http://127.0.0.1:${httpPort}/v1/traces`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-protobuf',
      'Authorization': `ApiKey ${testApiKey}`,
    },
    body: protobufBuffer,
  });

  t.equal(response.status, 200, 'should return 200 on success');
  const result = await response.json();
  t.same(result, {}, 'should return empty ExportTraceServiceResponse');

  // Wait for Elasticsearch to index
  await new Promise(resolve => setTimeout(resolve, 1000));

  // Verify span was stored
  const searchQuery = new SearchQuery(`traceId:${traceId}`);
  const searchResult = await searchSpans(searchQuery, testOrgId!, 10, 0);
  t.equal(searchResult.hits.length, 1, 'should find the stored span');
  t.equal(searchResult.hits[0].traceId, traceId, 'should have correct traceId');
});

tap.test('OTLP HTTP + Protobuf: invalid protobuf data', async (t) => {
  if (!fastify || !testApiKey) {
    t.fail('Test setup failed');
    return;
  }

  const response = await fetch(`http://127.0.0.1:${httpPort}/v1/traces`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-protobuf',
      'Authorization': `ApiKey ${testApiKey}`,
    },
    body: Buffer.from('invalid protobuf data'),
  });

  t.equal(response.status, 400, 'should return 400 for invalid protobuf');
});

// ===== gRPC Tests =====

tap.test('OTLP gRPC: successful trace export', async (t) => {
  if (!elasticsearchAvailable) {
    t.skip('Elasticsearch not available');
    return;
  }
  
  if (!testOrgId || !testApiKey) {
    t.fail('Test setup failed');
    return;
  }

  // Note: gRPC server requires proto files to be available in proto/ directory
  // This test would require:
  // 1. Proto files from https://github.com/open-telemetry/opentelemetry-proto
  // 2. Starting the gRPC server
  // 3. Creating a gRPC client to call the Export method
  // 
  // For now, we test the shared processOtlpTraceExport function via HTTP endpoints
  // which exercises the same code path
  
  t.skip('gRPC server requires proto files - test via HTTP endpoints instead');
  // The HTTP + Protobuf test above exercises the same processOtlpTraceExport function
});

tap.test('OTLP: verify spans are stored correctly', async (t) => {
  if (!elasticsearchAvailable) {
    t.skip('Elasticsearch not available');
    return;
  }
  
  if (!fastify || !testOrgId || !testApiKey) {
    t.fail('Test setup failed');
    return;
  }

  const traceId = 'c3d4e5f6789012345678901234abcde';
  const spanId = '34567890abcdef12';
  const otlpRequest = createTestOtlpRequest(traceId, spanId);

  // Send via HTTP JSON
  const response = await fetch(`http://127.0.0.1:${httpPort}/v1/traces`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `ApiKey ${testApiKey}`,
    },
    body: JSON.stringify(otlpRequest),
  });

  t.equal(response.status, 200, 'should store span successfully');

  // Wait for Elasticsearch to index
  await new Promise(resolve => setTimeout(resolve, 1000));

  // Verify all span fields
  const searchQuery = new SearchQuery(`traceId:${traceId}`);
  const searchResult = await searchSpans(searchQuery, testOrgId!, 10, 0);
  t.equal(searchResult.hits.length, 1, 'should find exactly one span');
  
  const span = searchResult.hits[0];
  t.equal(span.traceId, traceId, 'should have correct traceId');
  t.equal(span.spanId, spanId, 'should have correct spanId');
  t.equal(span.name, 'test-span', 'should have correct name');
  t.equal(span.organisation, testOrgId, 'should have correct organisation');
  t.ok(span.attributes, 'should have attributes');
  t.equal(span.attributes['service.name'], 'test-service', 'should have resource attributes merged');
  t.equal(span.attributes['test.attribute'], 'test-value', 'should have span attributes');
  t.ok(span.startTime, 'should have startTime');
  t.ok(span.endTime, 'should have endTime');
  t.ok(span.duration, 'should have duration');
});

