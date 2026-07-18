import type { AgentGraphState } from '../../src/graph/state.js';
import type {
  ResponseComposerInput,
  ResponseComposer,
  VerifiedResponseComposerInput,
} from '../../src/llm/responseComposer.js';
import {
  validateGenUiCompanionResponse,
  validateStandaloneSocialResponse,
} from '../../src/llm/responseComposer.js';

function formatVnd(value: number): string {
  return `${new Intl.NumberFormat('vi-VN').format(value)}đ`;
}

export function composeGroundedTestResponse(state: AgentGraphState): string | undefined {
  const parts: string[] = [];
  const cartItem = state.cart?.items[0];
  const menuItem = state.menuSearchResults?.[0];

  if (cartItem) {
    parts.push(cartItem.name);
    parts.push(...(cartItem.modifiers ?? []).map((modifier) => modifier.modifierName));
    parts.push(formatVnd(state.cart!.totalVnd));
  } else if (menuItem) {
    parts.push(menuItem.name, formatVnd(menuItem.priceVnd));
  }
  if (state.order?.id) parts.push(state.order.id);

  return parts.length > 0 ? parts.join(' · ') : undefined;
}

function testModelResponse(
  input: VerifiedResponseComposerInput,
  validate: (text: string, state: AgentGraphState) => boolean,
): string {
  const candidate = input.fallbackText.trim();
  if (candidate && validate(candidate, input.state)) return candidate;

  const grounded = composeGroundedTestResponse(input.state);
  const combined = [candidate, grounded].filter(Boolean).join(' · ');
  if (combined && validate(combined, input.state)) return combined;
  if (grounded && validate(grounded, input.state)) return grounded;
  throw new Error('missing_explicit_test_response');
}

function composeGenUi(input: VerifiedResponseComposerInput): Promise<string> {
  return Promise.resolve(testModelResponse(input, validateGenUiCompanionResponse));
}

function composeSocial(input: VerifiedResponseComposerInput): Promise<string> {
  return Promise.resolve(testModelResponse(input, validateStandaloneSocialResponse));
}

export const testResponseComposer: ResponseComposer = {
  composeResponse(input: ResponseComposerInput) {
    return input.presentationMode === 'structured_companion'
      ? composeGenUi(input)
      : composeSocial(input);
  },
  composeGenUiCompanion: composeGenUi,
  composeStandaloneSocial: composeSocial,
};

export function createTestResponseComposer(
  modelCandidate: string,
  preferModelCandidate = false,
): ResponseComposer {
  const composeWithCandidate = (
    input: VerifiedResponseComposerInput,
    compose: (candidate: VerifiedResponseComposerInput) => Promise<string>,
  ) => {
    const preferredInput = preferModelCandidate
      ? { ...input, fallbackText: modelCandidate }
      : input;
    return Promise.resolve().then(() => compose(preferredInput)).catch((error: unknown) => {
      if (!(error instanceof Error) || error.message !== 'missing_explicit_test_response') throw error;
      return compose({ ...input, fallbackText: modelCandidate });
    });
  };
  return {
    composeResponse(input) {
      return input.presentationMode === 'structured_companion'
        ? composeWithCandidate(input, composeGenUi)
        : composeWithCandidate(input, composeSocial);
    },
    composeGenUiCompanion(input) {
      return composeWithCandidate(input, composeGenUi);
    },
    composeStandaloneSocial(input) {
      return composeWithCandidate(input, composeSocial);
    },
  };
}

function candidateForReplyIntent(replyIntent: string): string | undefined {
  switch (replyIntent) {
    case 'ask_clarification':
      return 'Bạn vui lòng cung cấp thêm thông tin để mình tiếp tục hỗ trợ.';
    case 'ask_fulfillment_method':
      return 'Bạn muốn giao hàng hay nhận tại cửa hàng?';
    case 'human_review_required':
      return 'Mình đang chuyển yêu cầu sang nhân viên hỗ trợ.';
    case 'payment_retry':
      return 'Mình cần kiểm tra lại trạng thái thanh toán.';
    case 'order_created':
      return 'Đơn hàng đã được tạo từ thông tin đã xác minh.';
    case 'general_reply':
      return 'Mình có thể hỗ trợ bạn xem menu hoặc đặt món.';
    default:
      return undefined;
  }
}

export const intentTestResponseComposer: ResponseComposer = {
  composeResponse(input) {
    const candidate = candidateForReplyIntent(input.replyIntent);
    return candidate
      ? createTestResponseComposer(candidate).composeResponse(input)
      : testResponseComposer.composeResponse(input);
  },
  composeGenUiCompanion(input) {
    const candidate = candidateForReplyIntent(input.replyIntent);
    return candidate
      ? createTestResponseComposer(candidate).composeGenUiCompanion!(input)
      : testResponseComposer.composeGenUiCompanion!(input);
  },
  composeStandaloneSocial(input) {
    const candidate = candidateForReplyIntent(input.replyIntent);
    return candidate
      ? createTestResponseComposer(candidate).composeStandaloneSocial!(input)
      : testResponseComposer.composeStandaloneSocial!(input);
  },
};
