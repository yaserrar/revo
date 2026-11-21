import { createClaudeEngine, fakeEngine, type ReviewEngine } from '@revo/review';
import type { WorkerEnv } from './env';
import type { Logger } from './logger';

/** The review engine for REVO_ENGINE: Claude (real API) or the deterministic fake. */
export function createEngine(
  env: Pick<WorkerEnv, 'REVO_ENGINE' | 'ANTHROPIC_API_KEY'>,
  log: Logger,
): ReviewEngine {
  if (env.REVO_ENGINE === 'fake') return fakeEngine;
  return createClaudeEngine({
    apiKey: env.ANTHROPIC_API_KEY,
    // Usage and timing only: never the prompt, the code or the answer.
    onCall: (call) =>
      log.info(
        {
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
      ),
  });
}
