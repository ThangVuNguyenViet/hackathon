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
  supportsMultiStep?: boolean;
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
  directResponse: z.string().nullable().optional().transform((value) => value ?? undefined),
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
  searchMenu: { query: '<specific item/category text; omit for full menu discovery>' },
  getItemDetails: { code: '<verified_menu_item_code>' },
  getModifierOptions: { code: '<verified_menu_item_code>' },
  updateCart: { itemCode: '<verified_menu_item_code>', quantity: 1 },
  previewCart: {},
  recommendAddOns: {},
  findStores: { city: 'Hồ Chí Minh', district: 'Quận 1' },
  checkStoreAvailability: { storeId: '<verified_store_id>', itemCodes: ['<verified_menu_item_code>'], disposition: 'delivery' },
  quoteFulfillment: {
    address: {
      label: 'Nhà',
      line1: '72 Lê Thánh Tôn',
      district: 'Quận 1',
      city: 'Hồ Chí Minh',
    },
    method: 'delivery',
    itemCodes: ['<verified_menu_item_code>'],
  },
  searchPromotions: { query: '<specific promotion text; omit for current active promotion discovery>' },
  explainPromotion: { offerId: 'promotion-offer-id' },
  validateVoucher: { voucherText: '<customer voucher text>', subtotalVnd: 250000 },
  getMembershipProfile: {},
  listMembershipRewards: { query: 'đổi quà thành viên' },
  listMembershipWallet: { status: 'active' },
  getMembershipPointHistory: { days: 30 },
  listMembershipTools: { sideEffect: 'voucher_acquisition' },
  acquireVoucher: { rewardId: 'reward-discount-10k', confirmed: false },
  redeemReward: { voucherId: 'wallet-new-member-25k', channel: 'kiosk', confirmed: false },
  searchContentPolicy: { kind: 'allergen', query: '<specific safety/content text; omit for broad policy discovery>' },
  answerAllergenQuestion: { query: '<specific allergen question; omit for broad allergen evidence>' },
  previewOrder: {},
  placeOrder: {},
  getOrderStatus: { orderId: '<verified_order_id>' },
  createPaymentLink: { method: 'momo' },
  checkPaymentStatus: { orderId: '<verified_order_id>' },
  collectInvoice: { companyName: '<company_name>', taxCode: '<tax_code>', email: '<invoice_email>' },
  handoff: { reasons: ['customer_requested_human'] },
};

