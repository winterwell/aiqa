import { FastifyInstance } from 'fastify';
import { bulkInsertExamples, searchExamples, getExample, updateExample, deleteExample, updateSpan } from '../db/db_es.js';
import { authenticate, AuthenticatedRequest } from '../server_auth.js';
import SearchQuery from '../common/SearchQuery.js';
import Example from '../common/types/Example.js';
import { checkAccessDeveloper, parseSearchQuery, send404 } from './route_helpers.js';

/**
 * Clean spans for use in examples by:
 * 1. Removing resource attributes from span.attributes (they belong in resource.attributes)
 * 2. Stripping spans to minimal fields needed for experiments: name, attributes.input, id, parent_span_id
 * 
 * Note: Supports objects and arrays in attributes (e.g., attributes.input can be an object)
 */
function cleanSpanForExample(span: any): any {
	// Get resource attributes to remove from span.attributes
	const resourceAttrs = span.resource?.attributes || {};
	
	// Common resource attribute prefixes (OpenTelemetry semantic conventions)
	const resourceAttributePrefixes = [
		'telemetry.sdk.',
		'service.',
		'deployment.',
		'cloud.',
		'container.',
		'host.',
		'os.',
		'process.',
		'device.',
	];
	
	// Check if a key is a resource attribute
	const isResourceAttribute = (key: string): boolean => {
		// Check if it exists in resource.attributes
		if (key in resourceAttrs) {
			return true;
		}
		// Check if it matches known resource attribute patterns
		return resourceAttributePrefixes.some(prefix => key.startsWith(prefix));
	};
	
	// Clean span attributes - remove resource attributes but keep all values (including objects/arrays)
	const cleanedAttrs: Record<string, any> = {};
	if (span.attributes) {
		for (const [key, value] of Object.entries(span.attributes)) {
			// Skip resource attributes (they're already in resource.attributes)
			if (!isResourceAttribute(key)) {
				cleanedAttrs[key] = value; // Keep all values including objects/arrays
			}
		}
	}
	
	// Get id from various possible locations (id is standard, spanId is legacy fallback)
	const id = span.id || span.spanId || span.client_span_id || span.span?.id || (span as any).clientSpanId;
	
	// Get parent_span_id from various possible locations
	const parentSpanId = span.parent_span_id || (span as any).parentSpanId || span.span?.parent?.id;
	
	// Strip span to minimal fields: name, attributes (with input), id, parent_span_id
	return {
		id: id,
		name: span.name || '',
		attributes: cleanedAttrs,
    ...(span.client_span_id && { client_span_id: span.client_span_id }),
		...(parentSpanId && { parent_span_id: parentSpanId }),
	};
}

/**
 * Register example endpoints with Fastify
 */
