import { z } from "zod";
import { opaqueProviderIdSchema } from "../domain/opaqueProviderId.js";
import {
  commerceCommandSchema,
  commerceContractVersion,
  commerceProviderProvenanceSchema,
  commerceResultSchema,
  sandboxCommerceProofProviderProvenance,
  type CommerceCommand,
  type CommerceResult,
} from "./contracts.js";
import {
  gatewayOmsCancellationEvidenceSchema,
  gatewayOmsCancellationFailureEvidenceSchema,
  gatewayOmsCreateEvidenceSchema,
  gatewayOmsCreateFailureEvidenceSchema,
  gatewayPosCancellationEvidenceSchema,
  gatewayPosCancellationFailureEvidenceSchema,
  gatewayPosRejectionEvidenceSchema,
  gatewayPosSubmitEvidenceSchema,
} from "./gatewayMutationEvidence.js";
import {
  structurallyEqual,
  validateGatewayMutationSnapshotBindings,
  validateStoredOrderPhase,
} from "./gatewayMutationValidation.js";
const identifierSchema = opaqueProviderIdSchema;
const bindingFingerprintSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const pathSafeIdentifierSchema = identifierSchema.refine(
  (value) => value !== "." && value !== "..",
  { message: "Identifier must not be a URL dot segment" },
);

const mutationHttpStatusSchema = z.number().int().min(100).max(599);
const canonicalPayloadSchema = z.string().min(1);
const storedMutationAuthoritySchema = z.object({
  kind: z.enum(["placeOrder", "createPaymentLink", "cancelOrder"]),
  bindingFingerprint: bindingFingerprintSchema,
  canonicalPayload: canonicalPayloadSchema,
}).strict();
const gatewayProviderRuntimeBindingSchema = z.object({
  omsInstanceId: identifierSchema,
  posInstanceId: identifierSchema,
}).strict();

export const gatewayProviderMutationIdentitySchema = z.object({
  idempotencyKey: identifierSchema,
  bindingFingerprint: bindingFingerprintSchema,
}).strict();

const gatewayRuntimeProvenanceSchema = z.array(z.object({
  fixtureMode: z.literal("provider_runtime"),
  sourceFile: z.literal("src/commerceProof/gatewayServer.ts"),
  sourceApi: z.literal("sandbox-commerce-gateway"),
}).strict()).length(1);

export const sandboxPaymentLinkSuccessSchema = z.object({
  ok: z.literal(true),
  value: z.object({
    url: z.string().url(),
    status: z.literal("pending"),
  }).strict(),
  message: z.literal("payment_link_created"),
  provenance: gatewayRuntimeProvenanceSchema,
}).strict();

const absentStoredResultFieldSchema = z.never().optional();
const storedOrderResponseSchema = z.discriminatedUnion("outcome", [
  commerceResultSchema.extend({
    outcome: z.literal("accepted"),
    commerceOrderId: pathSafeIdentifierSchema,
    omsOrderId: identifierSchema,
    posTicketId: identifierSchema,
    omsStatus: z.literal("created"),
    posStatus: z.literal("accepted"),
    customerStatus: z.literal("accepted"),
    deduplicated: z.literal(false),
    originalTraceId: absentStoredResultFieldSchema,
    compensationStatus: absentStoredResultFieldSchema,
    conflictType: absentStoredResultFieldSchema,
  }).strict(),
  commerceResultSchema.extend({
    outcome: z.literal("pos_rejected"),
    commerceOrderId: pathSafeIdentifierSchema,
    omsOrderId: identifierSchema,
    posTicketId: absentStoredResultFieldSchema,
    omsStatus: z.enum(["cancelled", "cancellation_failed"]),
    posStatus: z.literal("rejected"),
    customerStatus: z.literal("failed"),
    deduplicated: z.literal(false),
    originalTraceId: absentStoredResultFieldSchema,
    compensationStatus: z.enum(["succeeded", "failed"]),
    conflictType: absentStoredResultFieldSchema,
  }).strict(),
  commerceResultSchema.extend({
    outcome: z.literal("failed"),
    commerceOrderId: pathSafeIdentifierSchema,
    omsOrderId: absentStoredResultFieldSchema,
    posTicketId: absentStoredResultFieldSchema,
    omsStatus: absentStoredResultFieldSchema,
    posStatus: absentStoredResultFieldSchema,
    customerStatus: z.literal("failed"),
    deduplicated: z.literal(false),
    originalTraceId: absentStoredResultFieldSchema,
    compensationStatus: absentStoredResultFieldSchema,
    conflictType: absentStoredResultFieldSchema,
  }).strict(),
]);

