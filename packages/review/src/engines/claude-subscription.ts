/**
 * The Claude subscription engine: the same two passes as the API engine, run
 * through Claude Code (the Agent SDK) with the Claude Pro/Max login of the
 * machine running Revo. Self-hosted, single owner only (Anthropic's terms):
 * the worker uses it only when REVO_ALLOW_CLAUDE_SUBSCRIPTION is on.
 *
 * - Same system prompt, repo instructions, context and task as the API engine.
 * - The answer is Claude Code's structured output, whose JSON schema is the
 *   report tool's input; it is validated with the same parsers, and an
 *   invalid answer is retried once with the problem named.
 * - Claude Code runs with no tools (no files, no shell, no web), no MCP
 *   servers, no settings, skills or CLAUDE.md, in an empty temp folder, and
 *   keeps no transcript on disk.
 * - API keys are removed from its environment, so the subscription pays.
 *   Tokens are recorded; the cost is $0.
 * - Failures throw ReviewEngineError with a code and a `retryable` flag.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  Options,
  SDKAssistantMessageError,
  SDKMessage,
  SDKResultMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { type Finding } from '@revo/shared';
import { ReviewEngineError, type ReviewEngineErrorCode } from '../errors';
import { addUsage, ZERO_USAGE, type CallUsage } from '../pricing';
import {
  correctionMessage,
  findTask,
  renderInstructions,
  structuredOutputNote,
  SYSTEM_PROMPT,
  verifyTask,
} from '../prompts';
import type { EngineContext, FindResult, ReviewEngine, VerifyResult } from '../types';
import type { ClaudeCallEvent, ClaudeEffort } from './claude';
import {
  FINDINGS_TOOL_NAME,
  parseFindingsInput,
  parseVerificationsInput,
  REPORT_INPUT_SCHEMAS,
  VERIFICATIONS_TOOL_NAME,
  type ParseResult,
} from './tool-schemas';

/** The Agent SDK's `query()`, narrowed to what the engine uses (tests pass a mock). */
export type SubscriptionQuery = (params: { prompt: string; options: Options }) => AsyncIterable<SDKMessage>;

export type ClaudeSubscriptionEngineOptions = {
  /** Thinking effort for both passes, as in the API engine. Default `high`. */
  effort?: ClaudeEffort;
  /** Called after every Claude Code run (one per attempt). */
  onCall?: (event: ClaudeCallEvent) => void;
  /** The Claude Code executable; defaults to the one the SDK ships. */
  pathToClaudeCodeExecutable?: string;
  /** Replaces the SDK's `query()` (tests). By default the SDK is loaded on first use. */
  query?: SubscriptionQuery;
  /** Stops a run that takes longer (default 10 minutes, like the API engine's request timeout). */
  timeoutMs?: number;
  /** The environment Claude Code starts from (default `process.env`); secrets are removed. */
  env?: NodeJS.ProcessEnv;
};

type Pass = 'find' | 'verify';
type ReportToolName = keyof typeof REPORT_INPUT_SCHEMAS;

const DEFAULT_TIMEOUT_MS = 10 * 60_000;
/** The structured-output call, plus room for Claude Code's own schema retries. */
const MAX_TURNS = 4;
/** The tool Claude Code gives the model for structured output. */
const STRUCTURED_OUTPUT_TOOL = 'StructuredOutput';

/** User-facing detail for the errors only a subscription has. */
const SIGNED_OUT =
  'Claude Code on the machine running Revo is not signed in to a Claude subscription: run `claude`, then /login';
const LIMIT_REACHED = 'the Claude subscription usage limit is reached';

/**
 * Variables never passed to Claude Code: API keys (so the subscription pays,
 * never a key) and the host's secrets (it needs none of them).
 */
const WITHHELD_ENV =
  /^(ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN|DATABASE_URL|TEST_DATABASE_URL|REDIS_URL)$|SECRET|PRIVATE_KEY|ENCRYPTION_KEY|PASSWORD/;

