import type { Order } from "../domain/types.js";
import {
  commerceContractVersion,
  commerceResultSchema,
  sandboxCommerceProofProviderProvenance,
  type CommerceResult,
} from "./contracts.js";
import {
  completedStoredCancellation,
  completedStoredCommerceOrder,
  sandboxCancellationResultSchema,
  type StoredCancellationMutation,
  type StoredCommerceOrderMutation,
} from "./gatewayMutationContracts.js";
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
import type { GatewayMutationDurability } from "./gatewayMutationDurability.js";
import {
  deriveGatewayProviderMutationIdentity,
  gatewayOmsCancellationAction,
  gatewayOmsCompensationAction,
  gatewayOmsCreateInput,
  gatewayPosSubmitInput,
} from "./gatewayMutationIdentity.js";
import type {
  createCommerceProofOmsClient,
  createCommerceProofPosClient,
} from "./httpClients.js";

type OmsClient = ReturnType<typeof createCommerceProofOmsClient>;
type PosClient = ReturnType<typeof createCommerceProofPosClient>;

export interface GatewayMutationHttpResult {
  statusCode: number;
  body: unknown;
  commerceResult?: CommerceResult;
  projectedOrder?: Order;
}

const sandboxGatewayProvenance = [{
  fixtureMode: "provider_runtime" as const,
  sourceFile: "src/commerceProof/gatewayServer.ts" as const,
  sourceApi: "sandbox-commerce-gateway" as const,
}];

function required<Value>(
  value: Value | null | undefined,
  errorCode: string,
): Value {
  if (value === null || value === undefined) throw new Error(errorCode);
  return value;
}

