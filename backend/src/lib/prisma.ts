import { PrismaClient } from '@prisma/client';
import { logger } from './logger.js';

let prisma: PrismaClient;

export function getPrisma(): PrismaClient {
  if (!prisma) {
    prisma = new PrismaClient({
      log:
        process.env.NODE_ENV === 'development'
          ? ['query', 'info', 'warn', 'error']
          : ['error', 'warn'],
    });

    prisma.$connect().catch((err) => {
      logger.error({ err }, 'Prisma connection error');
    });
  }
  return prisma;
}

export { prisma };
