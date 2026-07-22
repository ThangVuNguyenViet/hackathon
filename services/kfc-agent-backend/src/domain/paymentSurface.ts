import { z } from 'zod';

export const PAYMENT_SURFACES = ['kfc_website_checkout'] as const;

export const paymentSurfaceSchema = z.enum(PAYMENT_SURFACES);

export type PaymentSurface = z.infer<typeof paymentSurfaceSchema>;

export function parsePaymentSurface(value: unknown): PaymentSurface {
  const parsed = paymentSurfaceSchema.safeParse(value);
  if (!parsed.success) throw new Error('payment_surface_invalid');
  return parsed.data;
}