export async function executeStoredOrderMutation(input: {
  stored: StoredCommerceOrderMutation;
  oms: OmsClient;
  pos: PosClient;
  durability: GatewayMutationDurability;
}): Promise<GatewayMutationHttpResult> {
  const { stored, oms, pos, durability } = input;
  const original = stored.command;
  const rootIdentity = {
    idempotencyKey: original.idempotencyKey,
    bindingFingerprint: original.bindingFingerprint,
  };

  if (
    stored.state === "oms_create_pending" ||
    stored.state === "oms_create_unknown"
  ) {
    const downstreamOrder =
      gatewayOmsCreateInput(original, stored.commerceOrderId);
    const omsResult = await oms.createOrder(
      downstreamOrder,
      stored.omsCreateIdentity,
    );
    if (!omsResult.ok) {
      if (outcomeIsUnknown(omsResult)) {
        await commitOrderTransition(stored, {
          ...stored,
          state: "oms_create_unknown",
        }, durability);
        return unknownOutcome(stored.commerceOrderId);
      }
      await commitOrderTransition(stored, {
        ...stored,
        state: "oms_create_failed",
        omsCreateFailureEvidence:
          gatewayOmsCreateFailureEvidenceSchema.parse({
            operation: "oms_create",
            traceId: original.traceId,
            scenarioId: original.scenarioId,
            commerceOrderId: stored.commerceOrderId,
            statusCode: omsResult.status,
            errorCode: omsResult.errorCode,
          }),
      }, durability);
      return completeOrder(
        stored,
        result({
          command: original,
          commerceOrderId: stored.commerceOrderId,
          outcome: "failed",
          customerStatus: "failed",
        }),
        502,
        durability,
      );
    }
    const omsCreateEvidence =
      gatewayOmsCreateEvidenceSchema.parse(omsResult.value);
    const posSubmitIdentity = deriveGatewayProviderMutationIdentity(
      rootIdentity,
      "pos_submit",
      gatewayPosSubmitInput(
        original,
        stored.commerceOrderId,
        omsCreateEvidence.omsOrderId,
      ),
    );
    await commitOrderTransition(stored, {
      ...stored,
      state: "pos_submit_pending",
      omsCreateEvidence,
      omsOrderId: omsCreateEvidence.omsOrderId,
      omsStatus: "created",
      posSubmitIdentity,
    }, durability);
  }

  if (stored.state === "oms_create_failed") {
    return completeOrder(
      stored,
      result({
        command: original,
        commerceOrderId: stored.commerceOrderId,
        outcome: "failed",
        customerStatus: "failed",
      }),
      502,
      durability,
    );
  }

  if (
    stored.state === "pos_submit_pending" ||
    stored.state === "pos_submit_unknown"
  ) {
    const omsOrderId = required(
      stored.omsOrderId,
      "gateway_oms_order_id_missing",
    );
    const posSubmitIdentity = required(
      stored.posSubmitIdentity,
      "gateway_pos_submit_identity_missing",
    );
    const posResult = await pos.submitTicket(
      gatewayPosSubmitInput(
        original,
        stored.commerceOrderId,
        omsOrderId,
      ),
      posSubmitIdentity,
    );
    if (!posResult.ok) {
      if (
        outcomeIsUnknown(posResult) ||
        posResult.status !== 409 ||
        posResult.posStatus !== "rejected"
      ) {
        await commitOrderTransition(stored, {
          ...stored,
          state: "pos_submit_unknown",
        }, durability);
        return unknownOutcome(stored.commerceOrderId);
      }
      const posRejectionEvidence =
        gatewayPosRejectionEvidenceSchema.parse({
          traceId: original.traceId,
          scenarioId: original.scenarioId,
          commerceOrderId: stored.commerceOrderId,
          omsOrderId,
          errorCode: posResult.errorCode,
          posStatus: posResult.posStatus,
          statusCode: posResult.status,
        });
      const compensationIdentity = deriveGatewayProviderMutationIdentity(
        rootIdentity,
        "oms_compensate",
        gatewayOmsCompensationAction(omsOrderId, {
          traceId: original.traceId,
          scenarioId: original.scenarioId,
          commerceOrderId: stored.commerceOrderId,
        }),
      );
      await commitOrderTransition(stored, {
        ...stored,
        state: "oms_compensation_pending",
        posRejectionEvidence,
        compensationIdentity,
      }, durability);
    } else {
      const posSubmitEvidence =
        gatewayPosSubmitEvidenceSchema.parse(posResult.value);
      await commitOrderTransition(stored, {
        ...stored,
        state: "pos_submit_accepted",
        posSubmitEvidence,
      }, durability);
    }
  }

  if (stored.state === "pos_submit_accepted") {
    const posSubmitEvidence = required(
      stored.posSubmitEvidence,
      "gateway_pos_submit_evidence_missing",
    );
    return completeOrder(
      stored,
      result({
        command: original,
        commerceOrderId: stored.commerceOrderId,
        omsOrderId: stored.omsOrderId,
        posTicketId: posSubmitEvidence.posTicketId,
        omsStatus: stored.omsStatus,
        posStatus: posSubmitEvidence.posStatus,
        outcome: "accepted",
        customerStatus: "accepted",
      }),
      201,
      durability,
    );
  }

  if (
    stored.state === "oms_compensation_pending" ||
    stored.state === "oms_compensation_unknown"
  ) {
  const omsOrderId = required(
    stored.omsOrderId,
    "gateway_compensation_oms_order_id_missing",
  );
  const compensationIdentity = required(
    stored.compensationIdentity,
    "gateway_compensation_identity_missing",
  );
  const compensation = await oms.cancelOrder(
    omsOrderId,
    {
      traceId: original.traceId,
      scenarioId: original.scenarioId,
      commerceOrderId: stored.commerceOrderId,
    },
    compensationIdentity,
  );
  if (!compensation.ok && outcomeIsUnknown(compensation)) {
    await commitOrderTransition(stored, {
      ...stored,
      state: "oms_compensation_unknown",
    }, durability);
    return unknownOutcome(stored.commerceOrderId);
  }
    if (compensation.ok) {
      await commitOrderTransition(stored, {
        ...stored,
        state: "oms_compensation_succeeded",
        omsCompensationEvidence:
          gatewayOmsCancellationEvidenceSchema.parse(compensation.value),
      }, durability);
    } else {
      await commitOrderTransition(stored, {
        ...stored,
        state: "oms_compensation_failed",
        omsCompensationFailureEvidence:
          gatewayOmsCancellationFailureEvidenceSchema.parse({
            operation: "oms_compensate",
            traceId: original.traceId,
            scenarioId: original.scenarioId,
            commerceOrderId: stored.commerceOrderId,
            omsOrderId,
            statusCode: compensation.status,
            errorCode: compensation.errorCode,
            omsStatus: compensation.omsStatus ?? "cancellation_failed",
          }),
      }, durability);
    }
  }

  if (
    stored.state !== "oms_compensation_succeeded" &&
    stored.state !== "oms_compensation_failed"
  ) {
    throw new Error("gateway_order_mutation_phase_invalid");
  }
  const compensationSucceeded =
    stored.state === "oms_compensation_succeeded";
  return completeOrder(
    stored,
    result({
      command: original,
      commerceOrderId: stored.commerceOrderId,
      omsOrderId: stored.omsOrderId,
      omsStatus: compensationSucceeded
        ? stored.omsCompensationEvidence?.omsStatus
        : stored.omsCompensationFailureEvidence?.omsStatus,
      posStatus: "rejected",
      outcome: "pos_rejected",
      customerStatus: "failed",
      compensationStatus: compensationSucceeded ? "succeeded" : "failed",
    }),
    409,
    durability,
  );
}

