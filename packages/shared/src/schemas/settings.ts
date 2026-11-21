import { z } from 'zod';
import { CATEGORIES, DEFAULT_THRESHOLD } from '../constants';
import { DEFAULT_MODEL, MODEL_IDS } from '../models';
import { CategorySchema } from './finding';

export const ModelIdSchema = z.enum(MODEL_IDS);

/** Repo settings (spec 11.6): the form, the PATCH body and the worker's view all use this. */
export const RepoSettingsSchema = z.object({
  enabled: z.boolean(),
  model: ModelIdSchema,
  categories: z.array(CategorySchema).min(1, 'Check at least one category'),
  ignoreGlobs: z.array(z.string().trim().min(1).max(200)).max(50, 'At most 50 patterns'),
  threshold: z.number().int().min(0).max(100),
  maxFindings: z.number().int().min(1).max(10),
  reviewDrafts: z.boolean(),
  reviewBots: z.boolean(),
  inlineComments: z.boolean(),
  instructions: z.string().max(2000, 'At most 2,000 characters'),
  monthlyBudgetUsd: z.number().min(0).max(10_000),
});
export type RepoSettings = z.infer<typeof RepoSettingsSchema>;

/** Partial update accepted by `PATCH /api/repos/[id]/settings`. */
export const RepoSettingsPatchSchema = RepoSettingsSchema.partial();
export type RepoSettingsPatch = z.infer<typeof RepoSettingsPatchSchema>;

export const DEFAULT_REPO_SETTINGS: RepoSettings = {
  enabled: true,
  model: DEFAULT_MODEL,
  categories: [...CATEGORIES],
  ignoreGlobs: [],
  threshold: DEFAULT_THRESHOLD,
  maxFindings: 5,
  reviewDrafts: false,
  reviewBots: false,
  inlineComments: true,
  instructions: '',
  monthlyBudgetUsd: 20,
};
