import type { Channel } from '../domain/types.js';
import type { KfcGenUiAttachment } from '../genui/kfcGenUi.js';
import type { AgentGraphState } from '../graph/state.js';
import { responseProfileForChannel, type ResponseProfile } from './responseProfile.js';
import {
  customerCommerceOutcome,
  customerHandoffStatus,
  customerOrderStatus,
  customerPaymentMethod,
  customerPaymentStatus,
  customerPaymentSupportStatus,
  customerProgressStatus,
  customerRestaurantStatus,
  customerSupportReason,
} from './customerLanguage.js';

export type ChannelPresentationMode = 'structured_companion' | 'standalone_text';

export interface ChannelCapabilities {
  presentationMode: ChannelPresentationMode;
  supportsGenUi: boolean;
  supportsCatalogMedia: boolean;
  requiresStandaloneText: boolean;
}
export type ChannelPresentationPlan =
  | {
      profile: 'genui';
      text: string;
      genUi?: KfcGenUiAttachment;
      media?: never;
    }
  | {
      profile: 'social';
      text: string;
      media?: ChannelPresentationMedia[];
      genUi?: never;
    };

export interface ChannelPresentationMedia {
  key: string;
  imageUrl: string;
  title: string;
}

export interface BuildChannelPresentationInput {
  channel: Channel;
  graphResponseText: string;
  genUi?: KfcGenUiAttachment;
}

