import type { ConversationTurnMetadata } from '../domain/types.js';
import type { AgentGraphState } from './state.js';

export type ContextPolicyValue = 'active' | 'relevant' | 'resume' | 'confirm_before_use' | 'irrelevant' | 'background_only' | 'operator_only';

export interface ContextPolicyDirective {
  cart?: ContextPolicyValue | boolean | undefined;
  order?: ContextPolicyValue | boolean | undefined;
  fulfillment?: ContextPolicyValue | boolean | undefined;
  promotion?: ContextPolicyValue | boolean | undefined;
  menuSearchResults?: ContextPolicyValue | boolean | undefined;
  payment?: ContextPolicyValue | boolean | undefined;
  invoice?: ContextPolicyValue | boolean | undefined;
  handoff?: ContextPolicyValue | boolean | undefined;
  recentTurns?: ContextPolicyValue | boolean | undefined;
  customer?: ContextPolicyValue | boolean | undefined;
  membership?: ContextPolicyValue | boolean | undefined;
  recentOrder?: ContextPolicyValue | boolean | undefined;
}

export interface ContextPolicyOptions {
  metadata?: ConversationTurnMetadata | null | undefined;
  policy?: ContextPolicyDirective | undefined;
  preserveCartOrderPaymentContext?: boolean | undefined;
  preserveMenuSearchResults?: boolean | undefined;
  preservePaymentContext?: boolean | undefined;
  preserveHandoff?: boolean | undefined;
  preserveRecentTurns?: boolean | undefined;
  preserveToolTrace?: boolean | undefined;
  defaultBehavior?: 'suppress' | 'preserve' | undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function contextPolicyFromMetadata(metadata: ConversationTurnMetadata | null | undefined): ContextPolicyDirective {
  const rawEvent = metadata?.rawEvent;
  if (!isRecord(rawEvent) || !isRecord(rawEvent["contextPolicy"])) return {};
  return rawEvent["contextPolicy"];
}

function allowsCustomerContext(value: ContextPolicyValue | boolean | undefined): boolean {
  return value === true || value === 'active' || value === 'relevant' || value === 'resume' || value === 'confirm_before_use';
}

export function contextPolicyIsActive(policy: ContextPolicyDirective, key: keyof ContextPolicyDirective): boolean {
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
  for (const [rawKey, nextValue] of Object.entries(next) as Array<[keyof ContextPolicyDirective, ContextPolicyDirective[keyof ContextPolicyDirective]]>) {
    if (nextValue === undefined) continue;
    const baseValue = base[rawKey];
    if (baseValue === 'operator_only') continue;
    if (baseValue === 'confirm_before_use') continue;
    if (allowsCustomerContext(baseValue) && (nextValue === false || nextValue === 'irrelevant' || nextValue === 'background_only')) {
      continue;
    }
    merged[rawKey] = nextValue;
  }
  return merged;
}

export function buildContextPolicyState(state: AgentGraphState, options: ContextPolicyOptions = {}): AgentGraphState {
  const policy = mergeContextPolicies(contextPolicyFromMetadata(options.metadata), options.policy);
  const preserveByDefault = options.defaultBehavior === 'preserve';
  const preserveCartOrderPayment =
    preserveByDefault ||
    options.preserveCartOrderPaymentContext === true ||
    allowsCustomerContext(policy.cart) ||
    allowsCustomerContext(policy.order);
  const preservePayment = preserveCartOrderPayment || options.preservePaymentContext === true || allowsCustomerContext(policy.payment);
  const preserveMenuSearchResults =
    preserveByDefault || options.preserveMenuSearchResults === true || allowsCustomerContext(policy.menuSearchResults);
  const preserveHandoff = preserveByDefault || options.preserveHandoff === true || allowsCustomerContext(policy.handoff);
  const preservePromotion = preserveCartOrderPayment || allowsCustomerContext(policy.promotion);
  const preserveFulfillment = preserveCartOrderPayment || allowsCustomerContext(policy.fulfillment);
  const preserveInvoice = preserveCartOrderPayment || allowsCustomerContext(policy.invoice);
  const preserveRecentTurns = preserveByDefault || options.preserveRecentTurns === true || allowsCustomerContext(policy.recentTurns);
  const preserveCustomerContext =
    preserveByDefault ||
    preserveCartOrderPayment ||
    allowsCustomerContext(policy.customer) ||
    allowsCustomerContext(policy.membership) ||
    allowsCustomerContext(policy.recentOrder);

  return {
    ...state,
    recentTurns: preserveRecentTurns ? state.recentTurns : [],
    cart: preserveCartOrderPayment ? state.cart : undefined,
    address: preserveCartOrderPayment ? state.address : undefined,
    orderPreview: preserveCartOrderPayment ? state.orderPreview : undefined,
    order: preserveCartOrderPayment ? state.order : undefined,
    selectedModifiers: preserveCartOrderPayment ? state.selectedModifiers : undefined,
    fulfillment: preserveFulfillment ? state.fulfillment : undefined,
    promotionContext: preservePromotion ? state.promotionContext : undefined,
    menuSearchResults: preserveMenuSearchResults ? state.menuSearchResults : undefined,
    menuModifierOptions: preserveCartOrderPayment ? state.menuModifierOptions : undefined,
    customerContext: preserveCustomerContext ? state.customerContext : undefined,
    paymentAttempt: preservePayment ? state.paymentAttempt : undefined,
    paymentMethodEvidence: preservePayment ? state.paymentMethodEvidence : undefined,
    invoiceRequest: preserveInvoice ? state.invoiceRequest : undefined,
    handoff: preserveHandoff ? state.handoff : undefined,
    toolTrace: options.preserveToolTrace ? state.toolTrace : [],
  };
}
