/**
 * Authentication middleware and utilities for API key and JWT token authentication.
 * API keys are hashed with SHA-256 before storage/verification.
 * JWT tokens are verified and user's organisation is looked up from the User table.
 */

import { FastifyRequest, FastifyReply } from 'fastify';
import { getApiKeyByHash, getUser, getOrganisationsForUser, getOrganisation, listUsers } from './db/db_sql.js';
import * as crypto from 'crypto';
import * as jwt from 'jsonwebtoken';
import * as jwksClient from 'jwks-rsa';
import SearchQuery from './common/SearchQuery.js';

/**
 * Request with authentication metadata attached by authenticate middleware.
 * organisationId, userId, and apiKeyId are set when authentication succeeds.
 */
export interface AuthenticatedRequest extends FastifyRequest {
  organisationId?: string;
  userId?: string;
  apiKeyId?: string;
}

/**
 * Hash an API key using SHA-256. Used to store keys securely (never store plain keys).
 */
export function hashApiKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

/**
 * Get JWT secret from environment variable (for symmetric JWT tokens).
 */
function getJwtSecret(): string | null {
  return process.env.JWT_SECRET || null;
}

/**
 * Get Auth0 domain from environment variable.
 */
function getAuth0Domain(): string | null {
  return process.env.AUTH0_DOMAIN || null;
}

/**
 * Create JWKS client for Auth0 token verification.
 */
function getJwksClient(auth0Domain: string): jwksClient.JwksClient {
  return jwksClient.default({
    jwksUri: `https://${auth0Domain}/.well-known/jwks.json`,
    cache: true,
    cacheMaxAge: 86400000, // 24 hours
  });
}

/**
 * Get signing key for Auth0 JWT token (promise-based).
 */
async function getSigningKey(auth0Domain: string, kid: string): Promise<string> {
  const client = getJwksClient(auth0Domain);
  const key = await client.getSigningKey(kid);
  return key.getPublicKey();
}

/**
 * Result of JWT token verification.
 */
interface JwtVerificationResult {
  userId?: string; // Database user ID (for symmetric JWTs) or Auth0 sub (for Auth0 tokens)
  email?: string; // Email from token (for Auth0 tokens)
  isAuth0: boolean; // Whether this is an Auth0 token
}

/**
 * Verify JWT token and extract user information.
 * Supports both Auth0 tokens (RS256 via JWKS) and symmetric tokens (HS256 via JWT_SECRET).
 */
async function verifyJwtToken(token: string): Promise<JwtVerificationResult | null> {
  try {
    // Decode token without verification to check issuer
    const decoded = jwt.decode(token, { complete: true });
    if (!decoded || typeof decoded === 'string' || !decoded.payload) {
      return null;
    }

    const payload = decoded.payload as { iss?: string; userId?: string; sub?: string; email?: string };
    const issuer = payload.iss;

    // Check if this is an Auth0 token
    const auth0Domain = getAuth0Domain();
    if (auth0Domain && issuer && issuer.includes(auth0Domain)) {
      // Get the kid from the token header
      const header = decoded.header as jwt.JwtHeader;
      if (!header.kid) {
        return null;
      }
      // Get the signing key
      const signingKey = await getSigningKey(auth0Domain, header.kid);
      // Verify using Auth0 JWKS
      const verifyOptions: jwt.VerifyOptions = {
        issuer: `https://${auth0Domain}/`,
      };
      if (process.env.AUTH0_AUDIENCE) {
        verifyOptions.audience = process.env.AUTH0_AUDIENCE;
      }
      const verified = jwt.verify(token, signingKey, verifyOptions);
      if (typeof verified === 'string') {
        return null;
      }
      if (!verified || typeof verified !== 'object') {
        return null;
      }
      const verifiedPayload = verified as { userId?: string; sub?: string; email?: string };
      // Auth0 uses 'sub' claim for user ID (format: "google-oauth2|109424848053592856653")
      // and 'email' claim for email address
      return {
        userId: verifiedPayload.sub || verifiedPayload.userId || undefined,
        email: verifiedPayload.email,
        isAuth0: true,
      };
    }
    // fail - to avoid token email spoofing
	console.log('Invalid Auth0 token:'+issuer+' - does not use the correct auth0 domain');
	return null;
  } catch (error) {
	console.error('Error verifying Auth0 token:', error);
    return null;
  }
}

