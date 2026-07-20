import { z } from "zod";
import { opaqueProviderIdSchema } from "../domain/opaqueProviderId.js";
import type { CommerceCommand } from "./contracts.js";
import {
  deriveGatewayProviderMutationIdentity,
  gatewayOmsCancellationAction,
  gatewayOmsCompensationAction,
  gatewayOmsCreateInput,
  gatewayPosCancellationAction,
  gatewayPosSubmitInput,
  type GatewayCancellationContext,
  type GatewayProviderMutationIdentity,
} from "./gatewayMutationIdentity.js";
import type {
  GatewayMutationSnapshotBindings,
  StoredCommerceOrderMutation,
  StoredGatewayMutationAuthority,
} from "./gatewayMutationContracts.js";

const pathSafeIdentifierSchema = opaqueProviderIdSchema.refine(
  (value) => value !== "." && value !== "..",
  { message: "Identifier must not be a URL dot segment" },
);
const canonicalPaymentPayloadSchema = z.object({
  commerceOrderId: pathSafeIdentifierSchema,
  methodId: opaqueProviderIdSchema,
}).strict();
const canonicalCancellationPayloadSchema = z.object({
  commerceOrderId: pathSafeIdentifierSchema,
}).strict();

export function validateStoredOrderPhase(
  stored: StoredCommerceOrderMutation,
  context: z.RefinementCtx,
): void {
  const rootIdentity = {
    idempotencyKey: stored.command.idempotencyKey,
    bindingFingerprint: stored.command.bindingFingerprint,
  };
  const omsCreateInput = gatewayOmsCreateInput(
    stored.command,
    stored.commerceOrderId,
  );
  const expectedOmsIdentity = deriveGatewayProviderMutationIdentity(
    rootIdentity,
    "oms_create",
    omsCreateInput,
  );
  const completedOutcome = stored.state === "completed"
    ? stored.response?.outcome
    : undefined;
  const needsOmsSuccess =
    [
      "pos_submit_pending",
      "pos_submit_unknown",
      "pos_submit_accepted",
      "oms_compensation_pending",
      "oms_compensation_unknown",
      "oms_compensation_succeeded",
      "oms_compensation_failed",
    ].includes(stored.state) ||
    completedOutcome === "accepted" ||
    completedOutcome === "pos_rejected";
  const needsOmsFailure =
    stored.state === "oms_create_failed" ||
    completedOutcome === "failed";
  const needsPosIdentity = needsOmsSuccess;
  const needsPosSuccess =
    stored.state === "pos_submit_accepted" ||
    completedOutcome === "accepted";
  const needsPosRejection =
    [
      "oms_compensation_pending",
      "oms_compensation_unknown",
      "oms_compensation_succeeded",
      "oms_compensation_failed",
    ].includes(stored.state) ||
    completedOutcome === "pos_rejected";
  const compensationSucceeded =
    stored.state === "oms_compensation_succeeded" ||
    (completedOutcome === "pos_rejected" &&
      stored.response?.omsStatus === "cancelled");
  const compensationFailed =
    stored.state === "oms_compensation_failed" ||
    (completedOutcome === "pos_rejected" &&
      stored.response?.omsStatus === "cancellation_failed");
  const expectedPosIdentity = stored.omsOrderId
    ? deriveGatewayProviderMutationIdentity(
        rootIdentity,
        "pos_submit",
        gatewayPosSubmitInput(
          stored.command,
          stored.commerceOrderId,
          stored.omsOrderId,
        ),
      )
    : undefined;
  const expectedCompensationIdentity = stored.omsOrderId
    ? deriveGatewayProviderMutationIdentity(
        rootIdentity,
        "oms_compensate",
        gatewayOmsCompensationAction(stored.omsOrderId, {
          traceId: stored.command.traceId,
          scenarioId: stored.command.scenarioId,
          commerceOrderId: stored.commerceOrderId,
        }),
      )
    : undefined;
  const expectedOmsEvidence = stored.omsOrderId
    ? {
        contractVersion: omsCreateInput.contractVersion,
        traceId: stored.command.traceId,
        scenarioId: stored.command.scenarioId,
        commerceOrderId: stored.commerceOrderId,
        omsOrderId: stored.omsOrderId,
        omsStatus: "created",
        commerceEnvironment: "sandbox",
        providerImplementation: "http-adapter",
      }
    : undefined;
  const expectedPosRejection = stored.omsOrderId
    ? {
        traceId: stored.command.traceId,
        scenarioId: stored.command.scenarioId,
        commerceOrderId: stored.commerceOrderId,
        omsOrderId: stored.omsOrderId,
        errorCode: "pos_order_rejected",
        posStatus: "rejected",
        statusCode: 409,
      }
    : undefined;

  if (
    !providerIdentityEquals(stored.omsCreateIdentity, expectedOmsIdentity) ||
    !providerCheckpointMatches(
      needsOmsSuccess,
      stored.omsOrderId,
      stored.omsStatus,
    ) ||
    !exactOptionalEvidence(
      needsOmsSuccess,
      stored.omsCreateEvidence,
      expectedOmsEvidence,
    ) ||
    needsOmsFailure !==
      (stored.omsCreateFailureEvidence !== undefined) ||
    (stored.omsCreateFailureEvidence !== undefined &&
      (stored.omsCreateFailureEvidence.operation !== "oms_create" ||
        !evidenceContextMatches(
          stored.omsCreateFailureEvidence,
          stored.command,
          stored.commerceOrderId,
        ))) ||
    !requiredIdentityMatches(
      needsPosIdentity,
      stored.posSubmitIdentity,
      expectedPosIdentity,
    ) ||
    needsPosSuccess !== (stored.posSubmitEvidence !== undefined) ||
    (stored.posSubmitEvidence !== undefined &&
      (!evidenceContextMatches(
        stored.posSubmitEvidence,
        stored.command,
        stored.commerceOrderId,
      ) ||
        stored.posSubmitEvidence.omsOrderId !== stored.omsOrderId ||
        (completedOutcome === "accepted" &&
          stored.posSubmitEvidence.posTicketId !==
            stored.response?.posTicketId))) ||
    !requiredIdentityMatches(
      needsPosRejection,
      stored.compensationIdentity,
      expectedCompensationIdentity,
    ) ||
    !exactOptionalEvidence(
      needsPosRejection,
      stored.posRejectionEvidence,
      expectedPosRejection,
    ) ||
    compensationSucceeded !==
      (stored.omsCompensationEvidence !== undefined) ||
    (stored.omsCompensationEvidence !== undefined &&
      (!evidenceContextMatches(
        stored.omsCompensationEvidence,
        stored.command,
        stored.commerceOrderId,
      ) ||
        stored.omsCompensationEvidence.omsOrderId !== stored.omsOrderId)) ||
    compensationFailed !==
      (stored.omsCompensationFailureEvidence !== undefined) ||
    (stored.omsCompensationFailureEvidence !== undefined &&
      (stored.omsCompensationFailureEvidence.operation !==
        "oms_compensate" ||
        !evidenceContextMatches(
          stored.omsCompensationFailureEvidence,
          stored.command,
          stored.commerceOrderId,
        ) ||
        stored.omsCompensationFailureEvidence.omsOrderId !==
          stored.omsOrderId)) ||
    (stored.response !== undefined &&
      ((stored.response.outcome !== "failed" &&
        stored.response.omsOrderId !== stored.omsOrderId) ||
        (stored.response.outcome === "accepted" &&
          (stored.response.posStatus !== "accepted" ||
            stored.response.posTicketId !==
              stored.posSubmitEvidence?.posTicketId)) ||
        (stored.response.outcome === "pos_rejected" &&
          (stored.response.posStatus !== "rejected" ||
            (compensationSucceeded &&
              stored.response.omsStatus !== "cancelled") ||
            (compensationFailed &&
              stored.response.omsStatus !== "cancellation_failed")))))
  ) {
    snapshotIssue(context, "Stored order mutation phase is inconsistent");
  }
}

