import { z } from 'zod';

export const mockOperationSchema = z.enum([
  'create_order',
  'get_order',
  'cancel_order',
  'submit_pos_ticket',
  'get_pos_ticket',
  'cancel_pos_ticket',
]);

export const mockBehaviorSchema = z.object({
  operation: mockOperationSchema,
  behavior: z.enum(['succeed', 'reject', 'fail', 'delay', 'conflict']),
  delayMs: z.number().int().nonnegative().optional(),
});

export type MockBehavior = z.infer<typeof mockBehaviorSchema>;