const planningExamples = [
  {
    user: 'Cho mình vài combo gà dễ ăn.',
    toolCalls: [{ toolName: 'searchMenu', arguments: { query: 'combo gà dễ ăn' } }],
  },
  {
    user: 'Mình có mã giảm giá, áp dụng giúp mình.',
    toolCalls: [{ toolName: 'validateVoucher', arguments: { voucherText: '<customer voucher text>', subtotalVnd: 250000 } }],
  },
  {
    user: 'Thanh toán bằng Momo được không?',
    toolCalls: [],
  },
  {
    user: 'Giao tới nơi gọi mình, đừng bấm chuông. Mình cần xuất hóa đơn công ty nữa.',
    toolCalls: [],
  },
  {
    user: 'Tên công ty <company_name>, MST <tax_code>, email <invoice_email>. Xác nhận đơn.',
    toolCalls: [
      { toolName: 'collectInvoice', arguments: { companyName: '<company_name>', taxCode: '<tax_code>', email: '<invoice_email>' } },
      { toolName: 'previewOrder', arguments: {} },
      { toolName: 'placeOrder', arguments: {} },
      { toolName: 'createPaymentLink', arguments: { method: 'momo' } },
    ],
  },
  {
    user: 'Đơn của mình tới đâu rồi? Bao lâu nữa giao tới?',
    toolCalls: [],
  },
  {
    user: 'Kiểm tra đơn <verified_order_id> giúp mình.',
    toolCalls: [{ toolName: 'getOrderStatus', arguments: { orderId: '<verified_order_id>' } }],
  },
  {
    user: 'Mình đặt đồ ăn trưa cho 10 người ở công ty. Tầm 300k thì ăn được gì?',
    toolCalls: [{ toolName: 'searchMenu', arguments: { query: 'combo nhóm 10 người ngân sách 300k' } }],
  },
  {
    user: 'Ok, thêm món đầu tiên vừa tìm được.',
    toolCalls: [{ toolName: 'updateCart', arguments: { itemCode: '<code_from_state_menu_search_results>', quantity: 1 } }],
  },
  {
    user: 'Cho mình combo gà đi.',
    toolCalls: [{ toolName: 'searchMenu', arguments: { query: 'combo gà' } }],
  },
  {
    user: 'Ok, nâng lên combo có thêm burger đi.',
    toolCalls: [{ toolName: 'searchMenu', arguments: { query: 'combo có burger' } }],
  },
  {
    user: 'Không, giữ vậy thôi, đừng thêm burger nữa.',
    toolCalls: [{ toolName: 'previewCart', arguments: {} }],
  },
  {
    user: 'Cho mình 1 burger tôm, giao về Nhà Bè được không?',
    toolCalls: [
      { toolName: 'searchMenu', arguments: { query: 'burger tôm' } },
      { toolName: 'findStores', arguments: { city: 'Hồ Chí Minh', district: 'Nhà Bè' } },
    ],
  },
  {
    user: 'Vậy lấy món vừa chọn, giao tới chỗ cũ nha.',
    toolCalls: [
      { toolName: 'updateCart', arguments: { itemCode: '<code_from_state_menu_search_results>', quantity: 1 } },
    ],
  },
  {
    user: 'Mình thêm 1 khoai nữa được không?',
    toolCalls: [
      { toolName: 'getOrderStatus', arguments: { orderId: '<verified_order_id>' } },
      { toolName: 'searchMenu', arguments: { query: 'khoai' } },
    ],
  },
  {
    user: 'Mình muốn hủy đơn vừa đặt.',
    toolCalls: [],
  },
  {
    user: 'Tiếp tục đặt.',
    toolCalls: [
      {
        toolName: 'checkStoreAvailability',
        arguments: { storeId: '<verified_store_id>', itemCodes: ['<verified_menu_item_code>'], disposition: 'delivery' },
      },
    ],
  },
  {
    user: 'Nếu đơn đã chuẩn bị hoặc đang giao rồi thì sao, mình vẫn muốn hủy.',
    toolCalls: [{ toolName: 'getOrderStatus', arguments: { orderId: '<verified_order_id>' } }],
  },
  {
    user: 'Chưa hủy, cho mình đặt lại đơn lần trước cho đồng nghiệp.',
    toolCalls: [
      { toolName: 'getOrderStatus', arguments: { orderId: '<verified_order_id>' } },
      { toolName: 'searchMenu', arguments: { query: 'đơn lần trước' } },
    ],
  },
  {
    user: 'Cho tui 2 gà kai vs 1 pesi nha.',
    toolCalls: [{ toolName: 'searchMenu', arguments: { query: 'gà cay đồ uống' } }],
  },
  {
    user: 'Món nào không cay với không có phô mai vậy?',
    toolCalls: [
      { toolName: 'searchContentPolicy', arguments: { kind: 'allergen', query: 'không cay không phô mai' } },
      { toolName: 'answerAllergenQuestion', arguments: { query: 'không cay không phô mai' } },
    ],
  },
  {
    user: 'Mình có điểm thành viên không?',
    toolCalls: [
      { toolName: 'getMembershipProfile', arguments: {} },
      { toolName: 'listMembershipRewards', arguments: { query: 'đổi điểm' } },
      { toolName: 'listMembershipWallet', arguments: { status: 'active' } },
      { toolName: 'getMembershipPointHistory', arguments: { days: 30 } },
    ],
  },
  {
    user: 'Ok, thêm combo đó. Mình có điểm thành viên không?',
    toolCalls: [
      { toolName: 'updateCart', arguments: { itemCode: '<code_from_state_menu_search_results>', quantity: 1 } },
      { toolName: 'getMembershipProfile', arguments: {} },
      { toolName: 'listMembershipRewards', arguments: { query: 'đổi điểm' } },
      { toolName: 'listMembershipWallet', arguments: { status: 'active' } },
      { toolName: 'getMembershipPointHistory', arguments: { days: 30 } },
    ],
  },
  {
    user: 'Bỏ món nước ra, đổi thành món nước khác được không?',
    toolCalls: [
      { toolName: 'searchMenu', arguments: { query: 'món nước khác' } },
      { toolName: 'previewCart', arguments: {} },
    ],
  },
  {
    user: 'Mình thanh toán rồi mà báo lỗi.',
    toolCalls: [{ toolName: 'checkPaymentStatus', arguments: { orderId: '<verified_order_id>' } }],
  },
  {
    user: 'Mình bấm thanh toán mà lỗi hoài.',
    toolCalls: [],
  },
  {
    user: 'Đặt cho mình 200 combo gà, giao trong 30 phút.',
    toolCalls: [
      { toolName: 'searchMenu', arguments: { query: 'combo gà' } },
      { toolName: 'handoff', arguments: { reasons: ['abnormal_large_order', 'human_review_required'] } },
    ],
  },
] satisfies Array<{ user: string; toolCalls: Array<{ toolName: ToolName; arguments: Record<string, unknown> }> }>;

export class StaticToolPlanner implements ToolPlanner {
  readonly supportsMultiStep = false;
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
  timeoutMs?: number;
}

