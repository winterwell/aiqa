import { FastifyInstance } from 'fastify';
import { bulkInsertSpans, searchSpans, updateSpan } from '../db/db_es.js';
import { authenticate, AuthenticatedRequest, checkAccess } from '../server_auth.js';
import SearchQuery from '../common/SearchQuery.js';
import Span from '../common/types/Span.js';
import { addTokenCost } from '../token_cost.js';
import { checkRateLimit, recordSpanPosting } from '../rate_limit.js';
import { getOrganisation, getOrganisationAccountByOrganisation } from '../db/db_sql.js';
import { getOrganisationThreshold } from '../common/subscription_defaults.js';

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
    const resourceAttributes = resource.attributes || [];
    
    // Convert resource attributes from keyValue array to object
    const resourceAttrs: Record<string, any> = {};
    for (const kv of resourceAttributes) {
      if (kv.key && kv.value) {
        resourceAttrs[kv.key] = convertOtlpValue(kv.value);
      }
    }
    
    const scopeSpans = resourceSpan.scopeSpans || [];
    for (const scopeSpan of scopeSpans) {
      const scope = scopeSpan.scope || {};
      const spans = scopeSpan.spans || [];
      
      for (const otlpSpan of spans) {
        // Convert span attributes
        const attributes: Record<string, any> = {};
        if (otlpSpan.attributes) {
          for (const kv of otlpSpan.attributes) {
            if (kv.key && kv.value) {
              attributes[kv.key] = convertOtlpValue(kv.value);
            }
          }
        }
        
        // Merge resource attributes into span attributes
        Object.assign(attributes, resourceAttrs);
        
        // Convert events
        const events = (otlpSpan.events || []).map((event: any) => {
          const eventAttrs: Record<string, any> = {};
          if (event.attributes) {
            for (const kv of event.attributes) {
              if (kv.key && kv.value) {
                eventAttrs[kv.key] = convertOtlpValue(kv.value);
              }
            }
          }
          return {
            name: event.name || '',
            time: event.timeUnixNano ? convertUnixNanoToMillis(event.timeUnixNano) : 0,
            attributes: eventAttrs,
          };
        });
        
        // Convert links
        const links = (otlpSpan.links || []).map((link: any) => {
          const linkAttrs: Record<string, any> = {};
          if (link.attributes) {
            for (const kv of link.attributes) {
              if (kv.key && kv.value) {
                linkAttrs[kv.key] = convertOtlpValue(kv.value);
              }
            }
          }
          return {
            context: {
              traceId: link.traceId ? bytesToHex(link.traceId) : '',
              spanId: link.spanId ? bytesToHex(link.spanId) : '',
            },
            attributes: linkAttrs,
          };
        });
        
        // Convert trace ID and span ID from bytes to hex
        const traceId = otlpSpan.traceId ? bytesToHex(otlpSpan.traceId) : '';
        const spanId = otlpSpan.spanId ? bytesToHex(otlpSpan.spanId) : '';
        const parentSpanId = otlpSpan.parentSpanId ? bytesToHex(otlpSpan.parentSpanId) : undefined;
        
        // Convert times
        const startTime = otlpSpan.startTimeUnixNano ? convertUnixNanoToMillis(otlpSpan.startTimeUnixNano) : 0;
        const endTime = otlpSpan.endTimeUnixNano ? convertUnixNanoToMillis(otlpSpan.endTimeUnixNano) : null;
        const duration = endTime !== null ? endTime - startTime : null;
        
        // Convert status
        const status = otlpSpan.status || {};
        const statusCode = status.code !== undefined ? status.code : 0;
        
        internalSpans.push({
          name: otlpSpan.name || '',
          kind: otlpSpan.kind !== undefined ? otlpSpan.kind : 0,
          parentSpanId: parentSpanId,
          startTime: startTime,
          endTime: endTime,
          status: {
            code: statusCode,
            message: status.message || undefined,
          },
          attributes: attributes,
          links: links,
          events: events,
          resource: {
            attributes: resourceAttrs,
          },
          traceId: traceId,
          spanId: spanId,
          traceFlags: otlpSpan.flags !== undefined ? otlpSpan.flags : 0,
          duration: duration,
          ended: endTime !== null,
          instrumentationLibrary: {
            name: scope.name || '',
            version: scope.version || undefined,
          },
          starred: false,
        });
      }
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
    // Return bytes as base64 string
    return Buffer.from(value.bytesValue, 'base64').toString('base64');
  }
  return null;
}

/**
 * Convert bytes (base64 or Uint8Array) to hex string.
 */
function bytesToHex(bytes: any): string {
  if (typeof bytes === 'string') {
    // Assume base64
    return Buffer.from(bytes, 'base64').toString('hex');
  }
  if (Array.isArray(bytes)) {
    return Buffer.from(bytes).toString('hex');
  }
  if (bytes instanceof Uint8Array) {
    return Buffer.from(bytes).toString('hex');
  }
  return '';
}

