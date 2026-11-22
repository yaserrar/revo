import { expect, type Page } from '@playwright/test';
import { mock, MOCK_URL, rootEnv, waitFor, WEB_URL } from './services';

/** What the mock GitHub recorded on a PR (GET /__mock/repos/:o/:r/pulls/:n/activity). */
export type CheckRun = {
  name: string;
  headSha: string;
  status: string;
  conclusion: string | null;
  title: string;
};
export type Activity = {
  headSha: string;
  checkRuns: CheckRun[];
  comments: { id: number; body: string; edits: number }[];
  reviewComments: { path: string; line: number; body: string }[];
};

/** The "Revo" check run of the PR's current head commit. */
export const headCheck = (a: Activity) =>
  a.checkRuns.filter((c) => c.headSha === a.headSha && c.name === 'Revo').at(-1);

/** A file with the "discount applied after tax" bug (spec 19 demo), and its fix. */
export const TOTAL_BUGGY = [
  'export function orderTotal(subtotal: number, taxRate: number, discount: number): number {',
  '  const taxed = subtotal * (1 + taxRate);',
  '  return taxed - discount;',
  '}',
  '',
].join('\n');
export const TOTAL_FIXED = [
  'export function orderTotal(subtotal: number, taxRate: number, discount: number): number {',
  '  const discounted = Math.max(0, subtotal - discount);',
  '  return discounted * (1 + taxRate);',
  '}',
  '',
].join('\n');
/** SQL built by string interpolation (a blocker). */
export const LEGACY_REPORT = [
  "import { db } from '../db';",
  '',
  'export async function ordersFor(customer: string) {',
  "  return db.$queryRawUnsafe(`SELECT * FROM orders WHERE customer = '${customer}'`);",
  '}',
  '',
].join('\n');

/** Sends the mock's webhooks to the web app under test, signed with the .env secret. */
export async function routeWebhooksToApp() {
  const secret = rootEnv().GITHUB_WEBHOOK_SECRET;
  if (!secret) throw new Error('GITHUB_WEBHOOK_SECRET must be set in the root .env');
  await mock('/__mock/webhook', { url: `${WEB_URL}/api/github/webhook`, secret });
}

/** One PR of one repo of a test installation on the mock GitHub. */
export function mockPullRequest(fullName: string) {
  let number = 0;
  const activity = () => mock<Activity>(`/__mock/repos/${fullName}/pulls/${number}/activity`);
  return {
    get number() {
      return number;
    },
    async open(input: {
      title: string;
      body?: string;
      author?: string;
      files: { path: string; after: string }[];
    }) {
      number = (await mock<{ number: number }>(`/__mock/repos/${fullName}/pulls`, input)).number;
    },
    push: (files: { path: string; after: string | null }[]) =>
      mock(`/__mock/repos/${fullName}/pulls/${number}/commits`, { files }),
    activity,
    /** Waits until the head commit's Revo check is completed. */
    completedHeadCheck: (timeoutMs?: number) =>
      waitFor(activity, (a) => headCheck(a)?.status === 'completed', {
        what: 'the Revo check to complete',
        ...(timeoutMs ? { timeoutMs } : {}),
      }),
  };
}

export async function signIn(page: Page, login = 'maya-chen') {
  await page.request.post(`${MOCK_URL}/__mock/user`, { form: { login } });
  await page.goto('/sign-in');
  await page.getByRole('button', { name: 'Sign in with GitHub' }).click();
  await expect(page).toHaveURL(/\/overview$/);
}
