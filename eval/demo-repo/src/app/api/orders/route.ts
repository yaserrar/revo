import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { handle, HttpError, json } from '@/lib/http';
import { reserveStock } from '@/lib/inventory';
import { sendOrderConfirmation } from '@/lib/mailer';
import { parsePagination } from '@/lib/pagination';
import { createPaymentIntent } from '@/lib/payments';
import { priceCart } from '@/lib/pricing';
import { CreateOrderSchema } from '@/lib/validation';

/** The signed-in customer's orders, newest first. */
export const GET = handle(async (req) => {
  const user = await requireUser(req);
  const { skip, take, page } = parsePagination(new URL(req.url));
  const [orders, total] = await Promise.all([
    db.order.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'desc' }, skip, take }),
    db.order.count({ where: { userId: user.id } }),
  ]);
  return json({ orders, page, total });
});

/** Creates an order from the cart, reserves stock and starts the payment. */
export const POST = handle(async (req) => {
  const user = await requireUser(req);
  const input = CreateOrderSchema.parse(await req.json());

  const products = await db.product.findMany({
    where: { id: { in: input.items.map((i) => i.productId) }, active: true },
  });
  const byId = new Map(products.map((p) => [p.id, p]));
  const lines = input.items.map((item) => {
    const product = byId.get(item.productId);
    if (!product) throw new HttpError(404, `Product ${item.productId} not found`);
    return { productId: product.id, quantity: item.quantity, unitPriceCents: product.priceCents };
  });

  const coupon = input.couponCode
    ? await db.coupon.findFirst({
        where: { code: input.couponCode, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
      })
    : null;
  if (input.couponCode && !coupon) throw new HttpError(400, 'This coupon is not valid');

  const totals = priceCart(lines, coupon);
  const order = await db.$transaction(async (tx) => {
    for (const line of lines) await reserveStock(tx, line.productId, line.quantity);
    return tx.order.create({
      data: {
        userId: user.id,
        couponId: coupon?.id ?? null,
        ...totals,
        items: { create: lines },
      },
    });
  });

  const intent = await createPaymentIntent(order.id, order.totalCents);
  await db.order.update({ where: { id: order.id }, data: { paymentId: intent.id } });
  await sendOrderConfirmation(user, order).catch((err) => console.error('Confirmation email failed', err));
  return json({ order, clientSecret: intent.clientSecret }, { status: 201 });
});
