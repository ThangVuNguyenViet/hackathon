import { normalizeSearchText } from '../ordering/orderingDataPlanning.js';
import type { ToolCallRequest } from '../ordering/types.js';
import type { ToolPlannerInput } from './toolPlanner.js';

export function recoverExplicitOrderConfirmation(
  input: ToolPlannerInput,
  toolCalls: ToolCallRequest[],
): { recovered: boolean; toolCalls: ToolCallRequest[] } {
  const explicitlyConfirmsOrder = /\b(?:xac nhan don|dat don|chot don)\b/.test(
    normalizeSearchText(input.state.latestUserMessage),
  );
  const recovered =
    explicitlyConfirmsOrder &&
    Boolean(input.state.cart?.items.length) &&
    Boolean(input.state.fulfillment) &&
    !input.state.order &&
    input.availableTools.includes('previewOrder') &&
    input.availableTools.includes('placeOrder');
  if (!recovered) return { recovered: false, toolCalls };
  return {
    recovered: true,
    toolCalls: [
      ...toolCalls.filter((call) => call.toolName !== 'previewOrder' && call.toolName !== 'placeOrder'),
      { toolName: 'previewOrder', arguments: {} },
      { toolName: 'placeOrder', arguments: {} },
    ],
  };
}

export function suppressDeferredOrderPreviews(
  input: ToolPlannerInput,
  toolCalls: ToolCallRequest[],
  orderConfirmed: boolean,
): { deferred: boolean; toolCalls: ToolCallRequest[] } {
  const explicitlyDefersOrder = /\b(?:chua|khong|dung)\s+(?:dat|chot)(?:\s+don)?\b/.test(
    normalizeSearchText(input.state.latestUserMessage),
  );
  const suppressOrderPreview =
    toolCalls.some((call) => call.toolName === 'previewOrder') &&
    !orderConfirmed &&
    input.state.userConfirmedOrder !== true;
  const suppressCartPreview =
    explicitlyDefersOrder && toolCalls.some((call) => call.toolName === 'previewCart');
  if (!suppressOrderPreview && !suppressCartPreview) return { deferred: false, toolCalls };
  return {
    deferred: true,
    toolCalls: toolCalls.filter((call) =>
      call.toolName !== 'previewOrder' && (!suppressCartPreview || call.toolName !== 'previewCart')
    ),
  };
}

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
