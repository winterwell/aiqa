import { FastifyInstance } from 'fastify';
import { bulkInsertSpans, searchSpans, updateSpan } from '../db/db_es.js';
import { authenticate, AuthenticatedRequest, checkAccess } from '../server_auth.js';
import SearchQuery from '../common/SearchQuery.js';
import Span, { getSpanId, getTraceId } from '../common/types/Span.js';
import { addTokenCost } from '../token_cost.js';
import { checkRateLimit, recordSpanPosting } from '../rate_limit.js';
import { getOrganisation, getOrganisationAccountByOrganisation } from '../db/db_sql.js';
import { getOrganisationThreshold } from '../common/subscription_defaults.js';
import { parseOtlpProtobuf } from '../utils/otlp_protobuf.js';
import { createHash } from 'crypto';
import {
	GEN_AI_USAGE_INPUT_TOKENS,
	GEN_AI_USAGE_OUTPUT_TOKENS,
	GEN_AI_USAGE_TOTAL_TOKENS,
	GEN_AI_USAGE_CACHED_INPUT_TOKENS,
	GEN_AI_COST_USD,
} from '../common/constants_otel.js';

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
        traceState: link.traceState || undefined,
      },
      attributes: convertKeyValueArray(link.attributes),
    }));
    
    // Convert trace ID and span ID from bytes to hex
    const traceId = otlpSpan.traceId ? bytesToHex(otlpSpan.traceId) : '';
    const id = otlpSpan.spanId ? bytesToHex(otlpSpan.spanId) : '';
    const parentSpanId = otlpSpan.parentSpanId ? bytesToHex(otlpSpan.parentSpanId) : undefined;
    
    // Convert times - support multiple formats
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
    
    internalSpans.push({
      name: otlpSpan.name || '',
      kind: otlpSpan.kind ?? 0,
      parentSpanId,
      startTime,
      endTime,
      status: {
        code: statusCode,
        message: status.message || undefined,
      },
      attributes,
      links,
      events,
      resource: { attributes: resourceAttrs },
      traceId,
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
      _seen: [],
      ...(exampleId !== undefined && { example: exampleId }),
      ...(experimentId !== undefined && { experiment: experimentId }),
    });
  }
  
  return internalSpans;
}

/**
 * Convert OTLP span format to internal span format.
 * OTLP format: ResourceSpans -> ScopeSpans -> Spans
 */
function convertOtlpSpansToInternal(otlpRequest: any): any[] {
  const internalSpans: any[] = [];
  
  if (!otlpRequest.resourceSpans || !Array.isArray(otlpRequest.resourceSpans)) {
    return internalSpans;
  }
  
  for (const resourceSpan of otlpRequest.resourceSpans) {
    const resource = resourceSpan.resource || {};
    const resourceAttrs = convertKeyValueArray(resource.attributes);
    
    const scopeSpans = resourceSpan.scopeSpans || [];
    for (const scopeSpan of scopeSpans) {
      const spans = convertOtlpSpansToInternalScopeSpan(scopeSpan, resourceAttrs);
      internalSpans.push(...spans);
    }
  }
  
  return internalSpans;
}

/**
 * Convert OTLP AnyValue to JavaScript value.
 */
function convertOtlpValue(value: any): any {
  if (value.stringValue !== undefined) return value.stringValue;
  if (value.boolValue !== undefined) return value.boolValue;
  if (value.intValue !== undefined) return value.intValue;
  if (value.doubleValue !== undefined) return value.doubleValue;
  if (value.arrayValue && value.arrayValue.values) {
    return value.arrayValue.values.map((v: any) => convertOtlpValue(v));
  }
  if (value.kvlistValue && value.kvlistValue.values) {
    const obj: Record<string, any> = {};
    for (const kv of value.kvlistValue.values) {
      if (kv.key && kv.value) {
        obj[kv.key] = convertOtlpValue(kv.value);
      }
    }
    return obj;
  }
  if (value.bytesValue) {
    // Return bytes as base64 string (already in base64 format from protobuf)
    return value.bytesValue;
  }
  return null;
}

/**
 * Convert bytes (base64 string, array, or Uint8Array) to hex string.
 */
