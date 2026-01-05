import dotenv from 'dotenv';
import tap from 'tap';
import { initRedis, closeRedis, checkRateLimit, recordSpanPosting } from '../dist/rate_limit.js';
import { createClient, RedisClientType } from 'redis';

dotenv.config();

// Helper to get a test Redis client for cleanup
async function getTestRedisClient(): Promise<RedisClientType | null> {
  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
  try {
    const client = createClient({ url: redisUrl });
    await client.connect();
    return client;
  } catch (error) {
    return null;
  }
}

// Helper to clean up test keys
async function cleanupTestKeys(organisationId: string): Promise<void> {
  const client = await getTestRedisClient();
  if (client) {
    const key = `rate_limit:span:${organisationId}`;
    await client.del(key);
    await client.quit();
  }
}

tap.test('Rate Limit: Redis unavailable (fail-open)', async t => {
  // Close Redis if it's open
  await closeRedis();
  
  const result = await checkRateLimit('test-org-1', 1000);
  t.equal(result, null, 'should return null when Redis is unavailable');
  
  // recordSpanPosting should not throw when Redis is unavailable
  try {
    await recordSpanPosting('test-org-1', 1);
    t.pass('should not throw when Redis is unavailable');
  } catch (error) {
    t.fail('should not throw when Redis is unavailable');
  }
  
  t.end();
});

tap.test('Rate Limit: Initialize and close Redis', async t => {
  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
  
  // Test initialization
  try {
    await initRedis(redisUrl);
    t.pass('should initialize Redis successfully');
  } catch (error) {
    t.fail('should initialize Redis successfully');
  }
  
  // Test that it's now available
  const result = await checkRateLimit('test-org-init', 1000);
  t.ok(result !== null, 'should return result when Redis is available');
  
  // Test closing
  try {
    await closeRedis();
    t.pass('should close Redis successfully');
  } catch (error) {
    t.fail('should close Redis successfully');
  }
  
  // Test that it's now unavailable
  const resultAfterClose = await checkRateLimit('test-org-init', 1000);
  t.equal(resultAfterClose, null, 'should return null after closing Redis');
  
  t.end();
});

tap.test('Rate Limit: Check limit with empty history', async t => {
  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
  const testOrgId = 'test-org-empty';
  
  // Clean up any existing keys
  await cleanupTestKeys(testOrgId);
  
  // Initialize Redis
  await initRedis(redisUrl);
  
  try {
    const result = await checkRateLimit(testOrgId, 1000);
    
    t.ok(result !== null, 'should return result');
    if (result) {
      t.equal(result.allowed, true, 'should allow when no history exists');
      t.equal(result.remaining, 1000, 'should show full limit remaining');
      t.ok(result.resetAt > Date.now(), 'resetAt should be in the future');
    }
  } finally {
    await cleanupTestKeys(testOrgId);
    await closeRedis();
  }
  
  t.end();
});

tap.test('Rate Limit: Record and check single span', async t => {
  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
  const testOrgId = 'test-org-single';
  
  // Clean up any existing keys
  await cleanupTestKeys(testOrgId);
  
  // Initialize Redis
  await initRedis(redisUrl);
  
  try {
    // Record a span posting
    await recordSpanPosting(testOrgId, 1);
    
    // Wait a tiny bit to ensure Redis has processed
    await new Promise(resolve => setTimeout(resolve, 50));
    
    // Check rate limit
    const result = await checkRateLimit(testOrgId, 1000);
    
    t.ok(result !== null, 'should return result');
    if (result) {
      t.equal(result.allowed, true, 'should allow with 1 span posted');
      t.equal(result.remaining, 999, 'should show 999 remaining');
    }
  } finally {
    await cleanupTestKeys(testOrgId);
    await closeRedis();
  }
  
  t.end();
});

