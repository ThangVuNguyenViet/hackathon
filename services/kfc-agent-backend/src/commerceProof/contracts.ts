import { z } from "zod";

export const commerceContractVersion = "kfc-commerce-proof-v1" as const;

export const omsStatusSchema = z.enum([
  "previewed",
  "created",
  "cancelled",
  "cancellation_failed",
]);

export const posStatusSchema = z.enum([
  "accepted",
  "preparing",
  "ready",
  "cancelled",
  "rejected",
  "cancellation_failed",
  "unknown",
]);

export const customerStatusSchema = z.enum([
  "awaiting_confirmation",
  "submitting",
  "accepted",
  "preparing",
  "ready",
  "cancelled",
  "failed",
]);

const identifierSchema = z.string().trim().min(1);

export const commerceCommandSchema = z.object({
  contractVersion: z.literal(commerceContractVersion),
  traceId: identifierSchema,
  scenarioId: identifierSchema,
  sessionId: identifierSchema,
  clientMessageId: identifierSchema,
  idempotencyKey: identifierSchema,
  toolName: z.literal("placeOrder"),
  order: z.object({
    previewId: identifierSchema,
    storeId: identifierSchema,
    items: z
      .array(
        z.object({
          itemCode: identifierSchema,
          quantity: z.number().int().positive(),
        }),
      )
      .min(1),
    totalVnd: z.number().int().nonnegative(),
    paymentMethod: identifierSchema,
    userConfirmed: z.literal(true),
  }),
});

export const commerceResultSchema = z.object({
  contractVersion: z.literal(commerceContractVersion),
  traceId: identifierSchema,
  scenarioId: identifierSchema,
  outcome: z.enum([
    "accepted",
    "deduplicated",
    "pos_rejected",
    "ambiguous_pos_submission",
    "cancelled",
    "partial_cancellation",
    "status_conflict",
    "failed",
  ]),
  commerceOrderId: identifierSchema.optional(),
  omsOrderId: identifierSchema.optional(),
  posTicketId: identifierSchema.optional(),
  omsStatus: omsStatusSchema.optional(),
  posStatus: posStatusSchema.optional(),
  customerStatus: customerStatusSchema,
  deduplicated: z.boolean().default(false),
  originalTraceId: identifierSchema.optional(),
  compensationStatus: z.enum(["not_required", "succeeded", "failed"]).optional(),
  conflictType: identifierSchema.optional(),
  simulated: z.object({
    gateway: z.boolean(),
    oms: z.boolean(),
    pos: z.boolean(),
  }),
});

export type CommerceCommand = z.infer<typeof commerceCommandSchema>;
export type CommerceResult = z.infer<typeof commerceResultSchema>;
export type OmsStatus = z.infer<typeof omsStatusSchema>;
export type PosStatus = z.infer<typeof posStatusSchema>;
export type CustomerStatus = z.infer<typeof customerStatusSchema>;
