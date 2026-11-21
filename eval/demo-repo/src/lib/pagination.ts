export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

export type Pagination = { page: number; pageSize: number; skip: number; take: number };

function positiveInt(value: string | null, fallback: number): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

/** Reads `?page=` (1-based) and `?pageSize=` from a URL, with safe defaults and limits. */
export function parsePagination(url: URL): Pagination {
  const page = positiveInt(url.searchParams.get('page'), 1);
  const pageSize = Math.min(positiveInt(url.searchParams.get('pageSize'), DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}
