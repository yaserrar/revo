import { createHash } from 'node:crypto';
import { createClaudeEngine, fakeEngine, type ClaudeCallEvent, type ReviewEngine } from '@revo/review';
import { createClaudeSubscriptionEngine } from '@revo/review/node';
import type { WorkerEnv } from './env';
import type { Logger } from './logger';

/** Engines kept for accounts' own keys (one client per key, reused across jobs). */
const ACCOUNT_ENGINE_CACHE_SIZE = 50;

/** Usage and timing only: never the prompt, the code, the answer or the key. */
function logCall(log: Logger, source: 'revo' | 'account' | 'subscription') {
  return (call: ClaudeCallEvent) =>
    log.info(
      {
        source,
        pass: call.pass,
        attempt: call.attempt,
        model: call.model,
        servedBy: call.servedBy,
        stopReason: call.stopReason,
        durationMs: call.durationMs,
        inputTokens: call.usage.inputTokens,
        outputTokens: call.usage.outputTokens,
        cacheReadTokens: call.usage.cacheReadTokens,
      },
      'claude call',
    );
}

/** The review engine for REVO_ENGINE: Claude (real API) or the deterministic fake. */
export function createEngine(
  env: Pick<WorkerEnv, 'REVO_ENGINE' | 'ANTHROPIC_API_KEY'>,
  log: Logger,
): ReviewEngine {
  if (env.REVO_ENGINE === 'fake') return fakeEngine;
  return createClaudeEngine({ apiKey: env.ANTHROPIC_API_KEY, onCall: logCall(log, 'revo') });
}

/**
 * Engines for accounts' own Anthropic keys, cached by a hash of the key (the
 * key itself is never a map key or a log field). With REVO_ENGINE=fake (tests,
 * local runs against the mock GitHub) every account gets the fake engine too.
 */
export function createAccountEngines(
  env: Pick<WorkerEnv, 'REVO_ENGINE'>,
  log: Logger,
  create: (apiKey: string) => ReviewEngine = (apiKey) =>
    createClaudeEngine({ apiKey, onCall: logCall(log, 'account') }),
): (apiKey: string) => ReviewEngine {
  if (env.REVO_ENGINE === 'fake') return () => fakeEngine;
  const cache = new Map<string, ReviewEngine>();
  return (apiKey) => {
    const id = createHash('sha256').update(apiKey).digest('hex');
    const cached = cache.get(id);
    if (cached) {
      // Most recently used last, so the oldest is evicted first.
      cache.delete(id);
      cache.set(id, cached);
      return cached;
    }
    const engine = create(apiKey);
    cache.set(id, engine);
    if (cache.size > ACCOUNT_ENGINE_CACHE_SIZE) cache.delete(cache.keys().next().value!);
    return engine;
  };
}

/**
 * The engine for accounts on the Claude subscription logged in on this
 * machine (Claude Code through the Agent SDK; REVO_ALLOW_CLAUDE_SUBSCRIPTION).
 * Made on first use and shared by every job. With REVO_ENGINE=fake (tests,
 * local runs against the mock GitHub) it is the fake engine, so Claude Code
 * never runs offline.
 */
export function createSubscriptionEngine(
  env: Pick<WorkerEnv, 'REVO_ENGINE'>,
  log: Logger,
  create: () => ReviewEngine = () => createClaudeSubscriptionEngine({ onCall: logCall(log, 'subscription') }),
): () => ReviewEngine {
  if (env.REVO_ENGINE === 'fake') return () => fakeEngine;
  let engine: ReviewEngine | null = null;
  return () => (engine ??= create());
}
