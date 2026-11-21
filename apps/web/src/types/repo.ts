import type { InstallationDto, ModelId, RepoDto, RepoSettingsDto } from '@revo/shared';

/** Spend of one repo this UTC month against its monthly budget. */
export type BudgetDto = {
  repoId: string;
  repoFullName: string;
  spentUsd: number;
  budgetUsd: number;
  reached: boolean;
};

/** A row of the Repos table. */
export type RepoRowDto = RepoDto & {
  model: string;
  prsReviewed: number;
  /** Average score of done reviews in the last 30 days. */
  avgScore: number | null;
  lastReviewAt: string | null;
  budget: BudgetDto;
};

export type ReposDto = { items: RepoRowDto[]; installations: InstallationDto[] };

/** A model the settings form offers, with its prices in USD per million tokens. */
export type ModelOptionDto = {
  id: ModelId;
  name: string;
  description: string;
  inputPerMTok: number;
  outputPerMTok: number;
};

export type RepoSettingsPageDto = {
  repo: RepoDto;
  settings: RepoSettingsDto;
  budget: BudgetDto;
  models: ModelOptionDto[];
  builtInIgnoreGlobs: string[];
  /** The user may change these settings (Maintain or Admin on GitHub). */
  canEdit: boolean;
};
