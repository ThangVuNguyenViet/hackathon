import type { AgentGraphState } from '../graph/state.js';
import type { Channel } from '../domain/types.js';
import type { ChannelPresentationMode } from '../presentation/channelPresentation.js';
import { responseProfileForChannel } from '../presentation/responseProfile.js';
import {
  assertOpenAiResponseOk,
  createOpenAiRequestMetadata,
  openAiRequestHeaders,
  type OpenAiDiagnosticContext,
} from './openAiDiagnostics.js';

export interface VerifiedResponseComposerInput {
  state: AgentGraphState;
  replyIntent: string;
  /** Optional text written by an upstream model. Never a deterministic response template. */
  fallbackText: string;
}
/** Compatibility input for injected test composers and non-production adapters. */
export interface ResponseComposerInput extends VerifiedResponseComposerInput {
  channel: Channel;
  presentationMode: ChannelPresentationMode;
}

export interface ResponseComposer {
  composeResponse(input: ResponseComposerInput): Promise<string>;
  composeGenUiCompanion?(input: VerifiedResponseComposerInput): Promise<string>;
  composeStandaloneSocial?(input: VerifiedResponseComposerInput): Promise<string>;
}

export interface OpenAIResponseComposerOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  diagnosticContext?: OpenAiDiagnosticContext;
}

interface ResponsesApiBody {
  output_text?: unknown;
  output?: Array<{ content?: Array<{ text?: unknown }> }>;
  error?: { message?: unknown };
}

const OPENAI_RESPONSES_API_BASE_URL = 'https://api.openai.com/v1';
const forbiddenSocialUiReference = /\b(?:gen\s*ui|widget|carousel|selector)\b|\b(?:button|card)\s+(?:above|below)\b|\b(?:bấm|nhấn)\s+(?:nút|thẻ)\b|\b(?:giao diện|ở (?:bên )?(?:trên|dưới))\b/iu;

function trimTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

function extractOutputText(body: ResponsesApiBody): string | undefined {
  if (typeof body.output_text === 'string' && body.output_text.trim().length > 0) {
    return body.output_text.trim();
  }
  for (const output of body.output ?? []) {
    for (const content of output.content ?? []) {
      if (typeof content.text === 'string' && content.text.trim().length > 0) {
        return content.text.trim();
      }
    }
  }
  return undefined;
}

function buildVerifiedPrompt(input: VerifiedResponseComposerInput): string {
  return JSON.stringify(
    {
      locale: 'vi-VN',
      role: 'KFC Vietnam ordering assistant',
      guardrails: [
        'Reply naturally in Vietnamese unless the customer used English.',
        'Use only verified state and toolTrace facts from this payload.',
        'Do not change business decisions or invent facts not present in state/toolTrace.',
        'Do not invent promotions, delivery availability, payment success, or order IDs.',
        'For policy and allergen answers, use contentEvidence only. If evidence is absent or conflicting, say the information cannot be verified and offer human support.',
        'A customer-facing policy answer must include an official sourceUrl from contentEvidence.',
      ],
      latestUserMessage: input.state.latestUserMessage,
      recentTurns: input.state.recentTurns?.map((turn) => ({ role: turn.role, text: turn.text })),
      replyIntent: input.replyIntent,
      ...(input.fallbackText ? { plannerDraft: input.fallbackText } : {}),
      cart: input.state.cart,
      fulfillment: input.state.fulfillment,
      menuSearchResults: input.state.menuSearchResults,
      menuCatalogContext: input.state.plannerMenuCatalogContext,
      promotionContext: input.state.promotionContext,
      contentEvidence: input.state.contentEvidence,
      customerContext: input.state.customerContext,
      order: input.state.order,
      paymentAttempt: input.state.paymentAttempt,
      paymentMethodEvidence: input.state.paymentMethodEvidence,
      escalationReasons: input.state.escalationReasons,
      toolTrace: input.state.toolTrace,
      retrievedEvidence: input.state.retrievedEvidence,
    },
    null,
    2,
  );
}

