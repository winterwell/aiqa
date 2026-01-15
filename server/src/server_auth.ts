/**
 * Authentication middleware and utilities for API key and JWT token authentication.
 * JWT tokens are verified and user's organisation is looked up from the User table.
 */

import { FastifyRequest, FastifyReply } from 'fastify';
import { getUser, getOrganisationsForUser, getOrganisation, listUsers, getApiKey, getApiKeyByHash, listOrganisations, getOrganisationMembers } from './db/db_sql.js';
import ApiKey from './common/types/ApiKey.js';
import * as crypto from 'crypto';
import * as jwt from 'jsonwebtoken';
import * as jwksClient from 'jwks-rsa';
import SearchQuery from './common/SearchQuery.js';
import { AIQA_ORG_ID, ANYONE_EMAIL } from './constants.js';

/**
 * Request with authentication metadata attached by authenticate middleware.
 * organisationId, userId, and apiKeyId are set when authentication succeeds.
 */
export interface AuthenticatedRequest extends FastifyRequest {
	authenticatedWith?: 'api_key' | 'jwt';
	organisation?: string;
	userId?: string;
	apiKeyId?: string;
	apiKey?: ApiKey; // Full API key object (only set when authenticated with API key)
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
 * Supports Auth0 tokens (RS256 via JWKS)
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
		console.log('Invalid Auth0 token:' + issuer + ' - does not use the correct auth0 domain');
		return null;
	} catch (error) {
		console.error('Error verifying Auth0 token:', error);
		return null;
	}
}

/**
 * Hash an API key using SHA256.
 */
function hashApiKey(key: string): string {
	return crypto.createHash('sha256').update(key).digest('hex');
}

/**
 * Authenticate using API key.
 * The incoming key is hashed and compared against stored key_hash values.
 */
async function authenticateWithApiKey(
	request: AuthenticatedRequest,
	reply: FastifyReply,
	apiKeyPlaintext: string
): Promise<boolean> {
	// Hash the incoming API key
	const keyHash = hashApiKey(apiKeyPlaintext);
	
	// Look up API key by hash
	const apiKey = await getApiKeyByHash(keyHash);

	if (!apiKey) {
		console.error('API key not found for hash:', keyHash.substring(0, 16) + '...');
		return false;
	}

	// Look up user from API key's organisation (API keys are tied to organisations)
	// For API keys, we use the organisation directly from the API key record
	request.organisation = apiKey.organisation;
	request.apiKeyId = apiKey.id;
	request.apiKey = apiKey; // Store full API key for permission checks
	request.authenticatedWith = 'api_key';
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
				console.log('User found by email:', user);
			}
		}

		// If not found by email and we have sub, try sub
		if (!user && verificationResult.userId) {
			const usersBySub = await listUsers(new SearchQuery(`sub:${verificationResult.userId}`));
			if (usersBySub.length > 0) {
				user = usersBySub[0];
			}
		}

		// If still not found, user doesn't exist yet (but may be created by this request)
		if (!user) {
			reply.code(403).send({ error: `User email:${verificationResult.email} sub:${verificationResult.userId} not found. Please log in via the web application first.` });
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

	const userId = user?.id;

	// Check for optional organisationId parameter (query param or header)
	const requestedOrg = (request.query as any)?.organisation;

	if (requestedOrg) {
		// Verify user is a member of the requested organisation
		const org = await getOrganisation(requestedOrg);
		if (!org || !org.members || !org.members.includes(userId)) {
			reply.code(403).send({ error: 'User is not a member of the specified organisation' });
			return false;
		}
		request.organisation = requestedOrg;
	} else {
		// Get user's organisations and use the first one if there is only one
		const organisations = await getOrganisationsForUser(userId);
		if (organisations.length === 1) {
		request.organisation = organisations[0].id;
		}
	}

	request.userId = userId;
	request.authenticatedWith = 'jwt';
	return true;
}

/**
 * Authenticate using JWT token from Authorization header.
 * @param request 
 * @returns 
 */
export async function authenticateWithJwtFromHeader(request: FastifyRequest): Promise<JwtVerificationResult | null> {
	const authHeader = request.headers.authorization;
	if (!authHeader) {
		return null;
	}
	// Check for JWT authentication: "Bearer <jwt-token>"
	if (!authHeader.startsWith('Bearer ')) {
		return null;
	}
	const token = authHeader.substring(7).trim();
	const verificationResult = await verifyJwtToken(token);
	return verificationResult;
}


