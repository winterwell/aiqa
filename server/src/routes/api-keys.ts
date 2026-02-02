import { FastifyInstance } from 'fastify';
import {
  createApiKey,
  getApiKey,
  listApiKeys,
  updateApiKey,
  deleteApiKey,
} from '../db/db_sql.js';
import { authenticate, AuthenticatedRequest, checkAccess } from '../server_auth.js';
import { checkAccessDeveloper, getOrganisationId, parseSearchQuery, send404 } from './route_helpers.js';

/**
 * Register API key endpoints with Fastify
 */
export async function registerApiKeyRoutes(fastify: FastifyInstance): Promise<void> {
  // Security: Authenticated users only. Organisation membership verified by authenticate middleware when organisation query param provided. Only accepts hash (not plaintext).
  fastify.post('/api-key', { preHandler: authenticate }, async (request: AuthenticatedRequest, reply) => {
    if (!checkAccessDeveloper(request, reply)) return;
    const body = request.body as any;
    const hash = body.hash ?? body.key_hash;
    const keyEnd = body.keyEnd ?? body.key_end;

    // Ensure we only accept hash, not key (security: frontend should hash before sending)
    if (body.key) {
      reply.code(400).send({ error: 'Cannot accept plaintext key. Send hash instead.' });
      return;
    }

    if (!hash) {
      reply.code(400).send({ error: 'hash is required' });
      return;
    }

    const apiKey = await createApiKey({
      organisation: body.organisation,
      name: body.name,
      hash,
      keyEnd,
      role: body.role || 'developer',
    });
    
    return apiKey;
  });

  // Security: Authenticated users only. No organisation check - any authenticated user can view any API key by ID.
  fastify.get('/api-key/:id', {preHandler: authenticate}, async (request: AuthenticatedRequest, reply) => {
    if (!checkAccessDeveloper(request, reply)) return;
    const { id } = request.params as { id: string };
    const apiKey = await getApiKey(id);
    if (!apiKey) {
      send404(reply, 'API key');
      return;
    }
    return apiKey;
  });

  // Security: Authenticated users only. Organisation membership verified by authenticate middleware. Results filtered by organisationId in database (listApiKeys).
  fastify.get('/api-key', { preHandler: authenticate }, async (request: AuthenticatedRequest, reply) => {
    if (!checkAccessDeveloper(request, reply)) return;
    const organisationId = request.organisation;
    if (!organisationId) {
      reply.code(400).send({ error: 'organisation query parameter is required' });
      return;
    }
    const searchQuery = parseSearchQuery(request);
    const apiKeys = await listApiKeys(organisationId, searchQuery);
    return apiKeys;
  });

  // Security: Authenticated users only. No organisation check - any authenticated user can update any API key by ID.
  fastify.put('/api-key/:id', { preHandler: authenticate }, async (request: AuthenticatedRequest, reply) => {
    if (!checkAccessDeveloper(request, reply)) return;
    const { id } = request.params as { id: string };
    const apiKey = await updateApiKey(id, request.body as any);
    if (!apiKey) {
      send404(reply, 'API key');
      return;
    }
    return apiKey;
  });

  // Security: Authenticated users only. User must be a member of the organisation that owns the API key.
  fastify.delete('/api-key/:id', { preHandler: authenticate }, async (request: AuthenticatedRequest, reply) => {
    const { id } = request.params as { id: string };
    
    // Get the API key to find its organisation
    const apiKey = await getApiKey(id);
    if (!apiKey) {
      send404(reply, 'API key');
      return;
    }
    
    // Check access and organisation membership
    if (!checkAccess(request, reply, ['developer', 'admin'], apiKey.organisation)) return;
    
    const deleted = await deleteApiKey(id);
    if (!deleted) {
      send404(reply, 'API key');
      return;
    }
    return { success: true };
  });
}