function buildResponseContract(component: string, state: AgentGraphState): string[] {
  const requirements: string[] = [];
  const policyUrls = state.contentEvidence
    ?.filter((evidence) => evidence.kind === 'policy')
    .map((evidence) => evidence.sourceUrl) ?? [];
  if (policyUrls.length > 0) {
    requirements.push(`Include at least one exact official policy URL: ${policyUrls.join(' | ')}`);
  }

  if (component === 'GenUI companion composition') {
    requirements.push('Return non-empty text of at most 280 characters.');
    requirements.push('Do not mention an unselected saved address.');
    requirements.push('If naming a cart item with modifiers, use its exact full name and every verified modifier name; otherwise omit the item name.');
    return requirements;
  }

  requirements.push('Return non-empty standalone text of at most 1200 characters with no references to hidden UI.');
  if (state.cart?.items.length) {
    const itemNames = state.cart.items.map((item) => item.name);
    const exactTotal = `${new Intl.NumberFormat('vi-VN').format(state.cart.totalVnd)}đ`;
    requirements.push(`Include at least one exact cart item name: ${itemNames.join(' | ')}`);
    requirements.push(`Include this exact cart total: ${exactTotal}`);
  } else if (state.menuSearchResults?.length) {
    requirements.push(
      `Include at least one exact menu choice name: ${state.menuSearchResults.slice(0, 5).map((item) => item.name).join(' | ')}`,
    );
  }
  if (state.order?.id) requirements.push(`Include this exact order ID: ${state.order.id}`);
  if (!state.order) requirements.push('Do not claim that an order has been placed or created.');
  return requirements;
}

export function validateGenUiCompanionText(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.length > 0 && trimmed.length <= 280;
}

function normalizedCommerceText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function validateGenUiCompanionResponse(
  text: string,
  state: AgentGraphState,
): boolean {
  if (!validateGenUiCompanionText(text)) return false;
  const policySources = state.contentEvidence?.filter((evidence) => evidence.kind === 'policy') ?? [];
  if (policySources.length > 0 && !policySources.some((evidence) => text.includes(evidence.sourceUrl))) return false;
  const normalized = normalizedCommerceText(text);
  const savedAddresses = state.customerContext?.savedAddresses ?? [];
  const rawDecision = state.entities?.savedAddressDecision;
  const decisionIndex = rawDecision && typeof rawDecision === 'object' && !Array.isArray(rawDecision)
    && typeof (rawDecision as Record<string, unknown>).addressIndex === 'number'
    ? (rawDecision as Record<string, unknown>).addressIndex as number
    : undefined;

  const savedAddressesAreGrounded = savedAddresses.every((candidate, index) => {
    if (!normalized.includes(normalizedCommerceText(candidate.line1))) return true;
    const isCurrentAddress = Boolean(
      state.address &&
      normalizedCommerceText(state.address.line1) === normalizedCommerceText(candidate.line1),
    );
    return isCurrentAddress || decisionIndex === index;
  });
  if (!savedAddressesAreGrounded) return false;

  return (state.cart?.items ?? []).every((item) => {
    const normalizedName = normalizedCommerceText(item.name);
    const parentheticalIndex = item.name.indexOf('(');
    if (parentheticalIndex > 0) {
      const baseName = normalizedCommerceText(item.name.slice(0, parentheticalIndex));
      if (baseName.length >= 4 && normalized.includes(baseName) && !normalized.includes(normalizedName)) {
        return false;
      }
    }
    if (!normalized.includes(normalizedName) || !item.modifiers?.length) return true;
    return item.modifiers.every((modifier) =>
      normalized.includes(normalizedCommerceText(modifier.modifierName)),
    );
  });
}

export function validateStandaloneSocialText(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.length > 0 && trimmed.length <= 1200 && !forbiddenSocialUiReference.test(trimmed);
}

export function validateStandaloneSocialResponse(
  text: string,
  state: AgentGraphState,
): boolean {
  if (!validateStandaloneSocialText(text)) return false;
  const policySources = state.contentEvidence?.filter((evidence) => evidence.kind === 'policy') ?? [];
  if (policySources.length > 0 && !policySources.some((evidence) => text.includes(evidence.sourceUrl))) return false;
  const normalized = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase();
  if (!state.order && /\b(?:da dat|dat mon roi|don hang da duoc tao)\b/.test(normalized)) return false;
  if (state.cart?.items.length) {
    const namesCartItem = state.cart.items.some((item) =>
      normalized.includes(item.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase()),
    );
    if (!namesCartItem) return false;
    const total = `${new Intl.NumberFormat('vi-VN').format(state.cart.totalVnd)}đ`.toLowerCase();
    if (!text.toLowerCase().includes(total)) return false;
  } else if (state.menuSearchResults?.length) {
    const namesMenuChoice = state.menuSearchResults.some((item) =>
      normalized.includes(item.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase()),
    );
    if (!namesMenuChoice) return false;
  }
  if (state.order?.id && !text.includes(state.order.id)) return false;
  return true;
}

class OpenAITextComposerClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: OpenAIResponseComposerOptions) {
    this.baseUrl = trimTrailingSlash(options.baseUrl ?? OPENAI_RESPONSES_API_BASE_URL);
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
  }

  async compose(input: {
    instructions: string;
    payload: VerifiedResponseComposerInput;
    validate(text: string): boolean;
    component: string;
  }): Promise<string> {
    const deadlineAt = Date.now() + (this.options.timeoutMs ?? 3_000);
    let previousInvalidOutput: string | undefined;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const remainingMs = deadlineAt - Date.now();
      if (remainingMs <= 0) throw new Error(`${input.component} deadline exceeded`);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), remainingMs);
      const requestMetadata = createOpenAiRequestMetadata(
        input.component,
        this.options.model,
        this.options.diagnosticContext,
      );
      const response = await this.fetchImpl(`${this.baseUrl}/responses`, {
        method: 'POST',
        headers: openAiRequestHeaders(this.options.apiKey, requestMetadata),
        signal: controller.signal,
        body: JSON.stringify({
          model: this.options.model,
          max_output_tokens: input.component === 'GenUI companion composition' ? 120 : 320,
          instructions: [
            input.instructions,
            `Validation contract: ${buildResponseContract(input.component, input.payload.state).join(' ')}`,
            previousInvalidOutput
              ? `The previous draft failed that contract. Rewrite it completely: ${JSON.stringify(previousInvalidOutput)}`
              : undefined,
          ].filter(Boolean).join(' '),
          input: buildVerifiedPrompt(input.payload),
        }),
      }).finally(() => clearTimeout(timeout));
      const body = (await response.json().catch(() => ({}))) as ResponsesApiBody;
      assertOpenAiResponseOk(response, body, requestMetadata);
      const outputText = extractOutputText(body);
      if (outputText && input.validate(outputText)) return outputText;
      previousInvalidOutput = outputText;
    }
    throw new Error(`${input.component} returned invalid profile output`);
  }
}

export class OpenAIGenUiCompanionComposer {
  static readonly promptVersion = 'genui-companion-v1';
  private readonly client: OpenAITextComposerClient;

  constructor(options: OpenAIResponseComposerOptions) {
    this.client = new OpenAITextComposerClient(options);
  }

  compose(input: VerifiedResponseComposerInput): Promise<string> {
    return this.client.compose({
      component: 'GenUI companion composition',
      payload: input,
      validate: (text) => validateGenUiCompanionResponse(text, input.state),
      instructions: [
        'You write concise companion copy for the KFC Vietnam first-party structured UI.',
        `Prompt version: ${OpenAIGenUiCompanionComposer.promptVersion}.`,
        'Verified choices and controls render separately. Do not enumerate menu, cart, payment, or order rows.',
        'Briefly summarize the verified outcome and state the next customer action.',
        'Keep the reply under 280 characters.',
        'Do not change business decisions or invent facts outside state/toolTrace.',
      ].join(' '),
    });
  }
}

export class OpenAIStandaloneSocialComposer {
  static readonly promptVersion = 'social-standalone-v1';
  private readonly client: OpenAITextComposerClient;

  constructor(options: OpenAIResponseComposerOptions) {
    this.client = new OpenAITextComposerClient(options);
  }

  compose(input: VerifiedResponseComposerInput): Promise<string> {
    return this.client.compose({
      component: 'standalone social composition',
      payload: input,
      validate: (text) => validateStandaloneSocialResponse(text, input.state),
      instructions: [
        'You write a complete standalone Messenger or Zalo response for KFC Vietnam.',
        `Prompt version: ${OpenAIStandaloneSocialComposer.promptVersion}.`,
        'Explicitly name every choice, price, status, missing detail, and next action needed from verified state/toolTrace.',
        'The text must remain useful when no image, quick reply, card, button, or other UI is delivered.',
        'Never mention widgets, GenUI, selectors, cards, buttons, or content above/below the message.',
        'Do not change business decisions or invent facts outside state/toolTrace.',
      ].join(' '),
    });
  }
}

/**
 * Production facade with two independent composer instances. Routing is derived
 * from the trusted channel; prompts and validation are never mode-switched.
 */
export class OpenAIResponseComposer implements ResponseComposer {
  private readonly genUi: OpenAIGenUiCompanionComposer;
  private readonly social: OpenAIStandaloneSocialComposer;

  constructor(options: OpenAIResponseComposerOptions) {
    this.genUi = new OpenAIGenUiCompanionComposer(options);
    this.social = new OpenAIStandaloneSocialComposer(options);
  }

  composeGenUiCompanion(input: VerifiedResponseComposerInput): Promise<string> {
    return this.genUi.compose(input);
  }

  composeStandaloneSocial(input: VerifiedResponseComposerInput): Promise<string> {
    return this.social.compose(input);
  }

  composeResponse(input: ResponseComposerInput): Promise<string> {
    const profile = responseProfileForChannel(input.channel);
    if (profile === 'genui' && input.presentationMode !== 'structured_companion') {
      throw new Error('Response profile mismatch for GenUI channel');
    }
    if (profile === 'social' && input.presentationMode !== 'standalone_text') {
      throw new Error('Response profile mismatch for social channel');
    }
    return profile === 'genui'
      ? this.composeGenUiCompanion(input)
      : this.composeStandaloneSocial(input);
  }
}
