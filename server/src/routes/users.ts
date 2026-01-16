import { FastifyInstance } from 'fastify';
import {
  createUser,
  getUser,
  listUsers,
  updateUser,
  deleteUser,
} from '../db/db_sql.js';
import { authenticate, authenticateWithJwtFromHeader, AuthenticatedRequest, checkAccess } from '../server_auth.js';
import SearchQuery from '../common/SearchQuery.js';

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
      newUser.name = newUser.email.split('@')[0];
    }
    
    console.log("creating user: "+newUser.email+" "+newUser.sub+" from JWT token "+JSON.stringify(jwtToken));
    const user = await createUser(newUser);
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
        const users = await listUsers(new SearchQuery(`sub:${sub}`));
        if (users.length === 0) {
          reply.code(404).send({ error: 'User not found with sub: '+sub });
          return;
        }
        return users[0];
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
    const user = await updateUser(id, request.body as any);
    if (!user) {
      reply.code(404).send({ error: 'User not found' });
      return;
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

