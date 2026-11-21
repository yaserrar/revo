/** Fictional sample data for the design kit (/dev/kit). */
import type { Category, PrState, ReviewStatus, SeverityCounts } from '@revo/shared';

export const SCORE_30_DAYS = [
  84, 86, 81, 88, 90, 87, 85, 79, 83, 88, 91, 89, 92, 86, 84, 88, 90, 93, 91, 89, 87, 90, 92, 94, 91, 88, 90,
  93, 95, 92,
].map((score, i) => ({ day: dayLabel(29 - i), score, reviews: 1 + ((i * 7) % 5) }));

export const PRS_PER_DAY = [3, 5, 4, 6, 2, 1, 4, 7, 5, 6, 3, 4, 8, 6];

export const FINDINGS_BY_WEEK: ({ week: string } & Record<Category, number>)[] = [
  { week: 'Oct 27', bug: 5, security: 2, performance: 3, 'error-handling': 2, data: 1, 'missing-test': 3 },
  { week: 'Nov 3', bug: 4, security: 3, performance: 2, 'error-handling': 3, data: 2, 'missing-test': 2 },
  { week: 'Nov 10', bug: 6, security: 1, performance: 2, 'error-handling': 1, data: 1, 'missing-test': 4 },
  { week: 'Nov 17', bug: 3, security: 2, performance: 1, 'error-handling': 2, data: 0, 'missing-test': 2 },
];

export const SAMPLE_SNIPPET = [
  'export function orderTotal(cart: Cart, promo?: Promo) {',
  '  const subtotal = cart.items.reduce((sum, i) => sum + i.price * i.qty, 0);',
  '  const taxed = subtotal * (1 + TAX_RATE);',
  '  if (!promo) return round(taxed);',
  '  // The promo is subtracted after tax is applied.',
  '  return round(taxed - promo.amountOff);',
  '}',
].join('\n');

export type SampleRow = {
  id: string;
  score: number | null;
  title: string;
  number: number;
  repo: string;
  author: string;
  counts: SeverityCounts;
  state: PrState;
  status: ReviewStatus;
  reviewedAgoMin: number;
};

export const SAMPLE_ROWS: SampleRow[] = [
  {
    id: '1',
    score: 100,
    title: 'Saved addresses on checkout',
    number: 268,
    repo: 'storefront',
    author: 'priya-raman',
    counts: { blocker: 0, major: 0, minor: 0 },
    state: 'open',
    status: 'done',
    reviewedAgoMin: 14,
  },
  {
    id: '2',
    score: 72,
    title: 'Apply promo codes at checkout',
    number: 241,
    repo: 'storefront',
    author: 'maya-chen',
    counts: { blocker: 0, major: 2, minor: 1 },
    state: 'open',
    status: 'done',
    reviewedAgoMin: 95,
  },
  {
    id: '3',
    score: 58,
    title: 'Sales report by region',
    number: 419,
    repo: 'api',
    author: 'tomas-lindqvist',
    counts: { blocker: 1, major: 1, minor: 0 },
    state: 'merged',
    status: 'done',
    reviewedAgoMin: 60 * 26,
  },
  {
    id: '4',
    score: 92,
    title: 'Store session securely',
    number: 163,
    repo: 'mobile',
    author: 'amara-okafor',
    counts: { blocker: 0, major: 0, minor: 2 },
    state: 'merged',
    status: 'done',
    reviewedAgoMin: 60 * 50,
  },
  {
    id: '5',
    score: null,
    title: 'Faster search suggestions',
    number: 279,
    repo: 'storefront',
    author: 'jonas-weber',
    counts: { blocker: 0, major: 0, minor: 0 },
    state: 'open',
    status: 'running',
    reviewedAgoMin: 1,
  },
];

function dayLabel(daysAgo: number): string {
  const d = new Date(Date.UTC(2026, 10, 21) - daysAgo * 86_400_000);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}
