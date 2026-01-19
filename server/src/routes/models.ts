import { FastifyInstance } from 'fastify';
import {
  createModel,
  getModel,
  listModels,
  deleteModel,
} from '../db/db_sql.js';
import { authenticate, AuthenticatedRequest, checkAccess } from '../server_auth.js';
import { checkAccessDeveloperOrAdmin, getOrganisationId, parseSearchQuery, send404 } from './route_helpers.js';

/**
 * Mask API key: return first 4 chars + **** + last 4 chars
 */
function maskApiKey(apiKey: string): string {
  if (!apiKey || apiKey.length < 8) {
    return '****';
  }
  return `${apiKey.substring(0, 4)}****${apiKey.substring(apiKey.length - 4)}`;
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
    
    if (!body.api_key) {
      reply.code(400).send({ error: 'api_key is required' });
      return;
    }
    
    const model = await createModel({
      organisation: organisationId,
      provider: body.provider,
      name: body.name,
      api_key: body.api_key,
      version: body.version,
      description: body.description,
    });
    
    // Mask the API key in the response
    const response = { ...model, api_key_sig: maskApiKey(model.api_key), api_key: undefined };
    return response;
  });

  // Security: Authenticated users only. Organisation membership verified by authenticate middleware.
  // Returns api_key_sig by default. Returns full api_key if fields=api_key parameter is sent AND requester has developer/admin role.
  fastify.get('/model/:id', { preHandler: authenticate }, async (request: AuthenticatedRequest, reply) => {
    const { id } = request.params as { id: string };
    const model = await getModel(id);
    
    if (!model) {
      send404(reply, 'Model');
      return;
    }
    
    // Check organisation membership
    if (!checkAccess(request, reply, ['developer', 'admin'], model.organisation)) return;
    
    // Check if requester wants full api_key (must have developer/admin role)
    const fields = (request.query as any).fields as string | undefined;
    const includeApiKey = fields === 'api_key';
    
    if (includeApiKey) {
      // Already checked access above, so return full model
      return model;
    }
    
    // Return masked API key
    const response = { ...model, api_key_sig: maskApiKey(model.api_key), api_key: undefined };
    return response;
  });

  // Security: Authenticated users only. Organisation membership verified by authenticate middleware. Results filtered by organisationId in database.
  fastify.get('/model', { preHandler: authenticate }, async (request: AuthenticatedRequest, reply) => {
    const organisationId = getOrganisationId(request, reply);
    if (!organisationId) return;
    
    // Check access (must be developer/admin)
    if (!checkAccessDeveloperOrAdmin(request, reply)) return;
    
    // Check if requester wants full api_key
    const fields = (request.query as any).fields as string | undefined;
    const includeApiKey = fields === 'api_key';
    
    const searchQuery = parseSearchQuery(request);
    const models = await listModels(organisationId, searchQuery);
    
    // Mask API keys unless explicitly requested
    if (!includeApiKey) {
      return models.map(model => ({
        ...model,
        api_key_sig: maskApiKey(model.api_key),
        api_key: undefined,
      }));
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

