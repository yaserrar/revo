/**
 * Fictional but realistic findings for the demo seed. `line` is the offset
 * (0-based) of the first flagged line inside `snippet`, `span` the number of
 * flagged lines; the seed places each snippet at `startLine` in the file.
 */
import type { Category, Severity } from '@revo/shared';

export type RepoKey = 'storefront' | 'api' | 'mobile';

export type FindingTemplate = {
  repo: RepoKey;
  category: Category;
  severity: Severity;
  file: string;
  startLine: number;
  line: number;
  span: number;
  title: string;
  explanation: string;
  suggestion: string;
  snippet: string;
  confidence: number;
  /** Feedback note when someone marks this finding "Wrong": it answers this finding. */
  wrongNote: string;
};

export type RejectedTemplate = Omit<FindingTemplate, 'wrongNote'> & { rejectReason: string };

const code = (lines: string[]) => lines.join('\n');

export const FINDINGS: FindingTemplate[] = [
  {
    repo: 'storefront',
    category: 'bug',
    severity: 'major',
    file: 'src/lib/pricing.ts',
    startLine: 40,
    line: 4,
    span: 1,
    title: 'Discount applied after tax',
    explanation:
      'The promo amount is taken off the taxed total, so tax is charged on money the customer never spends. A $20 code on a $100 cart with 20% tax charges $100 instead of $96.',
    suggestion: 'Subtract the promo from the subtotal first, then compute tax on the discounted subtotal.',
    snippet: code([
      'export function orderTotal(cart: Cart, promo?: Promo) {',
      '  const subtotal = cart.items.reduce((sum, i) => sum + i.price * i.qty, 0);',
      '  const taxed = subtotal * (1 + TAX_RATE);',
      '  if (!promo) return round(taxed);',
      '  return round(taxed - promo.amountOff);',
      '}',
    ]),
    confidence: 0.91,
    wrongNote: 'Our tax rules charge tax on the list price; finance confirmed it.',
  },
  {
    repo: 'api',
    category: 'security',
    severity: 'blocker',
    file: 'src/routes/users.ts',
    startLine: 18,
    line: 1,
    span: 3,
    title: 'User id taken from the request body',
    explanation:
      'The profile update uses `userId` from the body instead of the session, so any signed-in user can rewrite another user’s profile by changing one field.',
    suggestion: 'Use `req.session.userId` in the `where` clause and drop `userId` from the accepted body.',
    snippet: code([
      "router.patch('/users/profile', requireAuth, async (req, res) => {",
      '  const { userId, displayName, bio } = req.body;',
      '  const user = await prisma.user.update({',
      '    where: { id: userId },',
      '    data: { displayName, bio },',
      '  });',
      '  res.json(user);',
      '});',
    ]),
    confidence: 0.94,
    wrongNote: 'Only admins reach this route, and they may edit any user.',
  },
  {
    repo: 'api',
    category: 'performance',
    severity: 'major',
    file: 'src/services/invoices.ts',
    startLine: 61,
    line: 4,
    span: 1,
    title: 'Query inside a loop (N+1)',
    explanation:
      'Invoice lines are loaded with one query per invoice. Accounts with 400 invoices make 401 round trips and the endpoint times out.',
    suggestion:
      'Load the lines with the invoices: `include: { lines: true }`, or one `findMany` with `invoiceId: { in: ids }`.',
    snippet: code([
      'export async function invoiceSummaries(accountId: string) {',
      '  const invoices = await prisma.invoice.findMany({ where: { accountId } });',
      '  const summaries = [];',
      '  for (const invoice of invoices) {',
      '    const lines = await prisma.invoiceLine.findMany({ where: { invoiceId: invoice.id } });',
      '    summaries.push({ ...invoice, total: sum(lines.map((l) => l.amount)) });',
      '  }',
      '  return summaries;',
      '}',
    ]),
    confidence: 0.88,
    wrongNote: 'The loop runs over three warehouses at most.',
  },
  {
    repo: 'api',
    category: 'security',
    severity: 'blocker',
    file: 'src/routes/reports.ts',
    startLine: 27,
    line: 2,
    span: 3,
    title: 'SQL built from request input',
    explanation:
      '`region`, `from` and `to` come straight from the query string into the SQL text. A crafted region value can read or drop any table.',
    suggestion: 'Use `prisma.$queryRaw` with a tagged template so every value is sent as a parameter.',
    snippet: code([
      "router.get('/reports/sales', requireAdmin, async (req, res) => {",
      '  const { from, to, region } = req.query as Record<string, string>;',
      '  const rows = await prisma.$queryRawUnsafe(',
      "    `SELECT day, sum(total) FROM orders WHERE region = '${region}' AND day BETWEEN '${from}' AND '${to}' GROUP BY day`,",
      '  );',
      '  res.json(rows);',
      '});',
    ]),
    confidence: 0.96,
    wrongNote: 'The value is an enum checked by Zod two lines above.',
  },
  {
    repo: 'storefront',
    category: 'error-handling',
    severity: 'major',
    file: 'src/app/api/checkout/route.ts',
    startLine: 52,
    line: 2,
    span: 2,
    title: 'Payment failure swallowed',
    explanation:
      'If the payment confirmation throws, the error is ignored and the order is still marked as paid. Declined cards produce shipped orders.',
    suggestion:
      'Let the error propagate (or return a 402), and only mark the order paid after a successful confirmation.',
    snippet: code([
      '  try {',
      '    await stripe.paymentIntents.confirm(intent.id);',
      '  } catch {}',
      "  await prisma.order.update({ where: { id: order.id }, data: { status: 'paid' } });",
      '  return Response.json({ ok: true });',
    ]),
    confidence: 0.92,
    wrongNote: 'The payment webhook retries it and pages on-call.',
  },
  {
    repo: 'api',
    category: 'data',
    severity: 'major',
    file: 'src/jobs/sync-inventory.ts',
    startLine: 33,
    line: 2,
    span: 4,
    title: 'Stock update can lose concurrent writes',
    explanation:
      'Stock is read, decremented in memory and written back. Two orders for the same product at the same time both read 5 and both write 4.',
    suggestion:
      'Use an atomic update: `data: { stock: { decrement: item.qty } }` with `where: { id, stock: { gte: item.qty } }`.',
    snippet: code([
      'const product = await prisma.product.findUnique({ where: { id: item.productId } });',
      'if (!product) continue;',
      'await prisma.product.update({',
      '  where: { id: product.id },',
      '  data: { stock: product.stock - item.qty },',
      '});',
    ]),
    confidence: 0.84,
    wrongNote: 'Stock updates go through a single-worker queue.',
  },
  {
    repo: 'storefront',
    category: 'data',
    severity: 'minor',
    file: 'src/lib/promo.ts',
    startLine: 12,
    line: 1,
    span: 2,
    title: 'Promo expiry compared in server time',
    explanation:
      '`endsOn` is a calendar date but the end of day is set in the server’s timezone (UTC on the host), so US customers lose the last evening of a promo.',
    suggestion:
      'Store the promo end as a timestamp with timezone, or compute the end of day in the store’s timezone.',
    snippet: code([
      'export function isPromoActive(promo: Promo, now = new Date()) {',
      '  const end = new Date(promo.endsOn); // "2026-11-30"',
      '  end.setHours(23, 59, 59);',
      '  return now <= end;',
      '}',
    ]),
    confidence: 0.73,
    wrongNote: 'Every server runs in UTC, like the promo dates.',
  },
  {
    repo: 'mobile',
    category: 'bug',
    severity: 'minor',
    file: 'src/hooks/useCart.ts',
    startLine: 28,
    line: 2,
    span: 1,
    title: 'Quantity can go below zero',
    explanation:
      'Tapping minus on an item with quantity 1 sets it to 0, then -1. The cart shows negative totals.',
    suggestion: 'Remove the item when the quantity reaches 0, or clamp with `Math.max(0, item.qty - 1)`.',
    snippet: code([
      '  const decrement = useCallback((id: string) => {',
      '    setItems((items) =>',
      '      items.map((item) => (item.id === id ? { ...item, qty: item.qty - 1 } : item)),',
      '    );',
      '  }, []);',
    ]),
    confidence: 0.8,
    wrongNote: 'A CHECK constraint in the database rejects negative quantities.',
  },
  {
    repo: 'storefront',
    category: 'missing-test',
    severity: 'minor',
    file: 'src/lib/pricing.ts',
    startLine: 71,
    line: 0,
    span: 5,
    title: 'No test for the new shipping tiers',
    explanation:
      '`shippingFee` adds four branches (country, free threshold, two tiers) and no test covers them.',
    suggestion: 'Add a table test with one case per tier, including the 75.00 and 40.00 boundaries.',
    snippet: code([
      'export function shippingFee(subtotal: number, country: string) {',
      "  if (country !== 'US') return subtotal >= 150 ? 0 : 24;",
      '  if (subtotal >= 75) return 0;',
      '  return subtotal >= 40 ? 4.99 : 8.99;',
      '}',
    ]),
    confidence: 0.77,
    wrongNote: 'The checkout e2e suite covers every tier.',
  },
  {
    repo: 'mobile',
    category: 'security',
    severity: 'major',
    file: 'src/lib/storage.ts',
    startLine: 9,
    line: 1,
    span: 1,
    title: 'Session token stored in plain AsyncStorage',
    explanation:
      'AsyncStorage is unencrypted. On a rooted device or from a backup, the refresh token can be read and reused.',
    suggestion:
      'Store the session with `expo-secure-store` (Keychain / Keystore) and keep only non-secret data in AsyncStorage.',
    snippet: code([
      'export async function saveSession(session: Session) {',
      "  await AsyncStorage.setItem('session', JSON.stringify(session));",
      '}',
    ]),
    confidence: 0.86,
    wrongNote: 'This is the public guest token, not the session.',
  },
  {
    repo: 'mobile',
    category: 'error-handling',
    severity: 'minor',
    file: 'src/lib/api.ts',
    startLine: 14,
    line: 2,
    span: 1,
    title: 'Non-JSON error responses crash the client',
    explanation:
      'A 502 from the load balancer returns HTML, `res.json()` throws a SyntaxError, and the screen shows a generic crash instead of the retry state.',
    suggestion: 'Check `res.ok` and the content type before parsing; fall back to the status text.',
    snippet: code([
      'export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {',
      '  const res = await fetch(`${API_URL}${path}`, init);',
      '  const body = await res.json();',
      '  if (!res.ok) throw new ApiError(res.status, body.message);',
      '  return body as T;',
      '}',
    ]),
    confidence: 0.79,
    wrongNote: 'Our gateway always answers errors with JSON.',
  },
  {
    repo: 'api',
    category: 'bug',
    severity: 'major',
    file: 'src/services/invoices.ts',
    startLine: 104,
    line: 0,
    span: 1,
    title: 'Off-by-one drops the last page of the export',
    explanation:
      '`Math.floor` ignores the partial last page: 105 invoices with a page size of 50 export 100 and silently skip 5.',
    suggestion: 'Use `Math.ceil(total / PAGE_SIZE)`.',
    snippet: code([
      '  const pages = Math.floor(total / PAGE_SIZE);',
      '  for (let page = 0; page < pages; page++) {',
      '    await exportPage(accountId, page);',
      '  }',
    ]),
    confidence: 0.9,
    wrongNote: 'Pages are 1-based here, so the last page is included.',
  },
  {
    repo: 'storefront',
    category: 'performance',
    severity: 'major',
    file: 'src/server/orders.ts',
    startLine: 8,
    line: 1,
    span: 5,
    title: 'Every order loaded to show the last 10',
    explanation:
      'All orders with their lines and products are loaded, then sliced in memory. Loyal customers with 2,000 orders make the account page take seconds.',
    suggestion: 'Add `take: 10` to the query and drop the `slice`.',
    snippet: code([
      'export async function recentOrders(customerId: string) {',
      '  const orders = await prisma.order.findMany({',
      '    where: { customerId },',
      '    include: { lines: { include: { product: true } } },',
      "    orderBy: { createdAt: 'desc' },",
      '  });',
      '  return orders.slice(0, 10);',
      '}',
    ]),
    confidence: 0.87,
    wrongNote: 'This table holds a few hundred rows at most.',
  },
  {
    repo: 'storefront',
    category: 'security',
    severity: 'blocker',
    file: 'src/app/api/checkout/route.ts',
    startLine: 21,
    line: 2,
    span: 1,
    title: 'Price trusted from the client',
    explanation:
      'The amount charged is computed from `unitPrice` sent by the browser. Anyone can edit the request and pay $0.01 for any cart.',
    suggestion: 'Load prices from the database by product id and compute the amount on the server.',
    snippet: code([
      'export async function POST(req: Request) {',
      '  const { items } = CheckoutBody.parse(await req.json());',
      '  const amount = items.reduce((sum, i) => sum + i.unitPrice * i.qty, 0);',
      "  const intent = await stripe.paymentIntents.create({ amount: Math.round(amount * 100), currency: 'usd' });",
    ]),
    confidence: 0.95,
    wrongNote: 'Intentional: this endpoint is internal and behind the VPN.',
  },
  {
    repo: 'api',
    category: 'data',
    severity: 'blocker',
    file: 'prisma/migrations/20261102_phone_e164/migration.sql',
    startLine: 1,
    line: 0,
    span: 1,
    title: 'Migration drops a column that still holds data',
    explanation:
      '`phone` is dropped before its values are copied into `phoneE164`. Every customer phone number is lost on deploy.',
    suggestion:
      'Add the new column, backfill it with an UPDATE, deploy the code that reads it, then drop `phone` in a later migration.',
    snippet: code([
      'ALTER TABLE "Customer" DROP COLUMN "phone";',
      'ALTER TABLE "Customer" ADD COLUMN "phoneE164" TEXT;',
    ]),
    confidence: 0.93,
    wrongNote: 'The previous migration already copied and emptied that column.',
  },
  {
    repo: 'api',
    category: 'error-handling',
    severity: 'major',
    file: 'src/jobs/sync-inventory.ts',
    startLine: 88,
    line: 1,
    span: 1,
    title: 'Unhandled rejection in the sync interval',
    explanation:
      '`syncInventory()` returns a promise nobody awaits. When the supplier API fails, the rejection is unhandled and Node exits the worker.',
    suggestion:
      'Catch and log: `syncInventory().catch((err) => log.error({ err }, "inventory sync failed"))`.',
    snippet: code(['setInterval(() => {', '  syncInventory();', '}, 60_000);']),
    confidence: 0.85,
    wrongNote: 'A global unhandledRejection handler logs it and restarts the sync.',
  },
];

