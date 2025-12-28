import Fastify from 'fastify';
import cors from '@fastify/cors';
import dotenv from 'dotenv';
import { readFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

import { initPool, createTables, closePool } from './db/db_sql.js';
import { initClient, createIndices, closeClient } from './db/db_es.js';
import {
  createOrganisation,
  getOrganisation,
  listOrganisations,
  updateOrganisation,
  deleteOrganisation,
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
  addOrganisationMember,
  removeOrganisationMember,
  getOrganisationMembers,
} from './db/db_sql.js';
import {
  bulkInsertExamples,
  searchExamples,
} from './db/db_es.js';
import { authenticate, authenticateWithJwtFromHeader, AuthenticatedRequest } from './server_auth.js';
import SearchQuery from './common/SearchQuery.js';
import Example from './common/types/Example.js';
import { registerExperimentRoutes } from './routes/experiments.js';
import { registerSpanRoutes } from './routes/spans.js';
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

initPool(pgConnectionString);
initClient(esUrl);

// Graceful shutdown
const shutdown = async () => {
  fastify.log.info('Shutting down...');
  await fastify.close();
  await closePool();
  await closeClient();
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
fastify.get('/health', async () => {
  return { status: 'ok' };
});

// Version endpoint
fastify.get('/version', async () => {
  return versionData;
});

// ===== ORGANISATION ENDPOINTS (PostgreSQL) =====
fastify.post('/organisation', { preHandler: authenticate }, async (request: AuthenticatedRequest, reply) => {
  const org = await createOrganisation(request.body as any);
  return org;
});

fastify.get('/organisation/:id', { preHandler: authenticate }, async (request: AuthenticatedRequest, reply) => {
  const { id } = request.params as { id: string };
  const org = await getOrganisation(id);
  if (!org) {
    reply.code(404).send({ error: 'Organisation not found' });
    return;
  }
  return org;
});

fastify.get('/organisation', { preHandler: authenticate }, async (request: AuthenticatedRequest, reply) => {
  const query = (request.query as any).q as string | undefined;
  const searchQuery = query ? new SearchQuery(query) : null;
  const orgs = await listOrganisations(searchQuery);
  return orgs;
});

fastify.put('/organisation/:id', { preHandler: authenticate }, async (request: AuthenticatedRequest, reply) => {
  const { id } = request.params as { id: string };
  const org = await updateOrganisation(id, request.body as any);
  if (!org) {
    reply.code(404).send({ error: 'Organisation not found' });
    return;
  }
  return org;
});

fastify.delete('/organisation/:id', { preHandler: authenticate }, async (request: AuthenticatedRequest, reply) => {
  const { id } = request.params as { id: string };
  const deleted = await deleteOrganisation(id);
  if (!deleted) {
    reply.code(404).send({ error: 'Organisation not found' });
    return;
  }
  return { success: true };
});

// ===== USER ENDPOINTS (PostgreSQL) =====
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

fastify.get('/user', { preHandler: authenticate }, async (request: AuthenticatedRequest, reply) => {
  const query = (request.query as any).q as string | undefined;
  const searchQuery = query ? new SearchQuery(query) : null;
  const users = await listUsers(searchQuery);
  return users;
});

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

fastify.delete('/user/:id', { preHandler: authenticate }, async (request: AuthenticatedRequest, reply) => {
  const { id } = request.params as { id: string };
  const deleted = await deleteUser(id);
  if (!deleted) {
    reply.code(404).send({ error: 'User not found' });
    return;
  }
  return { success: true };
});

// ===== API KEY ENDPOINTS (PostgreSQL) =====
fastify.post('/api-key', { preHandler: authenticate }, async (request: AuthenticatedRequest, reply) => {
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
    rate_limit_per_hour: body.rate_limit_per_hour,
    retention_period_days: body.retention_period_days,
  });
  
  return apiKey;
});

fastify.get('/api-key/:id', {preHandler: authenticate}, async (request: AuthenticatedRequest, reply) => {
  const { id } = request.params as { id: string };
  const apiKey = await getApiKey(id);
  if (!apiKey) {
    reply.code(404).send({ error: 'API key not found' });
    return;
  }
  return apiKey;
});

