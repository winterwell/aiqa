import { FastifyInstance } from 'fastify';
import {
    createApiKey,
    getApiKey,
    listApiKeys,
    updateApiKey,
    deleteApiKey,
} from '../db/db_sql.js';
import { authenticate, AuthenticatedRequest, checkAccess } from '../server_auth.js';
import { checkAccessDeveloper, getOrganisationId, parseSearchQuery, send404 } from './route_helpers.js';

import versionData from '../version.json';

export async function registerMiscRoutes(fastify: FastifyInstance): Promise<void> {
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

    fastify.get('/', async () => {
        return { message: 'Hello, this is the AIQA server. For documentation, see https://aiqa.winterwell.com', status: 'ok' };
    });
}