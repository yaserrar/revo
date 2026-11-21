import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client';

export type CreatePrismaClientOptions = {
  /** Defaults to process.env.DATABASE_URL. */
  connectionString?: string;
  log?: ('query' | 'info' | 'warn' | 'error')[];
};

/** Creates a Prisma client on the pg driver adapter. Apps keep one instance per process. */
export function createPrismaClient(options: CreatePrismaClientOptions = {}): PrismaClient {
  const connectionString = options.connectionString ?? process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set');
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
    log: options.log ?? ['warn', 'error'],
  });
}
