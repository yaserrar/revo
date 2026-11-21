import { z } from 'zod';

export const CreateOrderSchema = z.object({
  items: z
    .array(z.object({ productId: z.string().min(1), quantity: z.number().int().min(1).max(50) }))
    .min(1)
    .max(50),
  couponCode: z.string().trim().toUpperCase().min(3).max(32).optional(),
});
export type CreateOrderInput = z.infer<typeof CreateOrderSchema>;

export const CouponCodeSchema = z.string().trim().toUpperCase().min(3).max(32);
