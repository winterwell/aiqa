import { FastifyInstance } from 'fastify';
import { bulkInsertSpans, searchSpans, getSpan, updateSpan, deleteSpans } from '../db/db_es.js';
import { authenticate, AuthenticatedRequest, checkAccess } from '../server_auth.js';
import SearchQuery from '../common/SearchQuery.js';
import Span, { getSpanId, getTraceId } from '../common/types/Span.js';
import { addTokenCost } from '../token_cost.js';
import { checkRateLimit, recordSpanPosting } from '../rate_limit.js';
import { getOrganisation, getOrganisationAccountByOrganisation } from '../db/db_sql.js';
import { getOrganisationThreshold } from '../common/subscription_defaults.js';
import { parseOtlpProtobuf } from '../utils/otlp_protobuf.js';
import { propagateTokenCostsToRootSpan } from './server-span-utils.js';

/**
 * Convert OTLP KeyValue array to object.
 */
function convertKeyValueArray(kvArray: any[] | undefined): Record<string, any> {
  const result: Record<string, any> = {};
  if (!kvArray) return result;
  for (const kv of kvArray) {
    if (kv.key && kv.value) {
      result[kv.key] = convertOtlpValue(kv.value);
    }
  }
  return result;
}

/**
 * Convert OTLP scopeSpan to internal span format.
 * Processes all spans within a single scopeSpan.
 */
function convertOtlpSpansToInternalScopeSpan(
  scopeSpan: any,
  resourceAttrs: Record<string, any>
): any[] {
  const internalSpans: any[] = [];
  const scope = scopeSpan.scope || {};
  const spans = scopeSpan.spans || [];
  
  for (const otlpSpan of spans) {
    // Convert span attributes and merge resource attributes
    const attributes = { ...convertKeyValueArray(otlpSpan.attributes), ...resourceAttrs };
    
    // Convert events
    const events = (otlpSpan.events || []).map((event: any) => ({
      name: event.name || '',
      time: normalizeTimeToMillis(event.timeUnixNano || event.time) ?? 0,
      attributes: convertKeyValueArray(event.attributes),
    }));

    // Convert links
    const links = (otlpSpan.links || []).map((link: any) => ({
      context: {
        traceId: link.traceId ? bytesToHex(link.traceId) : '',
        spanId: link.spanId ? bytesToHex(link.spanId) : '',
        traceState: link.traceState ?? undefined,
      },
      attributes: convertKeyValueArray(link.attributes),
    }));

    // Convert trace ID and span ID from bytes to hex (OTLP JSON may send hex; protobuf sends base64/Buffer)
    const traceId = bytesToHex(otlpSpan.traceId) || '';
    const id = bytesToHex(otlpSpan.spanId) || '';
    const parentSpanId = otlpSpan.parentSpanId ? bytesToHex(otlpSpan.parentSpanId) : undefined;

    // Convert times
    const startTime = normalizeTimeToMillis(otlpSpan.startTimeUnixNano || otlpSpan.startTime) ?? 0;
    const endTime = normalizeTimeToMillis(otlpSpan.endTimeUnixNano || otlpSpan.endTime);
    const duration = endTime !== null ? endTime - startTime : null;
    
    // Convert status (enums are already numbers when parsed with enums: Number)
    const status = otlpSpan.status || {};
    const statusCode = status.code ?? 0;
    
    // Extract dropped counts (default to 0)
    const droppedAttributesCount = otlpSpan.droppedAttributesCount ?? 0;
    const droppedEventsCount = otlpSpan.droppedEventsCount ?? 0;
    const droppedLinksCount = otlpSpan.droppedLinksCount ?? 0;
    
    // Extract example and experiment from attributes (set by experiment runner)
    // These are special fields that should be top-level, not in attributes
    const exampleId = attributes.example;
    const experimentId = attributes.experiment;
    // Remove from attributes so they don't appear twice
    if (exampleId !== undefined) delete attributes.example;
    if (experimentId !== undefined) delete attributes.experiment;
    
    // Span type requires end: number; use startTime when endTime is null (in-progress span)
    internalSpans.push({
      name: otlpSpan.name || '',
      kind: otlpSpan.kind ?? 0,
      parent: parentSpanId,
      start: startTime,
      end: endTime ?? startTime,
      status: {
        code: statusCode,
        message: status.message || undefined,
      },
      attributes,
      links,
      events,
      resource: { attributes: resourceAttrs },
      trace: traceId,
      id,
      traceFlags: otlpSpan.flags ?? 0,
      duration,
      ended: endTime !== null,
      instrumentationLibrary: {
        name: scope.name || '',
        version: scope.version || undefined,
      },
      droppedAttributesCount,
      droppedEventsCount,
      droppedLinksCount,
      starred: false,
      ...(exampleId !== undefined && { example: exampleId }),
      ...(experimentId !== undefined && { experiment: experimentId }),
    });
  }
  
  console.log('spans.ts convertOtlpSpansToInternalScopeSpan: Internal spans:', internalSpans);
  return internalSpans;
}

