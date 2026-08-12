import { z } from 'zod';

export const pvcfcChatPayloadSchema = z
  .object({
    sessionId: z.string().startsWith('pvcfc:'),
    customerId: z.string().min(1),
    clientMessageId: z.string().min(1),
    text: z.string().min(1),
    metadata: z.record(z.unknown()).optional(),
  })
  .strict();
