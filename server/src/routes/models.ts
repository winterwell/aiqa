import { FastifyInstance } from 'fastify';
import {
  createModel,
  getModel,
  listModels,
  deleteModel,
} from '../db/db_sql.js';
import { authenticate, AuthenticatedRequest, checkAccess } from '../server_auth.js';
import { checkAccessDeveloperOrAdmin, getOrganisationId, parseSearchQuery, send404 } from './route_helpers.js';

/** Mask model key: return first 4 chars + **** + last 4 chars */
function maskKey(key: string): string {
  if (!key || key.length < 8) {
    return '****';
  }
  return `${key.substring(0, 4)}****${key.substring(key.length - 4)}`;
}

/**
 * Register Model endpoints with Fastify
 */
export async function registerModelRoutes(fastify: FastifyInstance): Promise<void> {
  // Security: Authenticated users only. Organisation membership verified by authenticate middleware. Only organisation members/admins can create models.
  fastify.post('/model', { preHandler: authenticate }, async (request: AuthenticatedRequest, reply) => {
    if (!checkAccessDeveloperOrAdmin(request, reply)) return;
    
    const organisationId = getOrganisationId(request, reply);
    if (!organisationId) return;
    
    const body = request.body as any;
    
    if (!body.provider) {
      reply.code(400).send({ error: 'provider is required' });
      return;
    }
    
    if (!body.name) {
      reply.code(400).send({ error: 'name is required' });
      return;
    }
    
    const key = body.key ?? body.api_key;
    if (!key) {
      reply.code(400).send({ error: 'key is required' });
      return;
    }
    
    const model = await createModel({
      organisation: organisationId,
      provider: body.provider,
      name: body.name,
      key,
      version: body.version,
      description: body.description,
    });
    
    const response = { ...model, hash: maskKey(model.key), key: undefined };
    return response;
  });

  // Security: Authenticated users only. Organisation membership verified by authenticate middleware.
  // Returns hash (masked key) by default. Returns full key if fields=key (or fields=api_key for backwards compat) and requester has developer/admin role.
  fastify.get('/model/:id', { preHandler: authenticate }, async (request: AuthenticatedRequest, reply) => {
    const { id } = request.params as { id: string };
    const model = await getModel(id);
    
    if (!model) {
      send404(reply, 'Model');
      return;
    }
    
    if (!checkAccess(request, reply, ['developer', 'admin'], model.organisation)) return;
    
    const fields = (request.query as any).fields as string | undefined;
    const includeKey = fields === 'key' || fields === 'apiKey' || fields === 'api_key';
    
    if (includeKey) {
      return model;
    }
    
    const response = { ...model, hash: maskKey(model.key), key: undefined };
    return response;
  });

  // Security: Authenticated users only. Organisation membership verified by authenticate middleware. Results filtered by organisationId in database.
  fastify.get('/model', { preHandler: authenticate }, async (request: AuthenticatedRequest, reply) => {
    const organisationId = getOrganisationId(request, reply);
    if (!organisationId) return;
    
    // Check access (must be developer/admin)
    if (!checkAccessDeveloperOrAdmin(request, reply)) return;
    
    const fields = (request.query as any).fields as string | undefined;
    const includeKey = fields === 'key' || fields === 'apiKey' || fields === 'api_key';
    
    const searchQuery = parseSearchQuery(request);
    const models = await listModels(organisationId, searchQuery);
    
    if (!includeKey) {
      return models.map(m => ({ ...m, hash: maskKey(m.key), key: undefined }));
    }
    
    return models;
  });

  // Security: Authenticated users only. User must be a member/admin of the organisation that owns the model.
  fastify.delete('/model/:id', { preHandler: authenticate }, async (request: AuthenticatedRequest, reply) => {
    const { id } = request.params as { id: string };
    
    // Get the model to find its organisation
    const model = await getModel(id);
    if (!model) {
      send404(reply, 'Model');
      return;
    }
    
    // Check access and organisation membership
    if (!checkAccess(request, reply, ['developer', 'admin'], model.organisation)) return;
    
    const deleted = await deleteModel(id);
    if (!deleted) {
      send404(reply, 'Model');
      return;
    }
    return { success: true };
  });
}

