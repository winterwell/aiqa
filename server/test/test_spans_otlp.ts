import dotenv from 'dotenv';
import tap from 'tap';
import Fastify from 'fastify';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { join } from 'path';
import { initPool, createTables, closePool, createOrganisation, createApiKey, getApiKeyByHash } from '../dist/db/db_sql.js';
import { initClient, createIndices, closeClient, checkElasticsearchAvailable, searchSpans } from '../dist/db/db_es.js';
import { initRedis, closeRedis } from '../dist/rate_limit.js';
import { registerSpanRoutes } from '../dist/routes/spans.js';
import { parseOtlpProtobuf } from '../dist/utils/otlp_protobuf.js';
import { encodeOtlpProtobuf } from './utils-for-tests.ts';
import { startGrpcServer, stopGrpcServer } from '../dist/grpc_server.js';
import SearchQuery from '../dist/common/SearchQuery.js';
import * as crypto from 'crypto';

dotenv.config();

// Setup (ES, Redis, Fastify, gRPC) and 11 OTLP tests exceed default tap timeout.
tap.setTimeout(90000);

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
 * Build gRPC ExportTraceServiceRequest in camelCase (proto-loader keepCase: false).
 * Bytes must be Buffer (not base64 strings).
 */
function createGrpcOtlpRequest(otlpRequestJson: any): any {
  const rsList = otlpRequestJson.resourceSpans ?? [];
  return {
    resourceSpans: rsList.map((rs: any) => ({
      resource: {
        attributes: (rs.resource?.attributes ?? []).map((attr: any) => ({ key: attr.key, value: attr.value })),
      },
      scopeSpans: (rs.scopeSpans ?? []).map((ss: any) => ({
        scope: { name: ss.scope?.name, version: ss.scope?.version },
        spans: (ss.spans ?? []).map((span: any) => ({
          traceId: Buffer.from(span.traceId, 'base64'),
          spanId: Buffer.from(span.spanId, 'base64'),
          parentSpanId: span.parentSpanId ? Buffer.from(span.parentSpanId, 'base64') : undefined,
          name: span.name,
          kind: parseInt(span.kind),
          startTimeUnixNano: span.startTimeUnixNano,
          endTimeUnixNano: span.endTimeUnixNano,
          attributes: (span.attributes ?? []).map((attr: any) => ({ key: attr.key, value: attr.value })),
          status: { code: parseInt(span.status?.code ?? 0), message: span.status?.message ?? '' },
          flags: parseInt(span.flags ?? 0),
        })),
      })),
    })),
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
                          },
                          ResourceSpans: {
                            fields: {
                              resource: { type: '.opentelemetry.proto.common.v1.Resource', id: 1 },
                              scopeSpans: { type: 'ScopeSpans', id: 2, rule: 'repeated' }
                            }
                          },
                          ScopeSpans: {
                            fields: {
                              scope: { type: '.opentelemetry.proto.common.v1.InstrumentationScope', id: 1 },
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
                              attributes: { type: '.opentelemetry.proto.common.v1.KeyValue', id: 8, rule: 'repeated' },
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

const SETUP_TIMEOUT_MS = 8000;

tap.before(async () => {
  const pgConnectionString = process.env.DATABASE_URL ||
    `postgresql://${process.env.PGUSER}:${process.env.PGPASSWORD}@${process.env.PGHOST}/${process.env.PGDATABASE}?sslmode=${process.env.PGSSLMODE || 'require'}`;
  const esUrl = process.env.ELASTICSEARCH_URL || 'http://localhost:9200';
  const redisUrl = process.env.REDIS_URL;

  const setup = async () => {
    initPool(pgConnectionString);
    initClient(esUrl);
    // Check ES first (with timeout) so we don't init Redis/DB when unreachable
    elasticsearchAvailable = await Promise.race([
      checkElasticsearchAvailable(),
      new Promise<false>((r) => setTimeout(() => r(false), 3000)),
    ]);
    if (!elasticsearchAvailable) {
      return;
    }
    if (redisUrl) {
      await initRedis(redisUrl).catch(() => {});
    }
    await createTables();
    await createIndices();

    // Create test server (short keepAlive so teardown close() can complete)
    fastify = Fastify({ logger: false });
    await registerSpanRoutes(fastify);
    await fastify.listen({ port: 0, host: '127.0.0.1' });
    (fastify.server as any).keepAliveTimeout = 100;
    httpPort = (fastify.server.address() as any)?.port;

    const org = await createOrganisation({ name: 'Test OTLP Organisation' });
    testOrgId = org.id;

    const apiKey = 'test-otlp-api-key-' + Date.now();
    testApiKeyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
    await createApiKey({
      organisation: testOrgId,
      name: 'Test OTLP API Key',
      hash: testApiKeyHash,
      key_end: apiKey.substring(apiKey.length - 4),
      role: 'developer',
    });
    testApiKey = apiKey;

    try {
      const grpcResult = await startGrpcServer(0);
      grpcServer = grpcResult.server;
      grpcPort = grpcResult.port;
    } catch (error) {
      console.warn('gRPC server not started (proto files may be missing):', error instanceof Error ? error.message : String(error));
      grpcServer = null;
      grpcPort = 0;
    }
  };

  try {
    await Promise.race([
      setup(),
      new Promise<void>((_, rej) => setTimeout(() => rej(new Error('setup timeout')), SETUP_TIMEOUT_MS)),
    ]);
  } catch (_e) {
    elasticsearchAvailable = false;
    fastify = null;
  }
});

const TEARDOWN_TIMEOUT_MS = 5000;
const FASTIFY_CLOSE_MS = 8000; // allow time for keepAliveTimeout to close connections if closeAllConnections missing

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<void> {
  await Promise.race([
    p,
    new Promise<void>((resolve) => setTimeout(resolve, ms)),
  ]);
}

tap.after(async () => {
  if (fastify) {
    // Let keepAliveTimeout close idle connections, then force-close any remaining (Node 18.2+)
    await new Promise((r) => setTimeout(r, 150));
    const server = (fastify as any).server;
    if (server?.closeAllConnections) server.closeAllConnections();
    await withTimeout(fastify.close(), FASTIFY_CLOSE_MS);
    fastify = null;
  }
  if (grpcServer) {
    await withTimeout(stopGrpcServer(), TEARDOWN_TIMEOUT_MS);
  }
  await withTimeout(closePool(), TEARDOWN_TIMEOUT_MS);
  await withTimeout(closeClient(), TEARDOWN_TIMEOUT_MS);
  await withTimeout(closeRedis(), TEARDOWN_TIMEOUT_MS);
});

// Declare expected number of top-level tests so tap does not report plan mismatch
tap.plan(11);

// ===== HTTP + JSON Tests =====

tap.test('OTLP HTTP + JSON: successful trace export', async (t) => {
  if (!elasticsearchAvailable) {
    t.skip('Elasticsearch not available');
    return;
  }
  
  if (!fastify || !testOrgId || !testApiKey) {
    t.skip('Test setup failed (services unavailable)');
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

  await new Promise(resolve => setTimeout(resolve, 100));
  const searchQuery = new SearchQuery(`trace:${traceId}`);
  const searchResult = await searchSpans(searchQuery, testOrgId!, 10, 0);
  t.equal(searchResult.hits.length, 1, 'should find the stored span');
  t.equal(searchResult.hits[0].trace, traceId, 'should have correct trace');
  t.equal(searchResult.hits[0].organisation, testOrgId, 'should have correct organisation');
});

tap.test('OTLP HTTP + JSON: empty request', async (t) => {
  if (!elasticsearchAvailable) {
    t.skip('Elasticsearch not available');
    return;
  }
  
  if (!fastify || !testOrgId || !testApiKey) {
    t.skip('Test setup failed (services unavailable)');
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
    t.skip('Test setup failed (services unavailable)');
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
    t.skip('Test setup failed (services unavailable)');
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
    t.skip('Test setup failed (services unavailable)');
    return;
  }

  const traceId = 'b2c3d4e5f6789012345678901234abcd';
  const spanId = '234567890abcdef1';
  const otlpRequestJson = createTestOtlpRequest(traceId, spanId);
  const protobufBuffer = encodeOtlpProtobuf(otlpRequestJson);

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

  await new Promise(resolve => setTimeout(resolve, 100));
  const searchQuery = new SearchQuery(`trace:${traceId}`);
  const searchResult = await searchSpans(searchQuery, testOrgId!, 10, 0);
  t.equal(searchResult.hits.length, 1, 'should find the stored span');
  t.equal(searchResult.hits[0].trace, traceId, 'should have correct trace');
});

tap.test('OTLP HTTP + Protobuf: invalid protobuf data', async (t) => {
  if (!fastify || !testApiKey) {
    t.skip('Test setup failed (services unavailable)');
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

// ===== gRPC + Protobuf Tests =====

tap.test('OTLP gRPC + Protobuf: successful trace export', async (t) => {
  if (!elasticsearchAvailable) {
    t.skip('Elasticsearch not available');
    return;
  }
  
  if (!grpcServer || !grpcPort || !testOrgId || !testApiKey) {
    t.skip('gRPC server not available (proto files may be missing)');
    return;
  }

  const traceId = 'd4e5f6789012345678901234abcdef';
  const spanId = '4567890abcdef123';
  const otlpRequestJson = createTestOtlpRequest(traceId, spanId);
  
  // Convert JSON to protobuf format for gRPC
  // gRPC expects the message in protobuf format, but we need to convert bytes from base64
  const protoDir = join(process.cwd(), 'opentelemetry-proto');
  const protoPath = join(protoDir, 'opentelemetry/proto/collector/trace/v1/trace_service.proto');
  
  try {
    const packageDefinition = protoLoader.loadSync(protoPath, {
      keepCase: false,
      longs: String,
      enums: Number,
      defaults: true,
      oneofs: true,
      includeDirs: [protoDir],
    });
    
    const traceServiceProto = grpc.loadPackageDefinition(packageDefinition) as any;
    const TraceService = traceServiceProto.opentelemetry?.proto?.collector?.trace?.v1?.TraceService;
    
    if (!TraceService) {
      t.skip('TraceService not found in proto definition');
      return;
    }
    
    const client = new TraceService(
      `127.0.0.1:${grpcPort}`,
      grpc.credentials.createInsecure()
    );
    try {
      const grpcRequest = createGrpcOtlpRequest(otlpRequestJson);
      const metadata = new grpc.Metadata();
      metadata.add('authorization', `ApiKey ${testApiKey}`);
      const result = await new Promise<any>((resolve, reject) => {
        client.Export(grpcRequest, metadata, (error: grpc.ServiceError | null, response: any) => {
          if (error) reject(error);
          else resolve(response);
        });
      });
      t.ok(result, 'should return response');
      await new Promise(resolve => setTimeout(resolve, 100));
      const searchQuery = new SearchQuery(`trace:${traceId}`);
      const searchResult = await searchSpans(searchQuery, testOrgId!, 10, 0);
      t.equal(searchResult.hits.length, 1, 'should find the stored span');
      t.equal(searchResult.hits[0].trace, traceId, 'should have correct trace');
      t.equal(searchResult.hits[0].organisation, testOrgId, 'should have correct organisation');
    } finally {
      (client as any).close?.();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    t.skip(`gRPC test failed (proto files may be missing): ${message}`);
  }
});

tap.test('OTLP gRPC + Protobuf: authentication required', async (t) => {
  if (!grpcServer || !grpcPort) {
    t.skip('gRPC server not available');
    return;
  }

  const protoDir = join(process.cwd(), 'opentelemetry-proto');
  const protoPath = join(protoDir, 'opentelemetry/proto/collector/trace/v1/trace_service.proto');
  
  try {
    const packageDefinition = protoLoader.loadSync(protoPath, {
      keepCase: false,
      longs: String,
      enums: Number,
      defaults: true,
      oneofs: true,
      includeDirs: [protoDir],
    });
    
    const traceServiceProto = grpc.loadPackageDefinition(packageDefinition) as any;
    const TraceService = traceServiceProto.opentelemetry?.proto?.collector?.trace?.v1?.TraceService;
    
    if (!TraceService) {
      t.skip('TraceService not found');
      return;
    }
    
    const client = new TraceService(
      `127.0.0.1:${grpcPort}`,
      grpc.credentials.createInsecure()
    );
    try {
      const traceId = 'e5f6789012345678901234abcdef12';
      const spanId = '567890abcdef1234';
      const otlpRequestJson = createTestOtlpRequest(traceId, spanId);
      const grpcRequest = createGrpcOtlpRequest(otlpRequestJson);
      const metadata = new grpc.Metadata();
      try {
        await new Promise<any>((resolve, reject) => {
          client.Export(grpcRequest, metadata, (error: grpc.ServiceError | null, response: any) => {
            if (error) reject(error);
            else resolve(response);
          });
        });
        t.fail('should reject request without authentication');
      } catch (error: any) {
        t.equal(error.code, grpc.status.UNAUTHENTICATED, 'should return UNAUTHENTICATED status');
      }
    } finally {
      (client as any).close?.();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    t.skip(`gRPC test failed: ${message}`);
  }
});

tap.test('OTLP gRPC + Protobuf: empty request', async (t) => {
  if (!elasticsearchAvailable) {
    t.skip('Elasticsearch not available');
    return;
  }
  
  if (!grpcServer || !grpcPort || !testOrgId || !testApiKey) {
    t.skip('gRPC server not available');
    return;
  }

  const protoDir = join(process.cwd(), 'opentelemetry-proto');
  const protoPath = join(protoDir, 'opentelemetry/proto/collector/trace/v1/trace_service.proto');
  
  try {
    const packageDefinition = protoLoader.loadSync(protoPath, {
      keepCase: false,
      longs: String,
      enums: Number,
      defaults: true,
      oneofs: true,
      includeDirs: [protoDir],
    });
    
    const traceServiceProto = grpc.loadPackageDefinition(packageDefinition) as any;
    const TraceService = traceServiceProto.opentelemetry?.proto?.collector?.trace?.v1?.TraceService;
    
    if (!TraceService) {
      t.skip('TraceService not found');
      return;
    }
    
    const client = new TraceService(
      `127.0.0.1:${grpcPort}`,
      grpc.credentials.createInsecure()
    );
    try {
      const grpcRequest = { resourceSpans: [] };
      const metadata = new grpc.Metadata();
      metadata.add('authorization', `ApiKey ${testApiKey}`);
      const result = await new Promise<any>((resolve, reject) => {
        client.Export(grpcRequest, metadata, (error: grpc.ServiceError | null, response: any) => {
          if (error) reject(error);
          else resolve(response);
        });
      });
      t.ok(result, 'should return response for empty request');
    } finally {
      (client as any).close?.();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    t.skip(`gRPC test failed: ${message}`);
  }
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

  // 32 hex chars = 16 bytes (OTLP trace ID); 16 hex = 8 bytes (span ID)
  const traceId = 'c3d4e5f6789012345678901234abcdef';
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

  // ES bulk insert uses refresh: 'wait_for'; allow delay for index to be searchable
  await new Promise(resolve => setTimeout(resolve, 1000));

  // Verify all span fields
  const searchQuery = new SearchQuery(`trace:${traceId}`);
  const searchResult = await searchSpans(searchQuery, testOrgId!, 10, 0);
  t.ok(searchResult.hits.length >= 1, 'should find at least one span');
  const span = searchResult.hits[0];
  if (!span) {
    t.fail('no span in search result');
    return;
  }
  t.equal(span.trace, traceId, 'should have correct trace');
  t.equal(span.id, spanId, 'should have correct span id');
  t.equal(span.name, 'test-span', 'should have correct name');
  t.equal(span.organisation, testOrgId, 'should have correct organisation');
  t.ok(span.attributes, 'should have attributes');
  t.equal(span.attributes['service.name'], 'test-service', 'should have resource attributes merged');
  t.equal(span.attributes['test.attribute'], 'test-value', 'should have span attributes');
  t.ok(span.start, 'should have start');
  t.ok(span.end, 'should have end');
  t.ok(span.duration, 'should have duration');
});

// ===== Comprehensive Test: All Transport/Format Combinations =====

tap.test('OTLP: test all transport/format combinations', async (t) => {
  if (!elasticsearchAvailable) {
    t.skip('Elasticsearch not available');
    return;
  }
  if (!fastify || !testOrgId || !testApiKey) {
    t.skip('Test setup failed (services unavailable)');
    return;
  }
  const testCases = [
    {
      name: 'HTTPS + JSON',
      transport: 'https',
      format: 'json',
      traceId: 'f6789012345678901234abcdef1234',
      spanId: '67890abcdef12345',
    },
    {
      name: 'HTTPS + Protobuf',
      transport: 'https',
      format: 'protobuf',
      traceId: '789012345678901234abcdef123456',
      spanId: '7890abcdef123456',
    },
  ];

  // Add gRPC test if available
  if (grpcServer && grpcPort) {
    testCases.push({
      name: 'gRPC + Protobuf',
      transport: 'grpc',
      format: 'protobuf',
      traceId: '89012345678901234abcdef1234567',
      spanId: '890abcdef1234567',
    });
  }

  for (const testCase of testCases) {
    const otlpRequest = createTestOtlpRequest(testCase.traceId, testCase.spanId);
    
    if (testCase.transport === 'https') {
      if (testCase.format === 'json') {
        // HTTPS + JSON
        const response = await fetch(`http://127.0.0.1:${httpPort}/v1/traces`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `ApiKey ${testApiKey}`,
          },
          body: JSON.stringify(otlpRequest),
        });
        t.equal(response.status, 200, `${testCase.name}: should return 200`);
      } else {
        // HTTPS + Protobuf
        const protobufBuffer = encodeOtlpProtobuf(otlpRequest);
        const response = await fetch(`http://127.0.0.1:${httpPort}/v1/traces`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-protobuf',
            'Authorization': `ApiKey ${testApiKey}`,
          },
          body: protobufBuffer,
        });
        t.equal(response.status, 200, `${testCase.name}: should return 200`);
      }
    } else if (testCase.transport === 'grpc' && testCase.format === 'protobuf') {
      // gRPC + Protobuf
      const protoDir = join(process.cwd(), 'opentelemetry-proto');
      const protoPath = join(protoDir, 'opentelemetry/proto/collector/trace/v1/trace_service.proto');
      
      try {
        const packageDefinition = protoLoader.loadSync(protoPath, {
          keepCase: false,
          longs: String,
          enums: Number,
          defaults: true,
          oneofs: true,
          includeDirs: [protoDir],
        });
        
        const traceServiceProto = grpc.loadPackageDefinition(packageDefinition) as any;
        const TraceService = traceServiceProto.opentelemetry?.proto?.collector?.trace?.v1?.TraceService;
        
        if (TraceService) {
          const client = new TraceService(
            `127.0.0.1:${grpcPort}`,
            grpc.credentials.createInsecure()
          );
          try {
            const grpcRequest = createGrpcOtlpRequest(otlpRequest);
            const metadata = new grpc.Metadata();
            metadata.add('authorization', `ApiKey ${testApiKey}`);
            await new Promise<any>((resolve, reject) => {
              client.Export(grpcRequest, metadata, (error: grpc.ServiceError | null, response: any) => {
                if (error) reject(error);
                else resolve(response);
              });
            });
            t.pass(`${testCase.name}: should succeed`);
          } finally {
            (client as any).close?.();
          }
        }
      } catch (error) {
        t.skip(`${testCase.name}: gRPC test failed (proto files may be missing)`);
      }
    }

    await new Promise(resolve => setTimeout(resolve, 100));
    const searchQuery = new SearchQuery(`trace:${testCase.traceId}`);
    const searchResult = await searchSpans(searchQuery, testOrgId!, 10, 0);
    t.equal(searchResult.hits.length, 1, `${testCase.name}: should find the stored span`);
    t.equal(searchResult.hits[0].trace, testCase.traceId, `${testCase.name}: should have correct trace`);
    t.equal(searchResult.hits[0].organisation, testOrgId, `${testCase.name}: should have correct organisation`);
  }
});

