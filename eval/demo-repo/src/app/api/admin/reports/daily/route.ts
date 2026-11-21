import { requireAdmin } from '@/lib/auth';
import { addDays, isoDay, parseIsoDay, startOfUtcDay } from '@/lib/dates';
import { db } from '@/lib/db';
import { badRequest, handle, json } from '@/lib/http';

/** Sales for one UTC day (`?day=YYYY-MM-DD`, default today): order count and revenue by status. */
export const GET = handle(async (req) => {
  await requireAdmin(req);
  const param = new URL(req.url).searchParams.get('day');
  const day = param ? parseIsoDay(param) : startOfUtcDay(new Date());
  if (!day) throw badRequest('day must be YYYY-MM-DD');

  const rows = await db.order.groupBy({
    by: ['status'],
    where: { createdAt: { gte: day, lt: addDays(day, 1) } },
    _count: { _all: true },
    _sum: { totalCents: true },
  });
  return json({
    day: isoDay(day),
    byStatus: rows.map((r) => ({ status: r.status, orders: r._count._all, revenueCents: r._sum.totalCents ?? 0 })),
  });
});
