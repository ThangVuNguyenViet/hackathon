import type { ExternalClients } from "../clients/interfaces.js";
import { providerOrderStatusSchema } from "../commerce/providerResponseSchemas.js";
import {
  orderWithCurrentDeliveryEstimate,
} from "../domain/orderStatusEvidence.js";
import {
  agentFailure,
  currentAuthorityRevisions,
  isAgentCallFailure,
} from "./agentToolAuthority.js";
import { digestCommerceAction } from "./approvalReceipt.js";
import type { ExecutorContext } from "./toolExecutor.js";
import type {
  AgentToolCallResult,
  CollectionScope,
  ToolCallRequest,
  ToolCallResult,
} from "./types.js";
import { buildVerifiedCollectionSnapshot } from "./verifiedCollections.js";

type ResultAdapterContext = Pick<
  ExecutorContext,
  "cart" | "externalCallContext" | "state"
>;

async function agentCollectionResult<Item>(input: {
  legacy: ToolCallResult;
  items: Item[];
  scope: CollectionScope;
  providerRevision: string;
}): Promise<AgentToolCallResult> {
  const snapshot = await buildVerifiedCollectionSnapshot({
    items: input.items,
    scope: input.scope,
    providerRevision: input.providerRevision,
  });
  return {
    toolName: input.legacy.toolName,
    ok: true,
    value: snapshot.result,
    message: input.legacy.message,
    provenance: input.legacy.provenance,
    verifiedCollection: snapshot as typeof snapshot & {
      result: { items: unknown[] };
    },
  } as AgentToolCallResult;
}

async function contentCollectionRevision(
  legacy: ToolCallResult,
): Promise<string> {
  const digest = await digestCommerceAction({
    toolName: legacy.toolName,
    content: legacy.value,
    provenance: legacy.provenance,
  });
  return `content-result:${digest}`;
}

export async function adaptAgentToolResult(input: {
  clients: ExternalClients;
  request: ToolCallRequest;
  context: ResultAdapterContext;
  legacy: ToolCallResult;
  scope?: CollectionScope;
}): Promise<AgentToolCallResult> {
  const { clients, request, context, legacy, scope } = input;
  if (legacy.toolName === "getOrderStatus") {
    if (!legacy.ok) {
      return { ...legacy, message: "order_status_lookup_failed" };
    }
    const parsed = providerOrderStatusSchema.safeParse(legacy.value);
    const value = parsed.success
      ? orderWithCurrentDeliveryEstimate(parsed.data)
      : undefined;
    if (!value) {
      return agentFailure(
        request,
        "order_status_provider_response_invalid",
        "order_status_invalid_provider_response",
      );
    }
    return {
      toolName: "getOrderStatus",
      ok: true,
      value,
      message: "order_status_observed",
      provenance: legacy.provenance,
    };
  }
  if (!legacy.ok) return legacy;
  switch (legacy.toolName) {
    case "searchContentPolicy":
    case "answerAllergenQuestion":
      return agentCollectionResult({
        legacy,
        items: legacy.value,
        scope: scope ?? { scope: "all" },
        providerRevision: await contentCollectionRevision(legacy),
      });
    case "searchMenu":
      {
        const revisions = await currentAuthorityRevisions(
          clients,
          request,
          context,
        );
        if (isAgentCallFailure(revisions)) return revisions;
        return agentCollectionResult({
          legacy,
          items: legacy.value.items.map((item) => ({
            ...item,
            categoryId: item.category,
            originalPriceVnd: item.originalPriceVnd ?? null,
          })),
          scope: scope ?? { scope: "all" },
          providerRevision: revisions.providerRevision,
        });
      }
    case "recommendAddOns":
    case "findStores":
    case "searchPromotions":
    case "listMembershipRewards":
    case "listMembershipWallet":
    case "listMembershipTools":
    case "listPaymentMethods": {
      const revisions = await currentAuthorityRevisions(
        clients,
        request,
        context,
      );
      if (isAgentCallFailure(revisions)) return revisions;
      return agentCollectionResult({
        legacy,
        items: legacy.value as unknown[],
        scope: scope ?? { scope: "all" },
        providerRevision: revisions.providerRevision,
      });
    }
    default:
      return {
        toolName: legacy.toolName,
        ok: true,
        value: legacy.value,
        message: legacy.message,
        provenance: legacy.provenance,
        ...(legacy.inventoryAvailabilityAuthority
          ? {
              inventoryAvailabilityAuthority:
                legacy.inventoryAvailabilityAuthority,
            }
          : {}),
      } as AgentToolCallResult;
  }
}
