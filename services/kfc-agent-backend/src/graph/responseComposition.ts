import { selectKfcGenUiAttachment } from '../genui/kfcGenUiSelector.js';
import {
  validateGenUiCompanionResponse,
  validateStandaloneSocialResponse
} from '../llm/responseComposer.js';
import {
  type AgentTraceSpan
} from '../observability/agentTracing.js';
import type { ToolTraceEntry } from '../ordering/types.js';
import {
  assertPresentationMatchesChannel,
  buildChannelPresentation,
  buildSocialPresentation,
  buildStandaloneSocialFallback
} from '../presentation/channelPresentation.js';
import { responseProfileForChannel } from '../presentation/responseProfile.js';
import { partialAddressText, plannerSavedAddressDecision } from './addressContext.js';
import {
  type AgentTurnInput,
  type AgentTurnOutput,
  type ReplyIntent
} from './agentTurnState.js';
import {
  shouldPreserveCurrentCartOrderPaymentContext,
  shouldPreserveCurrentHandoff,
  shouldPreserveCurrentMenuSearchResults,
  shouldPreserveCurrentPaymentContext,
} from './commerceLifecycle.js';
import { hasSuccessfulToolResult } from './commerceExecution.js';
import {
  buildContextPolicyState,
  contextPolicyFromMetadata,
  contextPolicyIsActive,
  type ContextPolicyDirective
} from './contextPolicy.js';
import type { AgentGraphState } from './state.js';
import {
  findPaymentEvidenceForLinkMethod,
  hasPlannerBooleanEntity,
  isRecord,
  isRunStillCurrent,
  plannerPaymentMethod,
  traceStateSummary,
} from './turnSupport.js';

export const safeFallbackPriority = [
  'order_confirmation_required',
  'confirmed_address_required',
  'valid_fulfillment_required',
  'item_unavailable_before_confirmation',
  'payment_tool_success_required',
  'promotion_evidence_required',
  'allergen_certainty_not_allowed',
  'tool_execution_failed',
  'cart_initialization_failed',
  'menu_item_verification_required',
  'cart_mutation_confirmation_required',
  'previous_order_confirmation_required',
] as const;

export function paymentMethodFallbackText(state: AgentGraphState): string {
  const methods = state.paymentMethodEvidence ?? [];
  const supported = methods.filter((method) => method.supported);
  const requestedMethod = plannerPaymentMethod(state);
  const requestedEvidence = requestedMethod ? findPaymentEvidenceForLinkMethod(methods, requestedMethod) : undefined;
  const supportedNames = supported.map((method) => method.displayName).join(', ');

  if (requestedEvidence && !requestedEvidence.supported) {
    const suffix = supportedNames ? ` Các phương thức đang được liệt kê gồm: ${supportedNames}.` : '';
    return `Theo chính sách thanh toán công khai của KFC, ${requestedEvidence.displayName} không được liệt kê cho checkout website/app.${suffix}`;
  }

  if (requestedEvidence?.supported) {
    return `Theo chính sách thanh toán công khai của KFC, ${requestedEvidence.displayName} được liệt kê cho checkout website/app. Mình sẽ tạo thanh toán sau khi bạn xác nhận đơn.`;
  }

  return supportedNames
    ? `Theo chính sách thanh toán công khai của KFC, các phương thức đang được liệt kê gồm: ${supportedNames}.`
    : 'Mình chưa tìm thấy phương thức thanh toán đã được liệt kê trong dữ liệu KFC.';
}

export function orderStatusFallbackText(state: AgentGraphState): string | undefined {
  if (!state.order) return undefined;
  const status = switchOrderStatusLabel(state.order.status);
  return `Đơn ${state.order.id} hiện ${status}. Bạn có thể xem trạng thái mới nhất trong thẻ theo dõi bên dưới.`;
}

export function switchOrderStatusLabel(status: string): string {
  switch (status) {
    case 'created':
      return 'đã được tiếp nhận';
    case 'preparing':
      return 'đang được chuẩn bị';
    case 'delivering':
      return 'đang được giao';
    case 'delivered':
      return 'đã giao thành công';
    case 'cancelled':
      return 'đã bị hủy';
    default:
      return 'đang được xử lý';
  }
}