export const REJECTED: RejectedTemplate[] = [
  {
    repo: 'api',
    category: 'bug',
    severity: 'minor',
    file: 'src/jobs/sync-inventory.ts',
    startLine: 33,
    line: 0,
    span: 1,
    title: 'Product may be undefined',
    explanation: 'The product lookup can return null and the next line reads its stock.',
    suggestion: 'Handle the missing product.',
    snippet: code([
      'const product = await prisma.product.findUnique({ where: { id: item.productId } });',
      'if (!product) continue;',
    ]),
    confidence: 0.52,
    rejectReason: 'The next line already skips missing products with `if (!product) continue`.',
  },
  {
    repo: 'storefront',
    category: 'performance',
    severity: 'minor',
    file: 'src/lib/pricing.ts',
    startLine: 41,
    line: 0,
    span: 1,
    title: 'reduce runs on every call',
    explanation: 'The subtotal is recomputed each time the function is called.',
    suggestion: 'Memoise the subtotal.',
    snippet: code(['  const subtotal = cart.items.reduce((sum, i) => sum + i.price * i.qty, 0);']),
    confidence: 0.41,
    rejectReason: 'Carts are capped at 50 items; the cost is negligible and this is style, not a defect.',
  },
  {
    repo: 'storefront',
    category: 'security',
    severity: 'major',
    file: 'src/app/api/checkout/route.ts',
    startLine: 21,
    line: 0,
    span: 1,
    title: 'No CSRF protection on checkout',
    explanation: 'The route accepts POST requests without a CSRF token.',
    suggestion: 'Add a CSRF token.',
    snippet: code(['export async function POST(req: Request) {']),
    confidence: 0.58,
    rejectReason:
      'The route only accepts JSON bodies and the session cookie is SameSite=Lax, so a cross-site form cannot reach it.',
  },
  {
    repo: 'mobile',
    category: 'error-handling',
    severity: 'minor',
    file: 'src/lib/api.ts',
    startLine: 15,
    line: 0,
    span: 1,
    title: 'fetch has no timeout',
    explanation: 'The request may hang forever on a bad network.',
    suggestion: 'Pass an AbortSignal with a timeout.',
    snippet: code(['  const res = await fetch(`${API_URL}${path}`, init);']),
    confidence: 0.55,
    rejectReason:
      'Speculative: the app shell already aborts pending requests after 15 s through the shared signal in `init`.',
  },
];