/** Claude Code's environment: the host's, without API keys and secrets. */
export function subscriptionEnv(source: NodeJS.ProcessEnv): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(source)) {
    if (value !== undefined && !WITHHELD_ENV.test(name)) env[name] = value;
  }
  env.CLAUDE_AGENT_SDK_CLIENT_APP = 'revo';
  return env;
}

const ASSISTANT_ERROR_CODES: Record<SDKAssistantMessageError, ReviewEngineErrorCode> = {
  authentication_failed: 'auth',
  oauth_org_not_allowed: 'auth',
  account_on_hold: 'auth',
  verification_required: 'auth',
  cloud_credential_error: 'auth',
  billing_error: 'rate_limited',
  rate_limit: 'rate_limited',
  overloaded: 'unavailable',
  server_error: 'unavailable',
  unknown: 'unavailable',
  invalid_request: 'bad_request',
  model_not_found: 'bad_request',
  max_output_tokens: 'max_tokens',
};

function statusCode(status: number | null | undefined): ReviewEngineErrorCode | null {
  if (!status) return null;
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'unavailable';
  return status >= 400 ? 'bad_request' : null;
}

function errorDetail(code: ReviewEngineErrorCode, fallback: string): string {
  if (code === 'auth') return SIGNED_OUT;
  if (code === 'rate_limited') return LIMIT_REACHED;
  return fallback;
}

/** Tokens of a run: `modelUsage` covers every model call, `usage` only the main loop. Cost is $0. */
export function subscriptionUsage(result: Pick<SDKResultMessage, 'modelUsage' | 'usage'>): CallUsage {
  const models = Object.values(result.modelUsage ?? {});
  if (models.length > 0) {
    const sum = (pick: (m: (typeof models)[number]) => number) => models.reduce((n, m) => n + pick(m), 0);
    return {
      inputTokens: sum((m) => m.inputTokens),
      outputTokens: sum((m) => m.outputTokens),
      cacheReadTokens: sum((m) => m.cacheReadInputTokens),
      cacheWriteTokens: sum((m) => m.cacheCreationInputTokens),
      costUsd: 0,
    };
  }
  const u = result.usage;
  return {
    inputTokens: u?.input_tokens ?? 0,
    outputTokens: u?.output_tokens ?? 0,
    cacheReadTokens: u?.cache_read_input_tokens ?? 0,
    cacheWriteTokens: u?.cache_creation_input_tokens ?? 0,
    costUsd: 0,
  };
}

/** The model that did most of the work (for logs). */
function servedBy(result: SDKResultMessage | null, requested: string): string {
  const models = Object.entries(result?.modelUsage ?? {}).sort(
    ([, a], [, b]) => b.outputTokens - a.outputTokens,
  );
  return models[0]?.[0] ?? requested;
}

/** What one Claude Code run produced. */
type RunOutcome =
  | { kind: 'answer'; output: unknown }
  /** No usable answer: worth the one retry. */
  | { kind: 'invalid'; problem: string }
  | { kind: 'error'; code: ReviewEngineErrorCode; detail: string; cause?: unknown };

async function loadQuery(): Promise<SubscriptionQuery> {
  try {
    const sdk = await import('@anthropic-ai/claude-agent-sdk');
    return sdk.query;
  } catch (err) {
    throw new ReviewEngineError(
      'unavailable',
      'find',
      'the Claude Agent SDK is not installed with this worker (run Revo from source to use a Claude subscription)',
      { cause: err },
    );
  }
}

