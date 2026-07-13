export type CustomerCommand =
  | {
      kind: 'cart_update';
      itemCode: string;
      quantity: number;
    }
  | {
      kind: 'cart_batch_update';
      items: Array<{ itemCode: string; quantity: number }>;
    }
  | {
      kind: 'modifier_selection';
      itemCode: string;
      groupId: string;
      modifierId: string;
    }
  | { kind: 'confirm_order' }
  | { kind: 'start_fulfillment' }
  | { kind: 'accept_fulfillment' }
  | { kind: 'select_payment_method'; methodId: string }
  | { kind: 'edit_cart' }
  | { kind: 'submit_address'; value?: string }
  | { kind: 'apply_voucher'; value?: string }
  | { kind: 'change_payment_method' }
  | { kind: 'continue_payment' }
  | { kind: 'track_order' }
  | { kind: 'request_support' }
  | { kind: 'add_support_detail'; value?: string }
  | { kind: 'open_allergen_evidence' };

export interface VerifiedStructuredAction {
  actionId: string;
  value?: string;
  payload?: Record<string, unknown>;
}

export function customerCommandFromVerifiedAction(
  action: VerifiedStructuredAction,
): CustomerCommand | undefined {
  const payload = action.payload ?? {};
  if (
    action.actionId === 'add_item' ||
    action.actionId === 'update_item_quantity' ||
    action.actionId === 'remove_item'
  ) {
    const itemCode = stringValue(payload.itemCode);
    const requestedQuantity = integerValue(payload.quantity);
    if (!itemCode) return undefined;
    return {
      kind: 'cart_update',
      itemCode,
      quantity: action.actionId === 'remove_item' ? 0 : requestedQuantity ?? 1,
    };
  }
  if (action.actionId === 'add_items') {
    if (!Array.isArray(payload.items)) return undefined;
    const items = payload.items.flatMap((item) => {
      const record = recordValue(item);
      const itemCode = stringValue(record?.itemCode);
      const quantity = integerValue(record?.quantity);
      return itemCode && quantity !== undefined ? [{ itemCode, quantity }] : [];
    });
    return items.length === payload.items.length && items.length > 0
      ? { kind: 'cart_batch_update', items }
      : undefined;
  }
  if (action.actionId.startsWith('customize_item:')) {
    const itemCode = stringValue(payload.itemCode);
    const groupId = stringValue(payload.groupId);
    const modifierId = stringValue(payload.modifierId);
    return itemCode && groupId && modifierId
      ? { kind: 'modifier_selection', itemCode, groupId, modifierId }
      : undefined;
  }
  switch (action.actionId) {
    case 'confirm_order':
      return { kind: 'confirm_order' };
    case 'continue_to_fulfillment':
      return { kind: 'start_fulfillment' };
    case 'accept_fulfillment':
      return { kind: 'accept_fulfillment' };
    case 'select_payment_method': {
      const methodId = stringValue(payload.methodId);
      return methodId ? { kind: 'select_payment_method', methodId } : undefined;
    }
    case 'edit_cart':
      return { kind: 'edit_cart' };
    case 'submit_address':
      return { kind: 'submit_address', value: action.value };
    case 'apply_voucher':
      return { kind: 'apply_voucher', value: action.value };
    case 'change_payment_method':
      return { kind: 'change_payment_method' };
    case 'open_payment':
      return { kind: 'continue_payment' };
    case 'track_order':
      return { kind: 'track_order' };
    case 'request_human':
      return { kind: 'request_support' };
    case 'send_issue_summary':
      return { kind: 'add_support_detail', value: action.value };
    case 'open_allergen_chart':
      return { kind: 'open_allergen_evidence' };
    default:
      return undefined;
  }
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function integerValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) ? value : undefined;
}