tap.test('Rate Limit: Record multiple spans', async t => {
  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
  const testOrgId = 'test-org-multiple';
  
  // Clean up any existing keys
  await cleanupTestKeys(testOrgId);
  
  // Initialize Redis
  await initRedis(redisUrl);
  
  try {
    // Record multiple spans at once
    await recordSpanPosting(testOrgId, 5);
    
    // Wait a tiny bit to ensure Redis has processed
    await new Promise(resolve => setTimeout(resolve, 50));
    
    // Check rate limit
    const result = await checkRateLimit(testOrgId, 1000);
    
    t.ok(result !== null, 'should return result');
    if (result) {
      t.equal(result.allowed, true, 'should allow with 5 spans posted');
      t.equal(result.remaining, 995, 'should show 995 remaining');
    }
  } finally {
    await cleanupTestKeys(testOrgId);
    await closeRedis();
  }
  
  t.end();
});

tap.test('Rate Limit: Exceed limit', async t => {
  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
  const testOrgId = 'test-org-exceed';
  const limit = 10; // Small limit for testing
  
  // Clean up any existing keys
  await cleanupTestKeys(testOrgId);
  
  // Initialize Redis
  await initRedis(redisUrl);
  
  try {
    // Record spans up to the limit
    await recordSpanPosting(testOrgId, limit);
    
    // Wait a tiny bit to ensure Redis has processed
    await new Promise(resolve => setTimeout(resolve, 50));
    
    // Check rate limit - should be at limit but still allowed
    const resultAtLimit = await checkRateLimit(testOrgId, limit);
    t.ok(resultAtLimit !== null, 'should return result');
    if (resultAtLimit) {
      t.equal(resultAtLimit.allowed, true, 'should allow at exactly the limit');
      t.equal(resultAtLimit.remaining, 0, 'should show 0 remaining');
    }
    
    // Record one more span to exceed limit
    await recordSpanPosting(testOrgId, 1);
    
    // Wait a tiny bit
    await new Promise(resolve => setTimeout(resolve, 50));
    
    // Check rate limit - should be exceeded
    const resultExceeded = await checkRateLimit(testOrgId, limit);
    t.ok(resultExceeded !== null, 'should return result');
    if (resultExceeded) {
      t.equal(resultExceeded.allowed, false, 'should not allow when limit exceeded');
      t.equal(resultExceeded.remaining, 0, 'should show 0 remaining');
    }
  } finally {
    await cleanupTestKeys(testOrgId);
    await closeRedis();
  }
  
  t.end();
});

tap.test('Rate Limit: Default limit (1000)', async t => {
  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
  const testOrgId = 'test-org-default';
  
  // Clean up any existing keys
  await cleanupTestKeys(testOrgId);
  
  // Initialize Redis
  await initRedis(redisUrl);
  
  try {
    // Check without specifying limit (should default to 1000)
    const result = await checkRateLimit(testOrgId);
    
    t.ok(result !== null, 'should return result');
    if (result) {
      t.equal(result.remaining, 1000, 'should default to 1000 limit');
    }
  } finally {
    await cleanupTestKeys(testOrgId);
    await closeRedis();
  }
  
  t.end();
});

tap.test('Rate Limit: Sliding window - old entries removed', async t => {
  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
  const testOrgId = 'test-org-sliding';
  
  // Clean up any existing keys
  await cleanupTestKeys(testOrgId);
  
  // Initialize Redis
  await initRedis(redisUrl);
  
  try {
    const client = await getTestRedisClient();
    if (!client) {
      t.skip('Redis not available for sliding window test');
      await closeRedis();
      t.end();
      return;
    }
    
    const key = `rate_limit:span:${testOrgId}`;
    const now = Date.now();
    const twoHoursAgo = now - 7200000; // 2 hours ago
    
    // Manually add old entries (outside the 1-hour window)
    await client.zAdd(key, [
      { score: twoHoursAgo, value: `${twoHoursAgo}-0` },
      { score: twoHoursAgo + 1000, value: `${twoHoursAgo + 1000}-0` },
    ]);
    
    // Add a recent entry
    await recordSpanPosting(testOrgId, 1);
    
    await client.quit();
    
    // Wait a tiny bit
    await new Promise(resolve => setTimeout(resolve, 50));
    
    // Check rate limit - old entries should be removed
    const result = await checkRateLimit(testOrgId, 1000);
    
    t.ok(result !== null, 'should return result');
    if (result) {
      // Should only count the recent entry, not the old ones
      t.equal(result.remaining, 999, 'should only count recent entries');
    }
  } finally {
    await cleanupTestKeys(testOrgId);
    await closeRedis();
  }
  
  t.end();
});

