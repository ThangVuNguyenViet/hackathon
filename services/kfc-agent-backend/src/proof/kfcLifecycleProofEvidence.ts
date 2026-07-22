import { z } from 'zod';

const boundedId = z.string().min(1).max(256);
const digest = z.string().regex(/^[0-9a-f]{64}$/u);
const paymentAttemptSchema = z
  .object({
    attemptId: boundedId,
    status: z.enum(['pending', 'paid', 'failed', 'expired', 'cancelled']),
    orderId: z.string().max(256).nullable(),
  })
  .strict();
const orderStateSchema = z
  .object({
    status: z.enum([
      'accepted',
      'rejected',
      'preparing',
      'ready',
      'completed',
      'cancelled',
    ]),
    orderId: z.string().max(256).nullable(),
  })
  .strict();
const deliveryAttemptSchema = z
  .object({
    attemptId: boundedId,
    status: z.enum([
      'pending_dispatch',
      'assigned',
      'delivering',
      'delivered',
      'failed',
      'cancelled',
    ]),
    orderId: z.string().max(256).nullable(),
  })
  .strict();
const lifecycleInstanceSchema = z
  .object({
    instanceId: boundedId,
    environment: z.enum(['production', 'sandbox']),
    scenarioDefinitionVersion: boundedId,
    releaseId: boundedId,
    catalogObservationId: boundedId,
    catalogHash: digest,
    customerBinding: boundedId,
    sessionBinding: boundedId,
    paymentPolicy: z.enum(['prepaid', 'pay_on_fulfillment']),
    fulfillmentPolicy: z.enum(['delivery', 'pickup']),
    logicalTime: z.number().finite(),
    expiresAt: z.number().finite(),
    revision: z.number().int().nonnegative(),
    state: z
      .object({
        payment: paymentAttemptSchema.nullable(),
        order: orderStateSchema.nullable(),
        delivery: deliveryAttemptSchema.nullable(),
      })
      .strict(),
    sealedAt: z.number().finite().nullable(),
    resetFrom: z.string().max(256).nullable(),
  })
  .strict();
const lifecycleAuditEntrySchema = z
  .object({
    revision: z.number().int().nonnegative(),
    eventId: boundedId,
    eventType: z.string().min(1).max(128),
    outcome: z.enum([
      'committed',
      'fault_before_commit',
      'fault_after_commit',
      'control',
    ]),
    priorRevision: z.number().int().nonnegative().nullable(),
    createdAt: z.string().min(1).max(64),
  })
  .strict();
const lifecycleProofSourceSchema = z
  .object({
    instance: lifecycleInstanceSchema.nullable(),
    audit: z.array(lifecycleAuditEntrySchema).max(256),
  })
  .strict();

export type KfcLifecycleProofMissingReason =
  'lifecycle_audit' | 'lifecycle_evidence' | 'lifecycle_instance';

export interface KfcLifecycleProofEvidenceProjection {
  complete: boolean;
  missing: KfcLifecycleProofMissingReason[];
  instance: {
    instanceId: string;
    environment: 'production' | 'sandbox';
    scenarioDefinitionVersion: string;
    releaseId: string;
    catalogObservationId: string;
    catalogHash: string;
    paymentPolicy: 'prepaid' | 'pay_on_fulfillment';
    fulfillmentPolicy: 'delivery' | 'pickup';
    logicalTime: number;
    expiresAt: number;
    revision: number;
    state: {
      paymentStatus: string | null;
      orderStatus: string | null;
      deliveryStatus: string | null;
    };
    sealed: boolean;
  } | null;
  audit: Array<z.infer<typeof lifecycleAuditEntrySchema>>;
}

export function projectKfcLifecycleProofEvidence(
  source: unknown,
): KfcLifecycleProofEvidenceProjection {
  const parsed = lifecycleProofSourceSchema.safeParse(source);
  if (!parsed.success) {
    return {
      complete: false,
      missing: ['lifecycle_evidence'],
      instance: null,
      audit: [],
    };
  }
  const { instance, audit } = parsed.data;
  const missing: KfcLifecycleProofMissingReason[] = [
    ...(instance ? [] : ['lifecycle_instance' as const]),
    ...(audit.length > 0 ? [] : ['lifecycle_audit' as const]),
  ];
  return {
    complete: missing.length === 0,
    missing,
    instance: instance
      ? {
          instanceId: instance.instanceId,
          environment: instance.environment,
          scenarioDefinitionVersion: instance.scenarioDefinitionVersion,
          releaseId: instance.releaseId,
          catalogObservationId: instance.catalogObservationId,
          catalogHash: instance.catalogHash,
          paymentPolicy: instance.paymentPolicy,
          fulfillmentPolicy: instance.fulfillmentPolicy,
          logicalTime: instance.logicalTime,
          expiresAt: instance.expiresAt,
          revision: instance.revision,
          state: {
            paymentStatus: instance.state.payment?.status ?? null,
            orderStatus: instance.state.order?.status ?? null,
            deliveryStatus: instance.state.delivery?.status ?? null,
          },
          sealed: instance.sealedAt !== null,
        }
      : null,
    audit,
  };
}