function bytesToHex(bytes: any): string {
  if (!bytes) return '';
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
 * Convert a span ID (UUID/hex string) to a compact numeric hash for _seen tracking.
 * Uses a fast hash function to convert UUID -> number (collision chance is tiny).
 */
export function spanIdToHash(spanId: string | undefined): number | null {
  if (!spanId) return null;
  // Use first 8 bytes of SHA-256 hash as a 32-bit integer
  const hash = createHash('sha256').update(spanId).digest();
  // Convert first 4 bytes to signed 32-bit integer
  return hash.readInt32BE(0);
}

export interface TokenStats {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  totalTokens: number;
  cost: number;
}

/**
 * Safely convert a value to a number, handling both string and number types.
 * Prevents string concatenation bugs when adding token values.
 * @param defaultValue - Value to return if input is undefined/null/invalid. Omit to return undefined for missing values.
 */
export function toNumber(value: unknown, defaultValue?: number): number | undefined {
  if (value === undefined || value === null) {
    return defaultValue;
  }
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return isNaN(parsed) ? defaultValue : parsed;
  }
  return defaultValue;
}

/**
 * Get token usage values from a span's attributes.
 */
export function getTokenUsage(span: Span): TokenStats {
  const attrs = span.attributes || {};
  return {
    inputTokens: toNumber(attrs[GEN_AI_USAGE_INPUT_TOKENS], 0),
    outputTokens: toNumber(attrs[GEN_AI_USAGE_OUTPUT_TOKENS], 0),
    cachedInputTokens: toNumber(attrs[GEN_AI_USAGE_CACHED_INPUT_TOKENS], 0),
    totalTokens: toNumber(attrs[GEN_AI_USAGE_TOTAL_TOKENS], 0),
    cost: toNumber(attrs[GEN_AI_COST_USD], 0),
  };
}

/**
 * Add token usage values to a span's attributes.
 */
export function addTokenUsageToSpan(span: Span, usage: TokenStats): void {
  const mutableSpan = span as any;
  if (!mutableSpan.attributes) {
    mutableSpan.attributes = {};
  }
  const attrs = mutableSpan.attributes;
  
  // Aggregate token counts (only if they exist on the span or are being added)
  const current = getTokenUsage(span);

  attrs[GEN_AI_USAGE_INPUT_TOKENS] = current.inputTokens + usage.inputTokens;
  attrs[GEN_AI_USAGE_OUTPUT_TOKENS] = current.outputTokens + usage.outputTokens;
  attrs[GEN_AI_USAGE_CACHED_INPUT_TOKENS] = current.cachedInputTokens + usage.cachedInputTokens;
  attrs[GEN_AI_USAGE_TOTAL_TOKENS] = current.totalTokens + usage.totalTokens;
  attrs[GEN_AI_COST_USD] = current.cost + usage.cost;
}

/**
 * Dependencies for propagateTokenCostsToRootSpan (for testing/mocking)
 */
export interface PropagateTokenCostsDependencies {
  searchSpans: (query: SearchQuery | string, organisation: string, limit: number, offset: number, includes?: string[] | null, excludes?: string[] | null) => Promise<{ hits: Span[]; total: number }>;
  updateSpan: (spanId: string, updates: Partial<Span>, organisation: string) => Promise<Span | null>;
}

/**
 * Propagate token costs from child spans to their parent spans, all the way up to root spans.
 * 
 * This function:
 * 1. Separates spans into span-trees (one tree per root span)
 * 2. Finds spans referenced as parents but not present in the batch - loads them
 * 3. Processes from leaf nodes up to root, updating parent token-cost stats
 * 4. Uses _seen array to track processed children (for idempotent updates and late-arriving spans)
 * 
 * @param spans - Array of spans to process (will be modified in-place)
 * @param deps - Optional dependencies for testing (defaults to real database functions)
 */