/**
 * Fastify preHandler middleware for authentication (API key or JWT token).
 * Expects Authorization header:
 *   - "Bearer <jwt-token>" for JWT authentication
 *   - "ApiKey <api-key>" for API key authentication
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

	if (!authHeader) {
		reply.code(401).send({ error: 'Missing Authorization header' });
		return;
	}

	const authRequest = request as AuthenticatedRequest;

	// Check for API key authentication: "ApiKey <api-key>"
	if (authHeader.startsWith('ApiKey ')) {
		const apiKey = authHeader.substring(7).trim();
		const apiKeySuccess = await authenticateWithApiKey(authRequest, reply, apiKey);
		if (apiKeySuccess) {
			return;
		}
		// API key authentication failed - only send error if reply hasn't been sent yet
		if (!reply.sent) {
			reply.code(401).send({ error: 'Invalid API key' });
		}
		return;
	}

	// Check for JWT authentication: "Bearer <jwt-token>"
	if (authHeader.startsWith('Bearer ')) {
		const token = authHeader.substring(7).trim();
		const jwtSuccess = await authenticateWithJwt(authRequest, reply, token);
		if (jwtSuccess) {
			return;
		}
		// JWT authentication failed - only send error if reply hasn't been sent yet
		if (!reply.sent) {
			reply.code(401).send({ error: 'Invalid JWT token' });
		}
		return;
	}

	// Invalid Authorization header format
	reply.code(401).send({ error: 'Invalid Authorization header format. Use "Bearer <jwt-token>" or "ApiKey <api-key>"' });
}

/**
 * Check if the authenticated request has the required access permissions.
 * JWT users always have full access (equivalent to admin role).
 * API keys are checked against their role and the list of allowed roles.
 * Admin role always has access (can be omitted from allowedRoles, but can be specified for clarity).
 * 
 * @param request - Authenticated request
 * @param reply - Fastify reply object
 * @param allowedRoles - Array of roles that are allowed to access this endpoint. Admin is always allowed.
 * @returns true if access is allowed, false if denied (and reply is sent)
 */
export function checkAccess(request: AuthenticatedRequest, reply: FastifyReply, allowedRoles: ('trace' | 'developer' | 'admin')[]): boolean {
	// JWT users always have full access (equivalent to admin)
	if (request.authenticatedWith === 'jwt') {
		return true;
	}

	// For API keys, check role
	if (request.authenticatedWith === 'api_key') {
		if (!request.apiKey) {
			console.error('checkAccess: authenticatedWith is api_key but apiKey is not set');
			reply.code(500).send({ error: 'Internal error: API key object missing' });
			return false;
		}
		
		const apiKeyRole = request.apiKey.role;
		if (!apiKeyRole) {
			reply.code(403).send({ error: 'API key does not have a role' });
			return false;
		}
		
		// Admin role always has access
		if (apiKeyRole === 'admin') {
			return true;
		}
		
		// Check if the API key's role is in the allowed roles list
		if (!allowedRoles.includes(apiKeyRole)) {
			reply.code(403).send({ error: `API key role '${apiKeyRole}' is not allowed. Required roles: ${allowedRoles.join(', ')}` });
			return false;
		}
		
		return true;
	}
	
	// This should not happen if authentication middleware worked correctly
	console.error('checkAccess: authenticatedWith is not set or has unexpected value', request.authenticatedWith);
	reply.code(500).send({ error: 'Internal error: authentication state invalid' });
	return false;
}

/**
 * Check if the user is a super admin (member of AIQA organisation).
 * If AIQA org has ANYONE_EMAIL as a member, then always return true.
 * @param userId - User ID to check
 * @returns Promise resolving to true if user is a super admin, false otherwise
 */
export async function isSuperAdmin(userId: string): Promise<boolean> {
	if (!userId) {
		return false;
	}
	const aiqaOrg = await getOrganisation(AIQA_ORG_ID);
	if (!aiqaOrg) {
		return false;
	}
	
	// Check if ANYONE_EMAIL is a member - if so, everyone is a super admin
	const members = await getOrganisationMembers(AIQA_ORG_ID);
	const hasAnyoneEmail = members.some(member => member.email === ANYONE_EMAIL);
	if (hasAnyoneEmail) {
		return true;
	}
	
	// Otherwise, check if the user is a member
	return aiqaOrg.members && aiqaOrg.members.includes(userId);
}

/**
 * Authenticate from gRPC metadata (for gRPC server).
 * Extracts Authorization header from gRPC metadata and performs authentication.
 */
export async function authenticateFromGrpcMetadata(request: AuthenticatedRequest): Promise<void> {
  // gRPC metadata uses lowercase keys
  const authHeader = (request.headers as any).authorization || (request.headers as any).Authorization;
  
  if (!authHeader) {
    throw new Error('Missing Authorization header');
  }

  // Check for API key authentication: "ApiKey <api-key>"
  if (authHeader.startsWith('ApiKey ')) {
    const apiKey = authHeader.substring(7).trim();
    const keyHash = hashApiKey(apiKey);
    const apiKeyRecord = await getApiKeyByHash(keyHash);
    
    if (!apiKeyRecord) {
      throw new Error('Invalid API key');
    }
    
    request.organisation = apiKeyRecord.organisation;
    request.apiKeyId = apiKeyRecord.id;
    request.apiKey = apiKeyRecord;
    request.authenticatedWith = 'api_key';
    return;
  }

  // Check for JWT authentication: "Bearer <jwt-token>"
  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7).trim();
    const jwtSuccess = await authenticateWithJwt(request, null as any, token);
    if (!jwtSuccess) {
      throw new Error('Invalid JWT token');
    }
    return;
  }

  throw new Error('Invalid Authorization header format. Use "Bearer <jwt-token>" or "ApiKey <api-key>"');
}

/**
 * Legacy function name for backward compatibility.
 * @deprecated Use authenticate() instead.
 */
export const authenticateApiKey = authenticate;
