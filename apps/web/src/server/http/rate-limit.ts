import 'server-only';
import { rateLimited } from './errors';

// Fixed-window counter in memory: enough for the single web container of V1.
// Move it to Redis (INCR + PEXPIRE) before running several web replicas.
const hits = new Map<string, { count: number; resetAt: number }>();

/** Counts one hit for `key`; returns the seconds to wait when the limit is reached, else 0. */
export function takeRateLimit(key: string, max: number, windowMs: number, now = Date.now()): number {
  const entry = hits.get(key);
  if (!entry || entry.resetAt <= now) {
    hits.set(key, { count: 1, resetAt: now + windowMs });
    if (hits.size > 10_000) {
      for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
    }
    return 0;
  }
  if (entry.count >= max) return Math.ceil((entry.resetAt - now) / 1000);
  entry.count++;
  return 0;
}

/** Throws RATE_LIMITED (429) when `key` exceeded `max` hits in the window. */
export function assertRateLimit(key: string, max: number, windowMs: number): void {
  const wait = takeRateLimit(key, max, windowMs);
  if (wait > 0) throw rateLimited(wait);
}

/** Named limits used by routes. */
export const RATE_LIMITS = {
  /** Spec 14: webhook route. Per delivering IP. */
  webhook: { max: 120, windowMs: 60_000 },
  /** Spec 14: "Review again". Per user. */
  reviewAgain: { max: 5, windowMs: 10 * 60_000 },
  /** Saving an Anthropic API key: each try is a call to Anthropic. Per user. */
  anthropicKey: { max: 5, windowMs: 10 * 60_000 },
  /** Any other mutation. Per user. */
  mutation: { max: 60, windowMs: 60_000 },
} as const;
