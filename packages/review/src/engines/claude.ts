/**
 * The Claude engine: pass 1 (find) and pass 2 (verify) on the Claude API.
 *
 * - Answers come through two strict report tools, validated with Zod; an
 *   invalid answer (or no tool call) is retried once with the problem named.
 * - Both passes send the same tools, system prompt, settings and context, so
 *   pass 2 (and any retry) reads the context from the prompt cache.
 * - Adaptive thinking at a pinned effort (changing effort between passes
 *   would invalidate the cache).
 * - Server-side refusal fallback (`fallbacks: "default"`): when the model's
 *   safety classifiers decline (code review of security code can look like
 *   attack code), the API re-runs the request on a fallback model in the same
 *   call. Cost is computed per model from `usage.iterations`.
 * - Failures throw ReviewEngineError with a code and a `retryable` flag.
 */
import Anthropic from '@anthropic-ai/sdk';
import { type Finding } from '@revo/shared';
import { ReviewEngineError, type ReviewEngineErrorCode } from '../errors';
import { addUsage, callCostUsd, priceOf, roundUsd, ZERO_USAGE, type CallUsage } from '../pricing';
import { correctionMessage, findTask, renderInstructions, SYSTEM_PROMPT, verifyTask } from '../prompts';
import type { EngineContext, FindResult, ReviewEngine, VerifyResult } from '../types';
import {
  FINDINGS_TOOL_NAME,
  parseFindingsInput,
  parseVerificationsInput,
  REPORT_TOOLS,
  VERIFICATIONS_TOOL_NAME,
  type ParseResult,
} from './tool-schemas';

export type ClaudeEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
/** Thinking plus up to 10 findings fit well inside this; non-streaming stays under SDK timeouts. */
const DEFAULT_MAX_TOKENS = 16_000;
const REQUEST_TIMEOUT_MS = 5 * 60_000;

/** One API call, for logs. Carries no code and no prompt text. */
export type ClaudeCallEvent = {
  pass: 'find' | 'verify';
  attempt: number;
  model: string;
  /** The model that produced the answer (differs when a fallback ran). */
  servedBy: string;
  stopReason: string | null;
  durationMs: number;
  usage: CallUsage;
};

export type ClaudeEngineOptions = {
  /** Defaults to ANTHROPIC_API_KEY from the environment (read by the SDK). */
  apiKey?: string;
  /** A preconfigured client (tests, custom base URL). Wins over `apiKey`. */
  client?: Anthropic;
  /** Thinking effort for both passes. Default `high`: review is intelligence-sensitive work. */
  effort?: ClaudeEffort;
  maxTokens?: number;
  /** Called after every API call. */
  onCall?: (event: ClaudeCallEvent) => void;
};

type Pass = 'find' | 'verify';
type Body = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;

/** Usage and exact cost of one response, pricing fallback iterations at their own model. */
export function responseUsage(response: Anthropic.Beta.BetaMessage, requestedModel: string): CallUsage {
  const u = response.usage;
  const tokens: CallUsage = {
    inputTokens: u.input_tokens,
    outputTokens: u.output_tokens,
    cacheReadTokens: u.cache_read_input_tokens ?? 0,
    cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
  };
  const iterations = (u.iterations ?? []).filter(
    (it) => it.type === 'message' || it.type === 'fallback_message',
  );
  const usesOtherModel = iterations.some((it) => it.model && it.model !== requestedModel);
  if (!usesOtherModel) return { ...tokens, costUsd: callCostUsd(requestedModel, tokens) };
  let cost = 0;
  for (const it of iterations) {
    const model = it.model && priceOf(it.model) ? it.model : requestedModel;
    cost += callCostUsd(model, {
      inputTokens: it.input_tokens,
      outputTokens: it.output_tokens,
      cacheReadTokens: it.cache_read_input_tokens,
      cacheWriteTokens: it.cache_creation_input_tokens,
    });
  }
  return { ...tokens, costUsd: roundUsd(cost) };
}

function apiErrorCode(err: unknown): ReviewEngineErrorCode | null {
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError)
    return 'auth';
  if (err instanceof Anthropic.RateLimitError) return 'rate_limited';
  if (err instanceof Anthropic.APIConnectionError) return 'unavailable';
  if (err instanceof Anthropic.InternalServerError) return 'unavailable';
  if (err instanceof Anthropic.APIError) {
    return err.status !== undefined && err.status >= 500 ? 'unavailable' : 'bad_request';
  }
  return null;
}

export function createClaudeEngine(options: ClaudeEngineOptions = {}): ReviewEngine {
  const client =
    options.client ??
    new Anthropic({ ...(options.apiKey ? { apiKey: options.apiKey } : {}), timeout: REQUEST_TIMEOUT_MS });
  const effort = options.effort ?? 'high';
  const maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;

  function request(ctx: EngineContext, task: string): Body {
    const instructions = renderInstructions(ctx.settings.instructions);
    return {
      model: ctx.model,
      max_tokens: maxTokens,
      betas: [FALLBACK_BETA],
      fallbacks: 'default',
      thinking: { type: 'adaptive' },
      output_config: { effort },
      tools: REPORT_TOOLS,
      tool_choice: { type: 'auto' },
      system: [
        { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
        ...(instructions ? [{ type: 'text' as const, text: instructions }] : []),
      ],
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: ctx.context.text, cache_control: { type: 'ephemeral' } },
            { type: 'text', text: task },
          ],
        },
      ],
    };
  }

  /**
   * Runs one pass: call, read the tool input, validate; on an invalid answer
   * call once more with the problem appended to the task.
   */
  async function runPass<T>(
    pass: Pass,
    ctx: EngineContext,
    task: string,
    toolName: string,
    parse: (input: unknown) => ParseResult<T>,
  ): Promise<{ value: T; usage: CallUsage }> {
    let usage: CallUsage = ZERO_USAGE;
    let problem: string | null = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      const body = request(ctx, problem ? `${task}\n\n${correctionMessage(toolName, problem)}` : task);
      const started = Date.now();
      let response: Anthropic.Beta.BetaMessage;
      try {
        response = await client.beta.messages.create(body);
      } catch (err) {
        const code = apiErrorCode(err);
        if (!code) throw err;
        const detail = err instanceof Error ? err.message : String(err);
        throw new ReviewEngineError(code, pass, detail, { usage, cause: err });
      }
      const callUsage = responseUsage(response, ctx.model);
      usage = addUsage(usage, callUsage);
      options.onCall?.({
        pass,
        attempt,
        model: ctx.model,
        servedBy: response.model,
        stopReason: response.stop_reason,
        durationMs: Date.now() - started,
        usage: callUsage,
      });

      if (response.stop_reason === 'refusal') {
        const category = response.stop_details?.category ?? 'unspecified';
        throw new ReviewEngineError('refusal', pass, `category ${category}`, { usage });
      }
      if (response.stop_reason === 'max_tokens') {
        throw new ReviewEngineError('max_tokens', pass, `max_tokens ${maxTokens} reached`, { usage });
      }
      if (response.stop_reason === 'model_context_window_exceeded') {
        throw new ReviewEngineError('bad_request', pass, 'context window exceeded', { usage });
      }

      const call = response.content.find(
        (b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use' && b.name === toolName,
      );
      const result: ParseResult<T> = call
        ? parse(call.input)
        : { ok: false, problem: `you did not call \`${toolName}\`` };
      if (result.ok) return { value: result.value, usage };
      problem = result.problem;
    }
    throw new ReviewEngineError('invalid_output', pass, problem ?? 'invalid answer', { usage });
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
}