export async function executeStoredCancellationMutation(input: {
  idempotencyKey: string;
  stored: StoredCancellationMutation;
  accepted: CommerceResult;
  order: Order | undefined;
  oms: OmsClient;
  pos: PosClient;
  durability: GatewayMutationDurability;
}): Promise<GatewayMutationHttpResult> {
  const { stored, accepted, order, oms, pos, durability } = input;
  if (
    stored.state === "pos_cancel_pending" ||
    stored.state === "pos_cancel_unknown"
  ) {
    const posCancellation = await pos.cancelTicket(
      stored.context.posTicketId,
      {
        traceId: stored.context.traceId,
        scenarioId: stored.context.scenarioId,
        commerceOrderId: stored.context.commerceOrderId,
        omsOrderId: stored.context.omsOrderId,
      },
      stored.posCancelIdentity,
    );
    if (!posCancellation.ok) {
      if (outcomeIsUnknown(posCancellation)) {
        await commitCancellationTransition(
          input.idempotencyKey,
          stored,
          {
            ...stored,
            state: "pos_cancel_unknown",
          },
          durability,
        );
        return unknownOutcome(stored.context.commerceOrderId);
      }
      await commitCancellationTransition(
        input.idempotencyKey,
        stored,
        {
          ...stored,
          state: "pos_cancel_failed",
          posCancellationFailureEvidence:
            gatewayPosCancellationFailureEvidenceSchema.parse({
              operation: "pos_cancel",
              traceId: stored.context.traceId,
              scenarioId: stored.context.scenarioId,
              commerceOrderId: stored.context.commerceOrderId,
              omsOrderId: stored.context.omsOrderId,
              posTicketId: stored.context.posTicketId,
              statusCode: posCancellation.status,
              errorCode: posCancellation.errorCode,
              posStatus:
                posCancellation.posStatus ?? "cancellation_failed",
            }),
        },
        durability,
      );
    } else {
      const posCancellationEvidence =
        gatewayPosCancellationEvidenceSchema.parse(posCancellation.value);
      const rootIdentity = {
        idempotencyKey: input.idempotencyKey,
        bindingFingerprint: stored.bindingFingerprint,
      };
      const omsCancelIdentity = deriveGatewayProviderMutationIdentity(
        rootIdentity,
        "oms_cancel",
        gatewayOmsCancellationAction(stored.context),
      );
      await commitCancellationTransition(
        input.idempotencyKey,
        stored,
        {
          ...stored,
          state: "oms_cancel_pending",
          posCancellationEvidence,
          omsCancelIdentity,
        },
        durability,
      );
    }
  }

  if (stored.state === "pos_cancel_failed") {
    return completeCancellation(
      input.idempotencyKey,
      stored,
      partialCancellation(
        accepted,
        stored,
        stored.posCancellationFailureEvidence?.posStatus ??
          "cancellation_failed",
        "pos_cancellation_failed",
      ),
      409,
      "pos_cancellation_failed",
      durability,
    );
  }

  if (
    stored.state === "oms_cancel_pending" ||
    stored.state === "oms_cancel_unknown"
  ) {
  const omsCancelIdentity = required(
    stored.omsCancelIdentity,
    "gateway_oms_cancel_identity_missing",
  );
  const omsCancellation = await oms.cancelOrder(
    stored.context.omsOrderId,
    {
      traceId: stored.context.traceId,
      scenarioId: stored.context.scenarioId,
      commerceOrderId: stored.context.commerceOrderId,
    },
    omsCancelIdentity,
  );
  if (!omsCancellation.ok && outcomeIsUnknown(omsCancellation)) {
    await commitCancellationTransition(
      input.idempotencyKey,
      stored,
      {
        ...stored,
        state: "oms_cancel_unknown",
      },
      durability,
    );
    return unknownOutcome(stored.context.commerceOrderId);
  }
    if (omsCancellation.ok) {
      await commitCancellationTransition(
        input.idempotencyKey,
        stored,
        {
          ...stored,
          state: "oms_cancel_succeeded",
          omsCancellationEvidence:
            gatewayOmsCancellationEvidenceSchema.parse(
              omsCancellation.value,
            ),
        },
        durability,
      );
    } else {
      await commitCancellationTransition(
        input.idempotencyKey,
        stored,
        {
          ...stored,
          state: "oms_cancel_failed",
          omsCancellationFailureEvidence:
            gatewayOmsCancellationFailureEvidenceSchema.parse({
              operation: "oms_cancel",
              traceId: stored.context.traceId,
              scenarioId: stored.context.scenarioId,
              commerceOrderId: stored.context.commerceOrderId,
              omsOrderId: stored.context.omsOrderId,
              statusCode: omsCancellation.status,
              errorCode: omsCancellation.errorCode,
              omsStatus: omsCancellation.omsStatus ??
                "cancellation_failed",
            }),
        },
        durability,
      );
    }
  }

  if (stored.state === "oms_cancel_failed") {
    return completeCancellation(
      input.idempotencyKey,
      stored,
      partialCancellation(
        accepted,
        stored,
        "cancelled",
        "oms_cancellation_failed",
        stored.omsCancellationFailureEvidence?.omsStatus ??
          "cancellation_failed",
      ),
      409,
      "oms_cancellation_failed",
      durability,
    );
  }
  if (stored.state !== "oms_cancel_succeeded") {
    throw new Error("gateway_cancellation_mutation_phase_invalid");
  }
  const cancelled = commerceResultSchema.parse({
    ...accepted,
    traceId: stored.context.traceId,
    scenarioId: stored.context.scenarioId,
    outcome: "cancelled",
    omsStatus: stored.omsCancellationEvidence?.omsStatus,
    posStatus: "cancelled",
    customerStatus: "cancelled",
  });
  const projectedOrder = order && {
    ...order,
    status: "cancelled" as const,
    posStatus: "cancelled" as const,
    commerceOutcome: "cancelled",
    commerceCustomerStatus: "cancelled",
  };
  const response = sandboxCancellationResultSchema.parse({
    ...cancelled,
    ok: true,
    value: projectedOrder,
    message: "order_cancelled",
    provenance: sandboxGatewayProvenance,
  });
  return completeCancellation(
    input.idempotencyKey,
    stored,
    response,
    200,
    "cancelled",
    durability,
    projectedOrder,
  );
}

