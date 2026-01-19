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
} from './db/db_sql.js';
import { authenticate, AuthenticatedRequest, checkAccess } from './server_auth.js';
import SearchQuery from './common/SearchQuery.js';
import { AIQA_ORG_ID, ANYONE_EMAIL } from './constants.js';
import { registerExperimentRoutes } from './routes/experiments.js';
import { registerSpanRoutes } from './routes/spans.js';
import { registerOrganisationRoutes } from './routes/organisations.js';
import { registerUserRoutes } from './routes/users.js';
import { registerExampleRoutes } from './routes/examples.js';
import { registerDatasetRoutes } from './routes/datasets.js';
import { registerApiKeyRoutes } from './routes/api-keys.js';
import { registerModelRoutes } from './routes/models.js';
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
    
    // Register user routes
    await registerUserRoutes(fastify);
    
    // Register example routes
    await registerExampleRoutes(fastify);
    
    // Register dataset routes
    await registerDatasetRoutes(fastify);
    
    // Register API key routes
    await registerApiKeyRoutes(fastify);
    
    // Register model routes
    await registerModelRoutes(fastify);
    
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