export function validateGatewayMutationSnapshotBindings(
  snapshot: GatewayMutationSnapshotBindings,
  context: z.RefinementCtx,
): void {
  const hasDurableMutationState =
    snapshot.nextCommerceSequence > 0 ||
    snapshot.ordersByIdempotencyKey.length > 0 ||
    snapshot.orderKeyByCommerceOrderId.length > 0 ||
    snapshot.authorityByIdempotencyKey.length > 0 ||
    snapshot.paymentLinksByIdempotencyKey.length > 0 ||
    snapshot.cancellationsByIdempotencyKey.length > 0;
  if (hasDurableMutationState && !snapshot.providerRuntimeBinding) {
    snapshotIssue(
      context,
      "Durable mutations require an exact provider runtime binding",
    );
  }
  const collections = [
    ["ordersByIdempotencyKey", snapshot.ordersByIdempotencyKey],
    ["orderKeyByCommerceOrderId", snapshot.orderKeyByCommerceOrderId],
    ["authorityByIdempotencyKey", snapshot.authorityByIdempotencyKey],
    ["paymentLinksByIdempotencyKey", snapshot.paymentLinksByIdempotencyKey],
    ["cancellationsByIdempotencyKey", snapshot.cancellationsByIdempotencyKey],
  ] as const;
  for (const [name, entries] of collections) {
    if (new Set(entries.map(([key]) => key)).size !== entries.length) {
      snapshotIssue(context, `${name} contains duplicate keys`);
    }
  }

  const orders = new Map(snapshot.ordersByIdempotencyKey);
  const orderKeys = new Map(snapshot.orderKeyByCommerceOrderId);
  const authorities = new Map(snapshot.authorityByIdempotencyKey);
  const payments = new Map(snapshot.paymentLinksByIdempotencyKey);
  const cancellations = new Map(snapshot.cancellationsByIdempotencyKey);
  let maximumSequence = 0;
  const seenCommerceOrderIds = new Set<string>();
  const seenCommerceSequences = new Set<number>();
  const seenCancellationOrderIds = new Set<string>();

  for (const [key, stored] of snapshot.ordersByIdempotencyKey) {
    const sequenceMatch = /^COM-(\d+)$/u.exec(stored.commerceOrderId);
    const sequenceText = sequenceMatch?.[1];
    const sequence = sequenceText
      ? Number.parseInt(sequenceText, 10)
      : Number.NaN;
    const expectedCommerceOrderId = Number.isSafeInteger(sequence)
      ? `COM-${String(sequence).padStart(4, "0")}`
      : undefined;
    if (
      !Number.isSafeInteger(sequence) ||
      sequence < 1 ||
      stored.commerceOrderId !== expectedCommerceOrderId ||
      seenCommerceSequences.has(sequence)
    ) {
      snapshotIssue(context, "Stored commerce order ID is not sequence-bound");
    } else {
      maximumSequence = Math.max(maximumSequence, sequence);
      seenCommerceSequences.add(sequence);
    }
    if (
      key !== stored.command.idempotencyKey ||
      orderKeys.get(stored.commerceOrderId) !== key ||
      seenCommerceOrderIds.has(stored.commerceOrderId) ||
      !authorityMatches(
        authorities.get(key),
        "placeOrder",
        stored.command.bindingFingerprint,
        stored.canonicalPayload,
      )
    ) {
      snapshotIssue(context, "Stored order mutation bindings are inconsistent");
    }
    seenCommerceOrderIds.add(stored.commerceOrderId);
  }
  if (
    snapshot.nextCommerceSequence !== maximumSequence ||
    seenCommerceSequences.size !== snapshot.nextCommerceSequence
  ) {
    snapshotIssue(context, "Commerce order sequence is not monotonic");
  }
  for (const [commerceOrderId, key] of snapshot.orderKeyByCommerceOrderId) {
    if (orders.get(key)?.commerceOrderId !== commerceOrderId) {
      snapshotIssue(context, "Commerce order reverse index is inconsistent");
    }
  }

  for (const [key, stored] of snapshot.paymentLinksByIdempotencyKey) {
    const payload = parseCanonicalPayload(
      stored.canonicalPayload,
      canonicalPaymentPayloadSchema,
    );
    if (
      !payload ||
      stored.canonicalPayload !== JSON.stringify(payload) ||
      !orderIsReplayable(orders, orderKeys, payload.commerceOrderId) ||
      !authorityMatches(
        authorities.get(key),
        "createPaymentLink",
        stored.bindingFingerprint,
        stored.canonicalPayload,
      ) ||
      stored.result.value.url !==
        `https://pay.sandbox.invalid/method-${encodeURIComponent(payload.methodId)}/` +
          `order-${encodeURIComponent(payload.commerceOrderId)}`
    ) {
      snapshotIssue(context, "Stored payment-link bindings are inconsistent");
    }
  }

  for (const [key, stored] of snapshot.cancellationsByIdempotencyKey) {
    const payload = parseCanonicalPayload(
      stored.canonicalPayload,
      canonicalCancellationPayloadSchema,
    );
    const referencedOrder = payload
      ? replayableOrder(orders, orderKeys, payload.commerceOrderId)
      : undefined;
    const accepted = referencedOrder?.response?.outcome === "accepted"
      ? referencedOrder.response
      : undefined;
    const rootIdentity = {
      idempotencyKey: key,
      bindingFingerprint: stored.bindingFingerprint,
    };
    const expectedPosIdentity = deriveGatewayProviderMutationIdentity(
      rootIdentity,
      "pos_cancel",
      gatewayPosCancellationAction(stored.context),
    );
    const expectedOmsIdentity = deriveGatewayProviderMutationIdentity(
      rootIdentity,
      "oms_cancel",
      gatewayOmsCancellationAction(stored.context),
    );
    const needsPosSuccess =
      [
        "oms_cancel_pending",
        "oms_cancel_unknown",
        "oms_cancel_succeeded",
        "oms_cancel_failed",
      ].includes(stored.state) ||
      (stored.state === "completed" &&
        stored.completionKind !== "pos_cancellation_failed");
    const contextIsBound =
      payload?.commerceOrderId === stored.context.commerceOrderId &&
      accepted?.commerceOrderId === stored.context.commerceOrderId &&
      accepted?.omsOrderId === stored.context.omsOrderId &&
      accepted?.posTicketId === stored.context.posTicketId &&
      accepted?.scenarioId === stored.context.scenarioId &&
      providerIdentityEquals(stored.posCancelIdentity, expectedPosIdentity) &&
      requiredIdentityMatches(
        needsPosSuccess,
        stored.omsCancelIdentity,
        expectedOmsIdentity,
      ) &&
      exactOptionalEvidence(
        needsPosSuccess,
        stored.posCancellationEvidence,
        {
          contractVersion: accepted?.contractVersion,
          traceId: stored.context.traceId,
          scenarioId: stored.context.scenarioId,
          commerceOrderId: stored.context.commerceOrderId,
          omsOrderId: stored.context.omsOrderId,
          posTicketId: stored.context.posTicketId,
          posStatus: "cancelled",
          commerceEnvironment: "sandbox",
          providerImplementation: "http-adapter",
        },
      ) &&
      (stored.posCancellationFailureEvidence === undefined ||
        (stored.posCancellationFailureEvidence.operation === "pos_cancel" &&
          cancellationEvidenceContextMatches(
            stored.posCancellationFailureEvidence,
            stored.context,
          ))) &&
      (stored.omsCancellationEvidence === undefined ||
        structurallyEqual(stored.omsCancellationEvidence, {
          contractVersion: accepted?.contractVersion,
          traceId: stored.context.traceId,
          scenarioId: stored.context.scenarioId,
          commerceOrderId: stored.context.commerceOrderId,
          omsOrderId: stored.context.omsOrderId,
          omsStatus: "cancelled",
          commerceEnvironment: "sandbox",
          providerImplementation: "http-adapter",
        })) &&
      (stored.omsCancellationFailureEvidence === undefined ||
        (stored.omsCancellationFailureEvidence.operation === "oms_cancel" &&
          cancellationEvidenceContextMatches(
            stored.omsCancellationFailureEvidence,
            stored.context,
          )));
    const completedResultIsBound =
      stored.state !== "completed" ||
      (payload !== undefined &&
        stored.result?.commerceOrderId === payload.commerceOrderId &&
        stored.result.traceId === stored.context.traceId &&
        stored.result.scenarioId === stored.context.scenarioId &&
        stored.result.omsOrderId === stored.context.omsOrderId &&
        stored.result.posTicketId === stored.context.posTicketId &&
        stored.result.deduplicated === false &&
        structurallyEqual(
          stored.result.providerProvenance,
          accepted?.providerProvenance,
        ) &&
        ((stored.responseStatus === 200 &&
          stored.result.outcome === "cancelled" &&
          stored.result.customerStatus === "cancelled" &&
          stored.result.value.id === payload.commerceOrderId &&
          stored.result.value.commerceOrderId === payload.commerceOrderId &&
          stored.result.value.omsOrderId === stored.context.omsOrderId &&
          stored.result.value.posTicketId === stored.context.posTicketId &&
          stored.result.value.posStatus === "cancelled" &&
          stored.result.value.commerceOutcome === "cancelled" &&
          stored.result.value.commerceCustomerStatus === "cancelled" &&
          structurallyEqual(
            stored.result.value.commerceProviderProvenance,
            accepted?.providerProvenance,
          )) ||
          (stored.responseStatus === 409 &&
            stored.result.outcome === "partial_cancellation" &&
            stored.result.customerStatus === "failed")));
    if (
      !payload ||
      !contextIsBound ||
      seenCancellationOrderIds.has(stored.context.commerceOrderId) ||
      stored.canonicalPayload !== JSON.stringify(payload) ||
      !orderIsReplayable(orders, orderKeys, payload.commerceOrderId) ||
      !completedResultIsBound ||
      !authorityMatches(
        authorities.get(key),
        "cancelOrder",
        stored.bindingFingerprint,
        stored.canonicalPayload,
      )
    ) {
      snapshotIssue(context, "Stored cancellation bindings are inconsistent");
    }
    seenCancellationOrderIds.add(stored.context.commerceOrderId);
  }

  for (const [key, authority] of snapshot.authorityByIdempotencyKey) {
    const hasMutation =
      authority.kind === "placeOrder"
        ? orders.has(key)
        : authority.kind === "createPaymentLink"
          ? payments.has(key)
          : cancellations.has(key);
    if (!hasMutation) {
      snapshotIssue(context, "Mutation authority has no exact stored operation");
    }
  }
}

