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

function mentionsCommerceName(text: string, name: string): boolean {
  const normalizedText = normalizedCommerceText(text);
  const normalizedName = normalizedCommerceText(name);
  if (normalizedText.includes(normalizedName)) return true;
  const tokens = [...new Set(normalizedName.split(' ').filter((token) => token.length >= 2))];
  const matched = tokens.filter((token) => normalizedText.split(' ').includes(token)).length;
  return tokens.length >= 2 && matched >= 2 && matched / tokens.length >= 0.6;
}

export function validateGenUiCompanionResponse(
  text: string,
  state: AgentGraphState,
): boolean {
  if (!validateGenUiCompanionText(text)) return false;
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
    const baseName = parentheticalIndex > 0
      ? normalizedCommerceText(item.name.slice(0, parentheticalIndex))
      : normalizedName;
    if (
      !normalized.includes(normalizedName) &&
      !(baseName.length >= 4 && normalized.includes(baseName))
    ) return true;
    if (!item.modifiers?.length) return true;
    return item.modifiers.every((modifier) =>
      normalized.includes(normalizedCommerceText(modifier.modifierName)),
    );
  });
}

export function validateStandaloneSocialText(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.length > 0 && trimmed.length <= 1200 && !forbiddenSocialUiReference.test(trimmed);
}

function mentionsVndAmount(text: string, amountVnd: number): boolean {
  return [...text.matchAll(/(\d[\d., \u00a0]*\d|\d)\s*(?:đ|vnd|đồng)(?![\p{L}\p{N}])/giu)]
    .some((match) => Number(match[1]?.replace(/\D/g, '')) === amountVnd);
}

function standaloneSocialValidationIssues(text: string, state: AgentGraphState): string[] {
  const issues: string[] = [];
  if (!validateStandaloneSocialText(text)) {
    issues.push('reply_must_be_standalone_nonempty_and_at_most_1200_characters');
  }
  const currentTools = new Set<string>(
    (state.toolTrace ?? []).filter((entry) => entry.ok).map((entry) => entry.toolName),
  );
  if (state.cart?.items.length && ['updateCart', 'previewCart'].some((toolName) => currentTools.has(toolName))) {
    if (!state.cart.items.some((item) => mentionsCommerceName(text, item.name))) {
      issues.push('name_at_least_one_verified_cart_item');
    }
    if (!mentionsVndAmount(text, state.cart.totalVnd)) {
      issues.push(`state_exact_verified_cart_total_${state.cart.totalVnd}_vnd`);
    }
  } else if (
    state.menuSearchResults?.length &&
    ['searchMenu', 'getItemDetails', 'getModifierOptions', 'recommendAddOns']
      .some((toolName) => currentTools.has(toolName))
  ) {
    if (!state.menuSearchResults.some((item) => mentionsCommerceName(text, item.name))) {
      issues.push('name_at_least_one_verified_menu_choice');
    }
  }
  const mentionedOrderIds = text.match(/\bKFC-[A-Z0-9-]+\b/giu) ?? [];
  const mustNameVerifiedOrder = [
    'placeOrder',
    'getOrderStatus',
    'createPaymentLink',
    'checkPaymentStatus',
    'collectInvoice',
  ].some((toolName) => currentTools.has(toolName));
  if (mustNameVerifiedOrder && state.order?.id && !text.includes(state.order.id)) {
    issues.push('name_the_current_verified_order_id');
  }
  if (
    mentionedOrderIds.length > 0 &&
    (!state.order?.id || mentionedOrderIds.some((id) => id !== state.order?.id))
  ) {
    issues.push('remove_unverified_order_identifiers');
  }
  return issues;
}

