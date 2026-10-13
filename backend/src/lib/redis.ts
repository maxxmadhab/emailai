import { Redis } from 'ioredis';
import { getEnv } from '../config/env.js';
import { logger } from './logger.js';

let redisClient: Redis | null = null;

export function getRedis(): Redis {
  if (!redisClient) {
    const env = getEnv();
    redisClient = new Redis({
      host: env.REDIS_HOST,
      port: env.REDIS_PORT,
      password: env.REDIS_PASSWORD || undefined,
      maxRetriesPerRequest: null, // Required by BullMQ
      connectTimeout: 1500,
      retryStrategy: (times) => {
        return Math.min(times * 500, 5000);
      },
      lazyConnect: true,
    });

    redisClient.on('connect', () => {
      logger.info('Connected to Redis');
    });

    redisClient.on('error', (err) => {
      logger.warn({ err: err.message }, 'Redis error');
    });
  }

  return redisClient;
}

export async function checkRedisHealth(): Promise<boolean> {
  try {
    const client = getRedis();
    if (client.status === 'wait') {
      await Promise.race([
        client.connect(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Redis connect timeout')), 1000)),
      ]);
    }
    const pong = await Promise.race([
      client.ping(),
      new Promise<string>((_, reject) => setTimeout(() => reject(new Error('Redis ping timeout')), 1000)),
    ]);
    return pong === 'PONG';
  } catch (err: any) {
    logger.warn({ err: err.message }, 'Redis health check failed');
    return false;
  }
}