function authorityMatches(
  authority: StoredGatewayMutationAuthority | undefined,
  kind: StoredGatewayMutationAuthority["kind"],
  bindingFingerprint: string,
  canonicalPayload: string,
): boolean {
  return (
    authority?.kind === kind &&
    authority.bindingFingerprint === bindingFingerprint &&
    authority.canonicalPayload === canonicalPayload
  );
}

function providerCheckpointMatches(
  required: boolean,
  omsOrderId: string | undefined,
  omsStatus: "created" | undefined,
): boolean {
  return required
    ? omsOrderId !== undefined && omsStatus === "created"
    : omsOrderId === undefined && omsStatus === undefined;
}

function requiredIdentityMatches(
  required: boolean,
  actual: GatewayProviderMutationIdentity | undefined,
  expected: GatewayProviderMutationIdentity | undefined,
): boolean {
  return required
    ? providerIdentityEquals(actual, expected)
    : actual === undefined;
}

function exactOptionalEvidence(
  required: boolean,
  actual: unknown,
  expected: unknown,
): boolean {
  return required
    ? expected !== undefined && structurallyEqual(actual, expected)
    : actual === undefined;
}

function evidenceContextMatches(
  evidence: {
    traceId: string;
    scenarioId: string;
    commerceOrderId: string;
  },
  command: CommerceCommand,
  commerceOrderId: string,
): boolean {
  return (
    evidence.traceId === command.traceId &&
    evidence.scenarioId === command.scenarioId &&
    evidence.commerceOrderId === commerceOrderId
  );
}