export async function registerExampleRoutes(fastify: FastifyInstance): Promise<void> {
  
  /** create an Example */ 
  // Security: Authenticated users only. Organisation set from authenticate middleware (request.organisation). Examples stored with organisation field.
  fastify.post('/example', { preHandler: authenticate }, async (request: AuthenticatedRequest, reply) => {
    if (!checkAccessDeveloper(request, reply)) return;
    const organisation = request.organisation!;
    const example = request.body as Example;
    // user can specify an id if they wish -- check it is a valid UUID. Or we will create one for them.
    // Important: ES must use the id as the document _id.
    // Strip empty id strings (defensive: clients may send empty strings instead of omitting the field)
    if (example.id === "") {
      delete example.id;
    }
    if (example.id) {
      // Validate UUID format (RFC 4122)
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(example.id)) {
        reply.code(400).send({ error: 'id must be a valid UUID if provided' });
        return;
      }
    }

    // Validate dataset is present
    if (!example.dataset) {
      reply.code(400).send({ error: 'dataset is required for example documents' });
      return;
    }
    
    // Check for duplicates: same trace_id + dataset combination
    if (example.trace_id) {
      // Build a search query for trace_id AND dataset
      let searchQuery = SearchQuery.setProp(null, 'trace_id', example.trace_id);
      searchQuery = SearchQuery.setProp(searchQuery, 'dataset', example.dataset);
      
      const existing = await searchExamples(searchQuery, organisation, example.dataset, 1, 0);
      if (existing.total > 0) {
        reply.code(409).send({ 
          error: `Example with trace_id "${example.trace_id}" and dataset "${example.dataset}" already exists` 
        });
        return;
      }
    }
    
    // Add organisation and timestamps
    const now = new Date();
    // Clean spans if present
    let cleanedSpans = example.spans;
    if (Array.isArray(cleanedSpans)) {
      cleanedSpans = cleanedSpans.map(span => cleanSpanForExample(span));
    }
    
    const exampleWithOrg = {
      ...example,
      spans: cleanedSpans,
      organisation,
      created: example.created || now,
      updated: example.updated || now,
    };

    const exampleIdObjects = (await bulkInsertExamples([exampleWithOrg]));
    const exampleId = exampleIdObjects[0].id;
    exampleWithOrg.id = exampleId;
    
    // Extract span IDs from original spans (before cleaning)
    if (Array.isArray(example.spans) && example.spans.length > 0) {
      const spanIds: string[] = [];
      for (const span of example.spans) {
        // Get id from various possible locations (id is standard, spanId is legacy fallback)
        const spanId = span.id || span.spanId || span.client_span_id || span.span?.id || (span as any).clientSpanId;
        if (spanId) {
          spanIds.push(spanId);
        }
      }
      
      // Update each span with example.id
      for (const spanId of spanIds) {
        try {
          await updateSpan(spanId, { example: exampleId }, organisation);
        } catch (error) {
          // Log but don't fail - span might not exist or might belong to different org
          console.warn(`Failed to update span ${spanId} with example.id ${exampleId}:`, error);
        }
      }
    }
    
    return exampleWithOrg;
  }); // end create example

  /** Get a set of examples eg to run an experiment, or for the webapp to display a list */
  // Security: Authenticated users only. Organisation membership verified by authenticate middleware. Results filtered by organisationId in Elasticsearch (searchExamples).
  fastify.get('/example', { preHandler: authenticate }, async (request: AuthenticatedRequest, reply) => {
    if (!checkAccessDeveloper(request, reply)) return;
    const organisationId = request.organisation;
    if (!organisationId) {
      reply.code(400).send({ error: 'organisation query parameter is required and user must be a member' });
      return;
    }
    const datasetId = (request.query as any).dataset as string | undefined;
    const limit = parseInt((request.query as any).limit || '100');
    const offset = parseInt((request.query as any).offset || '0');

    const searchQuery = parseSearchQuery(request);
    const result = await searchExamples(searchQuery, organisationId, datasetId, limit, offset);
    
    return {
      hits: result.hits,
      total: result.total,
      limit,
      offset,
    };
  });

  /** get a specific example */
  // Security: Authenticated users only. Organisation membership verified by authenticate middleware. Example filtered by organisationId.
  fastify.get('/example/:id', { preHandler: authenticate }, async (request: AuthenticatedRequest, reply) => {
    if (!checkAccessDeveloper(request, reply)) return;
    const organisationId = request.organisation;
    if (!organisationId) {
      reply.code(400).send({ error: 'organisation query parameter is required and user must be a member' });
      return;
    }
    const { id } = request.params as { id: string };
    const example = await getExample(id, organisationId);
    if (!example) {
      send404(reply, 'Example');
      return;
    }
    return example;
  });

  // Security: Authenticated users only. Organisation membership verified by authenticate middleware. Example filtered by organisationId.
  fastify.put('/example/:id', { preHandler: authenticate }, async (request: AuthenticatedRequest, reply) => {
    if (!checkAccessDeveloper(request, reply)) return;
    const organisationId = request.organisation;
    if (!organisationId) {
      reply.code(400).send({ error: 'organisation query parameter is required and user must be a member' });
      return;
    }
    const { id } = request.params as { id: string };
    const updates = request.body as Partial<Example>;
    
    const updatedExample = await updateExample(id, updates, organisationId);
    if (!updatedExample) {
      send404(reply, 'Example');
      return;
    }
    return updatedExample;
  });

  // Security: Authenticated users only. Organisation membership verified by authenticate middleware. Example filtered by organisationId.
  fastify.delete('/example/:id', { preHandler: authenticate }, async (request: AuthenticatedRequest, reply) => {
    if (!checkAccessDeveloper(request, reply)) return;
    const organisationId = request.organisation;
    if (!organisationId) {
      reply.code(400).send({ error: 'organisation query parameter is required and user must be a member' });
      return;
    }
    const { id } = request.params as { id: string };
    
    const deleted = await deleteExample(id, organisationId);
    if (!deleted) {
      send404(reply, 'Example');
      return;
    }
    return { success: true };
  });
}

