/**
 * The engines the bench can run, and what one review used.
 *
 * - `claude-subscription` (default): Revo's subscription engine, i.e. Claude Code
 *   through the Agent SDK with the Claude Pro/Max login of this machine. Revo
 *   already strips API keys from Claude Code's environment; the bench also
 *   drops every `ANTHROPIC_*` and Claude Code session variable, and checks
 *   each run's `apiKeySource` before the model is called: anything but
 *   `none` (no API key: the claude.ai login) stops the whole bench.
 * - `fake`: Revo's deterministic offline engine (tests the harness, no AI).
 * - `claude`: the API engine, billed to ANTHROPIC_API_KEY. Opt-in only.
 *
 * Cost: the subscription bills nothing per review, so the bench prices the
 * same tokens with Revo's own price table (`callCostUsd`): what the review
 * would cost through the API engine.
 */
import { query as sdkQuery, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import {
  callCostUsd,
  createClaudeEngine,
  fakeEngine,
  type ClaudeCallEvent,
  type ClaudeEffort,
  type ReviewEngine,
} from '@revo/review';
import { createClaudeSubscriptionEngine, type SubscriptionQuery } from '@revo/review/node';

export const ENGINE_CHOICES = ['claude-subscription', 'fake', 'claude'] as const;
export type EngineChoice = (typeof ENGINE_CHOICES)[number];

/** The only `apiKeySource` that means "no API key": the claude.ai (subscription) login. */
const SUBSCRIPTION_KEY_SOURCE = 'none';

/** Variables never passed to Claude Code: API credentials and providers, and this shell's own Claude Code session. */
const DROPPED_ENV =
  /^(ANTHROPIC_.*|CLAUDECODE|CLAUDE_PID|CLAUDE_EFFORT|CLAUDE_AGENT_SDK_.*|CLAUDE_CODE_(?!OAUTH_TOKEN$).*)$/;

export function benchEnv(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(source).filter(([name]) => !DROPPED_ENV.test(name)));
}

export class BillingGuardError extends Error {
  constructor(readonly apiKeySource: string) {
    super(
      `Claude Code would use an API key (apiKeySource "${apiKeySource}"), not the subscription login: ` +
        'stopped before the review. Run `claude`, then /login with the Claude account.',
    );
    this.name = 'BillingGuardError';
  }
}

/** What the engine reported for one review (reset per case). */
export type CallLog = {
  calls: ClaudeCallEvent[];
  /** `apiKeySource` of each Claude Code run (subscription engine only). */
  apiKeySources: string[];
  /** Claude Code's own estimate of the runs' API cost (`total_cost_usd`), for cross-checking. */
  claudeCodeEstimateUsd: number;
  /** Set when the billing guard stopped a run. */
  guard: BillingGuardError | null;
};

export const emptyCallLog = (): CallLog => ({
  calls: [],
  apiKeySources: [],
  claudeCodeEstimateUsd: 0,
  guard: null,
});

/** The SDK's query(), refusing any run whose credential is not the subscription login. */
function guardedQuery(log: () => CallLog): SubscriptionQuery {
  return async function* (params): AsyncGenerator<SDKMessage> {
    for await (const message of sdkQuery(params)) {
      if (message.type === 'system' && message.subtype === 'init') {
        log().apiKeySources.push(message.apiKeySource);
        if (message.apiKeySource !== SUBSCRIPTION_KEY_SOURCE) {
          const error = new BillingGuardError(message.apiKeySource);
          log().guard = error;
          throw error;
        }
      }
      if (message.type === 'result') log().claudeCodeEstimateUsd += message.total_cost_usd;
      yield message;
    }
  };
}

export function createBenchEngine(
  choice: EngineChoice,
  effort: ClaudeEffort,
  log: () => CallLog,
): ReviewEngine {
  const onCall = (event: ClaudeCallEvent) => log().calls.push(event);
  if (choice === 'fake') return fakeEngine;
  if (choice === 'claude') return createClaudeEngine({ effort, onCall });
  return createClaudeSubscriptionEngine({
    effort,
    onCall,
    query: guardedQuery(log),
    env: benchEnv(process.env),
  });
}

/** What the calls would cost on the API, priced like Revo prices its API reviews. */
export function apiEquivalentUsd(calls: readonly ClaudeCallEvent[]): number {
  return calls.reduce((sum, call) => {
    const { costUsd: _billed, ...tokens } = call.usage;
    return sum + callCostUsd(call.model, tokens);
  }, 0);
}
