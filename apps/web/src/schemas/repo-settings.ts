import type { z } from 'zod';
import { globError, RepoSettingsPatchSchema, RepoSettingsSchema } from '@revo/shared';

/**
 * Why a glob pattern is invalid, or null when it is fine. The same rules run in
 * the worker before matching (`@revo/shared` glob engine, linear time).
 */
export { globError };

function refineGlobs(globs: string[], ctx: z.RefinementCtx) {
  const seen = new Set<string>();
  globs.forEach((glob, i) => {
    const error = globError(glob);
    if (error) ctx.addIssue({ code: 'custom', path: [i], message: error });
    else if (seen.has(glob.trim()))
      ctx.addIssue({ code: 'custom', path: [i], message: 'Already in the list.' });
    seen.add(glob.trim());
  });
}

const IgnoreGlobsSchema = RepoSettingsSchema.shape.ignoreGlobs.superRefine(refineGlobs);

/** The settings form (every field, globs validated). */
export const RepoSettingsFormSchema = RepoSettingsSchema.extend({
  ignoreGlobs: IgnoreGlobsSchema,
});
export type RepoSettingsFormValues = z.infer<typeof RepoSettingsFormSchema>;

/** Body of `PATCH /api/repos/[id]/settings`: a partial update with the same rules. */
export const RepoSettingsBodySchema = RepoSettingsPatchSchema.extend({
  ignoreGlobs: IgnoreGlobsSchema.optional(),
}).refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update.' });
export type RepoSettingsBody = z.infer<typeof RepoSettingsBodySchema>;
