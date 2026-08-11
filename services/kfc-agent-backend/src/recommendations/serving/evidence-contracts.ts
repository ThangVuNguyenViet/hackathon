import { z } from 'zod';

export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number().finite(),
    z.string(),
    z.array(jsonValueSchema),
    z.record(jsonValueSchema),
  ]),
);
const id = z.string().trim().min(1).max(256);
const digest = z.string().regex(/^[a-f0-9]{64}$/u);
const instant = z.string().datetime({ offset: true });
const recommendationType = z.enum([
  'local_favorite',
  'for_you',
  'modifier_upsell',
  'smart_cross_sell',
]);

export const automaticDecisionEvidenceSchema = z
  .object({
    idempotencyKey: id,
    requestId: id,
    requestDigest: digest,
    contextDigest: digest,
    recommendationId: id,
    recommendationType,
    orderingJourneyRef: id,
    opportunityRef: id,
    storeId: id,
    fulfilmentMode: z.enum(['pickup', 'delivery']),
    locale: z.string().trim().min(2),
    cartId: id,
    cartRevision: id,
    cartDigest: digest,
    catalogRevision: id,
    decisionTime: instant,
    expiresAt: instant,
    contractDigest: digest,
    response: jsonValueSchema,
    technical: z
      .object({
        contextBindings: jsonValueSchema,
        potentialCandidates: z.array(jsonValueSchema),
        eligibilityDecisions: z.array(jsonValueSchema),
        featureReconciliation: jsonValueSchema,
        scoresCalibration: jsonValueSchema.nullable(),
        composition: jsonValueSchema,
        modelReleaseProvenance: jsonValueSchema.nullable(),
        traceLocator: id.nullable(),
      })
      .strict(),
  })
  .strict();

export const automaticEventEvidenceSchema = z
  .object({
    idempotencyKey: id,
    eventId: id,
    recommendationId: id,
    orderingJourneyRef: id,
    channel: z.enum(['kiosk', 'chat', 'workbench', 'other']),
    eventType: z.enum([
      'impression',
      'selected',
      'action_dismissed',
      'cart_mutation_succeeded',
      'cart_mutation_failed',
      'slate_dismissed',
      'checkout_completed',
      'order_abandoned',
    ]),
    actionId: id.nullable(),
    renderedPosition: z.number().int().positive().nullable(),
    cartRevision: id,
    payloadDigest: digest,
    occurredAt: instant,
    receivedAt: instant,
    payload: jsonValueSchema,
  })
  .strict();

export type AutomaticDecisionEvidence = z.infer<
  typeof automaticDecisionEvidenceSchema
>;
export type AutomaticEventEvidence = z.infer<
  typeof automaticEventEvidenceSchema
>;

export function parseAutomaticDecisionEvidence(value: unknown) {
  return automaticDecisionEvidenceSchema.parse(value);
}

export function parseAutomaticEventEvidence(value: unknown) {
  return automaticEventEvidenceSchema.parse(value);
}

export function parseAutomaticTechnicalEvidence(value: unknown) {
  return automaticDecisionEvidenceSchema.shape.technical.parse(value);
}

export function parseJsonValue(value: unknown): JsonValue {
  return jsonValueSchema.parse(value);
}
