import { z } from 'zod';
import type { Channel } from '../domain/types.js';
import {
  assertOpenAiResponseOk,
  createOpenAiRequestMetadata,
  openAiRequestHeaders,
  type OpenAiDiagnosticContext,
} from './openAiDiagnostics.js';

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
  diagnosticContext?: OpenAiDiagnosticContext;
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

const structuredOutputSchema = z
  .object({
    decision: z.enum(['handle_social', 'continue_to_planner']),
    responseText: z.string().nullable(),
  })
  .strict();

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
const defaultModel = 'gpt-4.1-mini';
const defaultTimeoutMs = 2_500;

const outputJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    decision: { type: 'string', enum: ['handle_social', 'continue_to_planner'] },
    responseText: { type: ['string', 'null'] },
  },
  required: ['decision', 'responseText'],
} as const;

const instructions = [
  'Route a KFC Vietnam customer turn and return only JSON matching the requested schema.',
  'Use handle_social only when the entire turn is unambiguously a self-contained greeting, thanks, or goodbye, with no request, acknowledgement, reference, ambiguity, or business purpose.',
  'For handle_social, write a brief natural customer-facing responseText in the language used by the customer.',
  'Use continue_to_planner for menu, pricing, promotions, products, recommendations, cart, ordering, fulfillment, vouchers, loyalty, payment, invoices, order status, complaints, feedback, safety, allergens, handoff, mixed turns, acknowledgements, confirmations, references, ambiguity, or structured actions.',
  'Do not treat gratitude alone as an acknowledgement; a pure standalone expression of thanks is self-contained social talk.',
  'Here acknowledgement means assent, agreement, acceptance, confirmation, or a reference to prior content beyond the gratitude itself.',
  'An acknowledgement, confirmation, reference, or ambiguity must continue_to_planner even if it also contains thanks.',
  'Treat acknowledgement and confirmation as non-social compound pragmatic acts, never as self-contained thanks or goodbye.',
  'A turn combining thanks with an affirmative or assenting utterance is ambiguous and must continue_to_planner.',
  'Treat any assent, agreement, acceptance, or confirmation marker as an acknowledgement and return continue_to_planner.',
  'handle_social has zero tolerance for any possible acknowledgement, confirmation, assent, agreement, or acceptance in any language.',
  'Any uncertainty must return continue_to_planner. For continue_to_planner, responseText must be null.',
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

function parseStructuredOutput(outputText: string): SmallTalkRouterOutput {
  const output = structuredOutputSchema.parse(JSON.parse(outputText));
  if (output.decision === 'handle_social') {
    return outputSchema.parse(output);
  }

  if (output.responseText !== null) {
    throw new Error('OpenAI small-talk router returned response text for a planner decision');
  }

  return { decision: 'continue_to_planner' };
}

export class OpenAISmallTalkRouter implements SmallTalkRouter {
  readonly model: string;
  readonly promptVersion = 'small-talk-router-v1';

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly diagnosticContext?: OpenAiDiagnosticContext;

  constructor(options: OpenAISmallTalkRouterOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model ?? defaultModel;
    this.baseUrl = trimTrailingSlash(options.baseUrl ?? defaultBaseUrl);
    this.timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
    this.diagnosticContext = options.diagnosticContext;
  }

  async route(input: SmallTalkRouterInput): Promise<SmallTalkRouterOutput> {
    if (input.hasStructuredAction) {
      return { decision: 'continue_to_planner' };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const requestMetadata = createOpenAiRequestMetadata(
        'small-talk router',
        this.model,
        this.diagnosticContext,
      );
      const response = await this.fetchImpl(`${this.baseUrl}/responses`, {
        method: 'POST',
        signal: controller.signal,
        headers: openAiRequestHeaders(this.apiKey, requestMetadata),
        body: JSON.stringify({
          model: this.model,
          temperature: 0,
          text: {
            format: {
              type: 'json_schema',
              name: 'small_talk_router_output',
              strict: true,
              schema: outputJsonSchema,
            },
          },
          instructions,
          input: JSON.stringify({
            latestUserMessage: input.latestUserMessage,
            channel: input.channel,
          }),
        }),
      });

      const body = (await response.json().catch(() => ({}))) as ResponsesApiBody;
      assertOpenAiResponseOk(response, body, requestMetadata);

      const outputText = extractOutputText(body);
      if (!outputText) {
        throw new Error('OpenAI small-talk router returned no text');
      }

      return parseStructuredOutput(outputText);
    } finally {
      clearTimeout(timeout);
    }
  }
}