/**
 * Convert OTLP span format to internal span format.
 * OTLP format: ResourceSpans -> ScopeSpans -> Spans (camelCase per spec/example).
 */
function convertOtlpSpansToInternal(otlpRequest: any): any[] {
  const internalSpans: any[] = [];
  const resourceSpansList = otlpRequest.resourceSpans;
  if (!resourceSpansList || !Array.isArray(resourceSpansList)) {
    return internalSpans;
  }

  for (const resourceSpan of resourceSpansList) {
    const resource = resourceSpan.resource || {};
    const resourceAttrs = convertKeyValueArray(resource.attributes);
    const scopeSpansList = resourceSpan.scopeSpans || [];
    for (const scopeSpan of scopeSpansList) {
      const spans = convertOtlpSpansToInternalScopeSpan(scopeSpan, resourceAttrs);
      internalSpans.push(...spans);
    }
  }

  return internalSpans;
}

/**
 * Convert OTLP AnyValue to JavaScript value (camelCase per OTLP JSON spec).
 */
function convertOtlpValue(value: any): any {
  if (value.stringValue !== undefined) return value.stringValue;
  if (value.boolValue !== undefined) return value.boolValue;
  if (value.intValue !== undefined) return value.intValue;
  if (value.doubleValue !== undefined) return value.doubleValue;
  if (value.arrayValue?.values) {
    return value.arrayValue.values.map((v: any) => convertOtlpValue(v));
  }
  if (value.kvlistValue?.values) {
    const obj: Record<string, any> = {};
    for (const kv of value.kvlistValue.values) {
      if (kv.key && kv.value) obj[kv.key] = convertOtlpValue(kv.value);
    }
    return obj;
  }
  if (value.bytesValue !== undefined) return value.bytesValue;
  return null;
}

/**
 * Convert bytes (base64 string, Buffer, or Uint8Array) to hex string.
 * If the value is already a hex string (16 or 32 chars), returns as-is.
 * OTLP JSON can send IDs as hex (see opentelemetry-proto/examples/trace.json) or base64.
 */
function bytesToHex(bytes: any): string {
  if (!bytes) return '';
  if (typeof bytes === 'string' && /^[0-9a-fA-F]+$/.test(bytes) && (bytes.length === 16 || bytes.length === 32)) {
    return bytes;
  }
  try {
    const buffer = typeof bytes === 'string'
      ? Buffer.from(bytes, 'base64')
      : Buffer.from(bytes);
    return buffer.toString('hex');
  } catch {
    return '';
  }
}

/**
 * Process OTLP trace export request.
 * Handles rate limiting, token cost calculation, and storage in our ES database.
 * This is the shared logic used by both HTTP and gRPC endpoints.
 * 
 * @param otlpRequest - Parsed OTLP ExportTraceServiceRequest (JSON format)
 * @param organisation - Organisation ID
 * @returns Object with success status and optional error information (retryAfterSeconds when rate limited)
 * @throws Error for connection errors (should be caught by caller)
 */