async function commitOrderTransition(
  stored: StoredCommerceOrderMutation,
  candidate: StoredCommerceOrderMutation,
  durability: GatewayMutationDurability,
): Promise<void> {
  await durability.commitCandidate({
    collection: "ordersByIdempotencyKey",
    key: stored.command.idempotencyKey,
    candidate,
    publish: () => Object.assign(stored, candidate),
  });
}

async function commitCancellationTransition(
  idempotencyKey: string,
  stored: StoredCancellationMutation,
  candidate: StoredCancellationMutation,
  durability: GatewayMutationDurability,
): Promise<void> {
  await durability.commitCandidate({
    collection: "cancellationsByIdempotencyKey",
    key: idempotencyKey,
    candidate,
    publish: () => Object.assign(stored, candidate),
  });
}

async function completeOrder(
  stored: StoredCommerceOrderMutation,
  response: CommerceResult,
  responseStatus: number,
  durability: GatewayMutationDurability,
): Promise<GatewayMutationHttpResult> {
  const completed = completedStoredCommerceOrder(
    stored,
    response,
    responseStatus,
  );
  await durability.commitCandidate({
    collection: "ordersByIdempotencyKey",
    key: stored.command.idempotencyKey,
    candidate: completed,
    publish: () => Object.assign(stored, completed),
  });
  return {
    statusCode: responseStatus,
    body: response,
    commerceResult: response,
  };
}

