/**
 * Fictional demo identities shared by the seed and the mock GitHub server
 * (tools/mock-github), so signing in through the mock lands on seeded data.
 * Pure data: safe to import anywhere.
 */
import type { RepoPermission } from '@revo/shared';

export const DEMO_INSTALLATION = {
  githubId: 41_000_001,
  accountLogin: 'northwind-labs',
  accountType: 'Organization' as const,
  /** installation.account.id (the mock GitHub uses the same). */
  accountGithubId: 71_000_001,
};

export const DEMO_REPOS = [
  { githubId: 51_000_001, name: 'storefront', fullName: 'northwind-labs/storefront', private: false },
  { githubId: 51_000_002, name: 'api', fullName: 'northwind-labs/api', private: true },
  { githubId: 51_000_003, name: 'mobile', fullName: 'northwind-labs/mobile', private: true },
] as const;

/** The user the mock GitHub signs in by default. Has access to every demo repo. */
export const DEMO_USER = { githubId: 61_000_001, login: 'maya-chen', name: 'Maya Chen' } as const;

/** A second user with access to the storefront repo only (for access-scoping tests). */
export const DEMO_USER_LIMITED = { githubId: 61_000_002, login: 'jonas-weber', name: 'Jonas Weber' } as const;

export const DEMO_USERS = [DEMO_USER, DEMO_USER_LIMITED] as const;

/** Repos (by githubId) each demo user can see on GitHub. */
export const DEMO_ACCESS: Record<number, readonly number[]> = {
  [DEMO_USER.githubId]: DEMO_REPOS.map((r) => r.githubId),
  [DEMO_USER_LIMITED.githubId]: [DEMO_REPOS[0].githubId],
};

/**
 * Each demo user's role on the repos they see: Maya administers them, Jonas
 * only reads storefront (so he cannot change settings or start a review).
 */
export const DEMO_PERMISSION: Record<number, RepoPermission> = {
  [DEMO_USER.githubId]: 'admin',
  [DEMO_USER_LIMITED.githubId]: 'read',
};

/** PR authors used by the seed. */
export const DEMO_AUTHORS = [
  'maya-chen',
  'jonas-weber',
  'priya-raman',
  'tomas-lindqvist',
  'amara-okafor',
] as const;