const storedCommerceOrderMutationSchema = z.object({
  command: commerceCommandSchema,
  canonicalPayload: canonicalPayloadSchema,
  commerceOrderId: pathSafeIdentifierSchema,
  state: z.enum([
    "oms_create_pending",
    "oms_create_unknown",
    "oms_create_failed",
    "pos_submit_pending",
    "pos_submit_unknown",
    "pos_submit_accepted",
    "oms_compensation_pending",
    "oms_compensation_unknown",
    "oms_compensation_succeeded",
    "oms_compensation_failed",
    "completed",
  ]),
  omsCreateIdentity: gatewayProviderMutationIdentitySchema,
  omsCreateEvidence: gatewayOmsCreateEvidenceSchema.optional(),
  omsCreateFailureEvidence: gatewayOmsCreateFailureEvidenceSchema.optional(),
  omsOrderId: identifierSchema.optional(),
  omsStatus: z.literal("created").optional(),
  posSubmitIdentity: gatewayProviderMutationIdentitySchema.optional(),
  posSubmitEvidence: gatewayPosSubmitEvidenceSchema.optional(),
  posRejectionEvidence: gatewayPosRejectionEvidenceSchema.optional(),
  compensationIdentity: gatewayProviderMutationIdentitySchema.optional(),
  omsCompensationEvidence:
    gatewayOmsCancellationEvidenceSchema.optional(),
  omsCompensationFailureEvidence:
    gatewayOmsCancellationFailureEvidenceSchema.optional(),
  response: storedOrderResponseSchema.optional(),
  responseStatus: mutationHttpStatusSchema.optional(),
}).strict().superRefine((stored, context) => {
  if (
    stored.canonicalPayload !==
      canonicalCommerceCommandPayload(stored.command)
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Stored order canonical payload does not match its command",
    });
  }
  validateStoredOrderPhase(stored, context);
  if (stored.state === "completed") {
    if (!stored.response || stored.responseStatus === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Completed order mutation requires a replayable response",
      });
      return;
    }
    const expectedStatus = orderMutationResponseStatus(stored.response.outcome);
    if (
      expectedStatus === undefined ||
      stored.responseStatus !== expectedStatus ||
      stored.response.commerceOrderId !== stored.commerceOrderId ||
      stored.response.traceId !== stored.command.traceId ||
      stored.response.scenarioId !== stored.command.scenarioId ||
      stored.response.deduplicated ||
      stored.response.originalTraceId !== undefined ||
      !structurallyEqual(
        stored.response.providerProvenance,
        sandboxCommerceProofProviderProvenance,
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Completed order mutation response is not coherently bound",
      });
    }
  } else if (
    stored.response !== undefined ||
    stored.responseStatus !== undefined
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Incomplete order mutation must not contain a terminal response",
    });
  }
});

const storedPaymentLinkMutationSchema = z.object({
  bindingFingerprint: bindingFingerprintSchema,
  canonicalPayload: canonicalPayloadSchema,
  result: sandboxPaymentLinkSuccessSchema,
}).strict();

