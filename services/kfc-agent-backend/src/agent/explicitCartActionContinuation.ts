import type { ToolTraceEntry } from '../ordering/types.js';

const explicitQuantityCartAction =
  /(?:^|[\s,;])(?:cho\s+(?:mình|tôi|tui|em)\s+\d+|thêm(?:\s+cho\s+(?:mình|tôi|tui|em))?\s+\d+|(?:đặt|lấy)(?:\s+(?:cho\s+)?(?:mình|tôi|tui|em))?\s+\d+|add\s+\d+|order\s+\d+)\b/iu;

export const EXPLICIT_CART_ACTION_INCOMPLETE =
  'agent_explicit_cart_action_incomplete';

export function explicitCartActionNeedsContinuation(input: {
  currentUserMessage?: string;
  currentTurnToolTrace?: readonly ToolTraceEntry[];
}): boolean {
  const message = input.currentUserMessage?.trim();
  if (!message || !explicitQuantityCartAction.test(message)) return false;
  const trace = input.currentTurnToolTrace ?? [];
  if (trace.some((entry) => entry.toolName === 'updateCart' && entry.ok)) {
    return false;
  }
  return true;
}

export const EXPLICIT_CART_ACTION_CONTINUATION_FEEDBACK =
  'The current customer message explicitly requests a cart mutation with quantities. Continue the tool loop using the verified catalog evidence already obtained. Do not return a final response until updateCart succeeds or a genuinely missing fact has no verified default. For a generic drink, use its verified canonical Tiêu Chuẩn or standard base variant. Obtain modifier options only for the item with an explicitly requested customization, then use its exact nested verified modifier identifiers. Do not read or author optional modifiers for other items when the customer requested their base/default form.';
