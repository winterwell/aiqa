import { FastifyInstance, FastifyReply } from 'fastify';
import {
  createOrganisation,
  getOrganisation,
  listOrganisations,
  updateOrganisation,
  deleteOrganisation,
  addOrganisationMember,
  removeOrganisationMember,
  getOrganisationMembers,
  getOrganisationsForUser,
  getOrganisationAccount,
  getOrganisationAccountByOrganisation,
  createOrganisationAccount,
  updateOrganisationAccount,
  listOrganisationAccounts,
} from '../db/db_sql.js';
import { authenticate, AuthenticatedRequest, checkAccess, isSuperAdmin } from '../server_auth.js';
import SearchQuery from '../common/SearchQuery.js';

/**
 * Check if the user is a member of the organisation and has admin role.
 * Uses member_settings to determine admin status. If no one in member_settings has role:admin,
 * then any member can admin (to avoid lockout).
 * Returns true if access is allowed, false if denied (and 401 / 403 reply is sent).
 */
async function checkOrganisationAdminAccess(
  request: AuthenticatedRequest,
  reply: FastifyReply,
  organisationId: string
): Promise<boolean> {
  if (!request.userId) {
    reply.code(401).send({ error: 'User ID not found in authenticated request' });
    return false;
  }

  const org = await getOrganisation(organisationId);
  if (!org) {
    reply.code(404).send({ error: 'Organisation not found' });
    return false;
  }

  // Check if user is a member
  if (!org.members || !org.members.includes(request.userId)) {
    reply.code(403).send({ error: 'User is not a member of this organisation' });
    return false;
  }

  // Check if user has admin role via API key (JWT users always have admin)
  if (request.authenticatedWith === 'api_key' && request.apiKey) {
    // API key with admin role always has access
    if (request.apiKey.role === 'admin') {
      return true;
    } else {
      reply.code(403).send({ error: 'API key does not have admin role' });
      return false;
    }
  }

  // Check member_settings for admin role
  const memberSettings = org.member_settings || {};
  const userSettings = memberSettings[request.userId];
  
  // Check if any member has admin role in member_settings
  const hasAnyAdmin = Object.values(memberSettings).some(
    (settings: any) => settings && settings.role === 'admin'
  );

  // If no one has admin role, allow any member to admin (avoid lockout)
  if (!hasAnyAdmin) {
    return true;
  }

  // Otherwise, user must have admin role in member_settings
  if (userSettings && userSettings.role === 'admin') {
    return true;
  }

  reply.code(403).send({ error: 'Admin role required to manage organisation members' });
  return false;
}

/**
 * Register organisation endpoints with Fastify
 */
