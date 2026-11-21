/**
 * Model prices in USD per million tokens (spec section 13). Update this file
 * when prices change; everything else derives cost from it.
 * Prices at the time of writing (November 2026), Claude API first-party rates.
 */
import type { ModelId } from '@revo/shared';

export type ModelPrice = {
  input: number;
  output: number;
  /** Cache reads (prompt caching hits). */
  cacheRead: number;
  /** Cache writes (5-minute TTL), 1.25× input. */
  cacheWrite: number;
  /** Higher rates applied to a whole call when its prompt exceeds `threshold` tokens. */
  longContext?: { threshold: number; input: number; output: number; cacheRead: number; cacheWrite: number };
};

export const MODEL_PRICES: Record<ModelId, ModelPrice> = {
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
  'claude-haiku-5-5': {
    input: 0.1,
    output: 0.5,
    cacheRead: 0.005,
    cacheWrite: 0.125,
    longContext: { threshold: 100_000, input: 0.5, output: 2.5, cacheRead: 0.025, cacheWrite: 0.625 },
  },
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
};

/**
 * Models the API may switch to when a request is declined and server-side
 * fallback runs (`fallbacks: "default"`). Not selectable in settings; priced
 * here so a fallback call is costed at the rate actually billed.
 */
export const FALLBACK_MODEL_PRICES: Record<string, ModelPrice> = {
  'claude-sonnet-5': { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  'claude-opus-5': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  'claude-opus-4-8': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
};

/** Price of a selectable or fallback model, or null when unknown. */
export function priceOf(model: string): ModelPrice | null {
  return isPricedModel(model) ? MODEL_PRICES[model] : (FALLBACK_MODEL_PRICES[model] ?? null);
}

/** Token usage of one API call, as reported by `response.usage`. */
export type CallUsage = {
  /** Uncached input tokens (`input_tokens`). */
  inputTokens: number;
  outputTokens: number;
  /** `cache_read_input_tokens` */
  cacheReadTokens: number;
  /** `cache_creation_input_tokens` */
  cacheWriteTokens: number;
  /**
   * Exact cost when the engine computed it (e.g. part of the call ran on a
   * fallback model). When absent, cost is derived from the tokens and the
   * requested model.
   */
  costUsd?: number;
};

export const ZERO_USAGE: CallUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  costUsd: 0,
};

export function isPricedModel(model: string): model is ModelId {
  return model in MODEL_PRICES;
}

/** Cost of one call in USD. Unknown models throw: add their price above first. */
export function callCostUsd(model: string, usage: CallUsage): number {
  const base = priceOf(model);
  if (!base) throw new Error(`No price for model "${model}" in pricing.ts`);
  const promptTokens = usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
  const p = base.longContext && promptTokens > base.longContext.threshold ? base.longContext : base;
  const usd =
    (usage.inputTokens * p.input +
      usage.outputTokens * p.output +
      usage.cacheReadTokens * p.cacheRead +
      usage.cacheWriteTokens * p.cacheWrite) /
    1_000_000;
  return roundUsd(usd);
}

/** Sums two usages. The exact cost is kept only when both sides have one. */
export function addUsage(a: CallUsage, b: CallUsage): CallUsage {
  const sum: CallUsage = {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
  };
  if (a.costUsd !== undefined && b.costUsd !== undefined) sum.costUsd = roundUsd(a.costUsd + b.costUsd);
  return sum;
}

/** Cost of a usage: its exact cost when the engine set one, otherwise priced at `model`. */
export function usageCostUsd(model: string, usage: CallUsage): number {
  return usage.costUsd ?? callCostUsd(model, usage);
}

/** Rounds to the 6 decimals stored in Review.costUsd. */
export function roundUsd(usd: number): number {
  return Math.round(usd * 1_000_000) / 1_000_000;
}
