import 'server-only';
import { prisma } from '../config/prisma';
import { encryptSecret } from '../security/crypto';
import type { GithubTokens } from './github-user-api';

export type GithubProfile = { id: number; login: string; name?: string | null; avatar_url?: string | null };

const secondsFromNow = (s: number | undefined) => (s ? new Date(Date.now() + s * 1000) : null);

/** Encrypted token columns for a fresh token response. */
export function tokenColumns(tokens: GithubTokens) {
  return {
    accessTokenEnc: encryptSecret(tokens.access_token),
    accessTokenExpiresAt: secondsFromNow(tokens.expires_in),
    refreshTokenEnc: tokens.refresh_token ? encryptSecret(tokens.refresh_token) : null,
    refreshTokenExpiresAt: secondsFromNow(tokens.refresh_token_expires_in),
  };
}

/** Creates or updates the Revo user behind a GitHub sign-in and stores its token encrypted. */
export async function upsertGithubUser(profile: GithubProfile, tokens: GithubTokens) {
  const data = {
    login: profile.login,
    name: profile.name ?? null,
    avatarUrl: profile.avatar_url ?? null,
    ...tokenColumns(tokens),
  };
  return prisma.user.upsert({
    where: { githubId: BigInt(profile.id) },
    create: { githubId: BigInt(profile.id), ...data },
    update: data,
  });
}
