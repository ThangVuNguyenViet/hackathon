import { createHash } from 'node:crypto';
import type { AgentState } from '../agent/agentState.js';
import { digestCommerceAction } from '../ordering/commerceDigest.js';
import { activePaymentMethodCollectionAuthority } from '../ordering/paymentMethodAuthority.js';

export const KFC_GENUI_SCHEMA_VERSION = 'kfc-genui-v1' as const;

export const KFC_GENUI_WIDGET_KINDS = [
  'smartMenuPicker',
  'productDetailCard',
  'modifierPicker',
  'promotionGallery',
  'allergenEvidence',
  'cartBuilder',
  'addressFulfillmentCheck',
  'orderReviewConfirm',
  'paymentOrderStatus',
  'orderTrackingStatus',
  'supportHandoff',
  'paymentMethodPicker',
  'recommendationOffer',
] as const;

export type KfcGenUiWidgetKind = (typeof KFC_GENUI_WIDGET_KINDS)[number];

export type KfcGenUiStatus = 'active' | 'answered' | 'expired' | 'blocked';

export type KfcGenUiActionIntent =
  'primary' | 'secondary' | 'destructive' | 'recovery';

export interface KfcGenUiActionSpec {
  id: string;
  label: string;
  intent?: KfcGenUiActionIntent;
  value?: string;
  payload?: Record<string, unknown>;
  destructive?: boolean;
}

export interface KfcGenUiAuthority {
  schemaVersion: typeof KFC_GENUI_SCHEMA_VERSION;
  sessionId: string;
  customerId: string;
  verifiedRevision: string;
  actionLifecycle: 'one_shot' | 'replayable';
  issuedAt: string;
  expiresAt: string;
}

export interface KfcGenUiAttachment {
  id: string;
  lifecycleStage: string;
  widgetKind: KfcGenUiWidgetKind;
  status: KfcGenUiStatus;
  title: string;
  summary?: string;
  data: Record<string, unknown>;
  actions: KfcGenUiActionSpec[];
  selectedAction?: string;
  expiresAt?: string;
  /** Required on server-produced actionable attachments; optional only for legacy read fixtures. */
  authority?: KfcGenUiAuthority;
}

export interface KfcGenUiAction {
  attachmentId: string;
  actionId: string;
  value?: string;
  payload?: Record<string, unknown>;
}

export function isKfcGenUiWidgetKind(
  value: unknown,
): value is KfcGenUiWidgetKind {
  return (
    typeof value === 'string' &&
    KFC_GENUI_WIDGET_KINDS.includes(value as KfcGenUiWidgetKind)
  );
}