export async function processOtlpTraceExport(
  otlpRequest: any,
  organisation: string
): Promise<{ success: boolean; error?: { code: number; message: string }; retryAfterSeconds?: number }> {
  // Convert OTLP spans to internal format
  const spansArray = convertOtlpSpansToInternal(otlpRequest);

  if (spansArray.length === 0) {
    console.log('spans.ts processOtlpTraceExport: Empty request');
    // Empty request - return success per OTLP spec
    return { success: true };
  }

  // Reject spans missing required trace-id or span-id (per OTLP spec)
  if (spansArray.some(s => !s.trace?.trim() || !s.id?.trim())) {
    // log the bad spans
    console.error('spans.ts processOtlpTraceExport: Invalid spans:', spansArray.filter(s => !s.trace?.trim() || !s.id?.trim()));
    return {
      success: false,
      error: {
        code: 3, // INVALID_ARGUMENT
        message: 'Each span must have trace_id and span_id',
      },
    };
  }

  // Get organisation account to check rate limit
  const account = await getOrganisationAccountByOrganisation(organisation);
  const rateLimitPerHour = account ? getOrganisationThreshold(account, 'rate_limit_per_hour') ?? 1000 : 1000;
  
  // Check rate limit before processing
  const rateLimitResult = await checkRateLimit(organisation, rateLimitPerHour);
  if (rateLimitResult && !rateLimitResult.allowed) {
    const retryAfterSeconds = Math.ceil(Math.max(0, rateLimitResult.resetAt - Date.now()) / 1000);
    return {
      success: false,
      error: {
        code: 14, // RESOURCE_EXHAUSTED / UNAVAILABLE per gRPC status codes
        message: 'Rate limit exceeded',
      },
      retryAfterSeconds,
    };
  }
  
  // Add organisation to each span
  const spansWithOrg = spansArray.map(span => ({
    ...span,
    organisation,
  }));
  
  // Add token cost
  spansWithOrg.forEach(span => addTokenCost(span));
  // propagate token costs to the root span
  await propagateTokenCostsToRootSpan(spansWithOrg);
  // Save spans (may throw ConnectionError for Elasticsearch)
  console.log(`spans.ts processOtlpTraceExport: Bulk inserting ${spansWithOrg.length} spans for organisation ${organisation}`);
  await bulkInsertSpans(spansWithOrg);
  await recordSpanPosting(organisation, spansWithOrg.length);
  
  return { success: true };
}

/**
 * Normalize time value to epoch milliseconds.
 * Supports multiple input formats:
 * - ISO string (e.g., "2024-01-01T00:00:00.000Z")
 * - Epoch milliseconds (number, typically < 1e12 for dates before year 2286)
 * - Epoch nanoseconds (number, typically >= 1e12)
 * - HrTime format ([number, number] array with [seconds, nanoseconds])
 */
export function normalizeTimeToMillis(time: string | number | [number, number] | null | undefined): number | null {
  if (time === null || time === undefined) {
    return null;
  }

  // Handle HrTime format: [seconds, nanoseconds]
  if (Array.isArray(time) && time.length === 2 && typeof time[0] === 'number' && typeof time[1] === 'number') {
    return time[0] * 1000 + Math.floor(time[1] / 1_000_000);
  }

  // Handle string (ISO format)
  if (typeof time === 'string') {
    const date = new Date(time);
    if (!isNaN(date.getTime())) {
      return date.getTime();
    }
    // Try parsing as number string (epoch milliseconds or nanoseconds)
    const num = parseFloat(time);
    if (isNaN(num)) {
      return null;
    }
    time = num; // carry on to the next case
  }

  // Handle number (epoch milliseconds or nanoseconds)
  if (typeof time === 'number') {
    // If it's a very large number (>= 1e13), assume nanoseconds
    // This threshold is around year 2286 in milliseconds
    if (time >= 1e13) {
      return Math.floor(time / 1_000_000);
    }
    // Otherwise assume milliseconds
    return time;
  }

  return null;
}

/**
 * Register span endpoints with Fastify
 */
