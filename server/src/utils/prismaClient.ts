import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === 'development'
        ? ['query', 'error', 'warn']
        : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

// Attempt an eager connection for fast first queries, but never crash the
// process if the database is briefly unavailable at startup. Individual route
// handlers wrap their queries in try/catch and surface clean errors, so the
// app (and the /api/status endpoint) stays reachable for diagnostics.
prisma.$connect().catch((err: unknown) => {
  logger.error('Failed to connect to database at startup (will retry on demand)', {
    error: err,
  });
});
