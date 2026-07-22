import type { ConversationTurnMetadata } from '../domain/types.js';
import type { AgentState } from './agentState.js';

export type ContextPolicyValue =
  | 'active'
  | 'relevant'
  | 'resume'
  | 'confirm_before_use'
  | 'irrelevant'
  | 'background_only'
  | 'operator_only';

export interface ContextPolicyDirective {
  cart?: ContextPolicyValue | boolean;
  order?: ContextPolicyValue | boolean;
  fulfillment?: ContextPolicyValue | boolean;
  promotion?: ContextPolicyValue | boolean;
  menuSearchResults?: ContextPolicyValue | boolean;
  payment?: ContextPolicyValue | boolean;
  invoice?: ContextPolicyValue | boolean;
  handoff?: ContextPolicyValue | boolean;
  recentTurns?: ContextPolicyValue | boolean;
  customer?: ContextPolicyValue | boolean;
  membership?: ContextPolicyValue | boolean;
  recentOrder?: ContextPolicyValue | boolean;
}

export interface ContextPolicyOptions {
  metadata?: ConversationTurnMetadata | null;
  policy?: ContextPolicyDirective;
  preserveCartOrderPaymentContext?: boolean;
  preserveMenuSearchResults?: boolean;
  preservePaymentContext?: boolean;
  preserveHandoff?: boolean;
  preserveRecentTurns?: boolean;
  preserveToolTrace?: boolean;
  compactMenuSearchResults?: boolean;
  defaultBehavior?: 'suppress' | 'preserve';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function contextPolicyFromMetadata(
  metadata: ConversationTurnMetadata | null | undefined,
): ContextPolicyDirective {
  const rawEvent = metadata?.rawEvent;
  if (!isRecord(rawEvent) || !isRecord(rawEvent.contextPolicy)) return {};
  return rawEvent.contextPolicy as ContextPolicyDirective;
}

function allowsCustomerContext(
  value: ContextPolicyValue | boolean | undefined,
): boolean {
  return (
    value === true ||
    value === 'active' ||
    value === 'relevant' ||
    value === 'resume' ||
    value === 'confirm_before_use'
  );
}

export function contextPolicyIsActive(
  policy: ContextPolicyDirective,
  key: keyof ContextPolicyDirective,
): boolean {
  return allowsCustomerContext(policy[key]);
}

export function contextPolicyRequiresConfirmation(
  policy: ContextPolicyDirective,
  key: keyof ContextPolicyDirective,
): boolean {
  return policy[key] === 'confirm_before_use';
}

export function mergeContextPolicies(
  base: ContextPolicyDirective,
  next: ContextPolicyDirective | undefined,
): ContextPolicyDirective {
  if (!next) return base;
  const merged: ContextPolicyDirective = { ...base };
  for (const [rawKey, nextValue] of Object.entries(next) as Array<
    [
      keyof ContextPolicyDirective,
      ContextPolicyDirective[keyof ContextPolicyDirective],
    ]
  >) {
    if (nextValue === undefined) continue;
    const baseValue = base[rawKey];
    if (baseValue === 'operator_only') continue;
    if (baseValue === 'confirm_before_use') continue;
    if (
      allowsCustomerContext(baseValue) &&
      (nextValue === false ||
        nextValue === 'irrelevant' ||
        nextValue === 'background_only')
    ) {
      continue;
    }
    merged[rawKey] = nextValue;
  }
  return merged;
}

export function buildContextPolicyState(
  state: AgentState,
  options: ContextPolicyOptions = {},
): AgentState {
  const policy = mergeContextPolicies(
    contextPolicyFromMetadata(options.metadata),
    options.policy,
  );
  const preserveByDefault = options.defaultBehavior === 'preserve';
  const preserveConfiguredCommerceContext =
    preserveByDefault || options.preserveCartOrderPaymentContext === true;
  const preserveCart =
    preserveConfiguredCommerceContext || allowsCustomerContext(policy.cart);
  const preserveOrder =
    preserveConfiguredCommerceContext || allowsCustomerContext(policy.order);
  const preservePayment =
    preserveOrder ||
    options.preservePaymentContext === true ||
    allowsCustomerContext(policy.payment);
  const preserveMenuSearchResults =
    preserveByDefault ||
    options.preserveMenuSearchResults === true ||
    allowsCustomerContext(policy.menuSearchResults);
  const preserveHandoff =
    preserveByDefault ||
    options.preserveHandoff === true ||
    allowsCustomerContext(policy.handoff);
  const preservePromotion =
    preserveCart || allowsCustomerContext(policy.promotion);
  const preserveFulfillment =
    preserveCart || allowsCustomerContext(policy.fulfillment);
  const preserveInvoice = preserveCart || allowsCustomerContext(policy.invoice);
  const preserveRecentTurns =
    preserveByDefault ||
    options.preserveRecentTurns === true ||
    allowsCustomerContext(policy.recentTurns);
  const preserveCustomerContext =
    preserveByDefault ||
    preserveCart ||
    allowsCustomerContext(policy.customer) ||
    allowsCustomerContext(policy.membership) ||
    allowsCustomerContext(policy.recentOrder);

  return {
    ...state,
    recentTurns: preserveRecentTurns ? state.recentTurns : [],
    cart: preserveCart ? state.cart : undefined,
    address: preserveFulfillment ? state.address : undefined,
    addressDraft: preserveFulfillment ? state.addressDraft : undefined,
    orderPreview: preserveCart ? state.orderPreview : undefined,
    order: preserveOrder ? state.order : undefined,
    selectedModifiers: preserveCart ? state.selectedModifiers : undefined,
    fulfillment: preserveFulfillment ? state.fulfillment : undefined,
    promotionContext: preservePromotion ? state.promotionContext : undefined,
    menuSearchResults: preserveMenuSearchResults
      ? options.compactMenuSearchResults
        ? state.menuSearchResults?.slice(0, 24)
        : state.menuSearchResults
      : undefined,
    menuModifierOptions: preserveCart ? state.menuModifierOptions : undefined,
    customerContext: preserveCustomerContext
      ? state.customerContext
      : undefined,
    paymentAttempt: preservePayment ? state.paymentAttempt : undefined,
    selectedPaymentMethod: preservePayment
      ? state.selectedPaymentMethod
      : undefined,
    paymentMethodEvidence: preservePayment
      ? state.paymentMethodEvidence
      : undefined,
    invoiceRequest: preserveInvoice ? state.invoiceRequest : undefined,
    handoff: preserveHandoff ? state.handoff : undefined,
    toolTrace: options.preserveToolTrace ? state.toolTrace : [],
  };
}