export function createClaudeSubscriptionEngine(options: ClaudeSubscriptionEngineOptions = {}): ReviewEngine {
  const effort = options.effort ?? 'high';
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let query: Promise<SubscriptionQuery> | null = options.query ? Promise.resolve(options.query) : null;
  const getQuery = () => {
    query ??= loadQuery().catch((err: unknown) => {
      query = null;
      throw err;
    });
    return query;
  };

  function runOptions(
    ctx: EngineContext,
    cwd: string,
    toolName: ReportToolName,
    controller: AbortController,
  ): Options {
    const instructions = renderInstructions(ctx.settings.instructions);
    return {
      cwd,
      model: ctx.model,
      systemPrompt: instructions ? `${SYSTEM_PROMPT}\n\n${instructions}` : SYSTEM_PROMPT,
      thinking: { type: 'adaptive' },
      effort,
      outputFormat: {
        type: 'json_schema',
        schema: REPORT_INPUT_SCHEMAS[toolName] as Record<string, unknown>,
      },
      maxTurns: MAX_TURNS,
      // Nothing but the structured answer: no built-in tools, MCP servers, settings or skills.
      tools: [],
      mcpServers: {},
      strictMcpConfig: true,
      settingSources: [],
      skills: [],
      canUseTool: async (name) =>
        name === STRUCTURED_OUTPUT_TOOL
          ? { behavior: 'allow' }
          : { behavior: 'deny', message: `${name} is not available: answer with ${STRUCTURED_OUTPUT_TOOL}.` },
      // The PR text is data: no @file expansion, no slash commands.
      verbatimPrompts: true,
      // No transcript with the code under ~/.claude.
      persistSession: false,
      env: subscriptionEnv(options.env ?? process.env),
      abortController: controller,
      ...(options.pathToClaudeCodeExecutable
        ? { pathToClaudeCodeExecutable: options.pathToClaudeCodeExecutable }
        : {}),
    };
  }

  /** One Claude Code run: the outcome, its usage and the result message (for logs). */
  async function runOnce(
    ctx: EngineContext,
    prompt: string,
    toolName: ReportToolName,
  ): Promise<{ outcome: RunOutcome; usage: CallUsage; result: SDKResultMessage | null }> {
    const run = await getQuery();
    const cwd = await mkdtemp(join(tmpdir(), 'revo-review-'));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let result: SDKResultMessage | null = null;
    let apiError: SDKAssistantMessageError | null = null;
    let limitReached = false;
    let refusal: string | null = null;
    try {
      for await (const message of run({ prompt, options: runOptions(ctx, cwd, toolName, controller) })) {
        if (message.type === 'result') result = message;
        else if (message.type === 'assistant' && message.error) apiError = message.error;
        else if (message.type === 'rate_limit_event' && message.rate_limit_info.status === 'rejected')
          limitReached = true;
        else if (message.type === 'system' && message.subtype === 'model_refusal_no_fallback')
          refusal = message.api_refusal_category ?? 'unspecified';
      }
    } catch (err) {
      const detail = controller.signal.aborted
        ? `no answer after ${Math.round(timeoutMs / 1000)} s`
        : err instanceof Error
          ? err.message
          : String(err);
      const code: ReviewEngineErrorCode = limitReached
        ? 'rate_limited'
        : apiError
          ? ASSISTANT_ERROR_CODES[apiError]
          : /not logged in|\/login|authentication_failed|oauth|401/i.test(detail)
            ? 'auth'
            : 'unavailable';
      const usage = result ? subscriptionUsage(result) : ZERO_USAGE;
      return {
        outcome: { kind: 'error', code, detail: errorDetail(code, detail), cause: err },
        usage,
        result,
      };
    } finally {
      clearTimeout(timer);
      await rm(cwd, { recursive: true, force: true }).catch(() => undefined);
    }

    const usage = result ? subscriptionUsage(result) : ZERO_USAGE;
    return { outcome: classify(result, { apiError, limitReached, refusal }), usage, result };
  }

  return {
    kind: 'claude',

    async find(ctx: EngineContext): Promise<FindResult> {
      const { value, usage } = await runPass(
        'find',
        ctx,
        findTask(ctx.settings.categories),
        FINDINGS_TOOL_NAME,
        (input) => parseFindingsInput(input),
      );
      return { findings: value, usage };
    },

    async verify(ctx: EngineContext, findings: Finding[]): Promise<VerifyResult> {
      const { value, usage } = await runPass(
        'verify',
        ctx,
        verifyTask(findings),
        VERIFICATIONS_TOOL_NAME,
        (input) => parseVerificationsInput(input, findings.length),
      );
      return { verifications: value, usage };
    },
  };

  /** Runs one pass; on an invalid answer, runs once more with the problem appended to the task. */
  async function runPass<T>(
    pass: Pass,
    ctx: EngineContext,
    task: string,
    toolName: ReportToolName,
    parse: (input: unknown) => ParseResult<T>,
  ): Promise<{ value: T; usage: CallUsage }> {
    let usage: CallUsage = ZERO_USAGE;
    let problem: string | null = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      const withCorrection = problem ? `${task}\n\n${correctionMessage(toolName, problem)}` : task;
      const prompt = `${ctx.context.text}\n\n${withCorrection}\n\n${structuredOutputNote(toolName)}`;
      const started = Date.now();
      let run: Awaited<ReturnType<typeof runOnce>>;
      try {
        run = await runOnce(ctx, prompt, toolName);
      } catch (err) {
        if (err instanceof ReviewEngineError)
          throw new ReviewEngineError(err.code, pass, err.detail, { usage, cause: err });
        throw err;
      }
      usage = addUsage(usage, run.usage);
      options.onCall?.({
        pass,
        attempt,
        model: ctx.model,
        servedBy: servedBy(run.result, ctx.model),
        stopReason: run.result?.stop_reason ?? null,
        durationMs: Date.now() - started,
        usage: run.usage,
      });

      const { outcome } = run;
      if (outcome.kind === 'error')
        throw new ReviewEngineError(outcome.code, pass, outcome.detail, { usage, cause: outcome.cause });
      const parsed: ParseResult<T> =
        outcome.kind === 'answer' ? parse(outcome.output) : { ok: false, problem: outcome.problem };
      if (parsed.ok) return { value: parsed.value, usage };
      problem = parsed.problem;
    }
    throw new ReviewEngineError('invalid_output', pass, problem ?? 'invalid answer', { usage });
  }
}

