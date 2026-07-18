import { normalizeSearchText } from '../ordering/orderingDataPlanning.js';
import type { ToolPlannerInput } from './toolPlanner.js';

export function suppressStaleAddressChange(
  input: ToolPlannerInput,
  entities: Record<string, unknown>,
  semanticallyVerifiedChange = false,
): boolean {
  if (!input.state.address || !input.state.fulfillment) return false;

  const latestMessage = normalizeSearchText(input.state.latestUserMessage);
  const addressDraft = entities.addressDraft;
  const hasCurrentAddressEvidence =
    typeof addressDraft === 'object' &&
    addressDraft !== null &&
    !Array.isArray(addressDraft) &&
    Object.values(addressDraft).some((value) => {
      if (typeof value !== 'string') return false;
      const normalizedValue = normalizeSearchText(value);
      return normalizedValue.length > 1 && latestMessage.includes(normalizedValue);
    });
  if (entities.addressChangeRequested === true) {
    if (hasCurrentAddressEvidence || semanticallyVerifiedChange) {
      if (
        semanticallyVerifiedChange &&
        typeof addressDraft === 'object' &&
        addressDraft !== null &&
        !Array.isArray(addressDraft)
      ) {
        for (const [field, value] of Object.entries(addressDraft)) {
          if (
            typeof value !== 'string' ||
            !latestMessage.includes(normalizeSearchText(value))
          ) {
            delete (addressDraft as Record<string, unknown>)[field];
          }
        }
        if (Object.keys(addressDraft).length === 0) delete entities.addressDraft;
      } else if (!hasCurrentAddressEvidence) {
        delete entities.addressDraft;
      }
      return false;
    }
    delete entities.addressChangeRequested;
    delete entities.addressDraft;
    return true;
  }
  if (hasCurrentAddressEvidence) return false;

  const suppressed = 'addressDraft' in entities;
  delete entities.addressDraft;
  return suppressed;
}
