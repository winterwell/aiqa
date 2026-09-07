/**
 * OAuth support, for MCP clients that authenticate a user instead of carrying a
 * pre-issued API key (Cursor, Claude).
 *
 * This server is the authorization server those clients talk to, and it brokers
 * every request to the real identity provider. Clients cannot be pointed
 * straight at the provider: Auth0 only mints a verifiable JWT when the request
 * names a registered API in its non-standard `audience` parameter, and MCP
 * clients do not send it - they send RFC 8707 `resource`. A client talking to
 * Auth0 directly would come back holding an opaque token that server-aiqa
 * cannot verify. Brokering is what lets us add `audience` on the way through.
 *
 * The broker is deliberately stateless. The provider stays the only place that
 * registers clients, validates redirect URIs and checks PKCE, so there is no
 * client store to keep, no authorization codes of our own, and nothing that
 * needs rebuilding after a restart.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

/** How long to wait on the identity provider before giving up. */
const UPSTREAM_TIMEOUT_MS = 10_000;

export interface OAuthConfig {
  /** Issuer URL of the identity provider, e.g. https://example.eu.auth0.com/ */
  issuer: string;
  /** The provider's API identifier to request tokens for, sent as `audience`. */
  audience: string;
}

/** The provider endpoints we broker to, as the provider itself advertises them. */
export interface UpstreamEndpoints {
  authorization: string;
  token: string;
  registration: string;
  revocation?: string;
  scopesSupported?: string[];
  tokenAuthMethods?: string[];
}

/**
 * Whether OAuth is available, and if not, whether that was intended.
 * Reported by /health: 'error' means configured but not working, which is
 * otherwise invisible until a user tries to connect.
 */
export type OAuthState = 'disabled' | 'enabled' | 'error';

/**
 * Read the OAuth configuration. Returns null when OAuth is switched off, which
 * is the default: with nothing configured the server stays API-key only.
 *
 * A half-set configuration throws instead of quietly disabling OAuth. It can
 * only be a deploy mistake, and the alternative is discovering it later as
 * clients mysteriously failing to authenticate.
 */
export function loadOAuthConfig(env: NodeJS.ProcessEnv = process.env): OAuthConfig | null {
  const issuer = env.AIQA_OAUTH_ISSUER?.trim();
  const audience = env.AIQA_OAUTH_AUDIENCE?.trim();
  if (!issuer && !audience) {
    return null;
  }
  if (!issuer || !audience) {
    throw new Error(
      'OAuth is half-configured: AIQA_OAUTH_ISSUER and AIQA_OAUTH_AUDIENCE must be set together ' +
        `(issuer=${issuer || 'unset'}, audience=${audience || 'unset'})`,
    );
  }
  return { issuer, audience };
}

/**
 * Read the provider's own metadata, so the endpoints we broker to come from the
 * provider rather than being hardcoded to one vendor's URL shapes.
 */