/** Reads a finished run: the structured answer, a reason to retry, or a failure. */
function classify(
  result: SDKResultMessage | null,
  seen: { apiError: SDKAssistantMessageError | null; limitReached: boolean; refusal: string | null },
): RunOutcome {
  const failure = (code: ReviewEngineErrorCode, fallback: string): RunOutcome => ({
    kind: 'error',
    code,
    detail: errorDetail(code, fallback),
  });
  if (seen.refusal !== null || result?.stop_reason === 'refusal')
    return failure('refusal', `category ${seen.refusal ?? 'unspecified'}`);
  if (seen.limitReached) return failure('rate_limited', LIMIT_REACHED);
  if (!result) return failure('unavailable', 'Claude Code ended without a result');

  if (result.subtype === 'success' && !result.is_error) {
    if (result.structured_output === undefined || result.structured_output === null)
      return { kind: 'invalid', problem: `you did not call \`${STRUCTURED_OUTPUT_TOOL}\`` };
    return { kind: 'answer', output: result.structured_output };
  }
  if (result.subtype === 'error_max_structured_output_retries')
    return { kind: 'invalid', problem: 'the answer did not match the schema' };
  if (result.subtype === 'error_max_turns')
    return { kind: 'invalid', problem: `you did not call \`${STRUCTURED_OUTPUT_TOOL}\` in time` };

  const text =
    result.subtype === 'success'
      ? result.result.trim()
      : result.errors.filter(Boolean).join('; ') || result.subtype;
  const status = result.subtype === 'success' ? statusCode(result.api_error_status) : null;
  const code = status ?? (seen.apiError ? ASSISTANT_ERROR_CODES[seen.apiError] : 'unavailable');
  return failure(code, text || 'Claude Code reported an error');
}
