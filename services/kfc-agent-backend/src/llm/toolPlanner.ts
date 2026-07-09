import { z } from 'zod';
import type { ConversationTurn, Intent } from '../domain/types.js';
import type { AgentGraphState } from '../graph/state.js';
import { toolNames } from '../ordering/toolCatalog.js';
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
  if (typeof body.output_text === 'string' && body.output_text.trim().length > 0) {
    return body.output_text.trim();
  }
  for (const item of body.output ?? []) {
    for (const content of item.content ?? []) {
      if (typeof content.text === 'string' && content.text.trim().length > 0) {
        return content.text.trim();
      }
    }
  }
  return undefined;
}

function isToolName(value: string): value is ToolName {
  return toolNames.includes(value as ToolName);
}

function validateToolCalls(
  toolCalls: Array<{ toolName: string; arguments: Record<string, unknown> }>,
  availableTools: ToolName[],
): ToolCallRequest[] {
  const availableToolSet = new Set<string>(availableTools);

  return toolCalls.map(({ toolName, arguments: args }) => {
    if (!isToolName(toolName)) {
      throw new Error(`OpenAI tool planner proposed unknown tool: ${toolName}`);
    }

    if (!availableToolSet.has(toolName)) {
      throw new Error(`OpenAI tool planner proposed unavailable tool: ${toolName}`);
    }

    return {
      toolName,
      arguments: args,
    } satisfies ToolCallRequest;
  });
}

function trimTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

const toolArgumentExamples: Record<ToolName, Record<string, unknown>> = {
  searchMenu: { query: 'Combo Hợp Gu 99K' },
  getItemDetails: { code: '20751' },
  getModifierOptions: { code: '20751' },
  updateCart: { itemCode: '20751', quantity: 1 },
  previewCart: {},
  recommendAddOns: {},
  findStores: { city: 'Hồ Chí Minh', district: 'Quận 1' },
  checkStoreAvailability: { storeId: 'KFCVN0002', itemCodes: ['20751'], disposition: 'delivery' },
  quoteFulfillment: {
    address: {
      label: 'Nhà',
      line1: '72 Lê Thánh Tôn',
      district: 'Quận 1',
      city: 'Hồ Chí Minh',
    },
    method: 'delivery',
    itemCodes: ['20751'],
  },
  searchPromotions: { query: 'ưu đãi hiện có' },
  explainPromotion: { offerId: 'promotion-offer-id' },
  validateVoucher: { voucherText: 'KFC50', subtotalVnd: 250000 },
  getMembershipProfile: {},
  listMembershipRewards: { query: 'đổi quà pepsi' },
  listMembershipWallet: { status: 'active' },
  getMembershipPointHistory: { days: 30 },
  listMembershipTools: { sideEffect: 'voucher_acquisition' },
  acquireVoucher: { rewardId: 'reward-discount-10k', confirmed: false },
  redeemReward: { voucherId: 'wallet-new-member-25k', channel: 'kiosk', confirmed: false },
  searchContentPolicy: { kind: 'allergen', query: 'dị ứng hải sản' },
  answerAllergenQuestion: { query: 'Combo Hợp Gu 99K có dị ứng gì?' },
  previewOrder: {},
  placeOrder: {},
  getOrderStatus: { orderId: 'KFC-MOCK-1001' },
  createPaymentLink: { method: 'momo' },
  checkPaymentStatus: { orderId: 'KFC-MOCK-1001' },
  collectInvoice: { companyName: 'Công ty ABC', taxCode: '0312345678', email: 'finance@abc.test' },
  handoff: { reasons: ['customer_requested_human'] },
};

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
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
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
          [
            'You are a KFC Vietnam ordering tool planner. Return only JSON matching the requested schema.',
            'Choose tools for facts; do not invent business outcomes.',
            'For menu/order requests, call searchMenu with a non-empty query copied from the user item text before updateCart.',
            'For modifier questions, call getModifierOptions with the selected item code when known, otherwise searchMenu first.',
            'If state.cart has exactly one item and the user asks about changing drinks, Pepsi, 7UP, substitutions, or options, call getModifierOptions with that cart itemCode; do not answer modifier availability from searchMenu alone.',
            'For delivery or pickup requests, call quoteFulfillment only with a complete address object, method, and itemCodes from verified cart/menu state.',
            'If state.cart has items and the user gives a delivery address, call quoteFulfillment with method delivery and itemCodes from state.cart.items.',
            'For voucher or promotion questions, call searchPromotions or validateVoucher with non-empty arguments.',
            'Only include responseClaims when the response will claim promotion, payment success, or allergen certainty; leave it empty for normal menu/cart actions.',
          ].join(' '),
        input: JSON.stringify(
          {
            locale: 'vi-VN',
            state: input.state,
            availableTools: input.availableTools,
            recentTurns: input.recentTurns.slice(-8),
            toolArgumentExamples,
            outputSchema: {
              intent:
                'ordering|cart_edit|voucher|payment|order_status|complaint|feedback|handoff|safety|unclear',
              entities: {},
              toolCalls: [{ toolName: 'searchMenu', arguments: { query: 'Combo Hợp Gu 99K' } }],
              responseClaims: [],
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
      toolCalls: validateToolCalls(parsed.toolCalls, input.availableTools),
      responseClaims: parsed.responseClaims,
      directResponse: parsed.directResponse,
    };
  }
}
