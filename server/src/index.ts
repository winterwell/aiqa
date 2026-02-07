// Load .env file FIRST, before any imports that might use environment variables
// When running from dist/index.js, __dirname will be the dist directory
import dotenv from 'dotenv';
import { join } from 'path';
dotenv.config({ path: join(__dirname, '..', '.env') });

import Fastify from 'fastify';
import cors from '@fastify/cors';
import compress from '@fastify/compress';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

import { initPool, createTables, closePool, createOrganisation, getOrganisation, listOrganisations, addOrganisationMember, createOrganisationAccount, getOrganisationAccountByOrganisation } from './db/db_sql.js';
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
import { registerOrganisationAccountRoutes } from './routes/organisationaccounts.js';
import { registerUserRoutes } from './routes/users.js';
import { registerExampleRoutes } from './routes/examples.js';
import { registerDatasetRoutes } from './routes/datasets.js';
import { registerApiKeyRoutes } from './routes/api-keys.js';
import { registerModelRoutes } from './routes/models.js';
import { startGrpcServer, stopGrpcServer } from './grpc_server.js';
import { registerMiscRoutes } from './routes/misc-routes.js';

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



// Initialize AIQA organisation and admin user
async function initializeAiqaOrg(): Promise<void> {
  const adminEmail = process.env.AIQA_ADMIN_EMAIL || ANYONE_EMAIL;
  
  // Find or create AIQA organisation - must use correct ID
  let aiqaOrg = await getOrganisation(AIQA_ORG_ID);
  if (!aiqaOrg) {
    aiqaOrg = await createOrganisation({
      id: AIQA_ORG_ID,
      name: 'AIQA',
      members: [],
      memberSettings: {},
    }, AIQA_ORG_ID);
    fastify.log.info(`Created AIQA organisation: ${aiqaOrg.id}`);
  } else {
    fastify.log.info(`Found AIQA organisation with correct ID: ${aiqaOrg.id}`);
  }
  
  // Find admin user by email (users are created when they log in via Auth0)
  if (adminEmail !== ANYONE_EMAIL) {
    // Look for user by email (Auth0 users are created on first login with their real sub)
    const adminUser = (await listUsers(new SearchQuery(`email:${adminEmail}`)))[0];
    
    if (adminUser) {
      // Add admin user to AIQA organisation if not already a member
      if (!aiqaOrg.members.includes(adminUser.id)) {
        await addOrganisationMember(aiqaOrg.id, adminUser.id);
        fastify.log.info(`Added ${adminEmail} (user ${adminUser.id}) to AIQA organisation`);
      } else {
        fastify.log.info(`${adminEmail} is already a member of AIQA organisation`);
      }
    } else {
      // User doesn't exist yet - they'll be added when they first log in
      // (processPendingMembersForUser will handle it if they were invited)
      fastify.log.info(`Admin user ${adminEmail} not found - will be added when they log in`);
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
        start: new Date(),
        end: null,
        renewal: null,
        pricePerMonth: 0,
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
    
    // Register CORS plugin - allow all origins (enables external HTTP clients)
    // credentials: true is required for requests with Authorization headers
    // The plugin automatically handles OPTIONS preflight requests
    await fastify.register(cors, {
      origin: (origin, callback) => {
        // Allow all origins - reflect back the origin string for credentials support
        // For same-origin requests (no origin header), allow them
        callback(null, origin || true);
      },
      credentials: true, // Allow credentials (Authorization headers) in cross-origin requests
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Organisation-Id'],
    });
    
    // Register experiment routes
    await registerExperimentRoutes(fastify);
    
    // Register span routes
    await registerSpanRoutes(fastify);
    
    // Register organisation routes
    await registerOrganisationRoutes(fastify);
    
    // Register organisation account routes
    await registerOrganisationAccountRoutes(fastify);
    
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
    
    await registerMiscRoutes(fastify);

    const port = parseInt(process.env.PORT || '4318');
    // Bind to 0.0.0.0 to allow external connections (not just localhost)
    await fastify.listen({ port, host: '0.0.0.0' });
    fastify.log.info(`HTTP server listening on port ${port} (accessible from external hosts)`);
    
    // Start gRPC server for OTLP/gRPC (Protobuf) support
    const grpcPort = parseInt(process.env.GRPC_PORT || '4317');
    try {
      await startGrpcServer(grpcPort);
      fastify.log.info(`gRPC server listening on port ${grpcPort} (accessible from external hosts)`);
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

