import { z } from 'zod';

/** cuid ids used by every table. */
export const IdSchema = z.string().min(1).max(64);
export const IdParamsSchema = z.object({ id: IdSchema });

/** Error body returned by every API route (`route()` in apps/web). */
export const API_ERROR_CODES = [
  'VALIDATION_ERROR',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',
  'UNPROCESSABLE',
  'BUDGET_REACHED',
  'INTERNAL',
  'PAYLOAD_TOO_LARGE',
] as const;
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export type ApiErrorBody = {
  message: string;
  code: ApiErrorCode;
  details?: unknown;
  issues?: { path: (string | number)[]; message: string }[];
};

export type Paginated<T> = {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  pageCount: number;
};

export function pageMeta(total: number, page: number, pageSize: number) {
  return { page, pageSize, total, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
}