export async function discoverUpstream(issuer: string): Promise<UpstreamEndpoints> {
  const url = `${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`;
  const response = await fetch(url, { signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
  if (!response.ok) {
    throw new Error(`${url} returned HTTP ${response.status}`);
  }
  const doc = (await response.json()) as Record<string, unknown>;
  const str = (key: string) => (typeof doc[key] === 'string' ? (doc[key] as string) : undefined);
  const strList = (key: string) =>
    Array.isArray(doc[key])
      ? (doc[key] as unknown[]).filter((v): v is string => typeof v === 'string')
      : undefined;

  const endpoints = {
    authorization: str('authorization_endpoint'),
    token: str('token_endpoint'),
    // Required, not optional: without dynamic registration a client cannot get
    // a client_id at all, and neither Cursor nor Claude will ask a user for
    // one. On Auth0 this needs the tenant's OIDC Dynamic Application
    // Registration setting turned on.
    registration: str('registration_endpoint'),
  };
  const missing = Object.entries(endpoints)
    .filter(([, value]) => !value)
    .map(([key]) => key);
  if (missing.length) {
    throw new Error(`${url} does not advertise: ${missing.join(', ')}`);
  }

  // Check the URLs parse here rather than on the first request. Otherwise a
  // malformed document is a 500 for whoever happens to try to log in, instead
  // of an error at startup with oauth: 'error' on /health.
  for (const [key, value] of Object.entries({ ...endpoints, revocation: str('revocation_endpoint') })) {
    if (value === undefined) {
      continue;
    }
    try {
      // new URL rather than URL.canParse: the latter needs Node 20, and the
      // cost of being wrong about the deployed runtime is OAuth sitting
      // silently in the 'error' state.
      new URL(value);
    } catch {
      throw new Error(`${url} advertises an unusable ${key}_endpoint: ${value}`);
    }
  }

  return {
    authorization: endpoints.authorization!,
    token: endpoints.token!,
    registration: endpoints.registration!,
    revocation: str('revocation_endpoint'),
    scopesSupported: strList('scopes_supported'),
    tokenAuthMethods: strList('token_endpoint_auth_methods_supported'),
  };
}

export interface OAuthProxyOptions {
  config: OAuthConfig;
  endpoints: UpstreamEndpoints;
  /** This server's public base URL, as advertised to clients. */
  publicBaseUrl: (request: FastifyRequest) => string;
  /** Cache-Control for the metadata document, matching the other discovery route. */
  cacheControl: string;
}

/**
 * Register the brokered OAuth endpoints. Only called when OAuth is configured
 * and the provider's metadata could be read, so the routes exist exactly when
 * they can actually work.
 */
export function registerOAuthProxy(fastify: FastifyInstance, options: OAuthProxyOptions): void {
  const { config, endpoints, publicBaseUrl, cacheControl } = options;

  // The token endpoint is form-encoded (RFC 6749) and Fastify has no parser for
  // that by default. We want the bytes untouched anyway - the provider is the
  // one validating them - so keep the raw string and pass it straight on.
  fastify.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string' },
    (_request, body, done) => done(null, body),
  );

  // RFC 8414 authorization server metadata. It describes this server's brokered
  // endpoints, not the provider's, because clients must come through here for
  // the `audience` to be added.
  fastify.get('/.well-known/oauth-authorization-server', async (request, reply) => {
    const base = publicBaseUrl(request);
    reply.header('Cache-Control', cacheControl);
    return {
      issuer: base,
      authorization_endpoint: `${base}/authorize`,
      token_endpoint: `${base}/token`,
      registration_endpoint: `${base}/register`,
      ...(endpoints.revocation ? { revocation_endpoint: `${base}/revoke` } : {}),
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      // S256 only. The MCP spec requires it, and advertising `plain` as well
      // would let a client downgrade its own protection.
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: endpoints.tokenAuthMethods ?? [
        'client_secret_post',
        'client_secret_basic',
        'none',
      ],
      ...(endpoints.scopesSupported ? { scopes_supported: endpoints.scopesSupported } : {}),
    };
  });

  // Hand the user off to the provider, adding `audience` so what comes back is
  // a JWT for the AIQA API rather than an opaque token.
  fastify.get('/authorize', async (request, reply) => {
    const target = new URL(endpoints.authorization);
    // Repeated query parameters are not valid in an authorization request
    // (RFC 6749 s3.1), so anything not a single string is dropped rather than
    // guessed at.
    for (const [key, value] of Object.entries(request.query as Record<string, unknown>)) {
      if (typeof value === 'string') {
        target.searchParams.set(key, value);
      }
    }
    // Set last and unconditionally: a client must not be able to pick which API
    // its token is valid for by supplying its own audience.
    target.searchParams.set('audience', config.audience);
    return reply.redirect(target.toString(), 302);
  });

  /**
   * Pass a POST through to the provider untouched and hand its answer back
   * unchanged. Verbatim matters: the provider validates PKCE, client
   * credentials and authorization codes, and its error bodies are what make a
   * failure diagnosable in the client - a disabled registration endpoint, for
   * instance, says so in as many words.
   */
  async function forward(
    upstreamUrl: string,
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const headers: Record<string, string> = {
      'Content-Type': (request.headers['content-type'] as string) ?? 'application/json',
    };
    // client_secret_basic puts the client's credentials in this header.
    if (request.headers.authorization) {
      headers.Authorization = request.headers.authorization;
    }
    const body = typeof request.body === 'string' ? request.body : JSON.stringify(request.body ?? {});

    let upstream: Response;
    try {
      upstream = await fetch(upstreamUrl, {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });
    } catch (error) {
      // Never log the body: it carries authorization codes and client secrets.
      fastify.log.error({ err: error, upstreamUrl }, 'OAuth broker request failed');
      reply.code(502).send({
        error: 'server_error',
        error_description: 'The identity provider could not be reached',
      });
      return;
    }

    const text = await upstream.text();
    reply
      .code(upstream.status)
      .header('Content-Type', upstream.headers.get('content-type') ?? 'application/json')
      .send(text);
  }

  fastify.post('/token', (request, reply) => forward(endpoints.token, request, reply));
  fastify.post('/register', (request, reply) => forward(endpoints.registration, request, reply));
  if (endpoints.revocation) {
    const revocation = endpoints.revocation;
    fastify.post('/revoke', (request, reply) => forward(revocation, request, reply));
  }
}
