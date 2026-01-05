/**
 * Rate limiting utilities using Redis.
 * Implements sliding window rate limiting per organisation.
 */

import { createClient, RedisClientType } from 'redis';

let redisClient: RedisClientType | null = null;

/**
 * Initialize Redis client connection.
 * Should be called once at server startup.
 */
export async function initRedis(url?: string): Promise<void> {
  const redisUrl = url || process.env.REDIS_URL || 'redis://localhost:6379';
  redisClient = createClient({ url: redisUrl });
  
  redisClient.on('error', (err) => {
    console.error('Redis Client Error:', err);
  });
  
  await redisClient.connect();
  console.log('Redis client connected');
}

/**
 * Close Redis client connection.
 * Should be called during graceful shutdown.
 */
export async function closeRedis(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
    console.log('Redis client disconnected');
  }
}

/**
 * Check if rate limit is exceeded for an organisation.
 * Uses a sliding window approach: counts spans posted in the last hour.
 * 
 * @param organisationId - Organisation ID to check rate limit for
 * @param limitPerHour - Maximum number of spans allowed per hour (default: 1000)
 * @returns Object with `allowed` boolean and `remaining` count, or null if Redis is unavailable
 */
export async function checkRateLimit(
  organisationId: string,
  limitPerHour: number = 1000
): Promise<{ allowed: boolean; remaining: number; resetAt: number } | null> {
  if (!redisClient) {
    // If Redis is not available, allow the request (fail open)
    console.warn('Redis not available, rate limiting disabled');
    return null;
  }

  try {
    const key = `rate_limit:span:${organisationId}`;
    const now = Date.now();
    const oneHourAgo = now - 3600000; // 1 hour in milliseconds
    
    // Use sorted set to track spans with timestamps
    // Remove old entries (older than 1 hour)
    await redisClient.zRemRangeByScore(key, 0, oneHourAgo);
    
    // Count current entries in the window
    const count = await redisClient.zCard(key);
    
    // Check if limit is exceeded
    const allowed = count < limitPerHour;
    const remaining = Math.max(0, limitPerHour - count);
    
    // Calculate reset time (1 hour from oldest entry, or 1 hour from now if empty)
    let resetAt = now + 3600000;
    if (count > 0) {
      const oldestEntry = await redisClient.zRange(key, 0, 0);
      if (oldestEntry.length > 0) {
        const oldestScore = await redisClient.zScore(key, oldestEntry[0]);
        if (oldestScore !== null) {
          resetAt = oldestScore + 3600000;
        }
      }
    }
    
    return { allowed, remaining, resetAt };
  } catch (error) {
    console.error('Error checking rate limit:', error);
    // Fail open - allow request if Redis fails
    return null;
  }
}

/**
 * Record a span posting for rate limiting.
 * Adds current timestamp to the organisation's rate limit tracking.
 * 
 * @param organisationId - Organisation ID that posted the span
 * @param spanCount - Number of spans being posted (default: 1)
 */
export async function recordSpanPosting(
  organisationId: string,
  spanCount: number = 1
): Promise<void> {
  if (!redisClient) {
    return;
  }

  try {
    const key = `rate_limit:span:${organisationId}`;
    const now = Date.now();
    
    // Add current timestamp(s) to the sorted set
    // Use multiple entries if spanCount > 1
    const members: { score: number; value: string }[] = [];
    for (let i = 0; i < spanCount; i++) {
      // Add small offset to ensure unique values
      members.push({ score: now + i, value: `${now}-${i}` });
    }
    
    if (members.length > 0) {
      await redisClient.zAdd(key, members);
      // Set expiry on the key (1 hour + buffer)
      await redisClient.expire(key, 7200); // 2 hours expiry
    }
  } catch (error) {
    console.error('Error recording span posting:', error);
    // Fail silently - rate limiting is best effort
  }
}

