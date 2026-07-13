import type { AgentGraphState } from '../graph/state.js';
import type { Channel } from '../domain/types.js';
import type { ChannelPresentationMode } from '../presentation/channelPresentation.js';
import { responseProfileForChannel } from '../presentation/responseProfile.js';

export interface VerifiedResponseComposerInput {
  state: AgentGraphState;
  replyIntent: string;
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
        'Preserve the verifiedFallback action and requested missing detail.',
        'Do not invent promotions, delivery availability, payment success, or order IDs.',
      ],
      latestUserMessage: input.state.latestUserMessage,
      recentTurns: input.state.recentTurns?.map((turn) => ({ role: turn.role, text: turn.text })),
      replyIntent: input.replyIntent,
      verifiedFallback: input.fallbackText,
      cart: input.state.cart,
      fulfillment: input.state.fulfillment,
      menuSearchResults: input.state.menuSearchResults,
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

export function validateStandaloneSocialText(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.length > 0 && trimmed.length <= 1200 && !forbiddenSocialUiReference.test(trimmed);
}

export function validateStandaloneSocialResponse(
  text: string,
  state: AgentGraphState,
): boolean {
  if (!validateStandaloneSocialText(text)) return false;
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
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await this.fetchImpl(`${this.baseUrl}/responses`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.options.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.options.model,
          instructions: input.instructions,
          input: buildVerifiedPrompt(input.payload),
        }),
      });
      const body = (await response.json().catch(() => ({}))) as ResponsesApiBody;
      if (!response.ok) {
        const message = typeof body.error?.message === 'string' ? body.error.message : response.statusText;
        throw new Error(`${input.component} failed: ${message}`);
      }
      const outputText = extractOutputText(body);
      if (outputText && input.validate(outputText)) return outputText;
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
      component: 'OpenAI GenUI companion composition',
      payload: input,
      validate: validateGenUiCompanionText,
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
      component: 'OpenAI standalone social composition',
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
