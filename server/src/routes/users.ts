import { FastifyInstance } from 'fastify';
import {
  createUser,
  getUser,
  listUsers,
  updateUser,
  deleteUser,
  processPendingMembers,
} from '../db/db_sql.js';
import { authenticate, authenticateWithJwtFromHeader, AuthenticatedRequest, checkAccess } from '../server_auth.js';
import SearchQuery from '../common/SearchQuery.js';
import type User from '../common/types/User.js';

/**
 * Helper to process pending members for a user after creation/update.
 * Extracted to avoid code duplication.
 */
async function processPendingMembersForUser(user: User): Promise<void> {
  if (!user.email) {
    return;
  }
  try {
    const addedOrgIds = await processPendingMembers(user.id, user.email);
    if (addedOrgIds.length > 0) {
      console.log(`Auto-added user ${user.id} to ${addedOrgIds.length} organisation(s): ${addedOrgIds.join(', ')}`);
    }
  } catch (error) {
    console.error('Error processing pending members:', error);
    // Don't fail user creation/update if pending member processing fails
  }
}

/**
 * Update user email from JWT token if available and different.
 * Returns updated user or original user if no update needed.
 */
async function updateUserEmailFromJwt(user: User, jwtEmail?: string): Promise<User> {
	if (!jwtEmail) {
		console.log(`No email in JWT token for user ${user.id}`);
		return user;
	}
	if (user.email === jwtEmail) {
		return user;
	}
	console.log(`Updating user ${user.id} email from "${user.email || 'null'}" to "${jwtEmail}"`);
	const updated = await updateUser(user.id, { email: jwtEmail });
	if (updated) {
		console.log(`Successfully updated user ${user.id} with email from JWT: ${jwtEmail}`);
		return updated;
	}
	console.log(`Failed to update user ${user.id} email - updateUser returned null`);
	return user;
}

/**
 * Register user endpoints with Fastify
 */
