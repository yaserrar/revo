import { Webhooks } from '@octokit/webhooks';
import { z } from 'zod';

/**
 * Checks X-Hub-Signature-256 against the raw request body (HMAC-SHA256 with
 * the webhook secret, constant-time compare). Never parse before verifying.
 */
export function createWebhookVerifier(secret: string) {
  const webhooks = new Webhooks({ secret });
  return async (rawBody: string, signature: string | null): Promise<boolean> => {
    if (!signature || !signature.startsWith('sha256=')) return false;
    try {
      return await webhooks.verify(rawBody, signature);
    } catch {
      return false;
    }
  };
}

// ── Payloads (only the fields Revo reads) ───────────────────────────────────

const AccountSchema = z.object({
  /** The account's own id: unlike the installation id, it survives an uninstall and reinstall. */
  id: z.number().int().positive().optional(),
  login: z.string(),
  type: z.string(),
  avatar_url: z.string().optional().nullable(),
});

const RepoSchema = z.object({
  id: z.number().int().positive(),
  full_name: z.string().min(3),
  private: z.boolean().optional().default(true),
});

const InstallationRefSchema = z.object({ id: z.number().int().positive() });

const InstallationSchema = InstallationRefSchema.extend({
  account: AccountSchema,
  suspended_at: z.string().nullable().optional(),
});

export const InstallationEventSchema = z.object({
  action: z.string(),
  installation: InstallationSchema,
  repositories: z.array(RepoSchema).optional(),
});
export type InstallationEvent = z.infer<typeof InstallationEventSchema>;

export const InstallationRepositoriesEventSchema = z.object({
  action: z.string(),
  installation: InstallationSchema,
  repositories_added: z.array(RepoSchema).default([]),
  repositories_removed: z.array(RepoSchema.pick({ id: true, full_name: true })).default([]),
});
export type InstallationRepositoriesEvent = z.infer<typeof InstallationRepositoriesEventSchema>;

export const PullRequestPayloadSchema = z.object({
  id: z.number().int().positive(),
  number: z.number().int().positive(),
  title: z.string(),
  body: z.string().nullable(),
  html_url: z.string(),
  draft: z.boolean().optional().default(false),
  state: z.enum(['open', 'closed']),
  merged: z.boolean().nullable().optional(),
  merged_at: z.string().nullable().optional(),
  closed_at: z.string().nullable().optional(),
  created_at: z.string(),
  user: AccountSchema,
  head: z.object({ ref: z.string(), sha: z.string().regex(/^[0-9a-f]{7,64}$/i) }),
  base: z.object({ ref: z.string() }),
});
export type PullRequestPayload = z.infer<typeof PullRequestPayloadSchema>;

export const PullRequestEventSchema = z.object({
  action: z.string(),
  number: z.number().int().positive(),
  pull_request: PullRequestPayloadSchema,
  repository: RepoSchema.extend({ owner: AccountSchema }),
  installation: InstallationRefSchema,
});
export type PullRequestEvent = z.infer<typeof PullRequestEventSchema>;

/** pull_request actions that start a review (spec 6). */
export const REVIEW_ACTIONS = ['opened', 'synchronize', 'reopened', 'ready_for_review'] as const;

export function isReviewAction(action: string): action is (typeof REVIEW_ACTIONS)[number] {
  return (REVIEW_ACTIONS as readonly string[]).includes(action);
}

/** Organization or User, as stored on Installation (GitHub may also say Enterprise). */
export function accountType(type: string): 'User' | 'Organization' {
  return type === 'User' ? 'User' : 'Organization';
}

/** Ids read from any payload for the delivery log. */
export function deliveryIds(payload: unknown): {
  installationGithubId: number | null;
  repoGithubId: number | null;
} {
  const parsed = z
    .object({
      installation: InstallationRefSchema.optional(),
      repository: z.object({ id: z.number() }).optional(),
    })
    .safeParse(payload);
  return {
    installationGithubId: parsed.success ? (parsed.data.installation?.id ?? null) : null,
    repoGithubId: parsed.success ? (parsed.data.repository?.id ?? null) : null,
  };
}
