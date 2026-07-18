import type { SavedAddressDecisionPlan, ToolPlannerInput } from './toolPlanner.js';
import {
  precedingAssistantPresentedSavedAddress,
  referencesCatalogName,
} from './toolPlannerNormalization.js';

export function normalizeSavedAddressDecision(
  input: ToolPlannerInput,
  proposed: SavedAddressDecisionPlan | undefined,
  entities: Record<string, unknown>,
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
  if (!decision && entities.useSavedAddress === true && savedAddresses.length === 1) {
    decision = {
      addressIndex: 0,
      decision: precedingAssistantPresentedSavedAddress(input, savedAddresses[0]!) ? 'accept' : 'suggest',
    };
  }
  if (!decision) return undefined;

  const address = savedAddresses[decision.addressIndex];
  if (!address) return undefined;
  if (decision.decision === 'accept' && !precedingAssistantPresentedSavedAddress(input, address)) {
    return { ...decision, decision: 'suggest' };
  }
  return decision;
}
