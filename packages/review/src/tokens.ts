/**
 * Token estimates for the per-pass budget (spec 7.3: 150,000 input tokens).
 *
 * A calibrated heuristic instead of a count_tokens call per review: it costs
 * nothing and needs no network. Claude's current tokenizer averages about 3 to
 * 3.5 characters per token on source code (more symbols, shorter tokens) and
 * about 4 on English. 2.8 characters per token over-estimates on purpose, so
 * the budget cuts context a little early rather than sending a prompt that is
 * too large. The eval prints the estimate next to the real `input_tokens` so
 * the ratio can be re-checked when models change.
 */
export const CHARS_PER_TOKEN = 2.8;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Tokens kept free in every pass for what is not part of the shared context:
 * the two tool schemas, the task message, and in pass 2 up to 10 findings.
 */
export const PASS_RESERVE_TOKENS = 8_000;