export const PR_TITLES: Record<RepoKey, string[]> = {
  storefront: [
    'Apply promo codes at checkout',
    'Add tiered shipping fees',
    'Move checkout to server-side pricing',
    'Show recent orders on the account page',
    'Gift cards: redeem at checkout',
    'Fix cart badge count after sign-in',
    'Holiday banner with countdown',
    'Persist cart across devices',
    'Add Apple Pay to the payment sheet',
    'Product page: size guide drawer',
    'Refactor price formatting',
    'Wishlist: share a public link',
    'Track checkout funnel events',
    'Promo expiry banner',
    'Bump next from 16.3.6 to 16.3.8',
    'Saved addresses on checkout',
    'Faster search suggestions',
    'Order confirmation email copy',
  ],
  api: [
    'Invoice summaries endpoint',
    'Profile update endpoint',
    'Sales report by region',
    'Inventory sync every minute',
    'Normalise phone numbers to E.164',
    'Paginated invoice export',
    'Rate limit the public API',
    'Webhook retries with backoff',
    'Soft delete for customers',
    'Add audit log for admin actions',
    'Cache product catalogue in Redis',
    'Upgrade Prisma to 7.10',
    'Refund endpoint for partial refunds',
    'Tax rules per US state',
    'Health check includes Redis',
  ],
  mobile: [
    'Cart quantity stepper',
    'Store session securely',
    'Offline banner and retry',
    'Order history screen',
    'Push notification opt-in',
    'API client error handling',
    'Dark mode for product screens',
    'Biometric unlock',
    'Pull to refresh on orders',
  ],
};

export const BRANCH_PREFIX: Record<RepoKey, string[]> = {
  storefront: ['feat', 'fix', 'chore'],
  api: ['feat', 'fix', 'perf'],
  mobile: ['feat', 'fix'],
};

export const USEFUL_NOTES = [
  'Good catch, fixed in the next push.',
  'This would have hit production.',
  null,
  null,
  null,
];
