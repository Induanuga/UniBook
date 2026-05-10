// src/cache/RedisClient.ts
// Redis client — Singleton pattern (matches BookingEngine / IAM approach).
// Provides the single shared IORedis instance used by AvailabilityCacheManager.
//
// NFR-4 / ADR-002: If Redis is unreachable the catalogue must degrade gracefully
// (fall through to PostgreSQL) rather than hard-fail, so this client uses
// lazyConnect and every cache operation wraps errors internally.

import Redis from 'ioredis';
import { config } from '../config';
import { logger } from '../utils/logger';

class RedisClientSingleton {
  private static instance: Redis | null = null;
  private static connecting = false;

  static getInstance(): Redis {
    if (!RedisClientSingleton.instance) {
      RedisClientSingleton.instance = new Redis(config.redis.url, {
        lazyConnect:         true,
        enableReadyCheck:    true,
        maxRetriesPerRequest: 3,
        retryStrategy: (times) => Math.min(times * 200, 2000),
      });

      RedisClientSingleton.instance.on('connect', () => {
        logger.info({ component: 'RedisClient', message: 'Redis connected' });
      });

      RedisClientSingleton.instance.on('error', (err: Error) => {
        logger.error({ component: 'RedisClient', message: 'Redis error', error: err.message });
      });

      RedisClientSingleton.instance.on('reconnecting', () => {
        logger.warn({ component: 'RedisClient', message: 'Redis reconnecting…' });
      });

      if (!RedisClientSingleton.connecting) {
        RedisClientSingleton.connecting = true;
        RedisClientSingleton.instance.connect().catch((err: Error) => {
          // Non-fatal at startup — cache misses will fall through to DB
          logger.warn({
            component: 'RedisClient',
            message:   'Redis initial connect failed; will retry',
            error:     err.message,
          });
        });
      }
    }

    return RedisClientSingleton.instance;
  }
}

// Export the shared instance
export const redisClient = RedisClientSingleton.getInstance();