/**
 * Convert Unix nanoseconds to epoch milliseconds.
 */
function convertUnixNanoToMillis(unixNano: string | number): number {
  const nano = typeof unixNano === 'string' ? parseInt(unixNano, 10) : unixNano;
  return Math.floor(nano / 1_000_000);
}

/**
 * Register span endpoints with Fastify
 */
export async function registerSpanRoutes(fastify: FastifyInstance): Promise<void> {
  
  // ===== OTLP ENDPOINT =====
  // OTLP HTTP endpoint at /v1/traces following OpenTelemetry Protocol specification
  // Accepts ExportTraceServiceRequest (JSON encoding) and returns ExportTraceServiceResponse
  fastify.post('/v1/traces', { preHandler: authenticate }, async (request: AuthenticatedRequest, reply) => {
    if (!checkAccess(request, reply, ['trace', 'developer', 'admin'])) return;
    const organisation = request.organisation!;
    
    try {
      const otlpRequest = request.body as any;
      
      // Convert OTLP spans to internal format
      const spansArray = convertOtlpSpansToInternal(otlpRequest);
      
      if (spansArray.length === 0) {
        // Empty request - return success per OTLP spec
        reply.code(200).send({});
        return;
      }
      
      // Get organisation account to check rate limit
      const account = await getOrganisationAccountByOrganisation(organisation);
      const rateLimitPerHour = account ? getOrganisationThreshold(account, 'rate_limit_per_hour') ?? 1000 : 1000;
      
      // Check rate limit before processing
      const rateLimitResult = await checkRateLimit(organisation, rateLimitPerHour);
      if (rateLimitResult && !rateLimitResult.allowed) {
        reply.code(429).send({
          code: 14, // UNAVAILABLE per gRPC status codes (OTLP uses gRPC status codes)
          message: 'Rate limit exceeded',
        });
        return;
      }
      
      // Add organisation to each span
      const spansWithOrg = spansArray.map(span => ({
        ...span,
        organisation,
      }));
      
      // Add token cost
      spansWithOrg.forEach(span => addTokenCost(span));
      
      // Save spans
      await bulkInsertSpans(spansWithOrg);
      await recordSpanPosting(organisation, spansWithOrg.length);
      
      // Return OTLP success response (empty ExportTraceServiceResponse)
      reply.code(200).send({});
      
    } catch (error: any) {
      if (error.name === 'ConnectionError' || error.message?.includes('ConnectionError')) {
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
    console.log("organisationId", organisationId);
    const query = (request.query as any).q as string | undefined;  
    const limit = parseInt((request.query as any).limit || '100');
    const offset = parseInt((request.query as any).offset || '0');
    const fieldsParam = (request.query as any).fields as string | undefined;
	const excludeFieldsParam = (request.query as any).exclude as string | undefined;

    // Parse fields parameter for Elasticsearch _source filtering. Exclude attributes and unindexed_attributes by default if not specified.
    let _source_includes: string[] | null | undefined = undefined;
    let _source_excludes: string[] | null | undefined = undefined;
    
    // Handle fields="*" first - this means include all fields, no exclusions
    if (fieldsParam === "*") {
      _source_includes = undefined;
      _source_excludes = undefined;
    } else {
      // Parse fields parameter
      if (fieldsParam) {
        _source_includes = fieldsParam.split(',').map(f => f.trim()).filter(f => f.length > 0);
      }
      
      // Parse exclude parameter
      if (excludeFieldsParam) {
        _source_excludes = excludeFieldsParam.split(',').map(f => f.trim()).filter(f => f.length > 0);
      }
      
      // Default: exclude attributes and unindexed_attributes if neither fields nor exclude is specified
      if (!fieldsParam && !excludeFieldsParam) {
        _source_excludes = ['attributes', 'unindexed_attributes'];
      }
    }

    // If query is blank, add parentSpanId:unset to get root spans only
    let searchQuery: SearchQuery | null = null;
    if (query && query.trim().length > 0) {
      searchQuery = new SearchQuery(query);
    } else {
      // Query is blank or empty - add parentSpanId:unset to get root spans only (to avoid returning big data unless explicitly requested)
      searchQuery = new SearchQuery('parentSpanId:unset');
    }

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
      if (error.name === 'ConnectionError' || error.message?.includes('ConnectionError')) {
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

    // Validate that updates only contain allowed fields (for now, just starred)
    const allowedFields = ['starred'];
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
      if (error.name === 'ConnectionError' || error.message?.includes('ConnectionError')) {
        reply.code(503).send({ error: 'Elasticsearch service unavailable. Please check if Elasticsearch is running.' });
        return;
      }
      throw error;
    }
  });
}