const storedCancelledOrderSchema = z.object({
  id: pathSafeIdentifierSchema,
  cart: z.object({
    id: identifierSchema,
    items: z.array(z.object({
      itemCode: identifierSchema,
      name: z.string(),
      quantity: z.number().int().positive().safe(),
      unitPriceVnd: z.number().int().nonnegative().safe(),
      modifiers: z.array(z.object({
        groupId: identifierSchema,
        groupName: z.string(),
        modifierId: identifierSchema,
        modifierName: z.string(),
        quantity: z.number().int().positive().safe(),
        priceDeltaVnd: z.number().int().safe(),
      }).strict()).optional(),
      imageUrl: z.string().optional(),
      category: z.string().optional(),
    }).strict()),
    subtotalVnd: z.number().int().nonnegative().safe(),
    discountVnd: z.number().int().nonnegative().safe(),
    deliveryFeeVnd: z.number().int().nonnegative().safe(),
    totalVnd: z.number().int().nonnegative().safe(),
    voucherCode: z.string().nullable(),
  }).strict(),
  status: z.literal("cancelled"),
  paymentStatus: z.enum(["not_started", "pending", "paid", "failed"]),
  assignedStoreId: identifierSchema,
  createdAt: z.string().min(1),
  posTicketId: identifierSchema.optional(),
  posStatus: z.enum([
    "accepted",
    "preparing",
    "ready",
    "cancelled",
    "rejected",
  ]).optional(),
  commerceOrderId: pathSafeIdentifierSchema.optional(),
  omsOrderId: identifierSchema.optional(),
  commerceOutcome: identifierSchema.optional(),
  commerceCustomerStatus: identifierSchema.optional(),
  commerceEnvironment: z.literal("sandbox").optional(),
  commerceProviderProvenance: commerceProviderProvenanceSchema.optional(),
}).strict();

export const sandboxCancellationResultSchema = z.union([
  commerceResultSchema.extend({
    outcome: z.literal("cancelled"),
    customerStatus: z.literal("cancelled"),
    deduplicated: z.literal(false),
    originalTraceId: absentStoredResultFieldSchema,
    compensationStatus: absentStoredResultFieldSchema,
    conflictType: absentStoredResultFieldSchema,
    ok: z.literal(true),
    value: storedCancelledOrderSchema,
    message: z.literal("order_cancelled"),
    provenance: gatewayRuntimeProvenanceSchema,
  }).strict(),
  commerceResultSchema.extend({
    outcome: z.literal("partial_cancellation"),
    customerStatus: z.literal("failed"),
    deduplicated: z.literal(false),
    originalTraceId: absentStoredResultFieldSchema,
    compensationStatus: absentStoredResultFieldSchema,
    ok: z.literal(false),
    errorCode: z.literal("commerce_cancellation_incomplete"),
    message: z.literal("Order cancellation was incomplete"),
    provenance: gatewayRuntimeProvenanceSchema,
  }).strict(),
]);

const gatewayCancellationContextSchema = z.object({
  traceId: identifierSchema,
  scenarioId: identifierSchema,
  commerceOrderId: pathSafeIdentifierSchema,
  omsOrderId: identifierSchema,
  posTicketId: identifierSchema,
}).strict();

