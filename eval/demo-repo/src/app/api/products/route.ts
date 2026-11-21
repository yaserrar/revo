import { db } from '@/lib/db';
import { handle, json } from '@/lib/http';
import { parsePagination } from '@/lib/pagination';

/** Public catalogue: active products, newest first. */
export const GET = handle(async (req) => {
  const { skip, take, page, pageSize } = parsePagination(new URL(req.url));
  const where = { active: true };
  const [products, total] = await Promise.all([
    db.product.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
      select: { id: true, slug: true, name: true, priceCents: true, stock: true },
    }),
    db.product.count({ where }),
  ]);
  return json({ products, page, pageSize, total });
});
