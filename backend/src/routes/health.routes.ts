import { Router, Request, Response } from 'express';
import { getPrisma } from '../lib/prisma.js';
import { checkRedisHealth } from '../lib/redis.js';
import { checkElasticsearchHealth } from '../lib/elasticsearch.js';

const router = Router();

router.get('/', async (_req: Request, res: Response) => {
  let postgresOk = false;
  let redisOk = false;
  let esOk = false;

  // Check Postgres
  try {
    const prisma = getPrisma();
    await prisma.$queryRaw`SELECT 1`;
    postgresOk = true;
  } catch {
    postgresOk = false;
  }

  // Check Redis
  redisOk = await checkRedisHealth();

  // Check Elasticsearch
  esOk = await checkElasticsearchHealth();

  const isHealthy = postgresOk && redisOk && esOk;
  const statusCode = isHealthy ? 200 : 503;

  return res.status(statusCode).json({
    status: isHealthy ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    services: {
      postgres: postgresOk ? 'connected' : 'disconnected',
      redis: redisOk ? 'connected' : 'disconnected',
      elasticsearch: esOk ? 'connected' : 'disconnected',
    },
  });
});

export default router;