export interface BuildSocialPresentationInput {
  channel: Exclude<Channel, 'kfc'>;
  standaloneText: string;
  state: AgentGraphState;
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

const standaloneMediaCapabilities: ChannelCapabilities = {
  ...standaloneTextCapabilities,
  supportsCatalogMedia: true,
};

export function getChannelCapabilities(channel: Channel): ChannelCapabilities {
  switch (channel) {
    case 'kfc':
      return structuredCompanionCapabilities;
    case 'messenger':
    case 'zalo':
      return standaloneMediaCapabilities;
    case 'messenger_mock':
    case 'zalo_mock':
      return standaloneTextCapabilities;
    default:
      return assertNever(channel);
  }
}

export function textOnlyPresentation(text: string, channel: Channel = 'messenger'): ChannelPresentationPlan {
  const profile = responseProfileForChannel(channel);
  return profile === 'genui' ? { profile, text } : { profile, text };
}

export function buildChannelPresentation(input: BuildChannelPresentationInput): ChannelPresentationPlan {
  const profile = responseProfileForChannel(input.channel);
  if (profile === 'social') {
    if (input.genUi) {
      throw new Error('Social presentation cannot consume a GenUI attachment');
    }
    return { profile, text: input.graphResponseText };
  }
  return {
    profile,
    text: input.graphResponseText,
    ...(input.genUi ? { genUi: input.genUi } : {}),
  };
}

export function buildSocialPresentation(input: BuildSocialPresentationInput): ChannelPresentationPlan {
  if (responseProfileForChannel(input.channel) !== 'social') {
    throw new Error('Social presenter received a non-social channel');
  }
  const media = getChannelCapabilities(input.channel).supportsCatalogMedia
    ? renderTrustedMediaFromState(input.state)
    : [];
  return {
    profile: 'social',
    text: input.standaloneText,
    ...(media.length > 0 ? { media } : {}),
  };
}

export function assertPresentationMatchesChannel(
  channel: Channel,
  presentation: ChannelPresentationPlan,
  expectedProfile: ResponseProfile = responseProfileForChannel(channel),
): void {
  if (presentation.profile !== expectedProfile) {
    throw new Error(`Presentation profile mismatch: expected ${expectedProfile}, got ${presentation.profile}`);
  }
  if (presentation.profile === 'social' && 'genUi' in presentation && presentation.genUi !== undefined) {
    throw new Error('Social presentation contains forbidden GenUI metadata');
  }
  if (presentation.profile === 'genui' && 'media' in presentation && presentation.media !== undefined) {
    throw new Error('GenUI presentation contains forbidden social media delivery data');
  }
}

export function buildStandaloneSocialFallback(
  state: AgentGraphState,
  fallbackText: string,
): string {
  const currentTools = new Set((state.toolTrace ?? []).filter((entry) => entry.ok).map((entry) => entry.toolName));
  const withFollowUp = (facts: string | undefined, followUp: string): string | undefined =>
    facts ? `${facts}\n${followUp}` : undefined;

  if (state.handoff || currentTools.has('handoff')) {
    return withFollowUp(
      renderSupport({ handoff: state.handoff, reasons: state.escalationReasons, handoffStatus: state.handoff ? 'queued' : undefined }),
      'Bạn có muốn gửi thêm mô tả để nhân viên hỗ trợ không?',
    ) ?? fallbackText;
  }
  if (currentTools.has('listPaymentMethods') && state.paymentMethodEvidence?.length) {
    return withFollowUp(renderPaymentMethods({ methods: state.paymentMethodEvidence }), 'Bạn muốn chọn phương thức thanh toán nào?') ?? fallbackText;
  }
  if (state.paymentAttempt || currentTools.has('createPaymentLink') || currentTools.has('checkPaymentStatus')) {
    return withFollowUp(
      renderOrderStatus({ order: state.order, paymentAttempt: state.paymentAttempt }),
      'Bạn muốn tiếp tục thanh toán hay đổi phương thức thanh toán?',
    ) ?? fallbackText;
  }
  if (state.order || currentTools.has('getOrderStatus')) {
    return withFollowUp(
      renderTrackingStatus({ order: state.order, fulfillment: state.fulfillment }),
      'Bạn có muốn mình kiểm tra cập nhật mới nhất của đơn không?',
    ) ?? fallbackText;
  }
  if (state.orderPreview || currentTools.has('previewOrder')) {
    return withFollowUp(
      renderOrderReview({ cart: state.orderPreview?.cart ?? state.cart, fulfillment: state.fulfillment, invoiceRequest: state.invoiceRequest }),
      'Nếu thông tin đã đúng, bạn xác nhận đặt đơn nhé.',
    ) ?? fallbackText;
  }
  if (state.invoiceRequest || currentTools.has('collectInvoice')) {
    return withFollowUp(
      renderOrderReview({ cart: state.cart, fulfillment: state.fulfillment, invoiceRequest: state.invoiceRequest }),
      'Mình đã ghi nhận thông tin hóa đơn. Bạn muốn tiếp tục bước nào?',
    ) ?? fallbackText;
  }
  if (record(state.entities)?.invoiceRequested === true) {
    return withFollowUp(
      renderOrderReview({ cart: state.cart, fulfillment: state.fulfillment, invoiceRequested: true }),
      'Mình đã ghi nhận nhu cầu xuất hóa đơn. Bạn gửi giúp mình tên công ty, mã số thuế và email nhận hóa đơn nhé.',
    ) ?? fallbackText;
  }
  const entities = record(state.entities);
  if (
    (state.addressDraft && (!state.addressDraft.line1 || !state.addressDraft.district || !state.addressDraft.city)) ||
    (entities?.preferFulfillmentSurface === true && entities.asksClarification === true)
  ) {
    return 'Bạn gửi giúp mình địa chỉ giao hàng đầy đủ, gồm quận/huyện và tỉnh/thành phố nhé.';
  }
  if (state.menuModifierOptions || currentTools.has('getModifierOptions')) {
    return withFollowUp(renderModifiers({ modifierTree: state.menuModifierOptions }), 'Bạn muốn đổi phần nào sang lựa chọn nào?') ?? fallbackText;
  }
  if (
    [...currentTools].every((toolName) => ['searchMenu', 'recommendAddOns'].includes(toolName)) &&
    record(state.entities)?.keepMenuSurface === true &&
    record(state.entities)?.asksClarification === true &&
    state.plannerMenuCatalogContext?.candidates.length
  ) {
    return withFollowUp(renderPlanningMenu(state.plannerMenuCatalogContext), 'Bạn muốn chọn món nào?') ?? fallbackText;
  }
  if ((currentTools.has('searchMenu') || currentTools.has('recommendAddOns')) && !currentTools.has('updateCart')) {
    return withFollowUp(renderMenu({ items: state.menuSearchResults }), 'Bạn muốn chọn món nào?') ?? fallbackText;
  }
  if (state.fulfillment || state.address || currentTools.has('quoteFulfillment')) {
    return withFollowUp(
      renderFulfillment({ address: state.address, fulfillment: state.fulfillment }),
      state.address ? 'Bạn muốn dùng địa chỉ này hay nhập địa chỉ khác?' : 'Bạn gửi giúp mình địa chỉ giao hàng đầy đủ nhé.',
    ) ?? fallbackText;
  }
  if (state.cart || currentTools.has('updateCart') || currentTools.has('previewCart')) {
    return withFollowUp(
      renderCart(record(state.cart)),
      'Bạn gửi giúp mình địa chỉ giao hàng đầy đủ để mình kiểm tra phí ship và thời gian giao nhé.',
    ) ?? fallbackText;
  }
  if (state.menuItemDetail || currentTools.has('getItemDetails')) {
    return withFollowUp(renderProductDetail({ item: state.menuItemDetail }), 'Bạn có muốn thêm món này vào giỏ không?') ?? fallbackText;
  }
  if (state.promotionOffers?.length || currentTools.has('searchPromotions') || currentTools.has('explainPromotion')) {
    return withFollowUp(renderPromotions({ offers: state.promotionOffers }), 'Bạn muốn chọn ưu đãi nào?') ?? fallbackText;
  }
  if (state.contentEvidence?.length) {
    return withFollowUp(renderAllergenEvidence({ evidence: state.contentEvidence[0] }), 'Bạn muốn mình kiểm tra thêm thông tin dị ứng nào?') ?? fallbackText;
  }
  if (state.menuSearchResults?.length || currentTools.has('searchMenu') || currentTools.has('recommendAddOns')) {
    return withFollowUp(renderMenu({ items: state.menuSearchResults }), 'Bạn muốn chọn món nào?') ?? fallbackText;
  }
  return fallbackText;
}

function renderTrustedMediaFromState(state: AgentGraphState): ChannelPresentationMedia[] {
  const candidates = [
    ...(state.menuItemDetail ? [state.menuItemDetail] : []),
    ...(state.menuSearchResults ?? []),
    ...(state.promotionOffers ?? []),
  ].map((item) => record(item)).filter((item): item is Record<string, unknown> => Boolean(item));
  return candidates.flatMap((item, index) => {
    const imageUrl = trustedKfcImageUrl(item.imageUrl);
    const title = nonEmptyString(item.name) ?? nonEmptyString(item.offerName) ?? nonEmptyString(item.title) ?? nonEmptyString(item.campaign);
    if (!imageUrl || !title) return [];
    const entityId = nonEmptyString(item.code) ?? nonEmptyString(item.itemCode) ?? nonEmptyString(item.offerId) ?? nonEmptyString(item.id) ?? 'item';
    return [{ key: `social:${entityId}:${index}`, imageUrl, title }];
  });
}

function trustedKfcImageUrl(value: unknown): string | undefined {
  const text = nonEmptyString(value);
  if (!text) return undefined;
  try {
    const url = new URL(text);
    return url.protocol === 'https:' && url.hostname === 'static.kfcvietnam.com.vn' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function renderProductDetail(data: Record<string, unknown>): string | undefined {
  const item = record(data.item);
  if (!item) return undefined;
  const name = nonEmptyString(item.name);
  if (!name) return undefined;
  const price = moneyVnd(item.priceVnd);
  return price ? `${name}: ${price}` : name;
}

function renderModifiers(data: Record<string, unknown>): string | undefined {
  const tree = record(data.modifierTree);
  const options = records(tree?.modifierGroups).flatMap((group) => records(group.options));
  const lines = options.map((option) => nonEmptyString(option.name)).filter((name): name is string => Boolean(name));
  return lines.length > 0 ? `Tùy chọn:\n${lines.map((name) => `- ${name}`).join('\n')}` : undefined;
}

function renderPromotions(data: Record<string, unknown>): string | undefined {
  const offers = records(data.offers).slice(0, 5);
  const lines = offers
    .map((offer) => nonEmptyString(offer.offerName) ?? nonEmptyString(offer.campaign))
    .filter((name): name is string => Boolean(name));
  return lines.length > 0 ? lines.map((name) => `- ${name}`).join('\n') : undefined;
}

function renderAllergenEvidence(data: Record<string, unknown>): string | undefined {
  const evidence = record(data.evidence);
  return nonEmptyString(evidence?.snippet) ?? nonEmptyString(evidence?.title);
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

function renderPlanningMenu(data: unknown): string | undefined {
  const lines = records(record(data)?.candidates)
    .slice(0, 5)
    .map((item) => {
      const name = nonEmptyString(item.name);
      if (!name) return undefined;
      const price = moneyVnd(item.priceVnd);
      const modifiers = [...new Set(
        records(item.modifierGroups)
          .flatMap((group) => records(group.options))
          .map((option) => nonEmptyString(option.name))
          .filter((option): option is string => Boolean(option)),
      )];
      return `- ${name}${price ? `: ${price}` : ''}${modifiers.length ? ` (tùy chọn: ${modifiers.join(', ')})` : ''}`;
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
  pushLabel(lines, 'Trạng thái đơn', customerOrderStatus(order?.status));
  if (paymentStatusEvidence?.resolution === 'conflict') {
    pushLabel(lines, 'Trạng thái thanh toán (đơn hàng)', customerPaymentStatus(evidenceStatuses?.order));
    pushLabel(lines, 'Trạng thái thanh toán (lần thanh toán)', customerPaymentStatus(evidenceStatuses?.paymentAttempt));
  } else {
    const selectedStatus = nonEmptyString(paymentStatusEvidence?.selectedStatus);
    const orderPaymentStatus = nonEmptyString(order?.paymentStatus);
    const paymentAttemptStatus = nonEmptyString(paymentAttempt?.status);
    if (!selectedStatus && orderPaymentStatus && paymentAttemptStatus && orderPaymentStatus !== paymentAttemptStatus) {
      pushLabel(lines, 'Trạng thái thanh toán (đơn hàng)', customerPaymentStatus(orderPaymentStatus));
      pushLabel(lines, 'Trạng thái thanh toán (lần thanh toán)', customerPaymentStatus(paymentAttemptStatus));
    } else {
      pushLabel(lines, 'Trạng thái thanh toán', customerPaymentStatus(selectedStatus ?? paymentAttemptStatus ?? orderPaymentStatus));
    }
  }
  pushLabel(lines, 'Phương thức thanh toán', customerPaymentMethod(paymentAttempt?.method));
  pushLabel(lines, 'Liên kết thanh toán', paymentAttempt?.paymentUrl);
  return lines.length > 0 ? lines.join('\n') : undefined;
}

function renderTrackingStatus(data: Record<string, unknown>): string | undefined {
  const order = record(data.order);
  const progress: string[] = [];
  pushLabel(progress, 'Tiến trình tại nhà hàng', customerRestaurantStatus(order?.posStatus));
  pushLabel(progress, 'Kết quả xử lý đơn', customerCommerceOutcome(order?.commerceOutcome));
  pushLabel(progress, 'Tiến trình đơn hàng', customerProgressStatus(order?.commerceCustomerStatus));
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
  const reasons = [...new Set(
    stringValues(handoff?.reasons ?? data.reasons)
      .map(customerSupportReason)
      .filter((reason): reason is string => Boolean(reason)),
  )];
  if (reasons.length > 0) lines.push(`Lý do: ${reasons.join(', ')}`);
  pushLabel(lines, 'Trạng thái hỗ trợ', customerHandoffStatus(data.handoffStatus));
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
    const supportStatus = customerPaymentSupportStatus(method.supportStatus);
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