fastify.get('/api-key', { preHandler: authenticate }, async (request: AuthenticatedRequest, reply) => {
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

fastify.put('/api-key/:id', { preHandler: authenticate }, async (request: AuthenticatedRequest, reply) => {
  const { id } = request.params as { id: string };
  const apiKey = await updateApiKey(id, request.body as any);
  if (!apiKey) {
    reply.code(404).send({ error: 'API key not found' });
    return;
  }
  return apiKey;
});

fastify.delete('/api-key/:id', { preHandler: authenticate }, async (request: AuthenticatedRequest, reply) => {
  const { id } = request.params as { id: string };
  const deleted = await deleteApiKey(id);
  if (!deleted) {
    reply.code(404).send({ error: 'API key not found' });
    return;
  }
  return { success: true };
});

// ===== DATASET ENDPOINTS (PostgreSQL) =====
fastify.post('/dataset', { preHandler: authenticate }, async (request: AuthenticatedRequest, reply) => {
	const organisationId = (request.query as any).organisation as string | undefined;
  if (!organisationId) {
    reply.code(400).send({ error: 'organisation query parameter is required' });
    return;
  }
  const dataset = await createDataset(request.body as any);
  return dataset;
});

fastify.get('/dataset/:id', { preHandler: authenticate }, async (request: AuthenticatedRequest, reply) => {
  const { id } = request.params as { id: string };
  const dataset = await getDataset(id);
  if (!dataset) {
    reply.code(404).send({ error: 'Dataset not found' });
    return;
  }
  return dataset;
});

fastify.get('/dataset', { preHandler: authenticate }, async (request: AuthenticatedRequest, reply) => {
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

fastify.put('/dataset/:id', { preHandler: authenticate }, async (request: AuthenticatedRequest, reply) => {
  const { id } = request.params as { id: string };
  const dataset = await updateDataset(id, request.body as any);
  if (!dataset) {
    reply.code(404).send({ error: 'Dataset not found' });
    return;
  }
  return dataset;
});

fastify.delete('/dataset/:id', { preHandler: authenticate }, async (request, reply) => {
  const { id } = request.params as { id: string };
  const deleted = await deleteDataset(id);
  if (!deleted) {
    reply.code(404).send({ error: 'Dataset not found' });
    return;
  }
  return { success: true };
});

// ===== EXAMPLE ENDPOINTS (ElasticSearch) =====
fastify.post('/example', { preHandler: authenticate }, async (request: AuthenticatedRequest, reply) => {
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

fastify.get('/example', { preHandler: authenticate }, async (request: AuthenticatedRequest, reply) => {
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

// ===== ORGANISATION MEMBER ENDPOINTS =====
fastify.post('/organisation/:organisationId/member/:userId',{ preHandler: authenticate }, async (request, reply) => {
  const { organisationId, userId } = request.params as { organisationId: string; userId: string };
  const organisation = await addOrganisationMember(organisationId, userId);
  return organisation;
});

fastify.delete('/organisation/:organisationId/member/:userId', { preHandler: authenticate }, async (request, reply) => {
  const { organisationId, userId } = request.params as { organisationId: string; userId: string };
  const deleted = await removeOrganisationMember(organisationId, userId);
  if (!deleted) {
    reply.code(404).send({ error: 'Member not found' });
    return;
  }
  return { success: true };
});

fastify.get('/organisation/:organisationId/member', { preHandler: authenticate }, async (request, reply) => {
  const { organisationId } = request.params as { organisationId: string };
  const members = await getOrganisationMembers(organisationId);
  return members;
});

// Start server
const start = async () => {
  try {
    // Create schemas before server starts accepting requests
    try {
      await createTables();
      await createIndices();
      fastify.log.info('Database schemas initialized');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      fastify.log.error(`Error initializing schemas: ${message}`);
      // Continue anyway - defensive code will create indices on-demand
    }
    
    // Register CORS plugin - allow all origins
    await fastify.register(cors, {
      origin: true,
    });
    
    // Register experiment routes
    await registerExperimentRoutes(fastify);
    
    // Register span routes
    await registerSpanRoutes(fastify);
    
    const port = parseInt(process.env.PORT || '4001');
    await fastify.listen({ port, host: '0.0.0.0' });
    fastify.log.info(`Server listening on port ${port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();

