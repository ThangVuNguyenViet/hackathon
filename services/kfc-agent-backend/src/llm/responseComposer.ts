import type { AgentGraphState } from '../graph/state.js';
import type { OrderStatus, PaymentStatus, ResponseMode } from '../domain/types.js';
import type { FulfillmentMethod, PaymentAttempt, PaymentLinkMethod, PromotionValidationResult } from '../ordering/types.js';

export interface ResponseComposerInput {
  state: AgentGraphState;
  replyIntent: string;
  fallbackText: string;
  responseMode: ResponseMode;
  verifiedPlan: VerifiedResponsePlan;
}

export type VerifiedResponseFact =
  | {
      kind: 'menu_choices';
      items: Array<{ itemCode: string; name: string; priceVnd: number; available: boolean }>;
    }
  | {
      kind: 'cart';
      items: Array<{ itemCode: string; name: string; quantity: number; unitPriceVnd: number }>;
      subtotalVnd: number;
      discountVnd: number;
      deliveryFeeVnd: number;
      totalVnd: number;
      voucherCode: string | null;
    }
  | {
      kind: 'fulfillment';
      method: FulfillmentMethod;
      storeName: string;
      feeVnd: number;
      etaMinutes: number;
      address?: { line1: string; district: string; city: string } | undefined;
    }
  | {
      kind: 'payment_methods';
      methods: Array<{ methodId: string; displayName: string; supported: boolean }>;
    }
  | {
      kind: 'order';
      orderId: string;
      status: OrderStatus;
      paymentStatus: PaymentStatus;
    }
  | {
      kind: 'payment_attempt';
      method?: PaymentLinkMethod | undefined;
      status: PaymentAttempt['status'];
      paymentUrl?: string | undefined;
    }
  | {
      kind: 'promotion';
      valid: boolean;
      code: string;
      discountVnd: number;
      reason: PromotionValidationResult['reason'];
    };

export interface VerifiedResponsePlan {
  responseMode: ResponseMode;
  presentation: 'structured_ui_summary' | 'standalone_text';
  facts: VerifiedResponseFact[];
  requiredOutcome: string;
  structuredUiAvailable: boolean;
}

export interface ResponseComposer {
  composeResponse(input: ResponseComposerInput): Promise<string>;
}

export interface OpenAIResponseComposerOptions {
  apiKey: string;
  model: string;
  baseUrl?: string | undefined;
  fetchImpl?: typeof fetch | undefined;
}

interface ResponsesApiBody {
  output_text?: unknown | undefined;
  output?: Array<{
    content?: Array<{
      text?: unknown | undefined;
    }> | undefined;
  }> | undefined;
  error?: {
    message?: unknown | undefined;
  } | undefined;
}

const OPENAI_RESPONSES_API_BASE_URL = 'https://api.openai.com/v1';

function responseStyleForMode(responseMode: ResponseMode): string {
  return responseMode === 'genui'
    ? 'A structured UI renders verified choices separately; summarize the result and tell the customer what to do next without enumerating the same choices.'
    : 'No structured UI is available; include the relevant verified choices, prices, or next-step details directly in the concise text reply.';
}

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
  const responseStyle = responseStyleForMode(input.responseMode);
  return JSON.stringify(
    {
      locale: 'vi-VN',
      role: 'KFC Vietnam ordering assistant',
      guardrails: [
        'Reply naturally in Vietnamese unless the customer used English.',
        'Use only verified state and toolTrace facts from this payload.',
        'Do not change business decisions or invent facts not present in state/toolTrace.',
        'Preserve the verifiedFallback action: if it asks for a missing detail, ask for that same detail; do not replace it with an upsell or unrelated next step.',
        responseStyle,
        'Do not invent promotions, delivery availability, payment success, or order IDs.',
        'Keep the reply short enough for Messenger and Zalo.',
      ],
      latestUserMessage: input.state.latestUserMessage,
      recentTurns: input.state.recentTurns?.map((turn) => ({
        role: turn.role,
        text: turn.text,
      })),
      replyIntent: input.replyIntent,
      responseMode: input.responseMode,
      verifiedResponsePlan: input.verifiedPlan,
      verifiedFallback: input.fallbackText,
      contentEvidence: input.state.contentEvidence,
      customerContext: input.state.customerContext,
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
          `You rewrite verified KFC Vietnam ordering assistant outcomes into concise customer-facing chat replies. Keep the reply under 280 characters. ${responseStyleForMode(input.responseMode)} Do not change business decisions or invent facts outside state/toolTrace.`,
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
