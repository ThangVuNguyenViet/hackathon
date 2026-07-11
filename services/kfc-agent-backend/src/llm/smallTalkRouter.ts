import { z } from 'zod';
import type { Channel } from '../domain/types.js';

export interface SmallTalkRouterInput {
  latestUserMessage: string;
  channel: Channel;
  hasStructuredAction: boolean;
}

export type SmallTalkRouterOutput =
  | { decision: 'handle_social'; responseText: string }
  | { decision: 'continue_to_planner' };

export interface SmallTalkRouter {
  readonly model?: string;
  readonly promptVersion?: string;
  route(input: SmallTalkRouterInput): Promise<SmallTalkRouterOutput>;
}

export interface OpenAISmallTalkRouterOptions {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

const outputSchema = z.discriminatedUnion('decision', [
  z.object({
    decision: z.literal('handle_social'),
    responseText: z.string().trim().min(1),
  }),
  z.object({
    decision: z.literal('continue_to_planner'),
    responseText: z.never().optional(),
  }),
]);

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

const defaultBaseUrl = 'https://api.openai.com/v1';
const defaultModel = 'gpt-4.1-nano';
const defaultTimeoutMs = 2_500;

const instructions = [
  'Route a KFC Vietnam customer turn and return only JSON matching the requested schema.',
  'Use handle_social only for a self-contained greeting, thanks, or goodbye, and write a brief natural customer-facing responseText in the language used by the customer.',
  'Use continue_to_planner for menu, pricing, promotions, products, recommendations, cart, ordering, fulfillment, vouchers, loyalty, payment, invoices, order status, complaints, feedback, safety, allergens, handoff, mixed turns, acknowledgements, confirmations, references, ambiguity, or structured actions.',
  'Any uncertainty must return continue_to_planner.',
].join(' ');

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

export class OpenAISmallTalkRouter implements SmallTalkRouter {
  readonly model: string;
  readonly promptVersion = 'small-talk-router-v1';

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OpenAISmallTalkRouterOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model ?? defaultModel;
    this.baseUrl = trimTrailingSlash(options.baseUrl ?? defaultBaseUrl);
    this.timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
  }

  async route(input: SmallTalkRouterInput): Promise<SmallTalkRouterOutput> {
    if (input.hasStructuredAction) {
      return { decision: 'continue_to_planner' };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(`${this.baseUrl}/responses`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          temperature: 0,
          instructions,
          input: JSON.stringify({
            latestUserMessage: input.latestUserMessage,
            channel: input.channel,
          }),
        }),
      });

      const body = (await response.json().catch(() => ({}))) as ResponsesApiBody;
      if (!response.ok) {
        const detail = typeof body.error?.message === 'string' ? `: ${body.error.message}` : '';
        throw new Error(`OpenAI small-talk router failed: HTTP ${response.status}${detail}`);
      }

      const outputText = extractOutputText(body);
      if (!outputText) {
        throw new Error('OpenAI small-talk router returned no text');
      }

      return outputSchema.parse(JSON.parse(outputText));
    } finally {
      clearTimeout(timeout);
    }
  }
}
