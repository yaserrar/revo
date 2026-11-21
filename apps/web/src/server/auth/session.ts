import 'server-only';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import type { UserDto } from '@revo/shared';
import { prisma } from '../config/prisma';
import { presentUser } from '../presenters/user.presenter';
import { auth } from './auth';
import { needsGithubSignIn } from './repo-access';

export type SessionUser = UserDto;

/** The signed-in user, read once per request; null when signed out or deleted. */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) return null;
  const user = await prisma.user.findUnique({ where: { id } });
  return user ? presentUser(user) : null;
});

/**
 * For Server Components and layouts: redirects to /sign-in when signed out,
 * or when GitHub no longer accepts the user's authorization (sign in again).
 */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect('/sign-in');
  if (await needsGithubSignIn(user.id)) redirect('/sign-in?reauth=1');
  return user;
}