export function hasTrustedFixtureEvidence(state: AgentGraphState): boolean {
  const trustedFixtureModes = new Set(['public_crawl_seed', 'mock_external_state', 'test_only']);
  if (state.menuModifierOptions && trustedFixtureModes.has(state.menuModifierOptions.provenance.fixtureMode)) return true;
  return (state.toolTrace ?? []).some((entry) =>
    entry.provenance.some((source) => trustedFixtureModes.has(source.fixtureMode)),
  );
}

export function toolExecutionFailureText(state: AgentGraphState): string {
  const failed = [...(state.toolTrace ?? [])].reverse().find((entry) => !entry.ok);
  switch (failed?.resultSummary) {
    case 'authentication_required':
      return 'Mình chưa thể truy cập thông tin riêng tư khi phiên hiện tại chưa được KFC xác thực. Bạn vui lòng đăng nhập qua kênh KFC chính thức rồi thử lại.';
    case 'subject_binding_required':
    case 'access_context_mismatch':
      return 'Mình chưa thể truy cập thông tin riêng tư vì phiên này chưa được liên kết an toàn với đúng tài khoản KFC.';
    case 'authorization_required':
      return 'Phiên hiện tại chưa được cấp quyền cho thao tác thành viên này, nên mình chưa thể thực hiện.';
    case 'invalid_tool_arguments':
      return 'Dữ liệu món đã sẵn sàng, nhưng yêu cầu cập nhật giỏ không hợp lệ. Bạn thử lại thao tác giúp mình nhé.';
    case 'invalid_modifier':
      return 'Dữ liệu món đã sẵn sàng, nhưng tùy chọn này không áp dụng được cho món trong giỏ. Bạn chọn lại tùy chọn giúp mình nhé.';
    case 'cart_required':
    case 'cart_initialization_failed':
      return 'Dữ liệu món đã sẵn sàng, nhưng giỏ hàng chưa được khởi tạo. Bạn thử thêm món vào giỏ trước nhé.';
    default:
      return 'Dữ liệu món đã sẵn sàng, nhưng thao tác cập nhật chưa hoàn tất. Bạn thử lại giúp mình nhé.';
  }
}