const storedCancellationMutationSchema = z.object({
  bindingFingerprint: bindingFingerprintSchema,
  canonicalPayload: canonicalPayloadSchema,
  state: z.enum([
    "pos_cancel_pending",
    "pos_cancel_unknown",
    "pos_cancel_failed",
    "oms_cancel_pending",
    "oms_cancel_unknown",
    "oms_cancel_succeeded",
    "oms_cancel_failed",
    "completed",
  ]),
  context: gatewayCancellationContextSchema,
  posCancelIdentity: gatewayProviderMutationIdentitySchema,
  posCancellationEvidence: gatewayPosCancellationEvidenceSchema.optional(),
  posCancellationFailureEvidence:
    gatewayPosCancellationFailureEvidenceSchema.optional(),
  omsCancelIdentity: gatewayProviderMutationIdentitySchema.optional(),
  omsCancellationEvidence:
    gatewayOmsCancellationEvidenceSchema.optional(),
  omsCancellationFailureEvidence:
    gatewayOmsCancellationFailureEvidenceSchema.optional(),
  completionKind: z.enum([
    "cancelled",
    "pos_cancellation_failed",
    "oms_cancellation_failed",
  ]).optional(),
  result: sandboxCancellationResultSchema.optional(),
  responseStatus: mutationHttpStatusSchema.optional(),
}).strict().superRefine((stored, context) => {
  const needsPosSuccess =
    [
      "oms_cancel_pending",
      "oms_cancel_unknown",
      "oms_cancel_succeeded",
      "oms_cancel_failed",
    ].includes(stored.state) ||
    (stored.state === "completed" &&
      stored.completionKind !== "pos_cancellation_failed");
  const needsPosFailure =
    stored.state === "pos_cancel_failed" ||
    (stored.state === "completed" &&
      stored.completionKind === "pos_cancellation_failed");
  const needsOmsIdentity = needsPosSuccess;
  const needsOmsSuccess =
    stored.state === "oms_cancel_succeeded" ||
    (stored.state === "completed" &&
      stored.completionKind === "cancelled");
  const needsOmsFailure =
    stored.state === "oms_cancel_failed" ||
    (stored.state === "completed" &&
      stored.completionKind === "oms_cancellation_failed");
  if (
    needsOmsIdentity !== (stored.omsCancelIdentity !== undefined) ||
    needsPosSuccess !== (stored.posCancellationEvidence !== undefined) ||
    needsPosFailure !==
      (stored.posCancellationFailureEvidence !== undefined) ||
    needsOmsSuccess !== (stored.omsCancellationEvidence !== undefined) ||
    needsOmsFailure !==
      (stored.omsCancellationFailureEvidence !== undefined)
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Cancellation phase does not match provider evidence",
    });
  }
  if (stored.state !== "completed") {
    if (
      stored.completionKind !== undefined ||
      stored.result !== undefined ||
      stored.responseStatus !== undefined
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Incomplete cancellation must not contain a terminal response",
      });
    }
    return;
  }
  if (
    stored.completionKind === undefined ||
    !stored.result ||
    stored.responseStatus === undefined ||
    !["cancelled", "partial_cancellation"].includes(stored.result.outcome) ||
    ![200, 409].includes(stored.responseStatus)
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Completed cancellation requires a coherent replayable response",
    });
    return;
  }
  const completionMatches =
    (stored.completionKind === "cancelled" &&
      stored.responseStatus === 200 &&
      stored.result.outcome === "cancelled") ||
    (stored.completionKind === "pos_cancellation_failed" &&
      stored.responseStatus === 409 &&
      stored.result.outcome === "partial_cancellation" &&
      stored.result.conflictType === "pos_cancellation_failed") ||
    (stored.completionKind === "oms_cancellation_failed" &&
      stored.responseStatus === 409 &&
      stored.result.outcome === "partial_cancellation" &&
      stored.result.conflictType === "oms_cancellation_failed");
  if (!completionMatches) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Cancellation completion kind does not match its response",
    });
  }
});

export interface GatewayMutationSnapshotBindings {
  nextCommerceSequence: number;
  providerRuntimeBinding?: z.infer<
    typeof gatewayProviderRuntimeBindingSchema
  >;
  ordersByIdempotencyKey: Array<
    [string, z.infer<typeof storedCommerceOrderMutationSchema>]
  >;
  orderKeyByCommerceOrderId: Array<[string, string]>;
  authorityByIdempotencyKey: Array<
    [string, z.infer<typeof storedMutationAuthoritySchema>]
  >;
  paymentLinksByIdempotencyKey: Array<
    [string, z.infer<typeof storedPaymentLinkMutationSchema>]
  >;
  cancellationsByIdempotencyKey: Array<
    [string, z.infer<typeof storedCancellationMutationSchema>]
  >;
}

