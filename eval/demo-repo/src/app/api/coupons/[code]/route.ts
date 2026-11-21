import { db } from '@/lib/db';
import { handle, json, notFound } from '@/lib/http';
import { CouponCodeSchema } from '@/lib/validation';

type Ctx = { params: Promise<{ code: string }> };

/** Checks a coupon code at checkout and returns its discount. */
export const GET = handle<Ctx>(async (_req, { params }) => {
  const code = CouponCodeSchema.parse((await params).code);
  const coupon = await db.coupon.findUnique({ where: { code } });
  if (!coupon || (coupon.expiresAt && coupon.expiresAt <= new Date())) throw notFound('Coupon');
  return json({ code: coupon.code, percentOff: coupon.percentOff, expiresAt: coupon.expiresAt });
});