export async function registerSpanRoutes(fastify: FastifyInstance): Promise<void> {
  
  // Register content type parser for protobuf
  fastify.addContentTypeParser('application/x-protobuf', { parseAs: 'buffer' }, (req, body, done) => {
    done(null, body);
  });
  fastify.addContentTypeParser('application/protobuf', { parseAs: 'buffer' }, (req, body, done) => {
    done(null, body);
  });
  
  // ===== OTLP ENDPOINT =====
  /** OTLP HTTP endpoint at /v1/traces following OpenTelemetry Protocol specification
  // Accepts ExportTraceServiceRequest in JSON or Protobuf encoding
  // Content-Type: application/json (default) or application/x-protobuf
  // Returns ExportTraceServiceResponse
  */
  fastify.post('/v1/traces', { preHandler: authenticate }, async (request: AuthenticatedRequest, reply) => {
    if (!checkAccess(request, reply, ['trace', 'developer', 'admin'])) return;
    const organisation = request.organisation!;
   
    try {
      let otlpRequest: any;
      
      // Check Content-Type to determine encoding
      const contentType = request.headers['content-type'] || '';
      const isProtobuf = contentType.includes('application/x-protobuf') || contentType.includes('application/protobuf');
      console.log(`spans.ts POST: Organisation: ${organisation} Content-Type: ${contentType}`);

      if (isProtobuf) {
        // Parse Protobuf binary data
        const rawBody = request.body as Buffer;
        if (!rawBody || !Buffer.isBuffer(rawBody)) {
          reply.code(400).send({
            code: 3, // INVALID_ARGUMENT
            message: 'Invalid protobuf data',
          });
          return;
        }
        otlpRequest = parseOtlpProtobuf(rawBody);
      } else {
        // Parse JSON (default)
        otlpRequest = request.body as any;
      }

      console.log('spans.ts POST: OTLP request:', JSON.stringify(otlpRequest, null, 2));
      
      // Process the OTLP trace export (rate limiting, storage, etc.)
      const result = await processOtlpTraceExport(otlpRequest, organisation);
      
      if (!result.success && result.error) {
        // Map error code to HTTP status
        const httpStatus = result.error.code === 14 ? 429 : 400;
        if (httpStatus === 429 && result.retryAfterSeconds != null) {
          reply.header('Retry-After', String(result.retryAfterSeconds));
        }
        reply.code(httpStatus).send(result.error);
        return;
      }
      console.log(`spans.ts POST: OTLP success - spans uploaded for organisation ${organisation}`);
      // Return OTLP success response (empty ExportTraceServiceResponse)
      reply.code(200).send({});
      
    } catch (error: any) {
      if (isConnectionError(error)) {
        console.error('spans.ts POST: Error in OTLP HTTP endpoint:', error);
        reply.code(503).send({
          code: 14, // UNAVAILABLE
          message: 'Elasticsearch service unavailable',
        });
        return;
      }
      // Bad data (e.g. invalid/truncated protobuf) - return 400 per OTLP spec; log briefly to avoid noisy stacks
      if (error.message?.includes('Invalid protobuf') || error.message?.includes('Invalid request')) {
        console.warn('spans.ts POST: OTLP /v1/traces invalid request:', error.message);
      } else {
        console.error('spans.ts POST: Error in OTLP HTTP endpoint:', error);
      }
      reply.code(400).send({
        code: 3, // INVALID_ARGUMENT
        message: error.message || 'Invalid request data',
      });
    }
  }); //  end of POST /v1/traces

  /**
   * Query spans ie Traces
   * 
   * Query parameters:
   * - organisation: optional - organisation ID (required for JWT auth, optional for API key auth as it's provided by the API key)
   * - q: optional - search query string
   * - limit: optional - max results (default: 100)
   * - offset: optional - pagination offset (default: 0)
   * - fields: optional - comma-separated list of fields to include.
   * - exclude: optional - comma-separated list of fields to exclude.
   * Security: Authenticated users only. Organisation membership verified by authenticate middleware. Results filtered by organisationId in Elasticsearch (searchSpans).
   * For API key authentication, organisation is automatically set from the API key.
   */
  fastify.get('/span', { preHandler: authenticate }, async (request: AuthenticatedRequest, reply) => {
    if (!checkAccess(request, reply, ['developer', 'admin'])) return;
    // For API keys, organisation is set from the API key. For JWT, use query param or request.organisation.
    const organisationId = (request.query as any).organisation as string | undefined || request.organisation;
    if (!organisationId) {
      reply.code(400).send({ error: 'organisation query parameter is required (JWT authentication) or organisation must be associated with API key' });
      return;
    }
    const query = (request.query as any).q as string | undefined;  
    const limitRaw = parseInt(String((request.query as any).limit ?? 100), 10);
    const offsetRaw = parseInt(String((request.query as any).offset ?? 0), 10);
    const limit = Number.isNaN(limitRaw) || limitRaw < 1 ? 100 : limitRaw;
    const offset = Number.isNaN(offsetRaw) || offsetRaw < 0 ? 0 : offsetRaw;
    const fieldsParam = (request.query as any).fields as string | undefined;
    const excludeFieldsParam = (request.query as any).exclude as string | undefined;

    // Parse fields parameter for Elasticsearch _source filtering
    let _source_includes: string[] | undefined;
    let _source_excludes: string[] | undefined;
    
    if (fieldsParam === "*") {
      // Include all fields, no exclusions
      _source_includes = undefined;
      _source_excludes = undefined;
    } else {
      _source_includes = parseFieldList(fieldsParam);
      _source_excludes = parseFieldList(excludeFieldsParam);
      // Default: exclude attributes and unindexed_attributes if neither fields nor exclude is specified
      if (!fieldsParam && !excludeFieldsParam) {
        _source_excludes = ['attributes', 'unindexed_attributes'];
      }
    }

    // feedback:positive / feedback:negative in query → resolve to attribute.feedback (trace IDs from feedback spans), then filter root spans
    let resolvedQ = (query?.trim() || 'parent:unset');
    const feedbackValue = SearchQuery.propFromString(resolvedQ, 'feedback');
    if (feedbackValue === 'positive' || feedbackValue === 'negative') {
      const thumbsUp = feedbackValue === 'positive';
      resolvedQ = SearchQuery.setPropInString(resolvedQ, 'feedback', null);
      const feedbackSpanQuery = `attributes.aiqa.span_type:feedback AND attributes.feedback.thumbs_up:${thumbsUp}`;
      const feedbackResult = await searchSpans(feedbackSpanQuery, organisationId, 1000, 0, ['trace'], undefined);
      const traceIds = feedbackResult.hits.map((s: Span) => s.trace).filter(Boolean) as string[];
      if (traceIds.length === 0) {
        return { hits: [], total: 0, limit, offset };
      }
      const traceIdClause = traceIds.map((id: string) => `trace:${id}`).join(' OR ');
      resolvedQ = resolvedQ ? `(${traceIdClause}) AND (${resolvedQ})` : `(${traceIdClause})`;
    }

    const searchQuery = new SearchQuery(resolvedQ);

    try {
      const result = await searchSpans(searchQuery, organisationId, limit, offset, _source_includes, _source_excludes);
      return {
        hits: result.hits,
        total: result.total,
        limit,
        offset,
      };
    } catch (error: any) {
      if (isConnectionError(error)) {
        reply.code(503).send({ error: 'Elasticsearch service unavailable. Please check if Elasticsearch is running.' });
        return;
      }
      throw error;
    }
  });

  fastify.get('/span/:id', { preHandler: authenticate }, async (request: AuthenticatedRequest, reply) => {
    if (!checkAccess(request, reply, ['developer', 'admin'])) return;
    const organisation = request.organisation!;
    const { id } = request.params as { id: string };
    const span = await getSpan(id, organisation);
    if (!span) {
      reply.code(404).send({ error: 'Span not found or does not belong to your organisation' });
      return;
    }
    return span;
  });

  /**
   * Update a span by ID. Supports partial updates.
   * 
   * Path parameters:
   * - id: required - span ID (used as document _id in ElasticSearch)
   * 
   * Body: Partial span object with fields to update (e.g., { starred: true })
   * 
   * Security: Authenticated users only. Organisation membership verified by authenticate middleware. 
   * Updates are scoped to the authenticated user's organisation.
   */
  fastify.put('/span/:id', { preHandler: authenticate }, async (request: AuthenticatedRequest, reply) => {
    if (!checkAccess(request, reply, ['developer', 'admin'])) return;
    const organisation = request.organisation!;
    const { id } = request.params as { id: string };
    const updates = request.body as Partial<Span>;

    // Validate that updates only contain allowed fields
    const allowedFields = ['starred', 'tags'];
    const updateKeys = Object.keys(updates);
    const invalidFields = updateKeys.filter(key => !allowedFields.includes(key));
    if (invalidFields.length > 0) {
      reply.code(400).send({ error: `Invalid fields for update: ${invalidFields.join(', ')}. Allowed fields: ${allowedFields.join(', ')}` });
      return;
    }

    try {
      const updatedSpan = await updateSpan(id, updates, organisation);
      if (!updatedSpan) {
        reply.code(404).send({ error: 'Span not found or does not belong to your organisation' });
        return;
      }

      return updatedSpan;
    } catch (error: any) {
      if (isConnectionError(error)) {
        reply.code(503).send({ error: 'Elasticsearch service unavailable. Please check if Elasticsearch is running.' });
        return;
      }
      throw error;
    }
  });

  /** Shared handler for span deletion. Body shape: either spans or traces (webapp uses POST /span/delete with this). */
  async function handleDeleteSpans(
    request: AuthenticatedRequest,
    reply: any,
    body: { spanIds?: string[]; traceIds?: string[] } | { spans?: string[]; traces?: string[] }
  ) {
    if (!checkAccess(request, reply, ['developer', 'admin'])) return;
    const organisation = request.organisation!;
    const spanIds = (body as any).spanIds ?? (body as any).spans;
    const traceIds = (body as any).traceIds ?? (body as any).traces;

    if (!spanIds && !traceIds) {
      reply.code(400).send({ error: 'Either spanIds/spans or traceIds/traces must be provided' });
      return;
    }
    if (spanIds && traceIds) {
      reply.code(400).send({ error: 'Cannot specify both span IDs and trace IDs' });
      return;
    }
    if (spanIds && (!Array.isArray(spanIds) || spanIds.length === 0)) {
      reply.code(400).send({ error: 'spanIds/spans must be a non-empty array' });
      return;
    }
    if (traceIds && (!Array.isArray(traceIds) || traceIds.length === 0)) {
      reply.code(400).send({ error: 'traceIds/traces must be a non-empty array' });
      return;
    }

    try {
      const options = spanIds ? { spans: spanIds } : { traces: traceIds! };
      const deletedCount = await deleteSpans(options, organisation);
      return { success: true, deleted: deletedCount };
    } catch (error: any) {
      if (isConnectionError(error)) {
        reply.code(503).send({ error: 'Elasticsearch service unavailable. Please check if Elasticsearch is running.' });
        return;
      }
      throw error;
    }
  }

  /**
   * Delete spans by IDs or by trace IDs.
   *
   * Body: Either { spanIds: string[] } or { traceIds: string[] }.
   *
   * Security: Authenticated users only. Organisation membership verified by authenticate middleware.
   * Deletions are scoped to the authenticated user's organisation.
   */
  fastify.delete('/span', { preHandler: authenticate }, async (request: AuthenticatedRequest, reply) => {
    const body = (request.body as { spanIds?: string[]; traceIds?: string[] }) ?? {};
    return handleDeleteSpans(request, reply, body);
  });

  /**
   * Delete spans (POST). Same as DELETE /span but allows request body for clients that prefer POST.
   * Body: { spans: string[] } or { traces: string[] }.
   */
  fastify.post('/span/delete', { preHandler: authenticate }, async (request: AuthenticatedRequest, reply) => {
    const body = (request.body as { spans?: string[]; traces?: string[] }) ?? {};
    return handleDeleteSpans(request, reply, body);
  });
}

/**
 * Check if error is a ConnectionError from Elasticsearch.
 */
function isConnectionError(error: any): boolean {
  return error.name === 'ConnectionError' || error.message?.includes('ConnectionError');
}

/**
 * Parse comma-separated field list.
 */
function parseFieldList(fields: string | undefined): string[] | undefined {
  if (!fields) return undefined;
  const parsed = fields.split(',').map(f => f.trim()).filter(f => f.length > 0);
  return parsed.length > 0 ? parsed : undefined;
}

