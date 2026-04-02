import { FastifyInstance } from 'fastify';
import {
  createDataset,
  getDataset,
  listDatasets,
  updateDataset,
  deleteDataset,
  listDatasetIdsForOrganisation,
  countExperimentsByDatasetForOrganisation,
} from '../db/db_sql.js';
import { aggregateExampleCountsByDatasetForOrganisation } from '../db/db_es.js';
import { authenticate, AuthenticatedRequest } from '../server_auth.js';
import { checkAccessDeveloper, getOrganisationId, parseSearchQuery, send400, send404, validateUuid } from './route_helpers.js';

type DatasetStatsEntry = { examples: number; experiments: number };

async function buildDatasetStatsMap(organisationId: string): Promise<Record<string, DatasetStatsEntry>> {
  const [datasetIds, examplesByDataset, experimentsByDataset] = await Promise.all([
    listDatasetIdsForOrganisation(organisationId),
    aggregateExampleCountsByDatasetForOrganisation(organisationId),
    countExperimentsByDatasetForOrganisation(organisationId),
  ]);
  const out: Record<string, DatasetStatsEntry> = {};
  for (const id of datasetIds) {
    out[id] = {
      examples: examplesByDataset[id] ?? 0,
      experiments: experimentsByDataset[id] ?? 0,
    };
  }
  return out;
}

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

  // Security: Authenticated users only. Organisation-scoped; uses ES aggregation + SQL counts (no full example/experiment loads).
  // Registered before GET /dataset/:id so "stats" is not parsed as a UUID.
  fastify.get('/dataset/stats', { preHandler: authenticate }, async (request: AuthenticatedRequest, reply) => {
    if (!checkAccessDeveloper(request, reply)) return;
    const organisationId = getOrganisationId(request, reply);
    if (!organisationId) return;
    return buildDatasetStatsMap(organisationId);
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

