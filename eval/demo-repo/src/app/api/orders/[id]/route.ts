import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, json, notFound } from '@/lib/http';

type Ctx = { params: Promise<{ id: string }> };

/** One order with its items. Customers only see their own orders; admins see all. */
export const GET = handle<Ctx>(async (req, { params }) => {
  const user = await requireUser(req);
  const { id } = await params;
  const order = await db.order.findUnique({
    where: { id },
    include: { items: { include: { product: { select: { name: true, slug: true } } } } },
  });
  if (!order || (order.userId !== user.id && user.role !== 'ADMIN')) throw notFound('Order');
  return json({ order });
});
