import type { Channel } from '../domain/types.js';
import type { KfcGenUiAttachment, KfcGenUiWidgetKind } from '../genui/kfcGenUi.js';

export type ChannelPresentationMode = 'structured_companion' | 'standalone_text';

export interface ChannelCapabilities {
  presentationMode: ChannelPresentationMode;
  supportsGenUi: boolean;
  supportsCatalogMedia: boolean;
  requiresStandaloneText: boolean;
}

export interface ChannelPresentationPlan {
  text: string;
  genUi?: KfcGenUiAttachment;
}

export interface BuildChannelPresentationInput {
  channel: Channel;
  graphResponseText: string;
  genUi?: KfcGenUiAttachment;
}

const structuredCompanionCapabilities: ChannelCapabilities = {
  presentationMode: 'structured_companion',
  supportsGenUi: true,
  supportsCatalogMedia: false,
  requiresStandaloneText: false,
};

const standaloneTextCapabilities: ChannelCapabilities = {
  presentationMode: 'standalone_text',
  supportsGenUi: false,
  supportsCatalogMedia: false,
  requiresStandaloneText: true,
};

export function getChannelCapabilities(channel: Channel): ChannelCapabilities {
  switch (channel) {
    case 'kfc':
      return structuredCompanionCapabilities;
    case 'messenger':
    case 'zalo':
    case 'messenger_mock':
    case 'zalo_mock':
      return standaloneTextCapabilities;
    default:
      return assertNever(channel);
  }
}

export function textOnlyPresentation(text: string): ChannelPresentationPlan {
  return { text };
}

export function buildChannelPresentation(input: BuildChannelPresentationInput): ChannelPresentationPlan {
  const capabilities = getChannelCapabilities(input.channel);
  if (!input.genUi) return textOnlyPresentation(input.graphResponseText);

  if (capabilities.presentationMode === 'structured_companion') {
    return {
      text: input.graphResponseText,
      ...(capabilities.supportsGenUi ? { genUi: input.genUi } : {}),
    };
  }

  return {
    text: renderStandaloneAttachment(input.genUi, input.graphResponseText),
  };
}

function renderStandaloneAttachment(attachment: KfcGenUiAttachment, graphResponseText: string): string {
  const facts = renderVerifiedFacts(attachment.widgetKind, attachment.data);
  const fallback = nonEmptyString(attachment.summary) ?? graphResponseText;
  const base = facts ?? fallback;
  const actions = actionLabels(attachment);

  if (attachment.widgetKind === 'smartMenuPicker' && facts) {
    return `${facts}\nBạn muốn chọn món nào?`;
  }
  return actions.length > 0 ? `${base}\nBước tiếp theo: ${actions.join(' · ')}` : base;
}

function renderVerifiedFacts(kind: KfcGenUiWidgetKind, data: Record<string, unknown>): string | undefined {
  switch (kind) {
    case 'smartMenuPicker':
      return renderMenu(data);
    case 'cartBuilder':
      return renderCart(record(data.cart));
    case 'addressFulfillmentCheck':
      return renderFulfillment(data);
    case 'orderReviewConfirm':
      return renderOrderReview(data);
    case 'paymentOrderStatus':
      return renderOrderStatus(data);
    case 'orderTrackingStatus':
      return renderTrackingStatus(data);
    case 'supportHandoff':
      return renderSupport(data);
    case 'paymentMethodPicker':
      return renderPaymentMethods(data);
    default:
      return assertNever(kind);
  }
}

function renderMenu(data: Record<string, unknown>): string | undefined {
  const lines = records(data.items)
    .slice(0, 5)
    .map((item) => {
      const name = nonEmptyString(item.name);
      if (!name) return undefined;
      const price = moneyVnd(item.priceVnd);
      return price ? `- ${name}: ${price}` : `- ${name}`;
    })
    .filter((line): line is string => Boolean(line));
  return lines.length > 0 ? lines.join('\n') : undefined;
}

function renderCart(cart: Record<string, unknown> | undefined): string | undefined {
  if (!cart) return undefined;
  const lines = records(cart.items)
    .map((item) => {
      const name = nonEmptyString(item.name);
      if (!name) return undefined;
      const quantity = finiteNumber(item.quantity);
      return quantity !== undefined ? `- ${quantity} x ${name}` : `- ${name}`;
    })
    .filter((line): line is string => Boolean(line));
  const total = moneyVnd(cart.totalVnd);
  if (total) lines.push(`Tổng: ${total}`);
  return lines.length > 0 ? lines.join('\n') : undefined;
}

function renderFulfillment(data: Record<string, unknown>): string | undefined {
  const address = record(data.address);
  const fulfillment = record(data.fulfillment);
  const lines: string[] = [];
  if (address) {
    const addressText = [address.line1, address.district, address.city]
      .map(nonEmptyString)
      .filter((value): value is string => Boolean(value))
      .join(', ');
    if (addressText) lines.push(`Địa chỉ: ${addressText}`);
  }
  const storeName = nonEmptyString(fulfillment?.storeName);
  if (storeName) lines.push(`Cửa hàng: ${storeName}`);
  const fee = moneyVnd(fulfillment?.feeVnd);
  if (fee) lines.push(`Phí giao hàng: ${fee}`);
  const eta = finiteNumber(fulfillment?.etaMinutes);
  if (eta !== undefined) lines.push(`Thời gian dự kiến: ${eta} phút`);
  return lines.length > 0 ? lines.join('\n') : undefined;
}