const commerceProofGatewayMutationSnapshotSchema = z.object({
  nextCommerceSequence: z.number().int().nonnegative().safe(),
  providerRuntimeBinding: gatewayProviderRuntimeBindingSchema.optional(),
  ordersByIdempotencyKey: z.array(z.tuple([
    identifierSchema,
    storedCommerceOrderMutationSchema,
  ])),
  orderKeyByCommerceOrderId: z.array(z.tuple([
    pathSafeIdentifierSchema,
    identifierSchema,
  ])),
  authorityByIdempotencyKey: z.array(z.tuple([
    identifierSchema,
    storedMutationAuthoritySchema,
  ])),
  paymentLinksByIdempotencyKey: z.array(z.tuple([
    identifierSchema,
    storedPaymentLinkMutationSchema,
  ])),
  cancellationsByIdempotencyKey: z.array(z.tuple([
    identifierSchema,
    storedCancellationMutationSchema,
  ])),
}).strict().superRefine(validateGatewayMutationSnapshotBindings);

export type StoredCommerceOrderMutation = z.infer<
  typeof storedCommerceOrderMutationSchema
>;
export type StoredPaymentLinkMutation = z.infer<
  typeof storedPaymentLinkMutationSchema
>;
export type StoredCancellationMutation = z.infer<
  typeof storedCancellationMutationSchema
>;
export type StoredGatewayMutationAuthority = z.infer<
  typeof storedMutationAuthoritySchema
>;
export type GatewayProviderRuntimeBinding = z.infer<
  typeof gatewayProviderRuntimeBindingSchema
>;
export type SandboxPaymentLinkSuccess = z.infer<
  typeof sandboxPaymentLinkSuccessSchema
>;
export type CommerceProofGatewayMutationSnapshot = z.infer<
  typeof commerceProofGatewayMutationSnapshotSchema
>;

export interface CommerceProofGatewayMutationState {
  nextCommerceSequence: number;
  providerRuntimeBinding?: GatewayProviderRuntimeBinding;
  readonly ordersByIdempotencyKey: Map<
    string,
    StoredCommerceOrderMutation
  >;
  readonly orderKeyByCommerceOrderId: Map<string, string>;
  readonly authorityByIdempotencyKey: Map<
    string,
    StoredGatewayMutationAuthority
  >;
  readonly paymentLinksByIdempotencyKey: Map<
    string,
    StoredPaymentLinkMutation
  >;
  readonly cancellationsByIdempotencyKey: Map<
    string,
    StoredCancellationMutation
  >;
}

export function createCommerceProofGatewayMutationState():
  CommerceProofGatewayMutationState {
  return {
    nextCommerceSequence: 0,
    providerRuntimeBinding: undefined,
    ordersByIdempotencyKey: new Map(),
    orderKeyByCommerceOrderId: new Map(),
    authorityByIdempotencyKey: new Map(),
    paymentLinksByIdempotencyKey: new Map(),
    cancellationsByIdempotencyKey: new Map(),
  };
}

export function restoreCommerceProofGatewayMutationState(
  snapshot: unknown,
): CommerceProofGatewayMutationState {
  const parsed = commerceProofGatewayMutationSnapshotSchema.parse(snapshot);
  return {
    nextCommerceSequence: parsed.nextCommerceSequence,
    providerRuntimeBinding: parsed.providerRuntimeBinding,
    ordersByIdempotencyKey: new Map(parsed.ordersByIdempotencyKey),
    orderKeyByCommerceOrderId: new Map(parsed.orderKeyByCommerceOrderId),
    authorityByIdempotencyKey: new Map(parsed.authorityByIdempotencyKey),
    paymentLinksByIdempotencyKey: new Map(
      parsed.paymentLinksByIdempotencyKey,
    ),
    cancellationsByIdempotencyKey: new Map(
      parsed.cancellationsByIdempotencyKey,
    ),
  };
}

