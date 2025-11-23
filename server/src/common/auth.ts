import { FastifyRequest, FastifyReply } from 'fastify';
import { getApiKeyByHash } from './db_sql.js';
import * as crypto from 'crypto';

export interface AuthenticatedRequest extends FastifyRequest {
  organisationId?: string;
  apiKeyId?: string;
}

export function hashApiKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

export async function authenticateApiKey(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const authHeader = request.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    reply.code(401).send({ error: 'Missing or invalid Authorization header' });
    return;
  }

  const apiKey = authHeader.substring(7);
  const keyHash = hashApiKey(apiKey);
  
  const apiKeyRecord = await getApiKeyByHash(keyHash);
  
  if (!apiKeyRecord) {
    reply.code(401).send({ error: 'Invalid API key' });
    return;
  }

  // Attach organisation ID to request for use in handlers
  (request as AuthenticatedRequest).organisationId = apiKeyRecord.organisation_id;
  (request as AuthenticatedRequest).apiKeyId = apiKeyRecord.id;
}

