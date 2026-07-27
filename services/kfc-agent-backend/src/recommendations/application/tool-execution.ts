import type { AgentState } from '../../agent/agentState.js';
import type { z } from 'zod';
import type { Cart } from '../../domain/types.js';
import { digestCommerceAction } from '../../ordering/commerceDigest.js';
import type {
  RecommendationToolResult,
  ToolCallFailure,
  ToolCallResult,
} from '../../ordering/types.js';
import { KFC_RECOMMENDATION_POLICY_VERSION } from '../domain/versions.js';
import type {
  Placement,
  RecommendationDecisionRequest,
} from '../domain/contracts.js';
import {
  commerceSnapshotBindingsSchema,
  experimentProfileSchema,
  parseRecommendationDecisionRequest,
} from '../domain/schemas.js';
import type { RecommendationApplicationService } from './service-types.js';
import type { RecommendationRequestKind } from '../state/types.js';
import type { RecommendationToolName } from './tool-availability.js';

export interface RecommendationToolExecutionAuthority {
  application: RecommendationApplicationService;
  orderFlowId: string;
  verifiedCustomer: {
    ref: string;
    hasPriorCompletedHistory: boolean;
  } | null;
  storeId: string;
  fulfilmentMode: 'pickup' | 'delivery';
  decisionTime: string;
  commerceSnapshotBindings: z.input<typeof commerceSnapshotBindingsSchema>;
  experimentProfile: z.input<typeof experimentProfileSchema>;
}

export interface ExecuteRecommendationToolInput {
  toolName: RecommendationToolName;
  requestKind: RecommendationRequestKind;
  parentCartLineId?: string;
  sessionId: string;
  durableRequestIdentity: string;
  state?: AgentState;
  cart: Cart;
  authority: RecommendationToolExecutionAuthority;
}

export function recommendationCartLineId(
  itemCode: string,
  index: number,
): string {
  return `cart-line:${index + 1}:${itemCode}`;
}

export async function recommendationCartRevision(cart: Cart): Promise<string> {
  const digest = await digestCommerceAction(cart);
  return `cart-revision:${digest.slice(0, 24)}`;
}

function placementFor(input: ExecuteRecommendationToolInput): Placement {
  switch (input.toolName) {
    case 'recommendStarter':
      return input.authority.verifiedCustomer?.hasPriorCompletedHistory
        ? 'for_you'
        : 'local_favorite';
    case 'recommendModifierUpsell':
      return 'modifier_upsell';
    case 'recommendSmartCrossSell':
      return 'smart_cross_sell';
  }
}

async function requestFor(
  input: ExecuteRecommendationToolInput,
): Promise<RecommendationDecisionRequest> {
  const cartRevision = await recommendationCartRevision(input.cart);
  const operationDigest = await digestCommerceAction({
    sessionId: input.sessionId,
    durableRequestIdentity: input.durableRequestIdentity,
    toolName: input.toolName,
    requestKind: input.requestKind,
    cartRevision,
    recommendationStateRevision:
      input.state?.recommendationState?.revision ?? 0,
  });
  return parseRecommendationDecisionRequest({
    schemaVersion: 'kfc-recommendation-v1',
    requestId: `recommendation-request:${operationDigest.slice(0, 24)}`,
    idempotencyKey: `recommendation-tool:${operationDigest}`,
    orderFlowId: input.authority.orderFlowId,
    sessionId: input.sessionId,
    placement: placementFor(input),
    verifiedCustomerRef: input.authority.verifiedCustomer?.ref ?? null,
    storeId: input.authority.storeId,
    fulfilmentMode: input.authority.fulfilmentMode,
    decisionTime: input.authority.decisionTime,
    cart: {
      cartId: input.cart.id,
      revision: cartRevision,
      subtotal: { amount: input.cart.subtotalVnd, currency: 'VND' },
      lines: input.cart.items.map((item, index) => ({
        lineId: recommendationCartLineId(item.itemCode, index),
        sellableItemId: item.itemCode,
        quantity: item.quantity,
        unitPrice: { amount: item.unitPriceVnd, currency: 'VND' },
        modifiers: (item.modifiers ?? []).map((modifier) => ({
          groupPath: [modifier.groupId],
          optionId: modifier.modifierId,
          quantity: modifier.quantity,
          priceImpact: {
            amount: Math.max(0, modifier.priceDeltaVnd),
            currency: 'VND',
          },
        })),
      })),
    },
    cartRevision,
    commerceSnapshotBindings: input.authority.commerceSnapshotBindings,
    eligibilityPolicyVersion: KFC_RECOMMENDATION_POLICY_VERSION,
    experimentProfile: input.authority.experimentProfile,
  });
}

function failure(
  toolName: RecommendationToolName,
  errorCode: string,
  message: string,
): ToolCallFailure {
  return {
    toolName,
    ok: false,
    errorCode,
    message,
    provenance: [],
  };
}

export async function executeRecommendationTool(
  input: ExecuteRecommendationToolInput,
): Promise<ToolCallResult> {
  const request = await requestFor(input);
  const applicationResult = await input.authority.application.decide({
    request,
    requestKind: input.requestKind,
    trusted:
      input.toolName === 'recommendModifierUpsell'
        ? {
            parentCartLineId: input.parentCartLineId,
            presentationCustomerId: input.state?.customerId ?? null,
          }
        : { presentationCustomerId: input.state?.customerId ?? null },
  });
  if (
    applicationResult.status !== 'decided' &&
    applicationResult.status !== 'replay'
  ) {
    return failure(
      input.toolName,
      `recommendation_${applicationResult.status}`,
      'The recommendation decision could not be committed',
    );
  }
  if (
    applicationResult.response.orderFlowId !== request.orderFlowId ||
    applicationResult.response.placement !== request.placement
  ) {
    return failure(
      input.toolName,
      'recommendation_decision_binding_mismatch',
      'The recommendation decision did not match the verified request',
    );
  }
  const value: RecommendationToolResult =
    applicationResult.response.status === 'recommended'
      ? {
          status: 'recommended',
          recommendation: applicationResult.response,
        }
      : { status: 'silent', recommendation: null };
  return {
    toolName: input.toolName,
    ok: true,
    value,
    message:
      value.status === 'recommended'
        ? 'verified_recommendation'
        : 'silent_recommendation',
    provenance: [],
  } as ToolCallResult;
}