export function snapshotCommerceProofGatewayMutationState(
  state: CommerceProofGatewayMutationState,
): CommerceProofGatewayMutationSnapshot {
  return commerceProofGatewayMutationSnapshotSchema.parse({
    nextCommerceSequence: state.nextCommerceSequence,
    ...(state.providerRuntimeBinding
      ? { providerRuntimeBinding: state.providerRuntimeBinding }
      : {}),
    ordersByIdempotencyKey: [...state.ordersByIdempotencyKey],
    orderKeyByCommerceOrderId: [...state.orderKeyByCommerceOrderId],
    authorityByIdempotencyKey: [...state.authorityByIdempotencyKey],
    paymentLinksByIdempotencyKey: [...state.paymentLinksByIdempotencyKey],
    cancellationsByIdempotencyKey: [...state.cancellationsByIdempotencyKey],
  });
}

export function canonicalCommerceCommandPayload(
  command: CommerceCommand,
): string {
  return JSON.stringify({
    contractVersion: command.contractVersion,
    scenarioId: command.scenarioId,
    sessionId: command.sessionId,
    clientMessageId: command.clientMessageId,
    idempotencyKey: command.idempotencyKey,
    bindingFingerprint: command.bindingFingerprint,
    toolName: command.toolName,
    order: command.order,
  });
}

export function canonicalPaymentMutationPayload(
  commerceOrderId: string,
  methodId: string,
): string {
  return JSON.stringify({ commerceOrderId, methodId });
}

export function canonicalCancellationMutationPayload(
  commerceOrderId: string,
): string {
  return JSON.stringify({ commerceOrderId });
}

export function sameProviderMutationBinding(
  storedFingerprint: string,
  storedPayload: string,
  bindingFingerprint: string,
  canonicalPayload: string,
): boolean {
  return (
    storedFingerprint === bindingFingerprint &&
    storedPayload === canonicalPayload
  );
}

function orderMutationResponseStatus(
  outcome: CommerceResult["outcome"],
): number | undefined {
  if (outcome === "accepted") return 201;
  if (outcome === "pos_rejected") return 409;
  if (outcome === "ambiguous_pos_submission") return 504;
  if (outcome === "failed") return 502;
  return undefined;
}

export function claimGatewayMutationAuthority(
  state: CommerceProofGatewayMutationState,
  input: StoredGatewayMutationAuthority & { idempotencyKey: string },
): boolean {
  const existing = state.authorityByIdempotencyKey.get(input.idempotencyKey);
  if (existing) {
    return (
      existing.kind === input.kind &&
      sameProviderMutationBinding(
        existing.bindingFingerprint,
        existing.canonicalPayload,
        input.bindingFingerprint,
        input.canonicalPayload,
      )
    );
  }
  state.authorityByIdempotencyKey.set(input.idempotencyKey, {
    kind: input.kind,
    bindingFingerprint: input.bindingFingerprint,
    canonicalPayload: input.canonicalPayload,
  });
  return true;
}

export function completedStoredCommerceOrder(
  stored: StoredCommerceOrderMutation,
  response: CommerceResult,
  responseStatus: number,
): StoredCommerceOrderMutation {
  return storedCommerceOrderMutationSchema.parse({
    ...stored,
    state: "completed",
    response: storedOrderResponseSchema.parse(response),
    responseStatus,
  });
}

export function completedStoredCancellation(
  stored: StoredCancellationMutation,
  result: NonNullable<StoredCancellationMutation["result"]>,
  responseStatus: number,
  completionKind: NonNullable<StoredCancellationMutation["completionKind"]>,
): StoredCancellationMutation {
  return storedCancellationMutationSchema.parse({
    ...stored,
    state: "completed",
    completionKind,
    result,
    responseStatus,
  });
}
