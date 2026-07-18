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
