import {
  agentToolResultForModel,
  type AgentToolResultForModel,
} from '../graph/orderStatusEvidenceProjection.js';
import { isRecord } from '../graph/turnSupport.js';
import type {
  AgentToolCallResult,
  CollectionToolName,
  ToolName,
} from '../ordering/types.js';

const collectionToolNames = [
  'searchMenu',
  'recommendAddOns',
  'findStores',
  'searchPromotions',
  'listMembershipRewards',
  'listMembershipWallet',
  'listMembershipTools',
  'listPaymentMethods',
  'searchContentPolicy',
  'answerAllergenQuestion',
] as const satisfies readonly CollectionToolName[];
const collectionToolNameSet = new Set<ToolName>(collectionToolNames);

export function isAgentCollectionToolName(
  toolName: ToolName,
): toolName is CollectionToolName {
  return collectionToolNameSet.has(toolName);
}

export function projectAgentToolResultForModelCall(
  result: AgentToolCallResult,
  call: { auditArguments?: Record<string, unknown> },
): AgentToolResultForModel {
  const projected = agentToolResultForModel(result);
  if (
    projected.toolName !== 'quoteFulfillment' ||
    !isRecord(call.auditArguments?.savedAddressRef)
  ) {
    return projected;
  }
  if (!projected.ok) {
    return {
      ...projected,
      message: 'fulfillment_quote_failed',
    };
  }
  const {
    resolvedAddress: _privateSavedAddress,
    ...publicQuote
  } = projected.value;
  return {
    ...projected,
    value: publicQuote,
    message: 'fulfillment_quote_observed',
  };
}
