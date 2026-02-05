/**
 * Integration tests for MCP server.
 * These tests require a running server-aiqa instance.
 * Set AIQA_API_BASE_URL and AIQA_API_KEY environment variables to run.
 * 
 * Run with: node --loader ts-node/esm test/integration/integration.test.ts
 */

import { AiqaApiClient } from '../../src/client.js';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

const API_BASE_URL = process.env.AIQA_API_BASE_URL || 'http://localhost:4318';
const API_KEY = process.env.AIQA_API_KEY || '';

async function runIntegrationTests() {
  console.log('Running MCP Server Integration Tests...\n');

  if (!API_KEY) {
    console.error('ERROR: AIQA_API_KEY environment variable is required for integration tests');
    process.exit(1);
  }

  const client = new AiqaApiClient(API_BASE_URL, API_KEY);
  const testOrgId = process.env.TEST_ORG_ID || '';
  let testDatasetId: string | null = null;

  if (!testOrgId) {
    console.warn('WARNING: TEST_ORG_ID not set - some tests will be skipped\n');
  }

  // Test 1: List datasets
  if (testOrgId) {
    try {
      console.log('Test 1: List datasets...');
      const datasets = await client.listDatasets(testOrgId);
      assert(Array.isArray(datasets), 'Datasets should be an array');
      console.log('✓ List datasets test passed\n');
    } catch (error) {
      console.error('✗ List datasets test failed:', error);
    }
  }

  // Test 2: Create and query dataset
  if (testOrgId) {
    try {
      console.log('Test 2: Create and query dataset...');
      const datasetName = `test-dataset-${Date.now()}`;
      const dataset = await client.createDataset({
        organisation: testOrgId,
        name: datasetName,
        description: 'Test dataset for integration tests',
      });

      assert(dataset !== null, 'Dataset should be created');
      assert(dataset.id !== undefined, 'Dataset should have an id');
      assert(dataset.name === datasetName, 'Dataset name should match');
      testDatasetId = dataset.id;

      // Query it back
      const found = await client.getDataset(dataset.id);
      assert(found.id === dataset.id, 'Found dataset ID should match');
      console.log('✓ Create and query dataset test passed\n');
    } catch (error) {
      console.error('✗ Create dataset test failed:', error);
    }
  }

  // Test 3: Query traces
  if (testOrgId) {
    try {
      console.log('Test 3: Query traces...');
      const result = await client.queryTraces(testOrgId, undefined, 10, 0, undefined, undefined, true);
      assert(result !== null, 'Result should not be null');
      assert(result.hits !== undefined, 'Result should have hits');
      assert(result.total !== undefined, 'Result should have total');
      assert(Array.isArray(result.hits), 'Hits should be an array');
      console.log('✓ Query traces test passed\n');
    } catch (error) {
      console.error('✗ Query traces test failed:', error);
    }
  }

  // Test 4: Get trace stats
  if (testOrgId) {
    try {
      console.log('Test 4: Get trace stats...');
      const stats = await client.getTraceStats(testOrgId, undefined, 10);
      assert(stats !== null, 'Stats should not be null');
      assert(stats.count !== undefined, 'Stats should have count');
      assert(stats.tokens !== undefined, 'Stats should have tokens');
      assert(stats.cost !== undefined, 'Stats should have cost');
      assert(stats.duration !== undefined, 'Stats should have duration');
      assert(stats.feedback !== undefined, 'Stats should have feedback');
      console.log('✓ Get trace stats test passed\n');
    } catch (error) {
      console.error('✗ Get trace stats test failed:', error);
    }
  }

  // Test 5: List examples
  if (testDatasetId) {
    try {
      console.log('Test 5: List examples...');
      const examples = await client.listExamples(testDatasetId, undefined, 10);
      assert(Array.isArray(examples), 'Examples should be an array');
      console.log('✓ List examples test passed\n');
    } catch (error) {
      console.error('✗ List examples test failed:', error);
    }
  }

  console.log('Integration tests completed!');
}

runIntegrationTests().catch(console.error);