export function isKfcGenUiAttachment(
  value: unknown,
): value is KfcGenUiAttachment {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  const authority = record.authority;
  const authorityValid =
    authority === undefined ||
    (typeof authority === 'object' &&
      authority !== null &&
      (authority as Record<string, unknown>).schemaVersion ===
        KFC_GENUI_SCHEMA_VERSION &&
      typeof (authority as Record<string, unknown>).sessionId === 'string' &&
      typeof (authority as Record<string, unknown>).customerId === 'string' &&
      typeof (authority as Record<string, unknown>).verifiedRevision ===
        'string' &&
      ((authority as Record<string, unknown>).actionLifecycle === 'one_shot' ||
        (authority as Record<string, unknown>).actionLifecycle ===
          'replayable') &&
      typeof (authority as Record<string, unknown>).issuedAt === 'string' &&
      typeof (authority as Record<string, unknown>).expiresAt === 'string');
  return (
    typeof record.id === 'string' &&
    typeof record.lifecycleStage === 'string' &&
    isKfcGenUiWidgetKind(record.widgetKind) &&
    typeof record.status === 'string' &&
    typeof record.title === 'string' &&
    typeof record.data === 'object' &&
    record.data !== null &&
    Array.isArray(record.actions) &&
    authorityValid
  );
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/**
 * Revision of every persisted fact that can authorize or populate an
 * interactive commerce widget. Conversational prose and tool traces are
 * excluded so a semantically unchanged reply does not invalidate an action.
 */
export function kfcGenUiVerifiedStateRevision(
  state: Partial<AgentState>,
): string {
  const relevantState = {
    cart: state.cart ?? null,
    address: state.address ?? null,
    addressDraft: state.addressDraft ?? null,
    orderPreview: state.orderPreview ?? null,
    order: state.order ?? null,
    selectedModifiers: state.selectedModifiers ?? null,
    fulfillment: state.fulfillment ?? null,
    promotionContext: state.promotionContext ?? null,
    promotionOffers: state.promotionOffers ?? null,
    contentEvidence: state.contentEvidence ?? null,
    menuSearchResults: state.menuSearchResults ?? null,
    activeMenuCollection: state.activeMenuCollection ?? null,
    activeCollectionKeys: state.activeCollectionKeys ?? null,
    menuModifierOptions: state.menuModifierOptions ?? null,
    customerContext: state.customerContext ?? null,
    paymentAttempt: state.paymentAttempt ?? null,
    activePaymentMethodCollection:
      activePaymentMethodCollectionAuthority(state) ?? null,
    selectedPaymentMethod: state.selectedPaymentMethod ?? null,
    paymentMethodEvidence: state.paymentMethodEvidence ?? null,
    invoiceRequest: state.invoiceRequest ?? null,
    handoff: state.handoff ?? null,
  };
  return createHash('sha256')
    .update(canonicalJson(relevantState))
    .digest('hex');
}

export async function digestTrustedKfcGenUiAction(input: {
  attachment: KfcGenUiAttachment;
  assistantTurnId: string;
  action: KfcGenUiAction;
}): Promise<string> {
  return digestCommerceAction({
    schemaVersion: input.attachment.authority?.schemaVersion ?? null,
    attachmentId: input.attachment.id,
    assistantTurnId: input.assistantTurnId,
    sessionId: input.attachment.authority?.sessionId ?? null,
    customerId: input.attachment.authority?.customerId ?? null,
    verifiedRevision: input.attachment.authority?.verifiedRevision ?? null,
    widgetKind: input.attachment.widgetKind,
    action: input.action,
  });
}

/**
 * The delivered GenUI may render an authenticated address, but conversation
 * metadata is an audit/replay surface rather than private-data storage. Keep
 * safe action authority while removing every raw address from the persisted
 * attachment. This remains fail-closed after a saved address becomes accepted
 * verified state and its turn-local provenance is no longer available.
 */
export function kfcGenUiAttachmentForPersistence(
  attachment: KfcGenUiAttachment,
  privacy: {
    currentTurnPrivateOrder?: boolean;
  } = {},
): KfcGenUiAttachment {
  const redactsAddress = attachment.widgetKind === 'addressFulfillmentCheck';
  const redactsCurrentTurnOrder =
    privacy.currentTurnPrivateOrder === true &&
    (attachment.widgetKind === 'paymentOrderStatus' ||
      attachment.widgetKind === 'orderTrackingStatus');
  if (!redactsAddress && !redactsCurrentTurnOrder) {
    return structuredClone(attachment);
  }
  const data = { ...attachment.data };
  if (redactsAddress) {
    delete data.address;
    const fulfillment = data.fulfillment;
    if (
      typeof fulfillment === 'object' &&
      fulfillment !== null &&
      !Array.isArray(fulfillment)
    ) {
      const persistedFulfillment = {
        ...fulfillment,
      } as Record<string, unknown>;
      delete persistedFulfillment.resolvedAddress;
      data.fulfillment = persistedFulfillment;
    }
  }
  if (redactsCurrentTurnOrder) delete data.order;
  return {
    ...structuredClone(attachment),
    data,
  };
}