function cancellationEvidenceContextMatches(
  evidence: {
    traceId: string;
    scenarioId: string;
    commerceOrderId: string;
    omsOrderId: string;
    posTicketId?: string;
  },
  expected: GatewayCancellationContext,
): boolean {
  return (
    evidence.traceId === expected.traceId &&
    evidence.scenarioId === expected.scenarioId &&
    evidence.commerceOrderId === expected.commerceOrderId &&
    evidence.omsOrderId === expected.omsOrderId &&
    (evidence.posTicketId === undefined ||
      evidence.posTicketId === expected.posTicketId)
  );
}

export function structurallyEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => structurallyEqual(value, right[index]))
    );
  }
  if (!isPlainRecord(left) || !isPlainRecord(right)) return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key, index) =>
        key === rightKeys[index] &&
        structurallyEqual(left[key], right[key]),
    )
  );
}

function isPlainRecord(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function providerIdentityEquals(
  left: GatewayProviderMutationIdentity | undefined,
  right: GatewayProviderMutationIdentity | undefined,
): boolean {
  return (
    left !== undefined &&
    right !== undefined &&
    left.idempotencyKey === right.idempotencyKey &&
    left.bindingFingerprint === right.bindingFingerprint
  );
}

function replayableOrder(
  orders: Map<string, StoredCommerceOrderMutation>,
  orderKeys: Map<string, string>,
  commerceOrderId: string,
): StoredCommerceOrderMutation | undefined {
  const key = orderKeys.get(commerceOrderId);
  const stored = key ? orders.get(key) : undefined;
  return stored?.state === "completed" &&
    stored.response?.outcome === "accepted" &&
    stored.response.customerStatus === "accepted"
    ? stored
    : undefined;
}

function orderIsReplayable(
  orders: Map<string, StoredCommerceOrderMutation>,
  orderKeys: Map<string, string>,
  commerceOrderId: string,
): boolean {
  return replayableOrder(orders, orderKeys, commerceOrderId) !== undefined;
}

function parseCanonicalPayload<Payload>(
  payload: string,
  schema: z.ZodType<Payload>,
): Payload | undefined {
  try {
    const parsed: unknown = JSON.parse(payload);
    const validated = schema.safeParse(parsed);
    return validated.success ? validated.data : undefined;
  } catch {
    return undefined;
  }
}

function snapshotIssue(context: z.RefinementCtx, message: string): void {
  context.addIssue({ code: z.ZodIssueCode.custom, message });
}
