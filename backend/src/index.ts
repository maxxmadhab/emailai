import { createApp } from './app.js';
import { getEnv } from './config/env.js';
import { logger } from './lib/logger.js';
import { getPrisma } from './lib/prisma.js';
import { emailWorker } from './worker/email.worker.js';
import { outboxDispatcherService } from './services/outbox-dispatcher.service.js';
import { startSlackWorker } from './queue/slack.queue.js';
import { elasticsearchService } from './services/elasticsearch.service.js';

async function bootstrap() {
  const env = getEnv();
  const app = createApp();

  // Test Prisma DB connection on startup
  try {
    const prisma = getPrisma();
    await prisma.$connect();
    logger.info('Connected to PostgreSQL via Prisma');
  } catch (err) {
    logger.error({ err }, 'Failed to connect to PostgreSQL database on startup');
  }

  // 1. One-time startup outbox recovery reconciliation
  try {
    await outboxDispatcherService.reconcileStartupOutbox();
  } catch (reconcileErr) {
    logger.error({ err: reconcileErr }, 'Startup outbox reconciliation error');
  }

  // 2. Initialize Elasticsearch index mappings
  try {
    await elasticsearchService.initIndex();
  } catch (esErr) {
    logger.warn({ err: esErr }, 'Elasticsearch index init skipped');
  }

  // 3. Start BullMQ background email and Slack notification workers
  try {
    emailWorker.start();
    startSlackWorker();
  } catch (workerErr) {
    logger.error({ err: workerErr }, 'Failed to start BullMQ background workers');
  }

  const server = app.listen(env.PORT, '0.0.0.0', () => {
    logger.info(`Server listening on 0.0.0.0:${env.PORT} in ${env.NODE_ENV} mode`);
  });

  const shutdown = async (signal: string) => {
    logger.info(`${signal} received, starting graceful shutdown`);

    // 1. Stop receiving new HTTP requests
    server.close(async () => {
      logger.info('HTTP server closed');

      // 2. Close BullMQ worker gracefully (waits for active jobs to finish)
      try {
        await emailWorker.close();
      } catch (err) {
        logger.error({ err }, 'Error during worker shutdown');
      }

      // 3. Disconnect Prisma
      try {
        const prisma = getPrisma();
        await prisma.$disconnect();
        logger.info('Prisma disconnected');
      } catch (err) {
        logger.error({ err }, 'Error during Prisma disconnect');
      }

      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

process.on('uncaughtException', (err: any) => {
  logger.warn({ err: err?.message || err }, 'Uncaught exception handled gracefully');
});

process.on('unhandledRejection', (reason: any) => {
  logger.warn({ reason: reason?.message || reason }, 'Unhandled rejection handled gracefully');
});

bootstrap().catch((err) => {
  logger.fatal({ err }, 'Fatal error during application startup');
  process.exit(1);
});
