import Fastify from 'fastify';
import cors from '@fastify/cors';
import dotenv from 'dotenv';
import { initPool, createSchema as createSqlSchema, closePool } from './db/db_sql.js';
import { initClient, createSchema as createEsSchema, closeClient } from './db/db_es.js';
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
  createExperiment,
  getExperiment,
  listExperiments,
  updateExperiment,
  deleteExperiment,
  addOrganisationMember,
  removeOrganisationMember,
  getOrganisationMembers,
} from './db/db_sql.js';
import {
  bulkInsertSpans,
  bulkInsertInputs,
  searchSpans,
  searchInputs,
} from './db/db_es.js';
import { authenticate, AuthenticatedRequest } from './server_auth.js';
import SearchQuery from './common/SearchQuery.js';
import { Span } from './common/types/index.js';

dotenv.config();

const fastify = Fastify({
  logger: true,
});

// Initialize databases
const pgConnectionString = process.env.DATABASE_URL;
const esUrl = process.env.ELASTICSEARCH_URL || 'http://localhost:9200';

initPool(pgConnectionString);
initClient(esUrl);

// Create schemas on startup
fastify.addHook('onReady', async () => {
  try {
    await createSqlSchema();
    await createEsSchema();
    fastify.log.info('Database schemas initialized');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fastify.log.error(`Error initializing schemas: ${message}`);
  }
});

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

// Health check
fastify.get('/health', async () => {
  return { status: 'ok' };
});

// ===== SPAN ENDPOINTS (ElasticSearch) =====
fastify.post('/span', { preHandler: authenticate }, async (request: AuthenticatedRequest, reply) => {
  const organisationId = request.organisationId!;
  const spans = request.body as Span | Span[];

  const spansArray = Array.isArray(spans) ? spans : [spans];
  
  // Add organisation to each span
  const spansWithOrg = spansArray.map(span => ({
    ...span,
    organisation: organisationId,
  }));
  console.log("inserting: "+spansWithOrg.length+" spans");
  await bulkInsertSpans(spansWithOrg);
  return { success: true, count: spansWithOrg.length };
});

/**
 * Query spans
 */
fastify.get('/span', { preHandler: authenticate }, async (request: AuthenticatedRequest, reply) => {
	const organisationId = (request.query as any).organisation as string | undefined;
	if (!organisationId) {
	  reply.code(400).send({ error: 'organisation query parameter is required' });
	  return;
	}
  console.log("organisationId", organisationId);
  const query = (request.query as any).q as string | undefined;
  const limit = parseInt((request.query as any).limit || '100');
  const offset = parseInt((request.query as any).offset || '0');

  const searchQuery = query ? new SearchQuery(query) : null;
  const result = await searchSpans(searchQuery, organisationId, limit, offset);
  
  return {
    hits: result.hits,
    total: result.total,
    limit,
    offset,
  };
});

// ===== ORGANISATION ENDPOINTS (PostgreSQL) =====
fastify.post('/organisation', async (request, reply) => {
  const org = await createOrganisation(request.body as any);
  return org;
});

fastify.get('/organisation/:id', async (request, reply) => {
  const { id } = request.params as { id: string };
  const org = await getOrganisation(id);
  if (!org) {
    reply.code(404).send({ error: 'Organisation not found' });
    return;
  }
  return org;
});

fastify.get('/organisation', async (request, reply) => {
  const query = (request.query as any).q as string | undefined;
  const searchQuery = query ? new SearchQuery(query) : null;
  const orgs = await listOrganisations(searchQuery);
  return orgs;
});

fastify.put('/organisation/:id', async (request, reply) => {
  const { id } = request.params as { id: string };
  const org = await updateOrganisation(id, request.body as any);
  if (!org) {
    reply.code(404).send({ error: 'Organisation not found' });
    return;
  }
  return org;
});

fastify.delete('/organisation/:id', async (request, reply) => {
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
  const user = await createUser(request.body as any);
  return user;
});