export function selectSafeFallbackText(state: AgentGraphState, plannerFallbackText?: string): string {
  const incompleteAddress = partialAddressText(state);
  if (incompleteAddress) {
    return `Mình đã nhận địa chỉ ${incompleteAddress}, nhưng còn thiếu quận/huyện và tỉnh/thành phố. Bạn bổ sung giúp mình để kiểm tra giao hàng nhé.`;
  }
  const comboProposal = state.comboConversionProposal ?? (
    isRecord(state.entities) && isRecord(state.entities.comboConversionProposal)
      ? state.entities.comboConversionProposal
      : undefined
  );
  if (
    comboProposal &&
    typeof comboProposal.name === 'string' &&
    typeof comboProposal.quantity === 'number' &&
    typeof comboProposal.sourceTotalVnd === 'number' &&
    typeof comboProposal.comboTotalVnd === 'number' &&
    typeof comboProposal.savingsVnd === 'number'
  ) {
    return `Giỏ gọi lẻ tạm tính ${comboProposal.sourceTotalVnd.toLocaleString('vi-VN')}đ. ` +
      `Mình thấy ${comboProposal.quantity} ${comboProposal.name} có thành phần tương đương, tổng ` +
      `${comboProposal.comboTotalVnd.toLocaleString('vi-VN')}đ, tiết kiệm ` +
      `${comboProposal.savingsVnd.toLocaleString('vi-VN')}đ. Mình chưa đổi giỏ; bạn có muốn đổi sang combo này không?`;
  }
  const savedAddressDecision = plannerSavedAddressDecision(state);
  if (savedAddressDecision?.decision === 'suggest') {
    const candidate = state.customerContext?.savedAddresses[savedAddressDecision.addressIndex];
    if (candidate) {
      return `Mình tìm thấy địa chỉ đã lưu ${candidate.line1}, ${candidate.district}, ${candidate.city}. Bạn xác nhận giao tới địa chỉ này nhé.`;
    }
  }
  const catalogSuggestion = isRecord(state.entities) && isRecord(state.entities.catalogSuggestion)
    ? state.entities.catalogSuggestion
    : undefined;
  if (
    catalogSuggestion &&
    typeof catalogSuggestion.name === 'string' &&
    !state.escalationReasons.includes('previous_order_confirmation_required')
  ) {
    return `Món phù hợp từ lịch sử của bạn là ${catalogSuggestion.name}. Mình chưa thêm vào giỏ; bạn xác nhận món này nhé.`;
  }

  if (
    hasPlannerBooleanEntity(state, 'reorderConfirmed') &&
    state.cart &&
    !state.fulfillment &&
    hasSuccessfulToolResult(state.toolTrace ?? [], ['updateCart'])
  ) {
    const itemList = state.cart.items.map((item) => `${item.quantity} ${item.name}`).join(', ');
    return `Mình đã đặt lại ${itemList} vào giỏ hàng. Bạn gửi giúp mình địa chỉ giao hàng đầy đủ để mình kiểm tra phí ship và thời gian giao nhé.`;
  }

  if (state.handoff) {
    if (state.handoff.reasons.includes('order_cancellation_requested')) {
      return 'Mình đã ghi nhận yêu cầu hủy đơn. Nhân viên KFC sẽ kiểm tra trạng thái đơn trước khi xác nhận có thể hủy.';
    }
    if (state.handoff.reasons.includes('payment_failed')) {
      return 'Mình đã ghi nhận lỗi thanh toán và sẽ chuyển nhân viên KFC kiểm tra giao dịch cùng trạng thái đơn.';
    }
    return 'Mình đã ghi nhận yêu cầu và sẽ chuyển nhân viên KFC hỗ trợ.';
  }

  if (state.order && state.intent === 'cart_edit') {
    return `Đơn ${state.order.id} đã được gửi đi nên không thể sửa trực tiếp. Bạn có thể gặp nhân viên KFC để kiểm tra khả năng hỗ trợ.`;
  }

  if (state.order && state.intent === 'payment' && state.paymentAttempt?.status === 'failed') {
    return `Mình đã kiểm tra đơn ${state.order.id}; hệ thống chưa ghi nhận thanh toán thành công. Bạn có thể thử thanh toán lại hoặc đổi phương thức trong thẻ bên dưới.`;
  }

  if (hasSuccessfulToolResult(state.toolTrace ?? [], ['getMembershipProfile']) && typeof state.customerContext?.loyaltyPoints === 'number') {
    const cartApplicability = state.cart
      ? ' Mình có thể kiểm tra ưu đãi áp dụng cho giỏ hiện tại, nhưng cần bạn chọn hoặc xác nhận phần thưởng trước khi đổi điểm.'
      : ' Nếu bạn muốn dùng điểm, mình có thể kiểm tra ưu đãi thành viên phù hợp.';
    return `Bạn hiện có ${state.customerContext.loyaltyPoints} điểm thành viên.${cartApplicability}`;
  }

  if (state.escalationReasons.length === 0) {
    if (state.intent === 'order_status') {
      const statusText = orderStatusFallbackText(state);
      if (statusText) return statusText;
    }

    if (!state.invoiceRequest && hasPlannerBooleanEntity(state, 'invoiceRequested')) {
      return 'Mình đã lưu ghi chú giao hàng và nhu cầu xuất hóa đơn công ty. Bạn vui lòng gửi tên công ty, mã số thuế và email nhận hóa đơn để mình hoàn tất đơn nhé.';
    }

    if (state.order?.status === 'created' && state.paymentAttempt?.paymentUrl) {
      return `Đơn ${state.order.id} đã được tạo. Mình đã tạo link thanh toán ${state.paymentAttempt.paymentUrl}; KFC sẽ xử lý đơn theo thông tin giao hàng và hóa đơn đã ghi nhận.`;
    }

    if (state.paymentMethodEvidence && state.paymentMethodEvidence.length > 0) {
      return paymentMethodFallbackText(state);
    }

    if (state.order && state.intent === 'payment') {
      const paymentStatus = state.paymentAttempt?.status ?? state.order.paymentStatus;
      return `Mình đã kiểm tra đơn ${state.order.id}; trạng thái thanh toán hiện là ${paymentStatus}.`;
    }

    if (hasPlannerBooleanEntity(state, 'asksClarification') && state.customerContext?.recentOrders[0] && !state.cart) {
      const itemList = state.customerContext.recentOrders[0].cart.items.map((item) => `${item.quantity} ${item.name}`).join(', ');
      return `Đơn hàng trước của bạn là ${itemList}. Bạn có muốn đặt lại đơn này không?`;
    }

    if (state.paymentAttempt?.method && !state.paymentAttempt.paymentUrl && !state.order) {
      return `Phương thức thanh toán này dùng được cho đơn này. Mình sẽ tạo link thanh toán sau khi bạn xác nhận đơn.`;
    }

    if (state.handoff && !plannerFallbackText) {
      return 'Mình sẽ chuyển nhân viên hỗ trợ ngay.';
    }

    if (hasPlannerBooleanEntity(state, 'invoiceRequested') && !state.invoiceRequest) {
      return 'Mình có thể ghi nhận yêu cầu xuất hóa đơn. Bạn gửi giúp mình tên công ty, mã số thuế và email nhận hóa đơn nhé.';
    }

    if (hasPlannerBooleanEntity(state, 'asksClarification') && plannerFallbackText) {
      return plannerFallbackText;
    }

    if (
      state.cart &&
      !state.fulfillment &&
      !state.order &&
      !hasSuccessfulToolResult(state.toolTrace ?? [], [
        'searchMenu',
        'updateCart',
        'getMembershipProfile',
        'listMembershipRewards',
        'listMembershipWallet',
      ])
    ) {
      return 'Mình tiếp tục hỗ trợ giỏ hiện tại. Bạn gửi giúp mình địa chỉ giao hàng đầy đủ để mình kiểm tra phí ship và thời gian giao nhé.';
    }

    if (state.cart && !state.fulfillment && hasSuccessfulToolResult(state.toolTrace ?? [], ['updateCart'])) {
      const itemList = state.cart.items.map((item) => `${item.quantity} ${item.name}`).join(', ');
      return `Mình đã thêm ${itemList} vào giỏ hàng. Bạn gửi giúp mình địa chỉ giao hàng đầy đủ để mình kiểm tra phí ship và thời gian giao nhé.`;
    }

    if (
      state.cart &&
      !state.fulfillment &&
      !state.order &&
      hasSuccessfulToolResult(state.toolTrace ?? [], ['previewCart', 'recommendAddOns'])
    ) {
      return 'Mình tiếp tục hỗ trợ giỏ hiện tại. Bạn gửi giúp mình địa chỉ giao hàng đầy đủ để mình kiểm tra phí ship và thời gian giao nhé.';
    }

    if (state.cart?.voucherCode && state.promotionContext?.validation?.ok) {
      return `Mình đã áp dụng mã ${state.cart.voucherCode}, giảm ${state.cart.discountVnd.toLocaleString('vi-VN')}đ. Tổng tạm tính hiện là ${state.cart.totalVnd.toLocaleString('vi-VN')}đ.`;
    }

    if (state.cart && state.fulfillment && !state.orderPreview && !state.order) {
      const storeName = state.fulfillment.storeName.replace(/^KFC\s+/i, '');
      return `KFC ${storeName} có thể giao đơn này. Phí ship ${state.fulfillment.feeVnd.toLocaleString('vi-VN')}đ, dự kiến ${state.fulfillment.etaMinutes} phút; tạm tính ${state.cart.totalVnd.toLocaleString('vi-VN')}đ.`;
    }

    if (!state.cart && state.menuSearchResults && state.menuSearchResults.length > 0) {
      const visibleItems = state.menuSearchResults.slice(0, 5);
      const itemList = visibleItems.map((item) => `${item.name} (${item.priceVnd.toLocaleString('vi-VN')}đ)`).join(', ');
      const remaining = state.menuSearchResults.length - visibleItems.length;
      const suffix = remaining > 0 ? ` Còn ${remaining} món khác; bạn có thể thêm tiêu chí để lọc nhanh hơn.` : '';
      return `Mình tìm thấy ${itemList}.${suffix} Bạn muốn chọn món nào?`;
    }

    return plannerFallbackText ?? 'Mình đã kiểm tra thông tin từ dữ liệu KFC. Bạn muốn mình tiếp tục thế nào?';
  }

  const reasons = new Set(state.escalationReasons);
  const highestPriorityReason =
    safeFallbackPriority.find((reason) => reasons.has(reason)) ?? state.escalationReasons[0] ?? 'needs_verified_info';

  switch (highestPriorityReason) {
    case 'order_confirmation_required':
      return 'Mình chưa thể đặt đơn khi chưa có xác nhận rõ ràng. Nếu bạn muốn chốt đơn, hãy nhắn "xác nhận đơn".';
    case 'confirmed_address_required':
      return 'Mình cần địa chỉ giao hàng đầy đủ hoặc xác nhận rõ địa chỉ đã lưu trước khi kiểm tra phí và thời gian giao.';
    case 'valid_fulfillment_required':
      return 'Mình cần xác minh cửa hàng và hình thức nhận hoặc giao trước khi tiếp tục đặt đơn.';
    case 'item_unavailable_before_confirmation': {
      const unavailableItemCodes = isRecord(state.entities) && Array.isArray(state.entities.unavailableItemCodes)
        ? state.entities.unavailableItemCodes.filter((itemCode): itemCode is string => typeof itemCode === 'string')
        : [];
      const unavailableNames = state.cart?.items
        .filter((item) => unavailableItemCodes.includes(item.itemCode))
        .map((item) => item.name)
        .join(', ');
      return unavailableNames
        ? `${unavailableNames} vừa được báo hết tại cửa hàng giao hiện tại. Mình chưa đặt đơn; bạn muốn chọn món thay thế hay kiểm tra cửa hàng khác?`
        : 'Một món trong giỏ vừa được báo hết tại cửa hàng giao hiện tại. Mình chưa đặt đơn; bạn muốn chọn món thay thế hay kiểm tra cửa hàng khác?';
    }
    case 'payment_tool_success_required':
      return 'Mình chưa xác minh được trạng thái thanh toán thành công. Bạn gửi mã đơn để mình kiểm tra lại nhé.';
    case 'promotion_evidence_required':
      return 'Mình chưa có thông tin khuyến mãi đã được xác minh cho yêu cầu này. Bạn gửi thêm mã hoặc để mình kiểm tra ưu đãi công khai nhé.';
    case 'allergen_certainty_not_allowed':
      return 'Mình không thể khẳng định tuyệt đối về dị ứng từ dữ liệu hiện có. Mình có thể chia sẻ thông tin thành phần đã xác minh nếu bạn cần.';
    case 'tool_execution_failed':
      return toolExecutionFailureText(state);
    case 'cart_initialization_failed':
      return 'Mình chưa khởi tạo được giỏ hàng từ dữ liệu hiện có. Bạn thử lại món cần đặt giúp mình nhé.';
    case 'menu_item_verification_required':
      if (hasTrustedFixtureEvidence(state)) {
        return 'Dữ liệu món đã sẵn sàng, nhưng lựa chọn này không khớp với món trong giỏ. Bạn chọn lại tùy chọn giúp mình nhé.';
      }
      return 'Mình chưa xác minh được đầy đủ món bạn muốn đặt từ menu KFC. Bạn gửi lại tên món hoặc combo cụ thể hơn giúp mình nhé.';
    case 'cart_mutation_confirmation_required':
      return 'Mình cần bạn xác nhận rõ món trong giỏ hiện tại cần thay đổi trước khi mình cập nhật giỏ.';
    case 'previous_order_confirmation_required':
      if (state.customerContext?.recentOrders[0]) {
        const itemList = state.customerContext.recentOrders[0].cart.items.map((item) => `${item.quantity} ${item.name}`).join(', ');
        return `Đơn hàng trước của bạn là ${itemList}. Bạn có muốn đặt lại đơn này không?`;
      }
      return 'Mình tìm thấy món trong đơn trước, nhưng cần bạn xác nhận rõ đơn trước muốn đặt lại trước khi mình thêm vào giỏ.';
    default:
      return 'Mình cần thêm thông tin đã được xác minh để hỗ trợ đúng. Bạn cho mình biết chi tiết cần kiểm tra tiếp nhé.';
  }
}