export async function registerUserRoutes(fastify: FastifyInstance): Promise<void> {
  
  // Security: JWT token required (via authenticateWithJwtFromHeader). User can only create themselves (email/sub from JWT).
  fastify.post('/user', async (request, reply) => {
    // get details from JWT token
    let jwtToken = await authenticateWithJwtFromHeader(request);
    if (!jwtToken) {
      reply.code(401).send({ error: 'Invalid JWT token' });
      return;
    }
    const newUser = request.body as any;
    newUser.email = jwtToken.email;
    newUser.sub = jwtToken.userId;
    
    if (!newUser.name) {
      newUser.name = newUser.email ? newUser.email.split('@')[0] : 'User';
    }
    
    // Check if user already exists by sub (primary identifier)
    if (newUser.sub) {
      const existingUsersBySub = await listUsers(new SearchQuery(`sub:${newUser.sub}`));
      if (existingUsersBySub.length > 0) {
        // User already exists, return the existing user (prefer one with most organisations)
        let existingUser;
        if (existingUsersBySub.length > 1) {
          // Multiple users with same sub - prefer one in organisations
          const { getOrganisationsForUser } = await import('../db/db_sql.js');
          const usersWithOrgs = await Promise.all(
            existingUsersBySub.map(async (u) => {
              const orgs = await getOrganisationsForUser(u.id);
              return { user: u, orgCount: orgs.length };
            })
          );
          usersWithOrgs.sort((a, b) => {
            if (a.orgCount !== b.orgCount) return b.orgCount - a.orgCount;
            return new Date(a.user.created).getTime() - new Date(b.user.created).getTime();
          });
          existingUser = usersWithOrgs[0].user;
          console.log(`User with sub ${newUser.sub} already exists (multiple found), returning user ${existingUser.id}`);
        } else {
          existingUser = existingUsersBySub[0];
          console.log(`User with sub ${newUser.sub} already exists, returning existing user ${existingUser.id}`);
        }
        
        const returnedUser = await updateUserEmailFromJwt(existingUser, newUser.email);
        await processPendingMembersForUser(returnedUser);
        return returnedUser;
      }
    }
    
    // Also check by email as fallback
    if (newUser.email) {
      const existingUsersByEmail = await listUsers(new SearchQuery(`email:${newUser.email}`));
      if (existingUsersByEmail.length > 0) {
        // If email matches and sub matches or is missing, return existing user
        const matchingUser = existingUsersByEmail.find(u => !u.sub || u.sub === newUser.sub);
        if (matchingUser) {
          // Update sub if it was missing
          if (!matchingUser.sub && newUser.sub) {
            const updated = await updateUser(matchingUser.id, { sub: newUser.sub });
            if (updated) {
              console.log(`Updated user ${matchingUser.id} with sub from JWT: ${newUser.sub}`);

            }
          }
          console.log(`User with email ${newUser.email} already exists, returning existing user ${matchingUser.id}`);
          const returnedUser = await updateUserEmailFromJwt(matchingUser, newUser.email);
          await processPendingMembersForUser(returnedUser);
          return returnedUser;
        }
      }
    }
    
    console.log("creating user: "+newUser.email+" "+newUser.sub+" from JWT token "+JSON.stringify(jwtToken));
    const user = await createUser(newUser);
    await processPendingMembersForUser(user);
    return user;
  });

  // Security: No authentication required. Any user can view any user by ID (or use "jwt" to get own user via JWT token).
  fastify.get('/user/:id', async (request, reply) => {
    try {
      let jwtToken = await authenticateWithJwtFromHeader(request);
      let { id } = request.params as { id: string };
      if (id === "jwt") {
        if (!jwtToken) {
          reply.code(401).send({ error: 'Invalid JWT token' });
          return;
        }
        const sub = jwtToken.userId;
        if (!sub) {
          reply.code(401).send({ error: 'JWT token missing user ID' });
          return;
        }
        console.log(`GET /user/jwt - JWT token has email: ${jwtToken.email}, userId: ${sub}`);
        const users = await listUsers(new SearchQuery(`sub:${sub}`));
        if (users.length === 0) {
          reply.code(404).send({ error: 'User not found with sub: '+sub });
          return;
        }
        const user = users[0];
        console.log(`GET /user/jwt - Found user ${user.id}, current email: ${user.email || 'null'}`);
        const updatedUser = await updateUserEmailFromJwt(user, jwtToken.email);
        // Process pending members in case email changed or user was invited
        await processPendingMembersForUser(updatedUser);
        return updatedUser;
      }
      const user = await getUser(id);
      if (!user) {
        reply.code(404).send({ error: 'User not found' });
        return;
      }
      return user;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      fastify.log.error(`Error in /user/:id endpoint: ${errorMessage}`);
      fastify.log.error(error);
      reply.code(500).send({ error: 'Internal server error', details: errorMessage });
    }
  });

  // Security: Authenticated users only. No organisation filtering - returns all users matching search query.
  fastify.get('/user', { preHandler: authenticate }, async (request: AuthenticatedRequest, reply) => {
    if (!checkAccess(request, reply, ['developer', 'admin'])) return;
    const query = (request.query as any).q as string | undefined;
    const searchQuery = query ? new SearchQuery(query) : null;
    const users = await listUsers(searchQuery);
    return users;
  });

  // Security: JWT token required. Users can only update their own profile (verified by matching JWT userId/sub or email to target user).
  fastify.put('/user/:id', async (request, reply) => {
    let jwtToken = await authenticateWithJwtFromHeader(request);
    if (!jwtToken) {
      reply.code(401).send({ error: 'Invalid JWT token' });
      return;
    }  
    let { id } = request.params as { id: string };
    if (id === "jwt") {
      if (!jwtToken.userId) {
        reply.code(401).send({ error: 'JWT token missing user ID' });
        return;
      }
      id = jwtToken.userId;
    }
    // Authorization check: user can only update themselves
    // Get the user being updated and verify JWT token matches
    const targetUser = await getUser(id);
    if (!targetUser) {
      reply.code(404).send({ error: 'User not found' });
      return;
    }
    
    // Verify the JWT token matches the user being updated
    const tokenMatches = 
      (jwtToken.userId && targetUser.sub === jwtToken.userId) ||
      (jwtToken.email && targetUser.email === jwtToken.email);
    
    if (!tokenMatches) {
      reply.code(403).send({ error: 'You can only update your own user profile' });
      return;
    }
    
    console.log("updating user: "+id+" from JWT token "+JSON.stringify(jwtToken));
    const updates = request.body as any;
    // Also update email from JWT if available and not explicitly provided
    const emailChanged = jwtToken.email && updates.email === undefined;
    if (emailChanged) {
      updates.email = jwtToken.email;
    }
    const user = await updateUser(id, updates);
    if (!user) {
      reply.code(404).send({ error: 'User not found' });
      return;
    }
    // Process pending members if email was updated
    if (emailChanged) {
      await processPendingMembersForUser(user);
    }
    return user;
  });

  // Security: Authenticated users only. No ownership check - any authenticated user can delete any user by ID.
  fastify.delete('/user/:id', { preHandler: authenticate }, async (request: AuthenticatedRequest, reply) => {
    if (!checkAccess(request, reply, ['admin'])) return;
    const { id } = request.params as { id: string };
    const deleted = await deleteUser(id);
    if (!deleted) {
      reply.code(404).send({ error: 'User not found' });
      return;
    }
    return { success: true };
  });
}

