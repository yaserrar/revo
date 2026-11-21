import 'server-only';
import { createPrismaClient, type PrismaClient } from '@revo/db';
import { env } from './env';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/** One client per process (reused across hot reloads in development). */
export const prisma = globalForPrisma.prisma ?? createPrismaClient({ connectionString: env.DATABASE_URL });

if (env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