export async function propagateTokenCostsToRootSpan(
  spans: Span[],
  deps?: Partial<PropagateTokenCostsDependencies>
): Promise<void> {
  if (spans.length === 0) return;
  
  // Use provided dependencies or default to real ones
  const searchSpansFn = deps?.searchSpans || searchSpans;
  const updateSpanFn = deps?.updateSpan || updateSpan;
  
  // Get organisation from first span (all should have same organisation)
  const organisation = spans[0].organisation;
  if (!organisation) {
    console.warn('propagateTokenCostsToRootSpan: spans missing organisation');
    return;
  }
  
  // Build a map of spanId -> span for quick lookup
  const spanMap = new Map<string, Span>();
  
  for (const span of spans) {
    const spanId = getSpanId(span);
    if (spanId) {
      spanMap.set(spanId, span);
    } else {
      console.warn('propagateTokenCostsToRootSpan: span missing id, skipping', span.name);
    }
  }
  
  // Find all parent span IDs that are referenced but not in the batch
  const missingParentIds = new Set<string>();
  for (const span of spans) {
    const parentSpanId = (span as any).parentSpanId;
    if (parentSpanId && !spanMap.has(parentSpanId)) {
      missingParentIds.add(parentSpanId);
    }
  }
  
  // Load missing parent spans from database (recursively load grandparents too)
  // TODO speed up by loading a batch of spans at a time with a single query (though we may still have to recurse for grandparents)
  const loadedParents = new Map<string, Span>();
  const toLoad = Array.from(missingParentIds);
  
  while (toLoad.length > 0) {
    const parentId = toLoad.pop()!;
    if (loadedParents.has(parentId) || spanMap.has(parentId)) {
      continue; // Already loaded or in batch
    }
    
    try {
      const result = await searchSpansFn(
        new SearchQuery(`id:${parentId}`),
        organisation,
        1,
        0,
        ['id', 'parentSpanId', 'traceId', 'organisation', 'attributes', '_seen'],
        undefined
      );
      if (result.hits.length > 0) {
        const parent = result.hits[0];
        loadedParents.set(parentId, parent);
        spanMap.set(parentId, parent);
        
        // If this parent has its own parent, load that too
        const grandparentId = (parent as any).parentSpanId;
        if (grandparentId && !spanMap.has(grandparentId)) {
          toLoad.push(grandparentId);
        }
      }
    } catch (error) {
      console.warn(`Failed to load parent span ${parentId}:`, error);
    }
  }
  
  // Build parent-child relationships for all spans (including loaded parents)
  const childrenMap = new Map<string, Span[]>(); // parentSpanId -> children[]
  const rootSpans: Span[] = [];
  const allSpans = [...spans, ...Array.from(loadedParents.values())];
  
  for (const span of allSpans) {
    const spanId = getSpanId(span);
    if (!spanId) {
      console.warn('propagateTokenCostsToRootSpan: span missing id in allSpans, skipping', (span as any).name);
      continue;
    }
    
    const parentSpanId = (span as any).parentSpanId;
    if (!parentSpanId) {
      // This is a root span
      rootSpans.push(span);
    } else {
      // This span has a parent - add it to the children map
      // Note: parent might not exist if loading failed, but we still build the tree structure
      if (!childrenMap.has(parentSpanId)) {
        childrenMap.set(parentSpanId, []);
      }
      childrenMap.get(parentSpanId)!.push(span);
    }
  }
  
  // Process each span tree (one per root span)
  const processedSpans = new Set<string>();
  
  // Zero token stats for initialization
  const zeroStats: TokenStats = { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, totalTokens: 0, cost: 0 };
  
  // Helper function to process a span and propagate to its parent
  const processSpan = (span: Span): TokenStats => {
    const spanId = getSpanId(span);
    if (!spanId) {
      return zeroStats;
    }
    
    // Skip if already processed (avoid cycles)
    if (processedSpans.has(spanId)) {
      // This shouldn't happen in a well-formed tree, but handle gracefully
      console.warn(`propagateTokenCostsToRootSpan: span ${spanId} processed multiple times, possible cycle or duplicate`);
      return getTokenUsage(span);
    }
    processedSpans.add(spanId);
    
    // Get this span's own token usage
    const ownUsage = getTokenUsage(span);
    
    // Aggregate from children
    const children = childrenMap.get(spanId) || [];
    const childStats: TokenStats = { ...zeroStats };
    
    const mutableSpan = span as any;
    if (!mutableSpan._seen) {
      mutableSpan._seen = [];
    }
    const seenSet = new Set(mutableSpan._seen);
    
    for (const child of children) {
      const childSpanId = getSpanId(child);
      if (!childSpanId) continue;
      
      const childHashValue = spanIdToHash(childSpanId);
      if (childHashValue === null) continue;
      
      // Skip if this child was already processed (idempotent updates)
      if (seenSet.has(childHashValue)) {
        continue;
      }
      
      // Process child recursively
      const childUsage = processSpan(child);
      
      // Add child's usage to totals
      childStats.inputTokens += childUsage.inputTokens;
      childStats.outputTokens += childUsage.outputTokens;
      childStats.cachedInputTokens += childUsage.cachedInputTokens;
      childStats.totalTokens += childUsage.totalTokens;
      childStats.cost += childUsage.cost;
      
      // Mark child as seen
      seenSet.add(childHashValue);
    }
    
    // Update _seen array
    mutableSpan._seen = Array.from(seenSet);
    
    // Add child usage to this span (always add, even if zero - simplifies logic)
    try {
      addTokenUsageToSpan(span, childStats);
    } catch (error) {
      console.error(`propagateTokenCostsToRootSpan: failed to add token usage to span ${spanId}:`, error);
      // Continue processing - don't fail entire propagation
    }
    
    // Return total usage (own + children)
    return {
      inputTokens: ownUsage.inputTokens + childStats.inputTokens,
      outputTokens: ownUsage.outputTokens + childStats.outputTokens,
      cachedInputTokens: ownUsage.cachedInputTokens + childStats.cachedInputTokens,
      totalTokens: ownUsage.totalTokens + childStats.totalTokens,
      cost: ownUsage.cost + childStats.cost,
    };
  };
  
  // Process all root spans (this will process entire trees bottom-up)
  // This includes both root spans from the batch and loaded root spans
  for (const rootSpan of rootSpans) {
    try {
      processSpan(rootSpan);
    } catch (error) {
      console.error(`propagateTokenCostsToRootSpan: failed to process root span ${getSpanId(rootSpan) || 'unknown'}:`, error);
      // Continue processing other root spans - don't fail entire propagation
    }
  }
  
  // Update loaded parent spans in the database
  // Note: The parent spans have been modified in-place by processSpan
  const updateFailures: string[] = [];
  for (const [parentId, parent] of loadedParents.entries()) {
    try {
      const updates: Partial<Span> = {
        attributes: parent.attributes || {},
        _seen: (parent as any)._seen || [],
      };
      const updated = await updateSpanFn(parentId, updates, organisation);
      if (!updated) {
        updateFailures.push(parentId);
        console.warn(`propagateTokenCostsToRootSpan: updateSpan returned null for ${parentId} (span may not exist or belong to different org)`);
      }
    } catch (error) {
      updateFailures.push(parentId);
      console.error(`propagateTokenCostsToRootSpan: failed to update parent span ${parentId}:`, error);
    }
  }
  
  if (updateFailures.length > 0) {
    console.warn(`propagateTokenCostsToRootSpan: failed to update ${updateFailures.length} parent span(s) in database`);
  }
}

