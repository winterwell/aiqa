import { FastifyInstance } from 'fastify';
import {
  createDataset,
  getDataset,
  listDatasets,
  updateDataset,
  deleteDataset,
} from '../db/db_sql.js';
import { authenticate, AuthenticatedRequest } from '../server_auth.js';
import { checkAccessDeveloper, getOrganisationId, parseSearchQuery, send400, send404, validateUuid } from './route_helpers.js';

/**
 * Register dataset endpoints with Fastify
 */
export async function registerDatasetRoutes(fastify: FastifyInstance): Promise<void> {
  // Security: Authenticated users only. Organisation membership verified by authenticate middleware when organisation query param provided.
  fastify.post('/dataset', { preHandler: authenticate }, async (request: AuthenticatedRequest, reply) => {
    if (!checkAccessDeveloper(request, reply)) return;
    const organisationId = getOrganisationId(request, reply);
    if (!organisationId) return;
    const dataset = await createDataset(request.body as any);
    return dataset;
  });

  // Security: Authenticated users only. No organisation check - any authenticated user can view any dataset by ID.
  fastify.get('/dataset/:id', { preHandler: authenticate }, async (request: AuthenticatedRequest, reply) => {
    if (!checkAccessDeveloper(request, reply)) return;
    const { id } = request.params as { id: string };
    if (!validateUuid(id, reply)) {
      send400(reply, 'Invalid UUID format');
      return;
    }
    const dataset = await getDataset(id);
    if (!dataset) {
      send404(reply, 'Dataset');
      return;
    }
    return dataset;
  });

  // Security: Authenticated users only. Organisation membership verified by authenticate middleware. Results filtered by organisationId in database (listDatasets).
  fastify.get('/dataset', { preHandler: authenticate }, async (request: AuthenticatedRequest, reply) => {
    if (!checkAccessDeveloper(request, reply)) return;
    const organisationId = getOrganisationId(request, reply);
    if (!organisationId) return;
    const searchQuery = parseSearchQuery(request);
    const datasets = await listDatasets(organisationId, searchQuery);
    return datasets;
  });

  // Security: Authenticated users only. No organisation check - any authenticated user can update any dataset by ID.
  fastify.put('/dataset/:id', { preHandler: authenticate }, async (request: AuthenticatedRequest, reply) => {
    if (!checkAccessDeveloper(request, reply)) return;
    const { id } = request.params as { id: string };
    if (!validateUuid(id, reply)) {
      send400(reply, 'Invalid UUID format');
      return;
    }
    const dataset = await updateDataset(id, request.body as any);
    if (!dataset) {
      send404(reply, 'Dataset');
      return;
    }
    return dataset;
  });

  // Security: Authenticated users only. No organisation check - any authenticated user can delete any dataset by ID.
  fastify.delete('/dataset/:id', { preHandler: authenticate }, async (request: AuthenticatedRequest, reply) => {
    if (!checkAccessDeveloper(request, reply)) return;
    const { id } = request.params as { id: string };
    if (!validateUuid(id, reply)) {
      send400(reply, 'Invalid UUID format');
      return;
    }
    const deleted = await deleteDataset(id);
    if (!deleted) {
      send404(reply, 'Dataset');
      return;
    }
    return { success: true };
  });
}