export async function composeAssistantResponse(input: {
  turnInput: AgentTurnInput;
  state: AgentGraphState;
  fallbackText: string;
  replyIntent: ReplyIntent;
  currentTurnToolTrace: ToolTraceEntry[];
  contextPolicy?: ContextPolicyDirective;
  turnTrace?: AgentTraceSpan;
  preferFallbackText?: boolean;
  suppressGenUi?: boolean;
}): Promise<AgentTurnOutput> {
  const responseProfile = input.turnInput.responseProfile ?? responseProfileForChannel(input.turnInput.channel);
  const createdPaymentThisTurn = hasSuccessfulToolResult(input.currentTurnToolTrace, ['createPaymentLink']);
  const placedOrderThisTurn = hasSuccessfulToolResult(input.currentTurnToolTrace, ['placeOrder']);
  let responseText = createdPaymentThisTurn
    ? `Đơn ${input.state.order?.id ?? 'hàng'} đã được tạo. Bạn có thể tiếp tục thanh toán${input.state.paymentAttempt?.paymentUrl ? ` tại ${input.state.paymentAttempt.paymentUrl}` : ' bằng phương thức đã chọn'
    }.`
    : placedOrderThisTurn
      ? 'Đơn hàng đã được tạo thành công.'
      : input.fallbackText;
  const contextPolicy = input.contextPolicy ?? contextPolicyFromMetadata(input.turnInput.metadata);
  const preserveCurrentMenuResults =
    shouldPreserveCurrentMenuSearchResults(input.currentTurnToolTrace) ||
    hasPlannerBooleanEntity(input.state, 'keepMenuSurface');

  const genUi = input.suppressGenUi || responseProfile !== 'genui'
    ? undefined
    : selectKfcGenUiAttachment({
      state: buildContextPolicyState(input.state, {
        metadata: input.turnInput.metadata,
        policy: contextPolicy,
        preserveCartOrderPaymentContext: shouldPreserveCurrentCartOrderPaymentContext(input.currentTurnToolTrace),
        preserveMenuSearchResults: preserveCurrentMenuResults,
        preservePaymentContext: shouldPreserveCurrentPaymentContext(input.currentTurnToolTrace),
        preserveHandoff: shouldPreserveCurrentHandoff(input.currentTurnToolTrace),
      }),
      turnToolNames: input.currentTurnToolTrace.filter((entry) => entry.ok).map((entry) => entry.toolName),
      reuseVerifiedMenuResults: contextPolicyIsActive(contextPolicy, 'menuSearchResults'),
    });

  const composerInput = {
    channel: input.turnInput.channel,
    presentationMode: responseProfile === 'genui' ? 'structured_companion' as const : 'standalone_text' as const,
    state: buildContextPolicyState(
      {
        ...input.state,
        toolTrace: input.currentTurnToolTrace,
      },
      {
        metadata: input.turnInput.metadata,
        policy: contextPolicy,
        preserveCartOrderPaymentContext: shouldPreserveCurrentCartOrderPaymentContext(input.currentTurnToolTrace),
        preserveMenuSearchResults: preserveCurrentMenuResults,
        preservePaymentContext: shouldPreserveCurrentPaymentContext(input.currentTurnToolTrace),
        preserveHandoff: shouldPreserveCurrentHandoff(input.currentTurnToolTrace),
        preserveRecentTurns: true,
        preserveToolTrace: true,
        compactMenuSearchResults: true,
      },
    ),
    replyIntent: input.replyIntent,
    fallbackText: input.fallbackText,
  };
  const shouldCompose =
    Boolean(input.turnInput.responseComposer) &&
    !input.preferFallbackText;
  if (!(await isRunStillCurrent(input.turnInput))) {
    throw new Error('customer_run_cancelled');
  }
  await input.turnInput.observeRun?.({ kind: 'response_composition' });
  const responseSpan = input.turnTrace && shouldCompose
    ? await input.turnTrace.startSpan({
      name: 'response_compose',
      runType: 'llm',
      inputs: { composerInput },
      metadata: {
        component: responseProfile === 'genui' ? 'GenUiCompanionComposer' : 'StandaloneSocialComposer',
        responseProfile,
      },
      tags: ['agent-response', `profile:${responseProfile}`],
    })
    : undefined;

  if (input.turnInput.responseComposer && shouldCompose) {
    try {
      const specializedInput = {
        state: composerInput.state,
        replyIntent: composerInput.replyIntent,
        fallbackText: composerInput.fallbackText,
      };
      responseText = responseProfile === 'genui'
        ? input.turnInput.responseComposer.composeGenUiCompanion
          ? await input.turnInput.responseComposer.composeGenUiCompanion(specializedInput)
          : await input.turnInput.responseComposer.composeResponse(composerInput)
        : input.turnInput.responseComposer.composeStandaloneSocial
          ? await input.turnInput.responseComposer.composeStandaloneSocial(specializedInput)
          : await input.turnInput.responseComposer.composeResponse(composerInput);
      const valid = responseProfile === 'genui'
        ? validateGenUiCompanionResponse(responseText, composerInput.state)
        : validateStandaloneSocialResponse(responseText, composerInput.state);
      if (!valid) throw new Error(`invalid_${responseProfile}_response`);
    } catch (error) {
      await input.turnInput.store.appendEvent(input.turnInput.sessionId, 'llm:response_composer_failed', {
        message: error instanceof Error ? error.message : 'Unknown response composer failure',
        replyIntent: input.replyIntent,
      });
      responseText = input.fallbackText;
    }
  }

  if (responseProfile === 'social' && (!shouldCompose || !validateStandaloneSocialResponse(responseText, composerInput.state))) {
    responseText = buildStandaloneSocialFallback(composerInput.state, input.fallbackText);
  }

  let presentation = responseProfile === 'genui'
    ? buildChannelPresentation({
      channel: input.turnInput.channel,
      graphResponseText: responseText,
      genUi,
    })
    : input.turnInput.channel === 'kfc'
      ? { profile: 'social' as const, text: responseText }
      : buildSocialPresentation({
        channel: input.turnInput.channel,
        standaloneText: responseText,
        state: composerInput.state,
      });
  assertPresentationMatchesChannel(input.turnInput.channel, presentation, responseProfile);
  responseText = presentation.text;
  if (!responseText.trim()) {
    responseText = input.fallbackText.trim() || 'Mình cần bạn gửi lại yêu cầu để tiếp tục hỗ trợ.';
    presentation = {
      ...presentation,
      text: responseText,
    };
    await input.turnInput.store.appendEvent(input.turnInput.sessionId, 'agent:recovery_response', {
      reason: 'empty_channel_presentation',
      responseMode: 'deterministic',
    });
  }

  const output: AgentTurnOutput = {
    state: input.state,
    responseText,
    presentation,
    replyIntent: input.replyIntent,
    genUi: presentation.profile === 'genui' ? genUi : undefined,
  };
  await responseSpan?.end({
    replyIntent: input.replyIntent,
    genUiKind: genUi?.widgetKind ?? null,
    state: traceStateSummary(input.state),
    responseText,
  });
  return output;
}