fastify.get('/user/:id', async (request, reply) => {
  const { id } = request.params as { id: string };
  const user = await getUser(id);
  if (!user) {
    reply.code(404).send({ error: 'User not found' });
    return;
  }
  return user;
});

fastify.get('/user', async (request, reply) => {
  const query = (request.query as any).q as string | undefined;
  const searchQuery = query ? new SearchQuery(query) : null;
  const users = await listUsers(searchQuery);
  return users;
});

fastify.put('/user/:id', async (request, reply) => {
  const { id } = request.params as { id: string };
  const user = await updateUser(id, request.body as any);
  if (!user) {
    reply.code(404).send({ error: 'User not found' });
    return;
  }
  return user;
});

fastify.delete('/user/:id', async (request, reply) => {
  const { id } = request.params as { id: string };
  const deleted = await deleteUser(id);
  if (!deleted) {
    reply.code(404).send({ error: 'User not found' });
    return;
  }
  return { success: true };
});

// ===== API KEY ENDPOINTS (PostgreSQL) =====
fastify.post('/api-key', async (request, reply) => {
  const body = request.body as any;
  const apiKey = await createApiKey({
    ...body
  });
  
  return apiKey;
});

fastify.get('/api-key/:id', async (request, reply) => {
  const { id } = request.params as { id: string };
  const apiKey = await getApiKey(id);
  if (!apiKey) {
    reply.code(404).send({ error: 'API key not found' });
    return;
  }
  return apiKey;
});

fastify.get('/api-key', async (request, reply) => {
  const organisationId = (request.query as any).organisation_id as string | undefined;
  if (!organisationId) {
    reply.code(400).send({ error: 'organisation_id query parameter is required' });
    return;
  }
  const query = (request.query as any).q as string | undefined;
  const searchQuery = query ? new SearchQuery(query) : null;
  const apiKeys = await listApiKeys(organisationId, searchQuery);
  return apiKeys;
});

fastify.put('/api-key/:id', async (request, reply) => {
  const { id } = request.params as { id: string };
  const apiKey = await updateApiKey(id, request.body as any);
  if (!apiKey) {
    reply.code(404).send({ error: 'API key not found' });
    return;
  }
  return apiKey;
});

fastify.delete('/api-key/:id', async (request, reply) => {
  const { id } = request.params as { id: string };
  const deleted = await deleteApiKey(id);
  if (!deleted) {
    reply.code(404).send({ error: 'API key not found' });
    return;
  }
  return { success: true };
});

// ===== DATASET ENDPOINTS (PostgreSQL) =====
fastify.post('/dataset', async (request, reply) => {
	const organisationId = (request.query as any).organisation_id as string | undefined;
  if (!organisationId) {
    reply.code(400).send({ error: 'organisation_id query parameter is required' });
    return;
  }
  const dataset = await createDataset(request.body as any);
  return dataset;
});

fastify.get('/dataset/:id', async (request, reply) => {
  const { id } = request.params as { id: string };
  const dataset = await getDataset(id);
  if (!dataset) {
    reply.code(404).send({ error: 'Dataset not found' });
    return;
  }
  return dataset;
});

fastify.get('/dataset', async (request, reply) => {
  const organisationId = (request.query as any).organisation_id as string | undefined;
  if (!organisationId) {
    reply.code(400).send({ error: 'organisation_id query parameter is required' });
    return;
  }
  const query = (request.query as any).q as string | undefined;
  const searchQuery = query ? new SearchQuery(query) : null;
  const datasets = await listDatasets(organisationId, searchQuery);
  return datasets;
});

fastify.put('/dataset/:id', async (request, reply) => {
  const { id } = request.params as { id: string };
  const dataset = await updateDataset(id, request.body as any);
  if (!dataset) {
    reply.code(404).send({ error: 'Dataset not found' });
    return;
  }
  return dataset;
});

fastify.delete('/dataset/:id', async (request, reply) => {
  const { id } = request.params as { id: string };
  const deleted = await deleteDataset(id);
  if (!deleted) {
    reply.code(404).send({ error: 'Dataset not found' });
    return;
  }
  return { success: true };
});