tap.test('Rate Limit: Reset time calculation', async t => {
  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
  const testOrgId = 'test-org-reset';
  
  // Clean up any existing keys
  await cleanupTestKeys(testOrgId);
  
  // Initialize Redis
  await initRedis(redisUrl);
  
  try {
    const beforeTime = Date.now();
    
    // Record a span
    await recordSpanPosting(testOrgId, 1);
    
    // Wait a tiny bit
    await new Promise(resolve => setTimeout(resolve, 50));
    
    const afterTime = Date.now();
    
    // Check rate limit
    const result = await checkRateLimit(testOrgId, 1000);
    
    t.ok(result !== null, 'should return result');
    if (result) {
      // Reset time should be approximately 1 hour from when the span was recorded
      // Allow some margin for timing
      const expectedResetMin = beforeTime + 3600000;
      const expectedResetMax = afterTime + 3600000 + 1000; // 1 second margin
      
      t.ok(
        result.resetAt >= expectedResetMin && result.resetAt <= expectedResetMax,
        `resetAt should be approximately 1 hour from now (got ${result.resetAt}, expected between ${expectedResetMin} and ${expectedResetMax})`
      );
    }
  } finally {
    await cleanupTestKeys(testOrgId);
    await closeRedis();
  }
  
  t.end();
});

tap.test('Rate Limit: Different organisations isolated', async t => {
  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
  const testOrgId1 = 'test-org-isolated-1';
  const testOrgId2 = 'test-org-isolated-2';
  
  // Clean up any existing keys
  await cleanupTestKeys(testOrgId1);
  await cleanupTestKeys(testOrgId2);
  
  // Initialize Redis
  await initRedis(redisUrl);
  
  try {
    // Record spans for org 1
    await recordSpanPosting(testOrgId1, 5);
    
    // Record spans for org 2
    await recordSpanPosting(testOrgId2, 3);
    
    // Wait a tiny bit
    await new Promise(resolve => setTimeout(resolve, 50));
    
    // Check rate limit for org 1
    const result1 = await checkRateLimit(testOrgId1, 1000);
    t.ok(result1 !== null, 'should return result for org 1');
    if (result1) {
      t.equal(result1.remaining, 995, 'org 1 should have 995 remaining');
    }
    
    // Check rate limit for org 2
    const result2 = await checkRateLimit(testOrgId2, 1000);
    t.ok(result2 !== null, 'should return result for org 2');
    if (result2) {
      t.equal(result2.remaining, 997, 'org 2 should have 997 remaining');
    }
  } finally {
    await cleanupTestKeys(testOrgId1);
    await cleanupTestKeys(testOrgId2);
    await closeRedis();
  }
  
  t.end();
});

tap.test('Rate Limit: Error handling in checkRateLimit', async t => {
  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
  
  // Initialize Redis
  await initRedis(redisUrl);
  
  try {
    // Close Redis connection to simulate error
    await closeRedis();
    
    // Try to check rate limit - should fail open
    const result = await checkRateLimit('test-org-error', 1000);
    t.equal(result, null, 'should return null on error (fail-open)');
  } finally {
    // Make sure Redis is closed
    await closeRedis();
  }
  
  t.end();
});

tap.test('Rate Limit: Error handling in recordSpanPosting', async t => {
  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
  
  // Initialize Redis
  await initRedis(redisUrl);
  
  try {
    // Close Redis connection to simulate error
    await closeRedis();
    
    // Try to record span posting - should not throw
    try {
      await recordSpanPosting('test-org-error', 1);
      t.pass('should not throw on error');
    } catch (error) {
      t.fail('should not throw on error');
    }
  } finally {
    // Make sure Redis is closed
    await closeRedis();
  }
  
  t.end();
});