/**
 * Authenticate using API key.
 */
async function authenticateWithApiKey(
  request: AuthenticatedRequest,
  reply: FastifyReply,
  apiKey: string
): Promise<boolean> {
  const keyHash = hashApiKey(apiKey);
  const apiKeyRecord = await getApiKeyByHash(keyHash);
  
  if (!apiKeyRecord) {
    return false;
  }

  // Look up user from API key's organisation (API keys are tied to organisations)
  // For API keys, we use the organisation_id directly from the API key record
  request.organisationId = apiKeyRecord.organisation_id;
  request.apiKeyId = apiKeyRecord.id;
  return true;
}

/**
 * Authenticate using JWT token.
 */
async function authenticateWithJwt(
  request: AuthenticatedRequest,
  reply: FastifyReply,
  token: string
): Promise<boolean> {
  const verificationResult = await verifyJwtToken(token);
  if (!verificationResult) {
    return false;
  }

  let user;
  
  // For Auth0 tokens, look up user by email or sub
  if (verificationResult.isAuth0) {
    // Try email first if available
    if (verificationResult.email) {
      const usersByEmail = await listUsers(new SearchQuery(`email:${verificationResult.email}`));
      if (usersByEmail.length > 0) {
        user = usersByEmail[0];
      }
    }
    
    // If not found by email and we have sub, try sub
    if (!user && verificationResult.userId) {
      const usersBySub = await listUsers(new SearchQuery(`sub:${verificationResult.userId}`));
      if (usersBySub.length > 0) {
        user = usersBySub[0];
      }
    }
    
    // If still not found, user doesn't exist yet
    if (!user) {
      reply.code(403).send({ error: 'User not found. Please log in via the web application first.' });
      return false;
    }
  } else if (verificationResult.userId) {
    // For symmetric JWTs, look up by user ID (must be a UUID)
    user = await getUser(verificationResult.userId);
    if (!user) {
      return false;
    }
  } else {
    return false;
  }

  const userId = user.id;

  // Check for optional organisationId parameter (query param or header)
  const requestedOrgId = (request.query as any)?.organisationId || request.headers['x-organisation-id'];
  
  if (requestedOrgId) {
    // Verify user is a member of the requested organisation
    const org = await getOrganisation(requestedOrgId);
    if (!org || !org.members || !org.members.includes(userId)) {
      reply.code(403).send({ error: 'User is not a member of the specified organisation' });
      return false;
    }
    request.organisationId = requestedOrgId;
  } else {
    // Get user's organisations and use the first one
    const organisations = await getOrganisationsForUser(userId);
    if (organisations.length === 0) {
      reply.code(403).send({ error: 'User is not a member of any organisation' });
      return false;
    }
    // Use the first organisation (could be enhanced to allow selection)
    request.organisationId = organisations[0].id;
  }

  request.userId = userId;
  return true;
}

/**
 * Fastify preHandler middleware for authentication (API key or JWT token).
 * Expects Authorization header: "Bearer <api-key-or-jwt-token>".
 * 
 * For API keys: Looks up organisation from ApiKey table.
 * For JWT tokens: Verifies token, looks up user, then finds organisation from User's memberships.
 * 
 * Optional: JWT requests can include organisationId as query parameter or X-Organisation-Id header
 * to specify which organisation to use (user must be a member).
 * 
 * On success, attaches organisationId, userId (for JWT), and apiKeyId (for API key) to request.
 * On failure, sends 401/403 response and does not call next handler.
 */
export async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const authHeader = request.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    reply.code(401).send({ error: 'Missing or invalid Authorization header' });
    return;
  }

  const token = authHeader.substring(7);
  const authRequest = request as AuthenticatedRequest;

  // Try API key authentication first (API keys are typically longer)
  // If it fails, try JWT authentication
  const apiKeySuccess = await authenticateWithApiKey(authRequest, reply, token);
  if (apiKeySuccess) {
    return;
  }

  // Try JWT authentication
  const jwtSuccess = await authenticateWithJwt(authRequest, reply, token);
  if (jwtSuccess) {
    return;
  }

  // Both failed - only send error if reply hasn't been sent yet
  if (!reply.sent) {
    reply.code(401).send({ error: 'Invalid API key or JWT token' });
  }
}

/**
 * Legacy function name for backward compatibility.
 * @deprecated Use authenticate() instead.
 */
export const authenticateApiKey = authenticate;
