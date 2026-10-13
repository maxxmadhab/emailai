import { createApp } from './app.js';
import { getEnv } from './config/env.js';
import { logger } from './lib/logger.js';
import { getPrisma } from './lib/prisma.js';

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

  const server = app.listen(env.PORT, () => {
    logger.info(`Server listening on port ${env.PORT} in ${env.NODE_ENV} mode`);
  });

  const shutdown = async (signal: string) => {
    logger.info(`${signal} received, starting graceful shutdown`);
    server.close(async () => {
      logger.info('HTTP server closed');
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

bootstrap().catch((err) => {
  logger.fatal({ err }, 'Fatal error during application startup');
  process.exit(1);
});
