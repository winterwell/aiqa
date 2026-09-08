/**
 * OAuth support, for MCP clients that authenticate a user instead of carrying a
 * pre-issued API key (Cursor, Claude).
 *
 * Clients are pointed straight at the identity provider. That used to be
 * impossible: Auth0 only minted a verifiable JWT when the request named a
 * registered API in its non-standard `audience` parameter, and MCP clients do
 * not send it - they send RFC 8707 `resource`. A client talking to Auth0
 * directly came back holding an opaque token that server-aiqa could not verify,
 * so this server brokered every request to add `audience` on the way through.
 *
 * Auth0's Resource Parameter Compatibility Profile now maps `resource` onto the
 * token's audience, so the detour is gone, and with it the `/authorize`
 * redirect, the `/token`, `/register` and `/revoke` passthroughs, and the
 * authorization server metadata that described them. The provider is now the
 * authorization server clients discover and talk to, which is what RFC 9728
 * describes and what leaves the fewest moving parts in the login path.
 *
 * What replaces the code is configuration, and it is load-bearing: the provider
 * needs an API whose identifier is exactly this server's public URL, because
 * that URL is the `resource` its clients ask for. DEPLOYMENT.md has the detail.
 */

/** How long to wait on the identity provider before giving up. */
const UPSTREAM_TIMEOUT_MS = 10_000;

export interface OAuthConfig {
  /** Issuer URL of the identity provider, e.g. https://example.eu.auth0.com/ */
  issuer: string;
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
 */
export function loadOAuthConfig(env: NodeJS.ProcessEnv = process.env): OAuthConfig | null {
  const issuer = env.AIQA_OAUTH_ISSUER?.trim();
  if (!issuer) {
    return null;
  }
  // AIQA_OAUTH_AUDIENCE configured the audience the broker injected. Nothing
  // reads it now, and a leftover value would otherwise look like it was still
  // in effect - so say plainly that it is not, and where the audience comes
  // from instead. Not fatal: it is a stale variable, not a broken deploy.
  if (env.AIQA_OAUTH_AUDIENCE?.trim()) {
    console.warn(
      'AIQA_OAUTH_AUDIENCE is set but no longer used, and can be removed. The token audience now ' +
        "comes from the `resource` clients send, which is this server's public URL - so it is the " +
        'provider-side API identifier that has to match it, not this variable.',
    );
  }
  return { issuer };
}

/**
 * Check the provider can actually serve the flow, and return the issuer
 * identifier to advertise to clients.
 *
 * Nothing here is needed to build a request - clients talk to the provider
 * themselves now. It runs so that a provider which cannot support the flow
 * shows up at startup, as oauth: 'error' on /health, rather than as a login
 * that fails in someone's editor with nothing to go on.
 */
export async function discoverIssuer(issuer: string): Promise<string> {
  const url = `${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`;
  const response = await fetch(url, { signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
  if (!response.ok) {
    throw new Error(`${url} returned HTTP ${response.status}`);
  }
  const doc = (await response.json()) as Record<string, unknown>;
  const str = (key: string) => (typeof doc[key] === 'string' ? (doc[key] as string) : undefined);

  // Required, not optional: without dynamic registration a client cannot get a
  // client_id at all, and neither Cursor nor Claude will ask a user for one. On
  // Auth0 this needs the tenant's OIDC Dynamic Application Registration
  // setting turned on.
  if (!str('registration_endpoint')) {
    throw new Error(
      `${url} advertises no registration_endpoint, so clients cannot self-register ` +
        '(on Auth0, enable OIDC Dynamic Application Registration)',
    );
  }

  // Advertise the issuer the provider names itself by, not the configured
  // string. They differ in ways that matter to a client: Auth0's canonical
  // issuer carries a trailing slash, and RFC 8414 discovery is performed
  // against this exact value.
  const advertised = str('issuer');
  if (!advertised) {
    throw new Error(`${url} advertises no issuer`);
  }
  try {
    // new URL rather than URL.canParse: the latter needs Node 20, and the cost
    // of being wrong about the deployed runtime is OAuth sitting silently in
    // the 'error' state.
    new URL(advertised);
  } catch {
    throw new Error(`${url} advertises an unusable issuer: ${advertised}`);
  }
  return advertised;
}
