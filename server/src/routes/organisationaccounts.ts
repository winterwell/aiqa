import { FastifyInstance, FastifyReply } from 'fastify';
import {
  getOrganisationAccount,
  getOrganisationAccountByOrganisation,
  createOrganisationAccount,
  updateOrganisationAccount,
  getOrganisation,
  getRateLimitHits,
} from '../db/db_sql.js';
import { authenticate, AuthenticatedRequest, checkAccess, isSuperAdmin } from '../server_auth.js';
import { checkRateLimit } from '../rate_limit.js';
import { getOrganisationThreshold } from '../common/subscription_defaults.js';

/**
 * Register organisation account endpoints with Fastify
 */
export async function registerOrganisationAccountRoutes(fastify: FastifyInstance): Promise<void> {
  
  // Get OrganisationAccount by organisation ID
  // Security: Super admin or organisation members can read
  fastify.get('/organisation/:organisationId/account', { preHandler: authenticate }, async (request: AuthenticatedRequest, reply) => {
    if (!checkAccess(request, reply, ['developer', 'admin'])) return;
    if (!request.userId) {
      reply.code(401).send({ error: 'User ID not found in authenticated request' });
      return;
    }
    const { organisationId } = request.params as { organisationId: string };
    
    // Check if user is super admin or member of organisation
    const isSuper = await isSuperAdmin(request.userId);
    const org = await getOrganisation(organisationId);
    if (!org) {
      reply.code(404).send({ error: 'Organisation not found' });
      return;
    }
    const isMember = org.members.includes(request.userId);
    
    if (!isSuper && !isMember) {
      reply.code(403).send({ error: 'Access denied. Must be super admin or organisation member' });
      return;
    }
    
    let account = await getOrganisationAccountByOrganisation(organisationId);
    if (!account) {
      // Create account if it doesn't exist (with default free subscription)
      account = await createOrganisationAccount({
        organisation: organisationId,
        subscription: {
          type: 'free',
          status: 'active',
          start: new Date(),
          end: null,
          renewal: null,
          pricePerMonth: 0,
          currency: 'USD',
        },
      });
    }
    return account;
  });

  // Get OrganisationAccount by ID
  // Security: Super admin or organisation members can read
  fastify.get('/organisation-account/:id', { preHandler: authenticate }, async (request: AuthenticatedRequest, reply) => {
    if (!checkAccess(request, reply, ['developer', 'admin'])) return;
    if (!request.userId) {
      reply.code(401).send({ error: 'User ID not found in authenticated request' });
      return;
    }
    const { id } = request.params as { id: string };
    
    const account = await getOrganisationAccount(id);
    if (!account) {
      reply.code(404).send({ error: 'OrganisationAccount not found' });
      return;
    }
    
    // Check if user is super admin or member of organisation
    const isSuper = await isSuperAdmin(request.userId);
    const org = await getOrganisation(account.organisation);
    if (!org) {
      reply.code(404).send({ error: 'Organisation not found' });
      return;
    }
    const isMember = org.members.includes(request.userId);
    
    if (!isSuper && !isMember) {
      reply.code(403).send({ error: 'Access denied. Must be super admin or organisation member' });
      return;
    }
    
    return account;
  });

  // Create OrganisationAccount
  // Security: Super admin only
  fastify.post('/organisation-account', { preHandler: authenticate }, async (request: AuthenticatedRequest, reply) => {
    if (!checkAccess(request, reply, ['developer', 'admin'])) return;
    if (!request.userId) {
      reply.code(401).send({ error: 'User ID not found in authenticated request' });
      return;
    }
    
    const isSuper = await isSuperAdmin(request.userId);
    if (!isSuper) {
      reply.code(403).send({ error: 'Access denied. Super admin only' });
      return;
    }
    
    const account = await createOrganisationAccount(request.body as any);
    return account;
  });

  // Update OrganisationAccount
  // Security: Super admin or organisation members can update subscription
  fastify.put('/organisation-account/:id', { preHandler: authenticate }, async (request: AuthenticatedRequest, reply) => {
    if (!checkAccess(request, reply, ['developer', 'admin'])) return;
    if (!request.userId) {
      reply.code(401).send({ error: 'User ID not found in authenticated request' });
      return;
    }
    
    const { id } = request.params as { id: string };
    const body = request.body as any;
    
    const account = await getOrganisationAccount(id);
    if (!account) {
      reply.code(404).send({ error: 'OrganisationAccount not found' });
      return;
    }
    
    // Check if user is super admin or member of organisation
    const isSuper = await isSuperAdmin(request.userId);
    const org = await getOrganisation(account.organisation);
    if (!org) {
      reply.code(404).send({ error: 'Organisation not found' });
      return;
    }
    const isMember = org.members.includes(request.userId);
    
    // Allow super admin to update anything, or members to update subscription only
    if (!isSuper && !isMember) {
      reply.code(403).send({ error: 'Access denied. Must be super admin or organisation member' });
      return;
    }
    
    // If updating subscription and not super admin, only allow subscription updates
    if (body.subscription && !isSuper) {
      // Members can only update subscription, not other fields
      const updates: any = { subscription: body.subscription };
      const updated = await updateOrganisationAccount(id, updates);
      if (!updated) {
        reply.code(404).send({ error: 'OrganisationAccount not found' });
        return;
      }
      return updated;
    }
    
    // Super admin can update anything
    const updated = await updateOrganisationAccount(id, body);
    if (!updated) {
      reply.code(404).send({ error: 'OrganisationAccount not found' });
      return;
    }
    return updated;
  });

  // Get rate limit usage for an organisation
  // Security: Super admin or organisation members can read
  fastify.get('/organisation/:organisationId/account/usage', { preHandler: authenticate }, async (request: AuthenticatedRequest, reply) => {
    if (!checkAccess(request, reply, ['developer', 'admin'])) return;
    if (!request.userId) {
      reply.code(401).send({ error: 'User ID not found in authenticated request' });
      return;
    }
    const { organisationId } = request.params as { organisationId: string };
    
    // Check if user is super admin or member of organisation
    const isSuper = await isSuperAdmin(request.userId);
    const org = await getOrganisation(organisationId);
    if (!org) {
      reply.code(404).send({ error: 'Organisation not found' });
      return;
    }
    const isMember = org.members.includes(request.userId);
    
    if (!isSuper && !isMember) {
      reply.code(403).send({ error: 'Access denied. Must be super admin or organisation member' });
      return;
    }
    
    // Get account to determine rate limit
    const account = await getOrganisationAccountByOrganisation(organisationId);
    const rateLimitPerHour = account ? getOrganisationThreshold(account, 'rateLimitPerHour') ?? 1000 : 1000;
    
    // Get current usage from Redis
    const rateLimitResult = await checkRateLimit(organisationId, rateLimitPerHour);
    
    if (!rateLimitResult) {
      // Redis unavailable or error
      const hits = await getRateLimitHits(organisationId);
      return {
        current: 0,
        limit: rateLimitPerHour,
        remaining: rateLimitPerHour,
        resetAt: null,
        available: false,
        rateLimitHitsLast24h: hits.last24h,
        rateLimitHitsLast7d: hits.last7d,
      };
    }
    
    const current = rateLimitPerHour - rateLimitResult.remaining;
    const hits = await getRateLimitHits(organisationId);

    return {
      current,
      limit: rateLimitPerHour,
      remaining: rateLimitResult.remaining,
      resetAt: rateLimitResult.resetAt,
      available: true,
      rateLimitHitsLast24h: hits.last24h,
      rateLimitHitsLast7d: hits.last7d,
    };
  });
}
