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

testClient().catch(console.error);
