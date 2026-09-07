import tap from 'tap';
import { acceptedAudiences, adminAudiences, roleForJwt, checkAccess } from '../dist/server_auth.js';

// The audience helpers take an env argument precisely so tests need not mutate
// process.env; each case passes exactly the variables it is about.
const MGMT = 'https://tenant.eu.auth0.com/api/v2/';
const AIQA = 'https://server-aiqa.winterwell.com';

tap.test('acceptedAudiences - parses a comma-separated list', t => {
  t.same(acceptedAudiences({ AUTH0_AUDIENCE: `${MGMT},${AIQA}` }), [MGMT, AIQA]);
  t.same(acceptedAudiences({ AUTH0_AUDIENCE: ` ${MGMT} , ${AIQA} ` }), [MGMT, AIQA], 'trims whitespace');
  t.same(acceptedAudiences({ AUTH0_AUDIENCE: `${MGMT},,` }), [MGMT], 'drops empty entries');
  t.same(acceptedAudiences({}), [], 'unset means no audience verification');
  t.end();
});

tap.test('adminAudiences - defaults to the first accepted audience', t => {
  // The point of the default: adding an audience for MCP clients must not hand
  // them admin, and must not change what the webapp can do.
  t.same(adminAudiences({ AUTH0_AUDIENCE: `${MGMT},${AIQA}` }), [MGMT]);
  t.same(adminAudiences({ AUTH0_AUDIENCE: MGMT }), [MGMT], 'single audience keeps admin');
  t.same(
    adminAudiences({ AUTH0_AUDIENCE: `${MGMT},${AIQA}`, AUTH0_ADMIN_AUDIENCES: AIQA }),
    [AIQA],
    'an explicit list wins over the default',
  );
  t.same(adminAudiences({}), [], 'nothing is admin when no audience is configured');
  t.end();
});

tap.test('roleForJwt - admin only for an admin audience', t => {
  const env = { AUTH0_AUDIENCE: `${MGMT},${AIQA}` };
  t.equal(roleForJwt(MGMT, env), 'admin', 'webapp audience keeps admin');
  t.equal(roleForJwt(AIQA, env), 'developer', 'MCP audience gets developer');
  // Auth0 access tokens for a custom API commonly carry aud as an array.
  t.equal(roleForJwt([AIQA, `${MGMT}userinfo`], env), 'developer', 'array audience, none admin');
  t.equal(roleForJwt([AIQA, MGMT], env), 'admin', 'array audience including an admin one');
  t.equal(roleForJwt(undefined, env), 'developer', 'a token with no audience is not admin');
  t.equal(roleForJwt('https://somewhere.else', env), 'developer', 'unknown audience is not admin');
  t.end();
});

/** Minimal stand-in for FastifyReply, recording what checkAccess sent. */
function fakeReply() {
  return {
    statusCode: undefined as number | undefined,
    body: undefined as any,
    code(status: number) { this.statusCode = status; return this; },
    send(body: any) { this.body = body; return this; },
  };
}

tap.test('checkAccess - allows a role that is listed, and admin always', t => {
  const developerKey = { authenticatedWith: 'api_key', role: 'developer', apiKey: { role: 'developer' } };
  t.ok(checkAccess(developerKey as any, fakeReply() as any, ['developer', 'admin']));
  t.ok(checkAccess({ authenticatedWith: 'jwt', role: 'admin' } as any, fakeReply() as any, ['developer']),
    'admin passes even when not listed');
  t.ok(checkAccess({ authenticatedWith: 'jwt', role: 'developer' } as any, fakeReply() as any, ['developer', 'admin']),
    'a developer JWT reaches developer endpoints');
  t.end();
});

tap.test('checkAccess - refuses a developer JWT on an admin-only endpoint', t => {
  // This is what keeps an OAuth-connected MCP client away from DELETE /user/:id
  // and DELETE /organisation/:id, the only two admin-only endpoints.
  const reply = fakeReply();
  t.notOk(checkAccess({ authenticatedWith: 'jwt', role: 'developer' } as any, reply as any, ['admin']));
  t.equal(reply.statusCode, 403);
  t.match(reply.body?.error, /Token role 'developer' is not allowed/);
  t.end();
});

tap.test('checkAccess - trace keys stay out of developer endpoints', t => {
  const reply = fakeReply();
  const traceKey = { authenticatedWith: 'api_key', role: 'trace', apiKey: { role: 'trace' } };
  t.notOk(checkAccess(traceKey as any, reply as any, ['developer', 'admin']));
  t.equal(reply.statusCode, 403);
  t.match(reply.body?.error, /API key role 'trace' is not allowed/);
  t.end();
});

tap.test('checkAccess - organisation mismatch is refused before anything else', t => {
  const reply = fakeReply();
  const adminKey = { authenticatedWith: 'api_key', role: 'admin', apiKey: { role: 'admin' }, organisation: 'org-1' };
  t.notOk(checkAccess(adminKey as any, reply as any, ['developer', 'admin'], 'org-2'));
  t.equal(reply.statusCode, 403);
  t.match(reply.body?.error, /not a member of this organisation/);
  t.end();
});

tap.test('checkAccess - an inconsistent auth state fails closed', t => {
  const unauthenticated = fakeReply();
  t.notOk(checkAccess({} as any, unauthenticated as any, ['developer', 'admin']));
  t.equal(unauthenticated.statusCode, 500, 'no credential recorded');

  const keyWithoutRecord = fakeReply();
  t.notOk(checkAccess({ authenticatedWith: 'api_key' } as any, keyWithoutRecord as any, ['developer', 'admin']));
  t.equal(keyWithoutRecord.statusCode, 500, 'api_key with no key object');

  const roleless = fakeReply();
  t.notOk(checkAccess({ authenticatedWith: 'jwt' } as any, roleless as any, ['developer', 'admin']));
  t.equal(roleless.statusCode, 403, 'no role resolved');
  t.end();
});