// ===== INPUT ENDPOINTS (ElasticSearch) =====
fastify.post('/input', { preHandler: authenticate }, async (request: AuthenticatedRequest, reply) => {
  const organisationId = request.organisationId!;
  const inputs = request.body as Span | Span[];

  const inputsArray = Array.isArray(inputs) ? inputs : [inputs];
  
  // Validate dataset is present
  for (const input of inputsArray) {
    if (!input.dataset) {
      reply.code(400).send({ error: 'dataset is required for input documents' });
      return;
    }
  }
  
  // Add organisation to each input
  const inputsWithOrg = inputsArray.map(input => ({
    ...input,
    organisation: organisationId,
  }));

  await bulkInsertInputs(inputsWithOrg);
  return { success: true, count: inputsWithOrg.length };
});

fastify.get('/input', { preHandler: authenticate }, async (request: AuthenticatedRequest, reply) => {
  const organisationId = request.organisationId!;
  const query = (request.query as any).q as string | undefined;
  const datasetId = (request.query as any).dataset_id as string | undefined;
  const limit = parseInt((request.query as any).limit || '100');
  const offset = parseInt((request.query as any).offset || '0');

  const searchQuery = query ? new SearchQuery(query) : null;
  const result = await searchInputs(searchQuery, organisationId, datasetId, limit, offset);
  
  return {
    hits: result.hits,
    total: result.total,
    limit,
    offset,
  };
});

// ===== EXPERIMENT ENDPOINTS (PostgreSQL) =====
fastify.post('/experiment', async (request, reply) => {
  const experiment = await createExperiment(request.body as any);
  return experiment;
});

fastify.get('/experiment/:id', async (request, reply) => {
  const { id } = request.params as { id: string };
  const experiment = await getExperiment(id);
  if (!experiment) {
    reply.code(404).send({ error: 'Experiment not found' });
    return;
  }
  return experiment;
});

fastify.get('/experiment', async (request, reply) => {
  const organisationId = (request.query as any).organisation_id as string | undefined;
  if (!organisationId) {
    reply.code(400).send({ error: 'organisation_id query parameter is required' });
    return;
  }
  const query = (request.query as any).q as string | undefined;
  const searchQuery = query ? new SearchQuery(query) : null;
  const experiments = await listExperiments(organisationId, searchQuery);
  return experiments;
});

fastify.put('/experiment/:id', async (request, reply) => {
  const { id } = request.params as { id: string };
  const experiment = await updateExperiment(id, request.body as any);
  if (!experiment) {
    reply.code(404).send({ error: 'Experiment not found' });
    return;
  }
  return experiment;
});

fastify.delete('/experiment/:id', async (request, reply) => {
  const { id } = request.params as { id: string };
  const deleted = await deleteExperiment(id);
  if (!deleted) {
    reply.code(404).send({ error: 'Experiment not found' });
    return;
  }
  return { success: true };
});

// ===== ORGANISATION MEMBER ENDPOINTS =====
fastify.post('/organisation/:organisationId/member/:userId', async (request, reply) => {
  const { organisationId, userId } = request.params as { organisationId: string; userId: string };
  const organisation = await addOrganisationMember(organisationId, userId);
  return organisation;
});

fastify.delete('/organisation/:organisationId/member/:userId', async (request, reply) => {
  const { organisationId, userId } = request.params as { organisationId: string; userId: string };
  const deleted = await removeOrganisationMember(organisationId, userId);
  if (!deleted) {
    reply.code(404).send({ error: 'Member not found' });
    return;
  }
  return { success: true };
});

fastify.get('/organisation/:organisationId/member', async (request, reply) => {
  const { organisationId } = request.params as { organisationId: string };
  const members = await getOrganisationMembers(organisationId);
  return members;
});

// Start server
const start = async () => {
  try {
    // Register CORS plugin - allow all origins
    await fastify.register(cors, {
      origin: true,
    });
    
    const port = parseInt(process.env.PORT || '4001');
    await fastify.listen({ port, host: '0.0.0.0' });
    fastify.log.info(`Server listening on port ${port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();

