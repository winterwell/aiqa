/**
 * Simple unit tests for AiqaApiClient
 * Run with: node --loader ts-node/esm test/unit/client.test.ts
 */

import { AiqaApiClient } from '../../src/client.js';

// Simple test runner
function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function testClient() {
  console.log('Testing AiqaApiClient...');
  
  const baseUrl = 'http://localhost:4318';
  const apiKey = 'test-api-key';
  const client = new AiqaApiClient(baseUrl, apiKey);
  
  // Test that client is created
  assert(client !== null, 'Client should be created');
  
  // Test URL construction (basic check)
  // Note: Full integration tests require a running server
  console.log('✓ Client creation test passed');
  console.log('Note: Full API tests require a running server-aiqa instance');
}

/**
 * validateCredential decides whether a client may open an MCP session, so the
 * mapping from HTTP status to verdict is worth pinning down: only a 401 means
 * the credential itself was rejected.
 */
async function testValidateCredential() {
  console.log('Testing validateCredential...');

  const realFetch = globalThis.fetch;
  const stub = (status: number) => {
    globalThis.fetch = (async () => new Response('{}', { status })) as typeof fetch;
  };

  try {
    stub(200);
    assert(
      (await new AiqaApiClient('http://x', 'k').validateCredential()) === 'valid',
      '200 should be valid',
    );

    stub(403);
    assert(
      (await new AiqaApiClient('http://x', 'k').validateCredential()) === 'valid',
      '403 (authenticated, wrong role) should still be valid',
    );

    stub(400);
    assert(
      (await new AiqaApiClient('http://x', 'k').validateCredential()) === 'valid',
      '400 (organisation not resolvable) should still be valid',
    );

    stub(401);
    assert(
      (await new AiqaApiClient('http://x', 'k').validateCredential()) === 'invalid',
      '401 should be invalid',
    );

    globalThis.fetch = (async () => {
      throw new Error('ECONNREFUSED');
    }) as typeof fetch;
    assert(
      (await new AiqaApiClient('http://x', 'k').validateCredential()) === 'unknown',
      'an unreachable server should be unknown, not invalid',
    );
  } finally {
    globalThis.fetch = realFetch;
  }

  console.log('\u2713 validateCredential tests passed');
}

testClient()
  .then(testValidateCredential)
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
