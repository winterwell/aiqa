import { FastifyInstance } from 'fastify';
import { bulkInsertSpans, searchSpans, updateSpan } from '../db/db_es.js';
import { authenticate, AuthenticatedRequest, checkAccess } from '../server_auth.js';
import SearchQuery from '../common/SearchQuery.js';
import Span from '../common/types/Span.js';
import { addTokenCost } from '../token_cost.js';

/**
 * Register span endpoints with Fastify
 */
export async function registerSpanRoutes(fastify: FastifyInstance): Promise<void> {
  // ===== SPAN ENDPOINTS (ElasticSearch) =====
  // Security: Authenticated users only. Organisation set from authenticate middleware (request.organisation). Spans stored with organisation field.
  fastify.post('/span', { preHandler: authenticate }, async (request: AuthenticatedRequest, reply) => {
    if (!checkAccess(request, reply, ['trace', 'developer', 'admin'])) return;
    const organisation = request.organisation!;
    const spans = request.body as Span | Span[];

    const spansArray = Array.isArray(spans) ? spans : [spans];
    
    // Add organisation to each span
    const spansWithOrg = spansArray.map(span => ({
      ...span,
      organisation,
    }));
    console.log("inserting: "+spansWithOrg.length+" spans");
    // TODO rate limit check
    // Add token cost (must be called on spansWithOrg so cost attributes are included when saving)
    spansWithOrg.forEach(span => addTokenCost(span));
    // save
    try {
      await bulkInsertSpans(spansWithOrg);
      return { success: true, count: spansWithOrg.length };
    } catch (error: any) {
      if (error.name === 'ConnectionError' || error.message?.includes('ConnectionError')) {
        reply.code(503).send({ error: 'Elasticsearch service unavailable. Please check if Elasticsearch is running.' });
        return;
      }
      throw error;
    }
  });

  /**
   * Query spans ie Traces
   * 
   * Query parameters:
   * - organisation: required - organisation ID
   * - q: optional - search query string
   * - limit: optional - max results (default: 100)
   * - offset: optional - pagination offset (default: 0)
   * - fields: optional - comma-separated list of fields to include.
   * - exclude: optional - comma-separated list of fields to exclude.
   * Security: Authenticated users only. Organisation membership verified by authenticate middleware. Results filtered by organisationId in Elasticsearch (searchSpans).
   */
  fastify.get('/span', { preHandler: authenticate }, async (request: AuthenticatedRequest, reply) => {
    if (!checkAccess(request, reply, ['developer', 'admin'])) return;
    const organisationId = (request.query as any).organisation as string | undefined;
    if (!organisationId) {
      reply.code(400).send({ error: 'organisation query parameter is required' });
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

