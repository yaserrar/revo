import type { User } from '@prisma/client';
import { db } from './db';
import { HttpError } from './http';

const SESSION_COOKIE = 'hg_session';

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get('cookie') ?? '';
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

/** The signed-in user, or null. Expired sessions count as signed out. */
export async function getUser(req: Request): Promise<User | null> {
  const token = readCookie(req, SESSION_COOKIE);
  if (!token) return null;
  const session = await db.session.findUnique({ where: { token }, include: { user: true } });
  if (!session || session.expiresAt < new Date()) return null;
  return session.user;
}

export async function requireUser(req: Request): Promise<User> {
  const user = await getUser(req);
  if (!user) throw new HttpError(401, 'Sign in required');
  return user;
}

export async function requireAdmin(req: Request): Promise<User> {
  const user = await requireUser(req);
  if (user.role !== 'ADMIN') throw new HttpError(403, 'Admins only');
  return user;
}
