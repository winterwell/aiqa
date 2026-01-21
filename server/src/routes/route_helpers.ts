import { FastifyReply } from 'fastify';
import { AuthenticatedRequest, checkAccess } from '../server_auth.js';
import SearchQuery from '../common/SearchQuery.js';

/**
 * Common access check for developer endpoints
 */
export function checkAccessDeveloper(request: AuthenticatedRequest, reply: FastifyReply): boolean {
  return checkAccess(request, reply, ['developer']);
}

/**
 * Common access check for developer/admin endpoints
 */
export function checkAccessDeveloperOrAdmin(request: AuthenticatedRequest, reply: FastifyReply): boolean {
  return checkAccess(request, reply, ['developer', 'admin']);
}

/**
 * Get organisation ID from query params with validation
 */
export function getOrganisationId(request: AuthenticatedRequest, reply: FastifyReply, errorMessage = 'organisation query parameter is required'): string | null {
  const organisationId = (request.query as any).organisation as string | undefined;
  if (!organisationId) {
    reply.code(400).send({ error: errorMessage });
    return null;
  }
  return organisationId;
}

/**
 * Parse search query from request
 */
export function parseSearchQuery(request: AuthenticatedRequest): SearchQuery | null {
  const query = (request.query as any).q as string | undefined;
  return query ? new SearchQuery(query) : null;
}

/**
 * Handle 400 for bad request
 */
export function send400(reply: FastifyReply, errorMessage: string): boolean {
  reply.code(400).send({ error: errorMessage });
  return false;
}
/**
 * Handle 404 for resource not found
 */
export function send404(reply: FastifyReply, resourceName: string): boolean {
  reply.code(404).send({ error: `${resourceName} not found` });
  return false;
}

/**
 * Validate UUID format (RFC 4122)
 */
export function validateUuid(id: string, reply: FastifyReply): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(id)) {
    reply.code(400).send({ error: 'Invalid UUID format' });
    return false;
  }
  return true;
}

