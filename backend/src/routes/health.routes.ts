import { Router, Request, Response } from 'express';
import { getPrisma } from '../lib/prisma.js';
import { checkRedisHealth } from '../lib/redis.js';
import { checkElasticsearchHealth } from '../lib/elasticsearch.js';

const router = Router();

router.get('/ping', (_req: Request, res: Response) => {
  return res.status(200).json({ status: 'ok', uptime: process.uptime() });
});

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

  const isCoreHealthy = postgresOk && redisOk;
  const isFullHealthy = isCoreHealthy && esOk;
  const statusCode = isCoreHealthy ? 200 : 503;

  return res.status(statusCode).json({
    status: isFullHealthy ? 'healthy' : isCoreHealthy ? 'degraded' : 'unhealthy',
    timestamp: new Date().toISOString(),
    services: {
      postgres: postgresOk ? 'connected' : 'disconnected',
      redis: redisOk ? 'connected' : 'disconnected',
      elasticsearch: esOk ? 'connected' : 'disconnected',
    },
  });
});

export default router;