export function validateStandaloneSocialResponse(
  text: string,
  state: AgentGraphState,
): boolean {
  return standaloneSocialValidationIssues(text, state).length === 0;
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
    validationIssues(text: string): string[];
    component: string;
  }): Promise<string> {
    const timeoutMs = this.options.timeoutMs ?? 3_000;
    let priorValidationIssues: string[] = [];
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      const requestMetadata = createOpenAiRequestMetadata(
        input.component,
        this.options.model,
        this.options.diagnosticContext,
      );
      let response: Response;
      try {
        const instructions = attempt === 0
          ? input.instructions
          : `${input.instructions} The prior draft failed profile or grounding validation. Rewrite it from scratch and correct these exact issues: ${priorValidationIssues.join(', ')}.`;
        response = await this.fetchImpl(`${this.baseUrl}/responses`, {
          method: 'POST',
          headers: openAiRequestHeaders(this.options.apiKey, requestMetadata),
          signal: controller.signal,
          body: JSON.stringify({
            model: this.options.model,
            max_output_tokens: input.component === 'GenUI companion composition' ? 120 : 320,
            instructions,
            input: buildVerifiedPrompt(input.payload),
          }),
        });
      } catch (error) {
        if (controller.signal.aborted && attempt === 0) continue;
        throw error;
      } finally {
        clearTimeout(timeout);
      }
      const body = (await response.json().catch(() => ({}))) as ResponsesApiBody;
      assertOpenAiResponseOk(response, body, requestMetadata);
      const outputText = extractOutputText(body);
      if (outputText && input.validate(outputText)) return outputText;
      priorValidationIssues = outputText
        ? input.validationIssues(outputText)
        : ['return_nonempty_customer_facing_text'];
    }
    throw new Error(`${input.component} returned invalid profile output: ${priorValidationIssues.join(',')}`);
  }
}

export class OpenAIGenUiCompanionComposer {
  static readonly promptVersion = 'genui-companion-v2';
  private readonly client: OpenAITextComposerClient;

  constructor(options: OpenAIResponseComposerOptions) {
    this.client = new OpenAITextComposerClient(options);
  }

  compose(input: VerifiedResponseComposerInput): Promise<string> {
    return this.client.compose({
      component: 'GenUI companion composition',
      payload: input,
      validate: (text) => validateGenUiCompanionResponse(text, input.state),
      validationIssues: (text) =>
        validateGenUiCompanionResponse(text, input.state)
          ? []
          : ['reply_must_be_grounded_nonempty_and_at_most_280_characters'],
      instructions: [
        'You write concise companion copy for the KFC Vietnam first-party structured UI.',
        `Prompt version: ${OpenAIGenUiCompanionComposer.promptVersion}.`,
        'Verified choices and controls render separately. Do not enumerate menu, cart, payment, or order rows.',
        'Do not name or list cart items or modifiers; the structured UI presents their exact verified labels.',
        'Briefly summarize the verified outcome and state the next customer action.',
        'Keep the reply under 280 characters.',
        'Do not change business decisions or invent facts outside state/toolTrace.',
      ].join(' '),
    });
  }
}

export class OpenAIStandaloneSocialComposer {
  static readonly promptVersion = 'social-standalone-v2';
  private readonly client: OpenAITextComposerClient;

  constructor(options: OpenAIResponseComposerOptions) {
    this.client = new OpenAITextComposerClient(options);
  }

  compose(input: VerifiedResponseComposerInput): Promise<string> {
    return this.client.compose({
      component: 'standalone social composition',
      payload: input,
      validate: (text) => validateStandaloneSocialResponse(text, input.state),
      validationIssues: (text) => standaloneSocialValidationIssues(text, input.state),
      instructions: [
        'You write a complete standalone Messenger or Zalo response for KFC Vietnam.',
        `Prompt version: ${OpenAIStandaloneSocialComposer.promptVersion}.`,
        'Explicitly name every choice, price, status, missing detail, and next action needed from verified state/toolTrace.',
        'Use exact verified cart item names and totals when describing a cart update.',
        'Never claim that an order was created unless verified order state exists.',
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
