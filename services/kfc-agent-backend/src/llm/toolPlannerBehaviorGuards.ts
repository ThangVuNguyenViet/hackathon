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