export class OpenAIToolPlanner implements ToolPlanner {
  readonly supportsMultiStep = true;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: OpenAIToolPlannerOptions) {
    this.baseUrl = trimTrailingSlash(options.baseUrl ?? 'https://api.openai.com/v1');
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
  }

  async plan(input: ToolPlannerInput): Promise<ToolPlannerOutput> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 60_000);

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/responses`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${this.options.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.options.model,
          temperature: 0,
          instructions:
            [
            'You are a KFC Vietnam ordering tool planner. Return only JSON matching the requested schema.',
            'Choose tools for facts; do not invent business outcomes.',
            'You may be called repeatedly in one customer turn. After each tool result, use updated verified state for the next tool decision.',
            'Use planningExamples as few-shot guidance for tool selection and argument shape, adapting to the current state and latest user message.',
            'For broad menu discovery such as asking what is on the menu, call searchMenu with no query. For specific item/category requests, call searchMenu with the specific item or category text before updateCart.',
            'Use item codes only when they already appear in verified state.cart, state.menuSearchResults, or other verified state. Never infer catalog codes from examples.',
            'You may call multiple tools in one plan. If the user explicitly orders, adds, accepts, reorders, removes, or edits cart items, always include the cart tool in that same plan instead of stopping at lookup.',
            'For group meal, budget, best-seller, promotion, or upsell turns, combine searchMenu/searchPromotions with updateCart, previewCart, recommendAddOns, or getItemDetails when the user asks to choose or prepare a cart.',
            'Do not call updateCart for early recommendation, budget, or "what should I eat" turns until the user chooses a concrete combo/item or accepts an upsell.',
            'If the user says "Cho mình combo gà đi" or asks for a generic combo without size/count, searchMenu first and do not updateCart until they choose a concrete combo.',
            'When the user gives a voucher or promo code, call validateVoucher. Use searchPromotions only for general promotion discovery without a code.',
            'When the user only says they need an invoice but has not provided company name, tax code, or invoice email, do not call collectInvoice yet. Ask for those details.',
            'When the user gives company name, tax code, or invoice email, call collectInvoice.',
            'When the user confirms an order and state has a cart plus fulfillment, call previewOrder then placeOrder. If payment method is requested after order creation, call createPaymentLink.',
            'If an earlier turn requested Momo and the current turn confirms the order, include createPaymentLink with method momo after placeOrder.',
            'If the user only asks whether a payment method is available before confirming an order, do not call createPaymentLink.',
            'For order status, ETA, cancellation, post-order add-on, or reorder requests, call getOrderStatus only when the user message or verified state contains an order id; otherwise ask for the order id.',
            'If verified state contains an order id and the user asks to add an item to an existing order, getOrderStatus is mandatory in the same plan.',
            'If the user wants to continue after availability, address, or fulfillment risk, call checkStoreAvailability or quoteFulfillment before previewing or placing anything.',
            'For address ambiguity, out-of-area, store availability, or fulfillment risk, call findStores, checkStoreAvailability, or quoteFulfillment as appropriate.',
            'For allergen, cheese, spicy, ingredient, content-policy, spam, ambiguous, or out-of-scope safety turns, call searchContentPolicy or answerAllergenQuestion when food-safety facts are requested.',
            'For membership, rewards, wallet vouchers, loyalty points, favorite items, or member profile turns, call getMembershipProfile, listMembershipRewards, listMembershipWallet, or getMembershipPointHistory as appropriate.',
            'If a membership turn also says thêm combo đó, add the referenced combo with updateCart before membership lookup.',
            'Do not call handoff for loyalty, favorites, reorder, cart edit, remove, replace, or normal membership turns. Handoff is only for explicit human requests, active complaints, persistent verified payment failure, or abnormal large orders.',
            'For payment failure, payment link failure, or payment status turns, call checkPaymentStatus only when the user message or verified state contains an order id; otherwise ask for the order id. For abnormal large orders or explicit human review, call handoff.',
            'For modifier questions, call getModifierOptions with the selected item code when known, otherwise searchMenu first.',
            'If the user asks to remove or replace an item with words like bỏ, remove, đổi thành, or replace, always include updateCart or previewCart; do not stop at getModifierOptions.',
            'Remove/replace instructions override modifier-only lookup. For drink replacement requests, include updateCart or previewCart even if you also call getModifierOptions.',
            'If state.cart has exactly one item and the user asks about changing drinks, substitutions, or options without remove/replace wording, call getModifierOptions with that cart itemCode; do not answer modifier availability from searchMenu alone.',
            'For delivery or pickup requests, call quoteFulfillment only with a complete address object, method, and itemCodes from verified cart/menu state.',
            'If state.cart has items and the user gives a delivery address, call quoteFulfillment with method delivery and itemCodes from state.cart.items.',
            'For broad promotion discovery, call searchPromotions with no query. For specific voucher or promotion questions, call searchPromotions or validateVoucher with the specific user text.',
            'Only include responseClaims when the response will claim promotion, payment success, or allergen certainty; leave it empty for normal menu/cart actions.',
            ].join(' '),
          input: JSON.stringify(
            {
              locale: 'vi-VN',
              state: input.state,
              availableTools: input.availableTools,
              recentTurns: input.recentTurns.slice(-8),
              toolArgumentExamples,
              planningExamples,
              outputSchema: {
                intent:
                  'ordering|cart_edit|voucher|payment|order_status|complaint|feedback|handoff|safety|unclear',
                entities: {},
                toolCalls: [{ toolName: 'searchMenu', arguments: { query: '<specific item/category text or omit for full menu>' } }],
                responseClaims: [],
                directResponse: 'optional response when no tool call is needed',
              },
            },
            null,
            2,
          ),
        }),
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(`OpenAI tool planning timed out after ${this.options.timeoutMs ?? 60_000}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }

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
