import { FastifyInstance } from 'fastify';
import {
  createReport,
  getReport,
  listReports,
  updateReport,
  deleteReport,
} from '../db/db_sql.js';
import { executeReport } from '../analysis/report_run.js';
import { authenticate, AuthenticatedRequest } from '../server_auth.js';
import { checkAccessDeveloper, getOrganisationId, parseSearchQuery, send400, send404, validateUuid } from './route_helpers.js';

/**
 * Register report endpoints (drift / coverage embedding analysis).
 */
export async function registerReportRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post('/report', { preHandler: authenticate }, async (request: AuthenticatedRequest, reply) => {
    if (!checkAccessDeveloper(request, reply)) return;
    const organisationId = getOrganisationId(request, reply);
    if (!organisationId) return;
    const body = request.body as Record<string, unknown>;
    const kind = body.kind;
    if (kind !== 'drift' && kind !== 'coverage') {
      send400(reply, 'kind must be drift or coverage');
      return;
    }
    const report = await createReport({
      ...body,
      organisation: organisationId,
    } as any);
    return report;
  });

  fastify.get('/report/:id', { preHandler: authenticate }, async (request: AuthenticatedRequest, reply) => {
    if (!checkAccessDeveloper(request, reply)) return;
    const { id } = request.params as { id: string };
    if (!validateUuid(id, reply)) return;
    const report = await getReport(id);
    if (!report) {
      send404(reply, 'Report');
      return;
    }
    return report;
  });

  fastify.get('/report', { preHandler: authenticate }, async (request: AuthenticatedRequest, reply) => {
    if (!checkAccessDeveloper(request, reply)) return;
    const organisationId = getOrganisationId(request, reply);
    if (!organisationId) return;
    const searchQuery = parseSearchQuery(request);
    return listReports(organisationId, searchQuery);
  });

  fastify.put('/report/:id', { preHandler: authenticate }, async (request: AuthenticatedRequest, reply) => {
    if (!checkAccessDeveloper(request, reply)) return;
    const { id } = request.params as { id: string };
    if (!validateUuid(id, reply)) return;
    const report = await updateReport(id, request.body as any);
    if (!report) {
      send404(reply, 'Report');
      return;
    }
    return report;
  });

  fastify.delete('/report/:id', { preHandler: authenticate }, async (request: AuthenticatedRequest, reply) => {
    if (!checkAccessDeveloper(request, reply)) return;
    const { id } = request.params as { id: string };
    if (!validateUuid(id, reply)) return;
    const deleted = await deleteReport(id);
    if (!deleted) {
      send404(reply, 'Report');
      return;
    }
    return { success: true };
  });

  /** Run analysis (loads ES data, writes summary/results). */
  fastify.post('/report/:id/run', { preHandler: authenticate }, async (request: AuthenticatedRequest, reply) => {
    if (!checkAccessDeveloper(request, reply)) return;
    const { id } = request.params as { id: string };
    if (!validateUuid(id, reply)) return;
    const report = await executeReport(id);
    if (!report) {
      send404(reply, 'Report');
      return;
    }
    return report;
  });
}