/**
 * Process OTLP trace export request.
 * Handles rate limiting, token cost calculation, and storage in our ES database.
 * This is the shared logic used by both HTTP and gRPC endpoints.
 * 
 * @param otlpRequest - Parsed OTLP ExportTraceServiceRequest (JSON format)
 * @param organisation - Organisation ID
 * @returns Object with success status and optional error information
 * @throws Error for connection errors (should be caught by caller)
 */
export async function processOtlpTraceExport(
  otlpRequest: any,
  organisation: string
): Promise<{ success: boolean; error?: { code: number; message: string } }> {
  // Convert OTLP spans to internal format
  const spansArray = convertOtlpSpansToInternal(otlpRequest);
  
  if (spansArray.length === 0) {
    // Empty request - return success per OTLP spec
    return { success: true };
  }
  
  // Get organisation account to check rate limit
  const account = await getOrganisationAccountByOrganisation(organisation);
  const rateLimitPerHour = account ? getOrganisationThreshold(account, 'rate_limit_per_hour') ?? 1000 : 1000;
  
  // Check rate limit before processing
  const rateLimitResult = await checkRateLimit(organisation, rateLimitPerHour);
  if (rateLimitResult && !rateLimitResult.allowed) {
    return {
      success: false,
      error: {
        code: 14, // RESOURCE_EXHAUSTED / UNAVAILABLE per gRPC status codes
        message: 'Rate limit exceeded',
      },
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
    if (!isNaN(num)) {
      // If it's a very large number (>= 1e12), assume nanoseconds
      if (num >= 1e12) {
        return Math.floor(num / 1_000_000);
      }
      return num;
    }
    return null;
  }

  // Handle number (epoch milliseconds or nanoseconds)
  if (typeof time === 'number') {
    // If it's a very large number (>= 1e12), assume nanoseconds
    // This threshold is around year 2286 in milliseconds
    if (time >= 1e12) {
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
      
      // Process the OTLP trace export (rate limiting, storage, etc.)
      const result = await processOtlpTraceExport(otlpRequest, organisation);
      
      if (!result.success && result.error) {
        // Map error code to HTTP status
        const httpStatus = result.error.code === 14 ? 429 : 400;
        reply.code(httpStatus).send(result.error);
        return;
      }
      
      // Return OTLP success response (empty ExportTraceServiceResponse)
      reply.code(200).send({});
      
    } catch (error: any) {
      console.error('spans.ts POST: Error in OTLP HTTP endpoint:', error);
      if (isConnectionError(error)) {
        reply.code(503).send({
          code: 14, // UNAVAILABLE
          message: 'Elasticsearch service unavailable',
        });
        return;
      }
      // Bad data - return 400 per OTLP spec
      reply.code(400).send({
        code: 3, // INVALID_ARGUMENT
        message: error.message || 'Invalid request data',
      });
    }
  });

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
    const limit = parseInt((request.query as any).limit || '100');
    const offset = parseInt((request.query as any).offset || '0');
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

    // If query is blank, add parentSpanId:unset to get root spans only
    const searchQuery = new SearchQuery(query?.trim() || 'parentSpanId:unset');

    // Pass sourceFields to Elasticsearch for efficient field filtering at the source
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

