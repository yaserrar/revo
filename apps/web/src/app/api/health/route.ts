import { prisma } from '~/server/config/prisma';
import { route } from '~/server/http/route';

export const dynamic = 'force-dynamic';

/** Liveness + database check for Docker and Traefik. */
export const GET = route({ auth: 'public' }, async () => {
  await prisma.$queryRaw`SELECT 1`;
  return { ok: true };
});
