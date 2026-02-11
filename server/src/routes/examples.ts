import { FastifyInstance } from 'fastify';
import { randomUUID } from 'crypto';
import { bulkInsertExamples, searchExamples, getExample, updateExample, deleteExample, updateSpan } from '../db/db_es.js';
import { authenticate, AuthenticatedRequest } from '../server_auth.js';
import SearchQuery from '../common/SearchQuery.js';
import Example from '../common/types/Example.js';
import { checkAccessDeveloper, parseSearchQuery, send404 } from './route_helpers.js';
import { getSpanId, getParentSpanId } from '../common/types/Span.js';

/**
 * Clean spans for use in examples by:
 * 1. Removing resource attributes from span.attributes (they belong in resource.attributes)
 * 2. Stripping spans to minimal fields needed for experiments: name, attributes.input, id, parent
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
	
	
	const id = getSpanId(span);
	const parent = getParentSpanId(span);

	return {
		id,
		name: span.name || '',
		attributes: cleanedAttrs,
		...(parent !== undefined && parent !== '' && { parent }),
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
    // id is required for examples - generate one if falsy
    // Important: ES must use the id as the document _id.
    // Strip empty id strings (defensive: clients may send empty strings instead of omitting the field)
    if (example.id === "") {
      delete example.id;
    }
    // Generate UUID if id is falsy (undefined, null, empty string, etc.)
    if (!example.id) {
      example.id = randomUUID();
    } else {
      // Validate UUID format (RFC 4122) if provided
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
    
    // Check for duplicates: same trace + dataset combination
    if (example.trace) {
      // Build a search query for trace AND dataset
      let searchQuery = SearchQuery.setProp(null, 'trace', example.trace);
      searchQuery = SearchQuery.setProp(searchQuery, 'dataset', example.dataset);

      const existing = await searchExamples(searchQuery, organisation, example.dataset, 1, 0);
      if (existing.total > 0) {
        reply.code(409).send({
          error: `Example with trace "${example.trace}" and dataset "${example.dataset}" already exists`
        });
        return;
      }
    }
    
    // Add organisation and timestamps
    const now = new Date();
    // Clean spans if present; require canonical shape (id required per span)
    let cleanedSpans = example.spans;
    if (Array.isArray(cleanedSpans)) {
      const missingId = cleanedSpans.find((s: any) => !s.id);
      if (missingId) {
        reply.code(400).send({ error: 'Each span in example.spans must have an id' });
        return;
      }
      cleanedSpans = cleanedSpans.map(span => cleanSpanForExample(span));
    }

    const exampleWithOrg = {
      ...example,
      spans: cleanedSpans,
      organisation,
      created: example.created || now,
      updated: example.updated || now,
    };

    await bulkInsertExamples([exampleWithOrg]);
    
    // Extract span IDs from original spans (before cleaning)
    if (Array.isArray(example.spans) && example.spans.length > 0) { 
      // Update each span with example.id (if unset)
      for (const span of example.spans) {
        if (span.attributes?.['aiqa.example']) {
          continue;
        }
        const spanId = getSpanId(span);
        try {
          console.log(`Updating span ${spanId} with example.id ${exampleWithOrg.id}`);
          const newAttributes = { ...span.attributes, 'aiqa.example': exampleWithOrg.id };
          await updateSpan(spanId, {  attributes: newAttributes }, organisation);
        } catch (error) {
          // Log but don't fail - span might not exist or might belong to different org
          console.warn(`Failed to update span ${spanId} with example.id ${exampleWithOrg.id}:`, error);
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