function renderOrderReview(data: Record<string, unknown>): string | undefined {
  const invoice = record(data.invoiceRequest);
  const invoiceValues = invoice
    ? [invoice.companyName, invoice.taxCode, invoice.email]
        .map(nonEmptyString)
        .filter((value): value is string => Boolean(value))
    : [];
  const invoiceSummary = invoiceValues.length > 0
    ? `Thông tin hóa đơn: ${invoiceValues.join(' · ')}`
    : data.invoiceRequested === true
      ? 'Bạn vui lòng cung cấp thông tin hóa đơn.'
      : undefined;
  const sections = [
    renderCart(record(data.cart)),
    renderFulfillment({ fulfillment: data.fulfillment }),
    invoiceSummary,
  ]
    .filter((value): value is string => Boolean(value));
  return sections.length > 0 ? sections.join('\n') : undefined;
}

function renderOrderStatus(data: Record<string, unknown>): string | undefined {
  const order = record(data.order);
  const paymentAttempt = record(data.paymentAttempt);
  const paymentStatusEvidence = record(data.paymentStatusEvidence);
  const evidenceStatuses = record(paymentStatusEvidence?.statuses);
  const lines: string[] = [];
  pushLabel(lines, 'Mã đơn', order?.id);
  pushLabel(lines, 'Trạng thái đơn', order?.status);
  if (paymentStatusEvidence?.resolution === 'conflict') {
    pushLabel(lines, 'Trạng thái thanh toán (đơn hàng)', evidenceStatuses?.order);
    pushLabel(lines, 'Trạng thái thanh toán (lần thanh toán)', evidenceStatuses?.paymentAttempt);
  } else {
    const selectedStatus = nonEmptyString(paymentStatusEvidence?.selectedStatus);
    const orderPaymentStatus = nonEmptyString(order?.paymentStatus);
    const paymentAttemptStatus = nonEmptyString(paymentAttempt?.status);
    if (!selectedStatus && orderPaymentStatus && paymentAttemptStatus && orderPaymentStatus !== paymentAttemptStatus) {
      pushLabel(lines, 'Trạng thái thanh toán (đơn hàng)', orderPaymentStatus);
      pushLabel(lines, 'Trạng thái thanh toán (lần thanh toán)', paymentAttemptStatus);
    } else {
      pushLabel(lines, 'Trạng thái thanh toán', selectedStatus ?? paymentAttemptStatus ?? orderPaymentStatus);
    }
  }
  pushLabel(lines, 'Phương thức thanh toán', paymentAttempt?.method);
  pushLabel(lines, 'Liên kết thanh toán', paymentAttempt?.paymentUrl);
  return lines.length > 0 ? lines.join('\n') : undefined;
}

function renderTrackingStatus(data: Record<string, unknown>): string | undefined {
  const order = record(data.order);
  const progress: string[] = [];
  pushLabel(progress, 'Trạng thái POS', order?.posStatus);
  pushLabel(progress, 'Kết quả thương mại', order?.commerceOutcome);
  pushLabel(progress, 'Trạng thái khách hàng', order?.commerceCustomerStatus);
  const sections = [
    renderOrderStatus(data),
    progress.length > 0 ? progress.join('\n') : undefined,
    renderFulfillment({ fulfillment: data.fulfillment }),
  ]
    .filter((value): value is string => Boolean(value));
  return sections.length > 0 ? sections.join('\n') : undefined;
}

function renderSupport(data: Record<string, unknown>): string | undefined {
  const handoff = record(data.handoff);
  const lines: string[] = [];
  pushLabel(lines, 'Mã hỗ trợ', handoff?.escalationId);
  const reasons = stringValues(handoff?.reasons ?? data.reasons);
  if (reasons.length > 0) lines.push(`Lý do: ${reasons.join(', ')}`);
  pushLabel(lines, 'Trạng thái hỗ trợ', data.handoffStatus);
  return lines.length > 0 ? lines.join('\n') : undefined;
}

function renderPaymentMethods(data: Record<string, unknown>): string | undefined {
  const supported: string[] = [];
  const unavailable: string[] = [];
  const unverified: string[] = [];

  for (const method of records(data.methods)) {
    const name = nonEmptyString(method.displayName) ?? nonEmptyString(method.methodId);
    if (!name) continue;
    if (method.supported === true) {
      supported.push(`- ${name}`);
      continue;
    }
    const supportStatus = nonEmptyString(method.supportStatus);
    if (method.supported === false && supportStatus) {
      unavailable.push(`- ${name} (${supportStatus})`);
      continue;
    }
    unverified.push(`- ${name}`);
  }

  const sections = [
    supported.length > 0 ? `Có thể chọn:\n${supported.join('\n')}` : undefined,
    unavailable.length > 0 ? `Không khả dụng:\n${unavailable.join('\n')}` : undefined,
    unverified.length > 0 ? `Chưa xác minh hỗ trợ:\n${unverified.join('\n')}` : undefined,
  ].filter((value): value is string => Boolean(value));
  return sections.length > 0 ? `Phương thức thanh toán:\n${sections.join('\n')}` : undefined;
}

function actionLabels(attachment: KfcGenUiAttachment): string[] {
  return attachment.actions
    .map((action) => nonEmptyString(action.label))
    .filter((label): label is string => Boolean(label));
}

function pushLabel(lines: string[], label: string, value: unknown): void {
  const text = nonEmptyString(value);
  if (text) lines.push(`${label}: ${text}`);
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function records(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.map(record).filter((item): item is Record<string, unknown> => Boolean(item))
    : [];
}

function stringValues(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map(nonEmptyString).filter((item): item is string => Boolean(item))
    : [];
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function moneyVnd(value: unknown): string | undefined {
  const amount = finiteNumber(value);
  return amount === undefined ? undefined : `${new Intl.NumberFormat('vi-VN').format(amount)}đ`;
}

function assertNever(value: never): never {
  throw new Error(`Unhandled channel presentation variant: ${String(value)}`);
}
