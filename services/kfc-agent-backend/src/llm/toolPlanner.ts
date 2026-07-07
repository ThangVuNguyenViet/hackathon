import { z } from 'zod';
import type { ConversationTurn, Intent } from '../domain/types.js';
import type { AgentGraphState } from '../graph/state.js';
import type { ToolCallRequest, ToolName } from '../ordering/types.js';

export interface ToolPlannerInput {
  state: AgentGraphState;
  availableTools: ToolName[];
  recentTurns: ConversationTurn[];
}

export interface ToolPlannerOutput {
  intent: Intent;
  entities: Record<string, unknown>;
  toolCalls: ToolCallRequest[];
  responseClaims: Array<'promotion' | 'payment_success' | 'allergen_certainty'>;
  directResponse?: string;
}

export interface ToolPlanner {
  plan(input: ToolPlannerInput): Promise<ToolPlannerOutput>;
}

const plannerOutputSchema = z.object({
  intent: z.enum([
    'ordering',
    'cart_edit',
    'voucher',
    'payment',
    'order_status',
    'complaint',
    'feedback',
    'handoff',
    'safety',
    'unclear',
  ]),
  entities: z.record(z.unknown()).default({}),
  toolCalls: z
    .array(
      z.object({
        toolName: z.string(),
        arguments: z.record(z.unknown()),
      }),
    )
    .default([]),
  responseClaims: z.array(z.enum(['promotion', 'payment_success', 'allergen_certainty'])).default([]),
  directResponse: z.string().optional(),
});

interface ResponsesBody {
  output_text?: unknown;
  output?: Array<{ content?: Array<{ text?: unknown }> }>;
  error?: { message?: unknown };
}

function extractText(body: ResponsesBody): string | undefined {
  if (typeof body.output_text === 'string') return body.output_text;
  for (const item of body.output ?? []) {
    for (const content of item.content ?? []) {
      if (typeof content.text === 'string') return content.text;
    }
  }
  return undefined;
}

function trimTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

export class StaticToolPlanner implements ToolPlanner {
  private index = 0;

  constructor(private readonly outputs: ToolPlannerOutput[]) {}

  async plan(_input: ToolPlannerInput): Promise<ToolPlannerOutput> {
    const output = this.outputs[this.index] ?? this.outputs.at(-1);
    this.index += 1;
    if (!output) {
      return {
        intent: 'unclear',
        entities: {},
        toolCalls: [],
        responseClaims: [],
        directResponse: 'Mình cần thêm thông tin để hỗ trợ đúng.',
      };
    }
    return output;
  }
}

export interface OpenAIToolPlannerOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export class OpenAIToolPlanner implements ToolPlanner {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: OpenAIToolPlannerOptions) {
    this.baseUrl = trimTrailingSlash(options.baseUrl ?? 'https://api.openai.com/v1');
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async plan(input: ToolPlannerInput): Promise<ToolPlannerOutput> {
    const response = await this.fetchImpl(`${this.baseUrl}/responses`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.options.model,
        instructions:
          'You are a KFC Vietnam ordering tool planner. Return only JSON matching the requested schema. Choose tools for facts; do not invent business outcomes.',
        input: JSON.stringify(
          {
            locale: 'vi-VN',
            state: input.state,
            availableTools: input.availableTools,
            recentTurns: input.recentTurns.slice(-8),
            outputSchema: {
              intent:
                'ordering|cart_edit|voucher|payment|order_status|complaint|feedback|handoff|safety|unclear',
              entities: {},
              toolCalls: [{ toolName: 'searchMenu', arguments: {} }],
              responseClaims: ['promotion'],
              directResponse: 'optional response when no tool call is needed',
            },
          },
          null,
          2,
        ),
      }),
    });

    const body = (await response.json().catch(() => ({}))) as ResponsesBody;
    if (!response.ok) {
      const message = typeof body.error?.message === 'string' ? body.error.message : response.statusText;
      throw new Error(`OpenAI tool planning failed: ${message}`);
    }

    const text = extractText(body);
    if (!text) throw new Error('OpenAI tool planning returned no text');
    const parsed = plannerOutputSchema.parse(JSON.parse(text));
    return {
      intent: parsed.intent,
      entities: parsed.entities,
      toolCalls: parsed.toolCalls as ToolCallRequest[],
      responseClaims: parsed.responseClaims,
      directResponse: parsed.directResponse,
    };
  }
}
