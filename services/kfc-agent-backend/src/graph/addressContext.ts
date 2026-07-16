import type {
  Address,
  ConversationTurn
} from '../domain/types.js';
import type { FulfillmentPlanningContext } from '../ordering/types.js';
import type { AgentGraphState } from './state.js';
import { hasPlannerBooleanEntity, isRecord, normalizedIntentText } from "./turnSupport.js";

export function partialAddressText(state: AgentGraphState): string | undefined {
  if (!state.addressDraft) return undefined;
  const value = [state.addressDraft.line1, state.addressDraft.district, state.addressDraft.city]
    .filter((field): field is string => typeof field === 'string' && field.trim().length > 0)
    .join(', ');
  return value || undefined;
}

export function hasIncompleteAddressDraft(state: AgentGraphState): boolean {
  const draft = state.addressDraft;
  if (!draft) return false;
  return !draft.line1 || !draft.district || !draft.city;
}

export function normalizedAddressEvidence(value: string): string {
  return normalizedIntentText(value).replace(/[^a-z0-9]+/g, ' ').trim();
}

export function plannerAddressDraft(state: AgentGraphState): Partial<Address> | undefined {
  const rawDraft = isRecord(state.entities) && isRecord(state.entities.addressDraft)
    ? state.entities.addressDraft
    : undefined;
  if (!rawDraft) return undefined;

  const latestMessage = normalizedAddressEvidence(state.latestUserMessage);
  const draft: Partial<Address> = {};
  for (const field of ['label', 'line1', 'district', 'city'] as const) {
    const value = rawDraft[field];
    if (typeof value !== 'string') continue;
    const normalizedValue = normalizedAddressEvidence(value);
    if (!normalizedValue || !latestMessage.includes(normalizedValue)) continue;
    draft[field] = value.trim();
  }
  return Object.keys(draft).length > 0 ? draft : undefined;
}

export function mergeVerifiedAddressDraft(
  state: AgentGraphState,
  fulfillmentLocationContext: FulfillmentPlanningContext | undefined,
): void {
  const suppliedDraft = plannerAddressDraft(state);
  const location = fulfillmentLocationContext?.candidates.length === 1
    ? fulfillmentLocationContext.candidates[0]
    : undefined;
  if (!suppliedDraft && !location) return;

  // A model-authored incomplete draft is not enough to replace a fulfillment
  // address that was already verified and quoted. Require current-turn
  // location evidence or an actual address-change signal. This keeps unrelated
  // checkout details (for example invoice text) from being promoted to line1.
  if (
    suppliedDraft &&
    state.address &&
    state.fulfillment &&
    !location &&
    !hasPlannerBooleanEntity(state, 'addressChangeRequested') &&
    !partialAddressText(state)
  ) {
    return;
  }

  const currentTurnAddressFields: Partial<Address> = {
    ...(suppliedDraft ?? {}),
    ...(location ? { district: location.district, city: location.city } : {}),
  };
  const startsDifferentConfirmedAddress = Boolean(
    state.address &&
    (['line1', 'district', 'city'] as const).some((field) => {
      const currentValue = state.address?.[field];
      const suppliedValue = currentTurnAddressFields[field];
      return Boolean(
        currentValue &&
        suppliedValue &&
        normalizedAddressEvidence(currentValue) !== normalizedAddressEvidence(suppliedValue),
      );
    }),
  );

  if (suppliedDraft && !state.order) {
    state.address = undefined;
    state.fulfillment = undefined;
    state.orderPreview = undefined;
  }

  state.addressDraft = {
    ...(startsDifferentConfirmedAddress ? {} : (state.addressDraft ?? {})),
    ...currentTurnAddressFields,
  };
}

export function shouldUseKnownAddressForFulfillment(state: AgentGraphState): boolean {
  return Boolean(
    state.cart &&
    state.cart.items.length > 0 &&
    state.address &&
    (
      hasPlannerBooleanEntity(state, 'useSavedAddress') ||
      hasPlannerBooleanEntity(state, 'fulfillmentAccepted')
    ),
  );
}

export function plannerSavedAddressDecision(state: AgentGraphState):
  | { addressIndex: number; decision: 'suggest' | 'accept'; }
  | undefined {
  const value = isRecord(state.entities) ? state.entities.savedAddressDecision : undefined;
  if (!isRecord(value)) return undefined;
  if (!Number.isInteger(value.addressIndex) || typeof value.addressIndex !== 'number' || value.addressIndex < 0) return undefined;
  if (value.decision !== 'suggest' && value.decision !== 'accept') return undefined;
  return { addressIndex: value.addressIndex, decision: value.decision };
}

export function addressesHaveSameLocation(left: Address, right: Address): boolean {
  return (['line1', 'district', 'city'] as const).every(
    (field) => normalizedAddressEvidence(left[field]) === normalizedAddressEvidence(right[field]),
  );
}

export function presentedSavedAddressIndex(
  recentTurns: ConversationTurn[],
  savedAddresses: Address[],
): number | undefined {
  const presentedAddress = [...recentTurns]
    .reverse()
    .filter((turn) => turn.role === 'assistant')
    .map((turn) => turn.metadata?.genUi)
    .find((genUi) =>
      genUi?.widgetKind === 'addressFulfillmentCheck' || genUi?.widgetKind === 'orderReviewConfirm',
    )?.data.address;
  if (!isRecord(presentedAddress)) return undefined;
  if (
    typeof presentedAddress.line1 !== 'string' ||
    typeof presentedAddress.district !== 'string' ||
    typeof presentedAddress.city !== 'string'
  ) {
    return undefined;
  }
  const candidate: Address = {
    label: typeof presentedAddress.label === 'string' ? presentedAddress.label : presentedAddress.line1,
    line1: presentedAddress.line1,
    district: presentedAddress.district,
    city: presentedAddress.city,
  };
  const index = savedAddresses.findIndex((address) => addressesHaveSameLocation(address, candidate));
  return index >= 0 ? index : undefined;
}

export function applyPlannerSavedAddressDecision(state: AgentGraphState): void {
  const decision = plannerSavedAddressDecision(state);
  if (!decision) return;
  const candidate = state.customerContext?.savedAddresses[decision.addressIndex];
  if (!candidate) {
    state.entities = {
      ...(isRecord(state.entities) ? state.entities : {}),
      useSavedAddress: false,
      fulfillmentAccepted: false,
      asksClarification: true,
    };
    return;
  }

  state.addressDraft = undefined;
  state.entities = {
    ...(isRecord(state.entities) ? state.entities : {}),
    preferFulfillmentSurface: true,
  };
  if (decision.decision === 'suggest') {
    state.address = undefined;
    state.fulfillment = undefined;
    state.orderPreview = undefined;
    return;
  }
  if (!state.address || !addressesHaveSameLocation(state.address, candidate)) {
    state.fulfillment = undefined;
    state.orderPreview = undefined;
  }
  state.address = candidate;
}

export function selectedSavedAddressCandidate(state: AgentGraphState): Address | undefined {
  const decision = plannerSavedAddressDecision(state);
  if (decision) return state.customerContext?.savedAddresses[decision.addressIndex];
  const savedAddresses = state.customerContext?.savedAddresses ?? [];
  return savedAddresses.length === 1 ? savedAddresses[0] : undefined;
}

export function cartItemCodes(state: AgentGraphState): string[] {
  return [...new Set(state.cart?.items.map((item) => item.itemCode) ?? [])];
}
