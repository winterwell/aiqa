import { FastifyReply } from 'fastify';
import { AuthenticatedRequest, checkAccess, isSuperAdmin } from '../server_auth.js';
import { getOrganisation } from '../db/db_sql.js';
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
 * Check if user has access to organisation (super admin or member).
 * Returns { isSuper, isMember, org } if access granted, null if denied (and reply sent).
 */
export async function checkOrganisationAccess(
	request: AuthenticatedRequest,
	reply: FastifyReply,
	organisationId: string
): Promise<{ isSuper: boolean; isMember: boolean; org: any } | null> {
	if (!request.userId) {
		reply.code(401).send({ error: 'User ID not found in authenticated request' });
		return null;
	}

	const isSuper = await isSuperAdmin(request.userId);
	const org = await getOrganisation(organisationId);
	if (!org) {
		reply.code(404).send({ error: 'Organisation not found' });
		return null;
	}

	const isMember = org.members.includes(request.userId);
	if (!isSuper && !isMember) {
		reply.code(403).send({ error: 'Access denied. Must be super admin or organisation member' });
		return null;
	}

	return { isSuper, isMember, org };
}

/**
 * Get price per month for a plan type.
 */
export function getPlanPrice(planType: 'free' | 'pro' | 'enterprise', noPaymentNeeded: boolean, customPrice?: number): number {
	if (planType === 'enterprise' && customPrice !== undefined) {
		return customPrice;
	}
	if (noPaymentNeeded || planType === 'free') {
		return 0;
	}
	const priceMap: Record<string, number> = {
		free: 0,
		pro: parseFloat(process.env.STRIPE_PRICE_PRO || '29'),
	};
	return priceMap[planType] || 0;
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

