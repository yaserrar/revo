/** Claude models a repo can use (spec 11.6). Prices live in packages/review/src/pricing.ts. */
export const MODEL_IDS = ['claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-opus-5-5'] as const;
export type ModelId = (typeof MODEL_IDS)[number];

export const DEFAULT_MODEL: ModelId = 'claude-sonnet-5-5';

export const MODELS: Record<ModelId, { name: string; shortName: string; description: string }> = {
  'claude-sonnet-5-5': {
    name: 'Claude Sonnet 5.5',
    shortName: 'Sonnet 5.5',
    description: 'Balanced depth and cost. The default.',
  },
  'claude-haiku-5-5': {
    name: 'Claude Haiku 5.5',
    shortName: 'Haiku 5.5',
    description: 'Fastest and cheapest. Good for small, routine PRs.',
  },
  'claude-opus-5-5': {
    name: 'Claude Opus 5.5',
    shortName: 'Opus 5.5',
    description: 'Deepest analysis, about twice the cost of Sonnet.',
  },
};

/** Display name for any model id, including ids no longer offered. */
export function modelName(id: string): string {
  return (MODELS as Record<string, { name: string }>)[id]?.name ?? id;
}

/** Which engine runs reviews: the Claude API, or the deterministic offline engine. */
export const ENGINE_KINDS = ['claude', 'fake'] as const;
export type EngineKind = (typeof ENGINE_KINDS)[number];