export async function registerOrganisationRoutes(fastify: FastifyInstance): Promise<void> {
  
  // Security: Authenticated users only (via authenticate middleware). No organisation membership check - any authenticated user can create organisations.
  fastify.post('/organisation', { preHandler: authenticate }, async (request: AuthenticatedRequest, reply) => {
    if (!checkAccess(request, reply, ['developer', 'admin'])) return;
    const org = await createOrganisation(request.body as any);
    return org;
  });

  // Security: Authenticated users only. No membership check - any authenticated user can view any organisation by ID.
  fastify.get('/organisation/:id', { preHandler: authenticate }, async (request: AuthenticatedRequest, reply) => {
    if (!checkAccess(request, reply, ['developer', 'admin'])) return;
    const { id } = request.params as { id: string };
    const org = await getOrganisation(id);
    if (!org) {
      reply.code(404).send({ error: 'Organisation not found' });
      return;
    }
    return org;
  });

  // List organisations for user
  // Security: Authenticated users only. Filtered to only return organisations where user is a member (via getOrganisationsForUser in endpoint handler).
  fastify.get('/organisation', { preHandler: authenticate }, async (request: AuthenticatedRequest, reply) => {
    if (!checkAccess(request, reply, ['developer', 'admin'])) return;
    const query = (request.query as any).q as string | undefined;
    const searchQuery = query ? new SearchQuery(query) : null;
    if (!request.userId) {
      reply.code(401).send({ error: 'User ID not found in authenticated request' });
      return;
    }
    const orgs = await getOrganisationsForUser(request.userId, searchQuery);
    return orgs;
  });

  // Security: Authenticated users only. No membership check - any authenticated user can update any organisation by ID.
  fastify.put('/organisation/:id', { preHandler: authenticate }, async (request: AuthenticatedRequest, reply) => {
    if (!checkAccess(request, reply, ['developer', 'admin'])) return;
    const { id } = request.params as { id: string };
    const org = await updateOrganisation(id, request.body as any);
    if (!org) {
      reply.code(404).send({ error: 'Organisation not found' });
      return;
    }
    return org;
  });

  // Security: Authenticated users only. No membership check - any authenticated user can delete any organisation by ID.
  fastify.delete('/organisation/:id', { preHandler: authenticate }, async (request: AuthenticatedRequest, reply) => {
    if (!checkAccess(request, reply, ['admin'])) return;
    const { id } = request.params as { id: string };
    const deleted = await deleteOrganisation(id);
    if (!deleted) {
      reply.code(404).send({ error: 'Organisation not found' });
      return;
    }
    return { success: true };
  });

  // ===== ORGANISATION MEMBER ENDPOINTS =====
  // Security: User must be a member of the organisation and have admin role (via member_settings or API key).
  // If no one has admin role in member_settings, any member can admin (to avoid lockout).
  fastify.post('/organisation/:organisationId/member/:userId', { preHandler: authenticate }, async (request: AuthenticatedRequest, reply) => {
    if (!checkAccess(request, reply, ['developer', 'admin'])) return;
    const { organisationId, userId } = request.params as { organisationId: string; userId: string };
    if (!(await checkOrganisationAdminAccess(request, reply, organisationId))) return;
    const organisation = await addOrganisationMember(organisationId, userId);
    return organisation;
  });

  // Security: User must be a member of the organisation and have admin role (via member_settings or API key).
  // If no one has admin role in member_settings, any member can admin (to avoid lockout).
  fastify.delete('/organisation/:organisationId/member/:userId', { preHandler: authenticate }, async (request: AuthenticatedRequest, reply) => {
    if (!checkAccess(request, reply, ['developer', 'admin'])) return;
    const { organisationId, userId } = request.params as { organisationId: string; userId: string };
    if (!(await checkOrganisationAdminAccess(request, reply, organisationId))) return;
    const deleted = await removeOrganisationMember(organisationId, userId);
    if (!deleted) {
      reply.code(404).send({ error: 'Member not found' });
      return;
    }
    return { success: true };
  });

  // Security: Authenticated users only. No membership check - any authenticated user can view members of any organisation.
  fastify.get('/organisation/:organisationId/member', { preHandler: authenticate }, async (request: AuthenticatedRequest, reply) => {
    if (!checkAccess(request, reply, ['developer', 'admin'])) return;
    const { organisationId } = request.params as { organisationId: string };
    const members = await getOrganisationMembers(organisationId);
    return members;
  });

  // ===== ORGANISATION ACCOUNT ENDPOINTS =====
  
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
    
    const account = await getOrganisationAccountByOrganisation(organisationId);
    if (!account) {
      reply.code(404).send({ error: 'OrganisationAccount not found' });
      return;
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

  // List all OrganisationAccounts (super admin only)
  // Security: Super admin only
  fastify.get('/organisation-account', { preHandler: authenticate }, async (request: AuthenticatedRequest, reply) => {
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
    
    const query = (request.query as any).q as string | undefined;
    const searchQuery = query ? new SearchQuery(query) : null;
    const accounts = await listOrganisationAccounts(searchQuery);
    return accounts;
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
  // Security: Super admin only
  fastify.put('/organisation-account/:id', { preHandler: authenticate }, async (request: AuthenticatedRequest, reply) => {
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
    
    const { id } = request.params as { id: string };
    const account = await updateOrganisationAccount(id, request.body as any);
    if (!account) {
      reply.code(404).send({ error: 'OrganisationAccount not found' });
      return;
    }
    return account;
  });
}

