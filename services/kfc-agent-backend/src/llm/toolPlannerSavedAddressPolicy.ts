import { normalizeSearchText } from '../ordering/orderingDataPlanning.js';
import type { SavedAddressDecisionPlan, ToolPlannerInput } from './toolPlanner.js';
import {
  addressFieldsEqual,
  precedingAssistantPresentedSavedAddress,
  referencesCatalogName,
} from './toolPlannerNormalization.js';

export function normalizeSavedAddressDecision(
  input: ToolPlannerInput,
  proposed: SavedAddressDecisionPlan | undefined,
  entities: Record<string, unknown>,
  toolCalls: Array<{ toolName: string; arguments: Record<string, unknown> }> = [],
): SavedAddressDecisionPlan | undefined {
  const addressDraft = typeof entities.addressDraft === 'object' &&
    entities.addressDraft !== null &&
    !Array.isArray(entities.addressDraft)
    ? entities.addressDraft as Record<string, unknown>
    : undefined;
  const hasCurrentTurnAddressEvidence = Object.values(addressDraft ?? {}).some(
    (value) => typeof value === 'string' && referencesCatalogName(input.state.latestUserMessage, value),
  );
  if (
    entities.addressChangeRequested === true ||
    (entities.useSavedAddress !== true && hasCurrentTurnAddressEvidence)
  ) return undefined;

  const savedAddresses = input.state.customerContext?.savedAddresses ?? [];
  let decision = proposed;
  const priorCustomerRequestedSavedAddress = input.recentTurns.some(
    (turn) => turn.role === 'user' && /\b(?:dia chi da luu|saved address)\b/.test(normalizeSearchText(turn.text)),
  );
  const quotedAddress = toolCalls.find(({ toolName }) => toolName === 'quoteFulfillment')?.arguments.address;
  const completeQuotedAddress = typeof quotedAddress === 'object' &&
    quotedAddress !== null &&
    typeof (quotedAddress as Record<string, unknown>).line1 === 'string' &&
    typeof (quotedAddress as Record<string, unknown>).district === 'string' &&
    typeof (quotedAddress as Record<string, unknown>).city === 'string'
    ? quotedAddress as { line1: string; district: string; city: string }
    : undefined;
  const recoveredVerifiedQuote = !decision &&
    !hasCurrentTurnAddressEvidence &&
    savedAddresses.length === 1 &&
    priorCustomerRequestedSavedAddress &&
    completeQuotedAddress !== undefined &&
    addressFieldsEqual(savedAddresses[0]!, completeQuotedAddress);
  if (recoveredVerifiedQuote) decision = { addressIndex: 0, decision: 'accept' };
  if (!decision && entities.useSavedAddress === true && savedAddresses.length === 1) {
    decision = {
      addressIndex: 0,
      decision: precedingAssistantPresentedSavedAddress(input, savedAddresses[0]!) ? 'accept' : 'suggest',
    };
  }
  if (!decision) return undefined;

  const address = savedAddresses[decision.addressIndex];
  if (!address) return undefined;
  if (decision.decision === 'accept' && !recoveredVerifiedQuote && !precedingAssistantPresentedSavedAddress(input, address)) {
    return { ...decision, decision: 'suggest' };
  }
  return decision;
}
