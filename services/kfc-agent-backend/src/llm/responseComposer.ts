import type { AgentGraphState } from '../graph/state.js';

export interface ResponseComposerInput {
  state: AgentGraphState;
  replyIntent: string;
  fallbackText: string;
}

export interface ResponseComposer {
  composeResponse(input: ResponseComposerInput): Promise<string>;
}

export interface OpenAIResponseComposerOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

interface ResponsesApiBody {
  output_text?: unknown;
  output?: Array<{
    content?: Array<{
      text?: unknown;
    }>;
  }>;
  error?: {
    message?: unknown;
  };
}

const OPENAI_RESPONSES_API_BASE_URL = 'https://api.openai.com/v1';

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

function buildPrompt(input: ResponseComposerInput): string {
  return JSON.stringify(
    {
      locale: 'vi-VN',
      role: 'KFC Vietnam ordering assistant',
      guardrails: [
        'Reply naturally in Vietnamese unless the customer used English.',
        'Use only verified state and toolTrace facts from this payload.',
	        'Do not change business decisions or invent facts not present in state/toolTrace.',
	        'Preserve the verifiedFallback action: if it asks for a missing detail, ask for that same detail; do not replace it with an upsell or unrelated next step.',
	        'When menuSearchResults has multiple items, mention the available choices from that list instead of defaulting to one product.',
        'Do not invent promotions, delivery availability, payment success, or order IDs.',
        'Keep the reply short enough for Messenger and Zalo.',
      ],
      latestUserMessage: input.state.latestUserMessage,
      recentTurns: input.state.recentTurns?.map((turn) => ({
        role: turn.role,
        text: turn.text,
      })),
      replyIntent: input.replyIntent,
      verifiedFallback: input.fallbackText,
      cart: input.state.cart,
      fulfillment: input.state.fulfillment,
      menuSearchResults: input.state.menuSearchResults,
      promotionContext: input.state.promotionContext,
      contentEvidence: input.state.contentEvidence,
      customerContext: input.state.customerContext,
      order: input.state.order,
      paymentMethodEvidence: input.state.paymentMethodEvidence,
      escalationReasons: input.state.escalationReasons,
      toolTrace: input.state.toolTrace,
      retrievedEvidence: input.state.retrievedEvidence,
    },
    null,
    2,
  );
}

export class OpenAIResponseComposer implements ResponseComposer {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OpenAIResponseComposerOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.baseUrl = trimTrailingSlash(options.baseUrl ?? OPENAI_RESPONSES_API_BASE_URL);
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
  }

  async composeResponse(input: ResponseComposerInput): Promise<string> {
    const response = await this.fetchImpl(`${this.baseUrl}/responses`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        instructions:
          'You rewrite verified KFC Vietnam ordering assistant outcomes into concise customer-facing chat replies. Keep the reply under 280 characters. Structured UI renders verified choices separately. Do not enumerate menu or cart items from state/toolTrace; summarize the result and tell the customer what to do next. Do not change business decisions or invent facts outside state/toolTrace.',
        input: buildPrompt(input),
      }),
    });

    const body = (await response.json().catch(() => ({}))) as ResponsesApiBody;
    if (!response.ok) {
      const message = typeof body.error?.message === 'string' ? body.error.message : response.statusText;
      throw new Error(`OpenAI response composition failed: ${message}`);
    }

    const outputText = extractOutputText(body);
    if (!outputText) {
      throw new Error('OpenAI response composition returned no text');
    }

    return outputText;
  }
}