async function completeCancellation(
  idempotencyKey: string,
  stored: StoredCancellationMutation,
  response: NonNullable<StoredCancellationMutation["result"]>,
  responseStatus: number,
  completionKind: NonNullable<StoredCancellationMutation["completionKind"]>,
  durability: GatewayMutationDurability,
  projectedOrder?: Order,
): Promise<GatewayMutationHttpResult> {
  const completed = completedStoredCancellation(
    stored,
    response,
    responseStatus,
    completionKind,
  );
  await durability.commitCandidate({
    collection: "cancellationsByIdempotencyKey",
    key: idempotencyKey,
    candidate: completed,
    publish: () => Object.assign(stored, completed),
  });
  return {
    statusCode: responseStatus,
    body: response,
    commerceResult: cancellationCommerceResult(response),
    projectedOrder,
  };
}

function cancellationCommerceResult(
  response: NonNullable<StoredCancellationMutation["result"]>,
): CommerceResult {
  const candidate: Record<string, unknown> = { ...response };
  delete candidate.ok;
  delete candidate.value;
  delete candidate.errorCode;
  delete candidate.message;
  delete candidate.provenance;
  return commerceResultSchema.parse(candidate);
}

function partialCancellation(
  accepted: CommerceResult,
  stored: StoredCancellationMutation,
  posStatus: CommerceResult["posStatus"],
  conflictType: string,
  omsStatus: CommerceResult["omsStatus"] = accepted.omsStatus,
) {
  const partial = commerceResultSchema.parse({
    ...accepted,
    traceId: stored.context.traceId,
    scenarioId: stored.context.scenarioId,
    outcome: "partial_cancellation",
    omsStatus,
    posStatus,
    customerStatus: "failed",
    conflictType,
  });
  return sandboxCancellationResultSchema.parse({
    ...partial,
    ok: false,
    errorCode: "commerce_cancellation_incomplete",
    message: "Order cancellation was incomplete",
    provenance: sandboxGatewayProvenance,
  });
}

function unknownOutcome(commerceOrderId: string): GatewayMutationHttpResult {
  return {
    statusCode: 503,
    body: {
      ok: false,
      errorCode: "provider_idempotency_outcome_unknown",
      message: "Provider outcome is unknown; retry the exact bound operation",
      commerceOrderId,
      provenance: sandboxGatewayProvenance,
    },
  };
}

function outcomeIsUnknown(result: {
  ok: boolean;
  status: number;
  timedOut?: boolean;
}): boolean {
  return !result.ok && (result.timedOut === true || result.status >= 500);
}

function result(input: {
  command: StoredCommerceOrderMutation["command"];
  commerceOrderId: string;
  outcome: CommerceResult["outcome"];
  customerStatus: CommerceResult["customerStatus"];
  omsOrderId?: string;
  posTicketId?: string;
  omsStatus?: CommerceResult["omsStatus"];
  posStatus?: CommerceResult["posStatus"];
  compensationStatus?: CommerceResult["compensationStatus"];
}): CommerceResult {
  return commerceResultSchema.parse({
    contractVersion: commerceContractVersion,
    traceId: input.command.traceId,
    scenarioId: input.command.scenarioId,
    outcome: input.outcome,
    commerceOrderId: input.commerceOrderId,
    omsOrderId: input.omsOrderId,
    posTicketId: input.posTicketId,
    omsStatus: input.omsStatus,
    posStatus: input.posStatus,
    customerStatus: input.customerStatus,
    compensationStatus: input.compensationStatus,
    deduplicated: false,
    commerceEnvironment: "sandbox",
    providerProvenance: sandboxCommerceProofProviderProvenance,
  });
}
