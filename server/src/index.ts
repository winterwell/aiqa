import Fastify from 'fastify';
import cors from '@fastify/cors';
import compress from '@fastify/compress';
import dotenv from 'dotenv';
import { readFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

import { initPool, createTables, closePool, createOrganisation, listOrganisations, addOrganisationMember, createOrganisationAccount, getOrganisationAccountByOrganisation } from './db/db_sql.js';
import { initClient, createIndices, closeClient } from './db/db_es.js';
import { initRedis, closeRedis } from './rate_limit.js';
import {
  createUser,
  getUser,
  listUsers,
  updateUser,
  deleteUser,
  createApiKey,
  getApiKey,
  listApiKeys,
  updateApiKey,
  deleteApiKey,
  createDataset,
  getDataset,
  listDatasets,
  updateDataset,
  deleteDataset,
} from './db/db_sql.js';
import {
  bulkInsertExamples,
  searchExamples,
} from './db/db_es.js';
import { authenticate, authenticateWithJwtFromHeader, AuthenticatedRequest, checkAccess } from './server_auth.js';
import SearchQuery from './common/SearchQuery.js';
import Example from './common/types/Example.js';
import { AIQA_ORG_ID, ANYONE_EMAIL } from './constants.js';
import { registerExperimentRoutes } from './routes/experiments.js';
import { registerSpanRoutes } from './routes/spans.js';
import { registerOrganisationRoutes } from './routes/organisations.js';
import { startGrpcServer, stopGrpcServer } from './grpc_server.js';
import versionData from './version.json';

dotenv.config();

const fastify = Fastify({
  logger: {
    serializers: {
      req: (req) => ({
        method: req.method,
        url: req.url,
        // Explicitly exclude body to avoid logging giant request bodies
      }),
    },
  },
  bodyLimit: 200 * 1024 * 1024, // 200MB - allow large span payloads
});

// Initialize databases
const pgConnectionString = process.env.DATABASE_URL;
const esUrl = process.env.ELASTICSEARCH_URL || 'http://localhost:9200';
const redisUrl = process.env.REDIS_URL;

initPool(pgConnectionString);
initClient(esUrl);
initRedis(redisUrl).catch((err) => {
  console.warn('Failed to initialize Redis (rate limiting will be disabled):', err);
});

// Graceful shutdown
const shutdown = async () => {
  fastify.log.info('Shutting down...');
  await fastify.close();
  await stopGrpcServer().catch((err: any) => {
    const message = err instanceof Error ? err.message : String(err);
    fastify.log.warn(`Error stopping gRPC server: ${message}`);
  });
  await closePool();
  await closeClient();
  await closeRedis();
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Log request body sizes for debugging
fastify.addHook('onRequest', async (request, reply) => {
  const contentLength = request.headers['content-length'];
  if (contentLength) {
    const sizeMB = (parseInt(contentLength) / (1024 * 1024)).toFixed(2);
    fastify.log.info(`Request ${request.method} ${request.url} - Content-Length: ${contentLength} bytes (${sizeMB} MB)`);
  }
});

// Health check
// Security: Public endpoint - no authentication required.
fastify.get('/health', async () => {
  return { status: 'ok' };
});

// Version endpoint
// Security: Public endpoint - no authentication required.
fastify.get('/version', async () => {
  return versionData;
});

// ===== USER ENDPOINTS (PostgreSQL) =====
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

// ===== API KEY ENDPOINTS (PostgreSQL) =====
// Security: Authenticated users only. Organisation membership verified by authenticate middleware when organisation query param provided. Only accepts key_hash (not plaintext).
fastify.post('/api-key', { preHandler: authenticate }, async (request: AuthenticatedRequest, reply) => {
  if (!checkAccess(request, reply, ['developer', 'admin'])) return;
  const body = request.body as any;
  
  // Ensure we only accept key_hash, not key (security: frontend should hash before sending)
  if (body.key) {
    reply.code(400).send({ error: 'Cannot accept plaintext key. Send key_hash instead.' });
    return;
  }
  
  if (!body.key_hash) {
    reply.code(400).send({ error: 'key_hash is required' });
    return;
  }
  
  const apiKey = await createApiKey({
    organisation: body.organisation,
    name: body.name,
    key_hash: body.key_hash,
    key_end: body.key_end,
    role: body.role || 'developer',
  });
  
  return apiKey;
});

// Security: Authenticated users only. No organisation check - any authenticated user can view any API key by ID.
fastify.get('/api-key/:id', {preHandler: authenticate}, async (request: AuthenticatedRequest, reply) => {
  if (!checkAccess(request, reply, ['developer', 'admin'])) return;
  const { id } = request.params as { id: string };
  const apiKey = await getApiKey(id);
  if (!apiKey) {
    reply.code(404).send({ error: 'API key not found' });
    return;
  }
  return apiKey;
});

// Security: Authenticated users only. Organisation membership verified by authenticate middleware. Results filtered by organisationId in database (listApiKeys).
fastify.get('/api-key', { preHandler: authenticate }, async (request: AuthenticatedRequest, reply) => {
  if (!checkAccess(request, reply, ['developer', 'admin'])) return;
  const organisationId = (request.query as any).organisation as string | undefined;
  if (!organisationId) {
    reply.code(400).send({ error: 'organisation query parameter is required' });
    return;
  }
  const query = (request.query as any).q as string | undefined;
  const searchQuery = query ? new SearchQuery(query) : null;
  const apiKeys = await listApiKeys(organisationId, searchQuery);
  return apiKeys;
});

// Security: Authenticated users only. No organisation check - any authenticated user can update any API key by ID.
fastify.put('/api-key/:id', { preHandler: authenticate }, async (request: AuthenticatedRequest, reply) => {
  if (!checkAccess(request, reply, ['developer', 'admin'])) return;
  const { id } = request.params as { id: string };
  const apiKey = await updateApiKey(id, request.body as any);
  if (!apiKey) {
    reply.code(404).send({ error: 'API key not found' });
    return;
  }
  return apiKey;
});

// Security: Authenticated users only. No organisation check - any authenticated user can delete any API key by ID.
fastify.delete('/api-key/:id', { preHandler: authenticate }, async (request: AuthenticatedRequest, reply) => {
  if (!checkAccess(request, reply, ['developer', 'admin'])) return;
  const { id } = request.params as { id: string };
  const deleted = await deleteApiKey(id);
  if (!deleted) {
    reply.code(404).send({ error: 'API key not found' });
    return;
  }
  return { success: true };
});

// ===== DATASET ENDPOINTS (PostgreSQL) =====
// Security: Authenticated users only. Organisation membership verified by authenticate middleware when organisation query param provided.
fastify.post('/dataset', { preHandler: authenticate }, async (request: AuthenticatedRequest, reply) => {
	if (!checkAccess(request, reply, ['developer', 'admin'])) return;
	const organisationId = (request.query as any).organisation as string | undefined;
  if (!organisationId) {
    reply.code(400).send({ error: 'organisation query parameter is required' });
    return;
  }
  const dataset = await createDataset(request.body as any);
  return dataset;
});

// Security: Authenticated users only. No organisation check - any authenticated user can view any dataset by ID.
fastify.get('/dataset/:id', { preHandler: authenticate }, async (request: AuthenticatedRequest, reply) => {
  if (!checkAccess(request, reply, ['developer', 'admin'])) return;
  const { id } = request.params as { id: string };
  const dataset = await getDataset(id);
  if (!dataset) {
    reply.code(404).send({ error: 'Dataset not found' });
    return;
  }
  return dataset;
});

// Security: Authenticated users only. Organisation membership verified by authenticate middleware. Results filtered by organisationId in database (listDatasets).
fastify.get('/dataset', { preHandler: authenticate }, async (request: AuthenticatedRequest, reply) => {
  if (!checkAccess(request, reply, ['developer', 'admin'])) return;
  const organisationId = (request.query as any).organisation as string | undefined;
  if (!organisationId) {
    reply.code(400).send({ error: 'organisation query parameter is required' });
    return;
  }
  const query = (request.query as any).q as string | undefined;
  const searchQuery = query ? new SearchQuery(query) : null;
  const datasets = await listDatasets(organisationId, searchQuery);
  return datasets;
});

// Security: Authenticated users only. No organisation check - any authenticated user can update any dataset by ID.
fastify.put('/dataset/:id', { preHandler: authenticate }, async (request: AuthenticatedRequest, reply) => {
  if (!checkAccess(request, reply, ['developer', 'admin'])) return;
  const { id } = request.params as { id: string };
  const dataset = await updateDataset(id, request.body as any);
  if (!dataset) {
    reply.code(404).send({ error: 'Dataset not found' });
    return;
  }
  return dataset;
});

// Security: Authenticated users only. No organisation check - any authenticated user can delete any dataset by ID.
fastify.delete('/dataset/:id', { preHandler: authenticate }, async (request: AuthenticatedRequest, reply) => {
  if (!checkAccess(request, reply, ['developer', 'admin'])) return;
  const { id } = request.params as { id: string };
  const deleted = await deleteDataset(id);
  if (!deleted) {
    reply.code(404).send({ error: 'Dataset not found' });
    return;
  }
  return { success: true };
});

// ===== EXAMPLE ENDPOINTS (ElasticSearch) =====
// Security: Authenticated users only. Organisation set from authenticate middleware (request.organisation). Examples stored with organisation field.
fastify.post('/example', { preHandler: authenticate }, async (request: AuthenticatedRequest, reply) => {
  if (!checkAccess(request, reply, ['developer', 'admin'])) return;
  const organisation = request.organisation!;
  const examples = request.body as Example | Example[];

  const examplesArray = Array.isArray(examples) ? examples : [examples];
  
  // Validate dataset is present
  for (const example of examplesArray) {
    if (!example.dataset) {
      reply.code(400).send({ error: 'dataset is required for example documents' });
      return;
    }
  }
  
  // Check for duplicates: same traceId + dataset combination
  for (const example of examplesArray) {
    if (example.traceId) {
      // Build a search query for traceId AND dataset
      let searchQuery = SearchQuery.setProp(null, 'traceId', example.traceId);
      searchQuery = SearchQuery.setProp(searchQuery, 'dataset', example.dataset);
      
      const existing = await searchExamples(searchQuery, organisation, example.dataset, 1, 0);
      if (existing.total > 0) {
        reply.code(409).send({ 
          error: `Example with traceId "${example.traceId}" and dataset "${example.dataset}" already exists` 
        });
        return;
      }
    }
  }
  
  // Add organisation and timestamps to each example
  const now = new Date();
  const examplesWithOrg = examplesArray.map(example => ({
    ...example,
    organisation,
    created: example.created || now,
    updated: example.updated || now,
  }));

  await bulkInsertExamples(examplesWithOrg);
  return { success: true, count: examplesWithOrg.length };
});

// Security: Authenticated users only. Organisation membership verified by authenticate middleware. Results filtered by organisationId in Elasticsearch (searchExamples).
fastify.get('/example', { preHandler: authenticate }, async (request: AuthenticatedRequest, reply) => {
  if (!checkAccess(request, reply, ['developer', 'admin'])) return;
  const organisationId = (request.query as any).organisation as string | undefined;
  if (!organisationId) {
    reply.code(400).send({ error: 'organisation query parameter is required' });
    return;
  }
  const query = (request.query as any).q as string | undefined;
  const datasetId = (request.query as any).dataset_id as string | undefined;
  const limit = parseInt((request.query as any).limit || '100');
  const offset = parseInt((request.query as any).offset || '0');

  const searchQuery = query ? new SearchQuery(query) : null;
  const result = await searchExamples(searchQuery, organisationId, datasetId, limit, offset);
  
  return {
    hits: result.hits,
    total: result.total,
    limit,
    offset,
  };
});

// Initialize AIQA organisation and admin user
async function initializeAiqaOrg(): Promise<void> {
  const adminEmail = process.env.AIQA_ADMIN_EMAIL || ANYONE_EMAIL;
  
  // Find or create AIQA organisation
  let aiqaOrg = (await listOrganisations(new SearchQuery('name:AIQA')))[0];
  if (!aiqaOrg) {
    aiqaOrg = await createOrganisation({
      id: AIQA_ORG_ID,
      name: 'AIQA',
      members: [],
      member_settings: {},
    });
    fastify.log.info(`Created AIQA organisation: ${aiqaOrg.id}`);
  }
  
  // Find or create admin user
  if (adminEmail !== ANYONE_EMAIL) {
    let adminUser = (await listUsers(new SearchQuery(`email:${adminEmail}`)))[0];
    if (!adminUser) {
      adminUser = await createUser({
        email: adminEmail,
        name: adminEmail.split('@')[0],
        sub: `aiqa-admin-${adminEmail}`, // Placeholder sub for admin user
      });
      fastify.log.info(`Created admin user: ${adminUser.id}`);
    }
    
    // Add admin user to AIQA organisation if not already a member
    if (!aiqaOrg.members.includes(adminUser.id)) {
      await addOrganisationMember(aiqaOrg.id, adminUser.id);
      fastify.log.info(`Added ${adminEmail} to AIQA organisation`);
    }
  }

  // Create OrganisationAccount for AIQA if it doesn't exist
  const account = await getOrganisationAccountByOrganisation(aiqaOrg.id);
  if (!account) {
    await createOrganisationAccount({
      organisation: aiqaOrg.id,
      subscription: {
        type: 'enterprise',
        status: 'active',
        start_date: new Date(),
        end_date: null,
        renewal_date: null,
        price_per_month: 0,
        currency: 'USD',
      },
    });
    fastify.log.info(`Created OrganisationAccount for AIQA`);
  }
} // end initializeAiqaOrg

// Start server
const start = async () => {
  try {
    // Create schemas before server starts accepting requests
    try {
      await createTables();
      await createIndices();
      fastify.log.info('Database schemas initialized');
      
      // Initialize AIQA organisation and admin user
      await initializeAiqaOrg();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      fastify.log.error(`Error initializing schemas: ${message}`);
      // Continue anyway - defensive code will create indices on-demand
    }
    
    // Register compression plugin - compresses responses for clients that support it
    await fastify.register(compress, {
      global: true, // Enable compression for all routes
      threshold: 1024, // Only compress responses larger than 1KB
    });
    
    // Register CORS plugin - allow all origins
    await fastify.register(cors, {
      origin: true,
    });
    
    // Register experiment routes
    await registerExperimentRoutes(fastify);
    
    // Register span routes
    await registerSpanRoutes(fastify);
    
    // Register organisation routes
    await registerOrganisationRoutes(fastify);
    
    const port = parseInt(process.env.PORT || '4318');
    await fastify.listen({ port, host: '0.0.0.0' });
    fastify.log.info(`HTTP server listening on port ${port}`);
    
    // Start gRPC server for OTLP/gRPC (Protobuf) support
    const grpcPort = parseInt(process.env.GRPC_PORT || '4317');
    try {
      await startGrpcServer(grpcPort);
      fastify.log.info(`gRPC server listening on port ${grpcPort}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      fastify.log.warn(`Failed to start gRPC server: ${message}`);
      fastify.log.warn('OTLP/gRPC (Protobuf) support will not be available. OTLP/HTTP (JSON and Protobuf) is still available.');
    }
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();

