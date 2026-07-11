import { z } from 'zod';
import type { ConversationTurn, Intent } from '../domain/types.js';
import type { AgentGraphState } from '../graph/state.js';
import type { ContextPolicyDirective } from '../graph/contextPolicy.js';
import { toolNames } from '../ordering/toolCatalog.js';
import type { ToolCallRequest, ToolName } from '../ordering/types.js';

export interface ToolPlannerInput {
  state: AgentGraphState;
  availableTools: ToolName[];
  recentTurns: ConversationTurn[];
}

export interface ToolPlannerOutput {
  intent: Intent;
  contextPolicy?: ContextPolicyDirective;
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
  intent: z.enum(['ordering', 'cart_edit', 'voucher', 'payment', 'order_status', 'complaint', 'feedback', 'handoff', 'safety', 'unclear']),
  contextPolicy: z
    .object({
      cart: z.enum(['active', 'confirm_before_use', 'irrelevant']).optional(),
      order: z.enum(['active', 'confirm_before_use', 'irrelevant']).optional(),
      fulfillment: z.enum(['active', 'confirm_before_use', 'irrelevant']).optional(),
      promotion: z.enum(['active', 'confirm_before_use', 'irrelevant']).optional(),
      menuSearchResults: z.enum(['active', 'confirm_before_use', 'irrelevant']).optional(),
      payment: z.enum(['active', 'confirm_before_use', 'irrelevant']).optional(),
      invoice: z.enum(['active', 'confirm_before_use', 'irrelevant']).optional(),
      handoff: z.enum(['active', 'confirm_before_use', 'irrelevant']).optional(),
      recentTurns: z.enum(['active', 'confirm_before_use', 'irrelevant']).optional(),
      customer: z.enum(['active', 'confirm_before_use', 'irrelevant']).optional(),
      membership: z.enum(['active', 'confirm_before_use', 'irrelevant']).optional(),
      recentOrder: z.enum(['active', 'confirm_before_use', 'irrelevant']).optional(),
    })
    .default({}),
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
  directResponse: z
    .string()
    .nullable()
    .optional()
    .transform((value) => value ?? undefined),
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

function normalizedPlannerText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .toLowerCase();
}

export function ensureAcceptedComboModifierLookup(
  input: ToolPlannerInput,
  output: ToolPlannerOutput,
): ToolPlannerOutput {
  const text = normalizedPlannerText(input.state.latestUserMessage);
  if (!text.includes('doi sang') || !text.includes('combo')) return output;

  const comboUpdate = [...output.toolCalls]
    .reverse()
    .find(
      (call) =>
        call.toolName === 'updateCart' &&
        typeof call.arguments.itemCode === 'string' &&
        typeof call.arguments.quantity === 'number' &&
        call.arguments.quantity > 0,
    );
  if (!comboUpdate || typeof comboUpdate.arguments.itemCode !== 'string') return output;

  const availableTools = new Set(input.availableTools);
  const toolCalls = [...output.toolCalls];
  if (availableTools.has('getModifierOptions') && !toolCalls.some((call) => call.toolName === 'getModifierOptions')) {
    toolCalls.push({
      toolName: 'getModifierOptions',
      arguments: { code: comboUpdate.arguments.itemCode },
    });
  }
  if (availableTools.has('previewCart') && !toolCalls.some((call) => call.toolName === 'previewCart')) {
    toolCalls.push({ toolName: 'previewCart', arguments: {} });
  }

  return { ...output, toolCalls };
}

function trimTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

const toolArgumentExamples: Record<ToolName, Record<string, unknown>> = {
  searchMenu: {
    query: '<specific item/category text; omit for full menu discovery>',
  },
  getItemDetails: { code: '<verified_menu_item_code>' },
  getModifierOptions: { code: '<verified_menu_item_code>' },
  updateCart: { itemCode: '<verified_menu_item_code>', quantity: 1 },
  previewCart: {},
  recommendAddOns: {},
  findStores: { city: 'Hồ Chí Minh', district: 'Quận 1' },
  checkStoreAvailability: {
    storeId: '<verified_store_id>',
    itemCodes: ['<verified_menu_item_code>'],
    disposition: 'delivery',
  },
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
  searchPromotions: {
    query: '<specific promotion text; omit for current active promotion discovery>',
  },
  explainPromotion: { offerId: 'promotion-offer-id' },
  validateVoucher: {
    voucherText: '<customer voucher text>',
    subtotalVnd: 250000,
  },
  getMembershipProfile: {},
  listMembershipRewards: { query: 'đổi quà thành viên' },
  listMembershipWallet: { status: 'active' },
  getMembershipPointHistory: { days: 30 },
  listMembershipTools: { sideEffect: 'voucher_acquisition' },
  listPaymentMethods: {
    query: '<payment method name or omit for all website checkout methods>',
  },
  acquireVoucher: { rewardId: 'reward-discount-10k', confirmed: false },
  redeemReward: {
    voucherId: 'wallet-new-member-25k',
    channel: 'kiosk',
    confirmed: false,
  },
  searchContentPolicy: {
    kind: 'allergen',
    query: '<specific safety/content text; omit for broad policy discovery>',
  },
  answerAllergenQuestion: {
    query: '<specific allergen question; omit for broad allergen evidence>',
  },
  previewOrder: {},
  placeOrder: {},
  getOrderStatus: { orderId: '<verified_order_id>' },
  createPaymentLink: { method: 'zalopay' },
  checkPaymentStatus: { orderId: '<verified_order_id>' },
  collectInvoice: {
    companyName: '<company_name>',
    taxCode: '<tax_code>',
    email: '<invoice_email>',
  },
  handoff: { reasons: ['customer_requested_human'] },
};

const planningExamples = [
  {
    user: 'Xin chào KFC',
    intent: 'unclear',
    entities: { smallTalk: true },
    toolCalls: [],
    directResponse: '<short natural greeting>',
  },
  {
    user: 'Cho mình vài món theo mô tả này.',
    toolCalls: [
      {
        toolName: 'searchMenu',
        arguments: { query: '<requested category or preference text>' },
      },
    ],
  },
  {
    user: 'Cho mình 1 món chính, 1 món ăn kèm và 2 đồ uống, giao về địa chỉ mình vừa cung cấp.',
    toolCalls: [
      {
        toolName: 'searchMenu',
        arguments: { query: '<first requested item text>' },
      },
      {
        toolName: 'updateCart',
        arguments: {
          itemCode: '<code_from_state_menu_search_results>',
          quantity: 1,
        },
      },
      {
        toolName: 'searchMenu',
        arguments: { query: '<second requested item text>' },
      },
      {
        toolName: 'updateCart',
        arguments: {
          itemCode: '<code_from_state_menu_search_results>',
          quantity: 1,
        },
      },
      { toolName: 'searchMenu', arguments: { query: '<drink text>' } },
      {
        toolName: 'updateCart',
        arguments: {
          itemCode: '<code_from_state_menu_search_results>',
          quantity: 2,
        },
      },
    ],
  },
  {
    user: 'Mình có mã giảm giá, áp dụng giúp mình.',
    toolCalls: [
      {
        toolName: 'validateVoucher',
        arguments: {
          voucherText: '<customer voucher text>',
          subtotalVnd: 250000,
        },
      },
    ],
  },
  {
    user: 'Thanh toán bằng phương thức này được không?',
    toolCalls: [
      {
        toolName: 'listPaymentMethods',
        arguments: {
          query: '<requested payment method or omit for all methods>',
        },
      },
    ],
  },
  {
    user: 'KFC có những phương thức thanh toán nào?',
    toolCalls: [{ toolName: 'listPaymentMethods', arguments: {} }],
  },
  {
    user: 'Mình có ghi chú giao hàng và cần xuất hóa đơn.',
    toolCalls: [],
  },
  {
    user: 'Tên công ty <company_name>, MST <tax_code>, email <invoice_email>. Xác nhận đơn.',
    entities: { orderConfirmed: true, paymentMethod: 'zalopay' },
    toolCalls: [
      {
        toolName: 'collectInvoice',
        arguments: {
          companyName: '<company_name>',
          taxCode: '<tax_code>',
          email: '<invoice_email>',
        },
      },
      { toolName: 'previewOrder', arguments: {} },
      { toolName: 'placeOrder', arguments: {} },
      { toolName: 'createPaymentLink', arguments: { method: 'zalopay' } },
    ],
  },
  {
    user: 'Kiểm tra đơn <verified_order_id> giúp mình.',
    toolCalls: [
      {
        toolName: 'getOrderStatus',
        arguments: { orderId: '<verified_order_id>' },
      },
    ],
  },
  {
    user: 'Mình đặt cho một nhóm với ngân sách này.',
    toolCalls: [
      {
        toolName: 'searchMenu',
        arguments: {},
      },
    ],
  },
  {
    user: 'Ok, thêm món đầu tiên vừa tìm được.',
    toolCalls: [
      {
        toolName: 'updateCart',
        arguments: {
          itemCode: '<code_from_state_menu_search_results>',
          quantity: 1,
        },
      },
    ],
  },
  {
    user: 'Cho mình một nhóm món chung chung.',
    toolCalls: [
      {
        toolName: 'searchMenu',
        arguments: { query: '<generic menu category text>' },
      },
    ],
  },
  {
    user: 'Ok, đổi sang combo đã xác minh này thay cho các món lẻ.',
    toolCalls: [
      {
        toolName: 'updateCart',
        arguments: { itemCode: '<verified_combo_code>', quantity: 1 },
      },
      { toolName: 'getModifierOptions', arguments: { code: '<verified_combo_code>' } },
      { toolName: 'previewCart', arguments: {} },
    ],
  },
  {
    user: 'Không, giữ vậy thôi, đừng thêm món nữa.',
    toolCalls: [{ toolName: 'previewCart', arguments: {} }],
  },
  {
    user: 'Cho mình 1 món này, giao về địa chỉ này được không?',
    toolCalls: [
      { toolName: 'searchMenu', arguments: { query: '<requested item text>' } },
      {
        toolName: 'findStores',
        arguments: { city: '<city>', district: '<district>' },
      },
    ],
  },
  {
    user: 'Vậy lấy món vừa chọn và dùng địa chỉ đã xác minh.',
    toolCalls: [
      {
        toolName: 'updateCart',
        arguments: {
          itemCode: '<code_from_state_menu_search_results>',
          quantity: 1,
        },
      },
    ],
  },
  {
    user: 'Mình thêm 1 món nữa vào đơn hiện tại được không?',
    toolCalls: [
      {
        toolName: 'getOrderStatus',
        arguments: { orderId: '<verified_order_id>' },
      },
      {
        toolName: 'searchMenu',
        arguments: { query: '<requested add-on text>' },
      },
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
        arguments: {
          storeId: '<verified_store_id>',
          itemCodes: ['<verified_menu_item_code>'],
          disposition: 'delivery',
        },
      },
    ],
  },
  {
    user: 'Đúng rồi, dùng địa chỉ và món đã xác minh.',
    contextPolicy: { cart: 'active', fulfillment: 'active' },
    toolCalls: [
      { toolName: 'quoteFulfillment', arguments: { method: 'delivery', address: '<verified_address>', itemCodes: ['<verified_menu_item_code>'] } },
      { toolName: 'checkStoreAvailability', arguments: { storeId: '<verified_store_id>', itemCodes: ['<verified_menu_item_code>'], disposition: 'delivery' } },
    ],
  },
  {
    user: 'Nếu đơn đã chuẩn bị hoặc đang giao rồi thì sao, mình vẫn muốn hủy.',
    toolCalls: [
      {
        toolName: 'getOrderStatus',
        arguments: { orderId: '<verified_order_id>' },
      },
    ],
  },
  {
    user: 'Chưa hủy, cho mình đặt lại đơn lần trước cho đồng nghiệp.',
    entities: { reorderConfirmed: true },
    contextPolicy: { recentOrder: 'active', cart: 'active' },
    toolCalls: [
      { toolName: 'updateCart', arguments: { itemCode: '<verified_recent_order_item_code>', quantity: 1 } },
      { toolName: 'previewCart', arguments: {} },
    ],
  },
  {
    user: 'Cho tui 2 món bị gõ sai tên và 1 món khác nha.',
    toolCalls: [
      {
        toolName: 'searchMenu',
        arguments: { query: '<original customer item text>' },
      },
    ],
  },
  {
    user: 'Món nào phù hợp với yêu cầu dị ứng hoặc thành phần này?',
    toolCalls: [
      {
        toolName: 'searchContentPolicy',
        arguments: { kind: 'allergen', query: '<food safety question text>' },
      },
      {
        toolName: 'answerAllergenQuestion',
        arguments: { query: '<food safety question text>' },
      },
    ],
  },
  {
    user: 'Món nào không cay và không có phô mai?',
    toolCalls: [
      { toolName: 'searchContentPolicy', arguments: { kind: 'allergen', query: '<food preference text>' } },
      { toolName: 'answerAllergenQuestion', arguments: { query: '<food preference text>' } },
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
    user: 'Ok, thêm món đó. Mình có điểm thành viên không?',
    toolCalls: [
      {
        toolName: 'updateCart',
        arguments: {
          itemCode: '<code_from_state_menu_search_results>',
          quantity: 1,
        },
      },
      { toolName: 'getMembershipProfile', arguments: {} },
      { toolName: 'listMembershipRewards', arguments: { query: 'đổi điểm' } },
      { toolName: 'listMembershipWallet', arguments: { status: 'active' } },
      { toolName: 'getMembershipPointHistory', arguments: { days: 30 } },
    ],
  },
  {
    user: 'Bỏ món này ra, đổi thành món khác được không?',
    toolCalls: [
      {
        toolName: 'searchMenu',
        arguments: { query: '<replacement item text>' },
      },
      { toolName: 'previewCart', arguments: {} },
    ],
  },
  {
    user: 'Mình thanh toán rồi mà báo lỗi.',
    toolCalls: [
      {
        toolName: 'checkPaymentStatus',
        arguments: { orderId: '<verified_order_id>' },
      },
    ],
  },
  {
    user: 'Đặt cho mình số lượng rất lớn, giao trong thời gian rất gấp.',
    toolCalls: [
      {
        toolName: 'searchMenu',
        arguments: { query: '<large order item text>' },
      },
      {
        toolName: 'handoff',
        arguments: {
          reasons: ['abnormal_large_order', 'human_review_required'],
        },
      },
    ],
  },
] satisfies Array<{
  user: string;
  intent?: ToolPlannerOutput['intent'];
  entities?: Record<string, unknown>;
  contextPolicy?: ContextPolicyDirective;
  toolCalls: Array<{ toolName: ToolName; arguments: Record<string, unknown> }>;
  directResponse?: string;
}>;

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

async function fetchPlannerResponse(fetchImpl: typeof fetch, url: string, init: RequestInit): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await fetchImpl(url, init);
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
    }
  }
  throw lastError;
}

function normalizedPolicyText(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd').toLowerCase();
}

export function repairPlannerToolPolicy(input: ToolPlannerInput, output: ToolPlannerOutput): ToolPlannerOutput {
  const text = normalizedPolicyText(input.state.latestUserMessage);
  let toolCalls = output.toolCalls.map((call) => {
    if (call.toolName !== 'quoteFulfillment') return call;
    const address = call.arguments.address;
    if (!address || typeof address !== 'object' || Array.isArray(address)) return call;
    const fields = address as Record<string, unknown>;
    if (
      typeof fields.line1 === 'string' ||
      typeof fields.district !== 'string' ||
      typeof fields.city !== 'string'
    ) return call;
    return {
      ...call,
      arguments: {
        ...call.arguments,
        address: {
          ...fields,
          label: typeof fields.label === 'string' ? fields.label : fields.district,
          line1: fields.district,
        },
      },
    };
  });
  const contextPolicy = { ...(output.contextPolicy ?? {}) };
  const entities = { ...output.entities };
  const available = new Set(input.availableTools);
  const has = (toolName: ToolName) => toolCalls.some((call) => call.toolName === toolName);
  const add = (call: ToolCallRequest) => {
    if (available.has(call.toolName) && !has(call.toolName)) toolCalls.push(call);
  };

  const asksConditionalComparison =
    /\bneu\b.*\bthi\b/.test(text) && /\b(?:goi le|combo|ban chay|tiet kiem|ngan sach)\b/.test(text);
  if (asksConditionalComparison) {
    toolCalls = toolCalls.filter((call) => !['updateCart', 'previewCart'].includes(call.toolName));
    add({ toolName: 'recommendAddOns', arguments: {} });
    entities.cartMutationRequested = false;
    entities.cartMutationConfirmed = false;
  }

  const hasBareAmbiguousReference = /\b(?:cai|mon|phan)\s+do\b/.test(text) && !/\b(?:combo|burger|ga|pepsi|khoai|zinger)\b/.test(text);
  if (hasBareAmbiguousReference) {
    toolCalls = toolCalls.filter((call) => !['updateCart', 'previewCart'].includes(call.toolName));
    contextPolicy.cart = 'confirm_before_use';
    contextPolicy.recentTurns = 'active';
    entities.asksClarification = true;
    entities.cartMutationRequested = false;
    entities.cartMutationConfirmed = false;
  }

  const explicitlyRejectsAdd = /\b(?:khong can|khong|dung)\b.*\bthem\b/.test(text);
  if (explicitlyRejectsAdd) {
    toolCalls = toolCalls.filter((call) => !['updateCart', 'previewCart'].includes(call.toolName));
    entities.cartMutationRequested = false;
    entities.cartMutationConfirmed = false;
  }

  const genericCategoryOnly = /\bcho minh (?:combo|burger|ga|mon)(?:\s+[^0-9]*)?$/.test(text) && !/\b(?:nhom|nguoi|phan|cai|\d+)\b/.test(text);
  if (genericCategoryOnly) {
    toolCalls = toolCalls.filter((call) => !['updateCart', 'previewCart', 'recommendAddOns'].includes(call.toolName));
    add({ toolName: 'searchMenu', arguments: { query: input.state.latestUserMessage } });
  }

  if (/\b(?:nhom|nguoi|ngan sach|budget)\b/.test(text)) {
    add({ toolName: 'searchMenu', arguments: {} });
  }

  const concreteGroupCombo = /\bcombo\b/.test(text) && /\b(?:nhom|nguoi)\b/.test(text) && !/\b(?:ngan sach|budget|\d+k)\b/.test(text);
  if (concreteGroupCombo && input.state.menuSearchResults?.length) {
    const combo = input.state.menuSearchResults.find((item) => normalizedPolicyText(item.name).includes('combo')) ?? input.state.menuSearchResults[0];
    if (combo) add({ toolName: 'updateCart', arguments: { itemCode: combo.code, quantity: 1 } });
    add({ toolName: 'previewCart', arguments: {} });
  }

  const explicitlyConfirmsOrder = /\b(?:xac nhan|chot|dat don|dong y dat)\b/.test(text);
  if (!explicitlyConfirmsOrder) {
    toolCalls = toolCalls.filter((call) => !['placeOrder', 'createPaymentLink'].includes(call.toolName));
  }

  const selectedItem = input.state.menuSearchResults?.find((item) => {
    const normalizedName = normalizedPolicyText(item.name);
    if (text.includes(normalizedName)) return true;
    const identifyingTokens = normalizedName.split(/\s+/).filter((token) => token.length >= 4);
    return identifyingTokens.length >= 2 && identifyingTokens.every((token) => text.includes(token));
  });
  const explicitlySelectsMenuItem = /\b(?:lay|them|chon)\b/.test(text);
  if (explicitlySelectsMenuItem) {
    contextPolicy.cart = 'active';
    contextPolicy.menuSearchResults = 'active';
    entities.cartMutationRequested = true;
    entities.cartMutationConfirmed = true;
    if (selectedItem) {
      add({ toolName: 'updateCart', arguments: { itemCode: selectedItem.code, quantity: 1 } });
    }
  }

  const explicitlyAcceptsSizeUpgrade =
    /\b(?:nang|tang)\b.*\b(?:size|co)\b|\b(?:size|co)\b.*\b(?:dai|lon)\b/.test(text);
  if (explicitlyAcceptsSizeUpgrade) {
    contextPolicy.cart = 'active';
    entities.cartMutationRequested = true;
    entities.cartMutationConfirmed = true;
    toolCalls = toolCalls.filter((call) => call.toolName !== 'searchMenu');

    const cartItem = input.state.cart?.items.length === 1 ? input.state.cart.items[0] : undefined;
    const modifierOptions = input.state.menuModifierOptions;
    const modifierItemMatches = cartItem && modifierOptions?.itemCode === cartItem.itemCode;
    if (!cartItem) {
      add({ toolName: 'previewCart', arguments: {} });
    } else if (!modifierItemMatches) {
      toolCalls = toolCalls.filter((call) => call.toolName !== 'updateCart');
      add({ toolName: 'getModifierOptions', arguments: { code: cartItem.itemCode } });
      add({ toolName: 'previewCart', arguments: {} });
    } else {
      const targetSize = text.includes('dai') ? 'dai' : 'lon';
      const requestedPepsi = text.includes('pepsi');
      const modifiers = modifierOptions.modifierGroups.flatMap((group) => {
        const groupName = normalizedPolicyText(group.name);
        const selected = group.options.find((option) => {
          const optionName = normalizedPolicyText(option.name);
          return (
            (groupName.includes('drink') || optionName.includes('pepsi')) &&
            optionName.includes(targetSize) &&
            (!requestedPepsi || optionName.includes('pepsi'))
          );
        });
        return selected
          ? [{
              groupId: group.groupId,
              groupName: group.name,
              modifierId: selected.modifierId,
              modifierName: selected.name,
              quantity: typeof selected.quantity === 'number' && selected.quantity > 0 ? selected.quantity : 1,
              priceDeltaVnd: selected.priceDeltaVnd,
            }]
          : [];
      });
      if (modifiers.length > 0) {
        toolCalls = toolCalls.filter((call) => call.toolName !== 'updateCart' && call.toolName !== 'getModifierOptions');
        add({
          toolName: 'updateCart',
          arguments: { itemCode: cartItem.itemCode, quantity: cartItem.quantity, modifiers },
        });
        add({ toolName: 'previewCart', arguments: {} });
      } else {
        add({ toolName: 'getModifierOptions', arguments: { code: cartItem.itemCode } });
      }
    }
  }

  const acceptedComboConversion = /\bdoi sang\b.*\bcombo\b/.test(text);
  if (acceptedComboConversion && input.state.cart?.items.length && input.state.menuSearchResults?.length) {
    const comboCandidates = input.state.menuSearchResults.filter((item) =>
      normalizedPolicyText(item.name).includes('combo'),
    );
    const combo = comboCandidates.find((item) => {
      const name = normalizedPolicyText(item.name);
      return text.includes(name);
    }) ?? (comboCandidates.length === 1 ? comboCandidates[0] : undefined);
    if (combo) {
      const requestedQuantity = Number(/\bdoi sang\s+(\d+)\b/.exec(text)?.[1] ?? 1);
      contextPolicy.cart = 'active';
      contextPolicy.menuSearchResults = 'active';
      entities.cartMutationRequested = true;
      entities.cartMutationConfirmed = true;
      toolCalls = toolCalls.filter((call) => !['updateCart', 'getModifierOptions', 'previewCart'].includes(call.toolName));
      if (available.has('updateCart')) {
        toolCalls.push({
          toolName: 'updateCart',
          arguments: {
            changes: [
              ...input.state.cart.items.map((item) => ({ itemCode: item.itemCode, quantity: 0 })),
              { itemCode: combo.code, quantity: requestedQuantity },
            ],
          },
        });
      }
      if (available.has('getModifierOptions')) {
        toolCalls.push({ toolName: 'getModifierOptions', arguments: { code: combo.code } });
      }
      if (available.has('previewCart')) toolCalls.push({ toolName: 'previewCart', arguments: {} });
    }
  }

  if (/\b(?:huy|cancel)\b.*\bdon\b|\bdon\b.*\b(?:huy|cancel)\b/.test(text) && input.state.order?.id) {
    add({ toolName: 'getOrderStatus', arguments: { orderId: input.state.order.id } });
  }

  if (/\b(?:dat lai|goi lai|reorder)\b.*\bdon\b/.test(text)) {
    const recentItems = input.state.customerContext?.recentOrders?.[0]?.cart.items ?? [];
    for (const item of recentItems) {
      add({ toolName: 'updateCart', arguments: { itemCode: item.itemCode, quantity: item.quantity } });
    }
    if (recentItems.length) add({ toolName: 'previewCart', arguments: {} });
  }

  const explicitlyEditsCart = /\b(?:bo|xoa|doi|thay)\b/.test(text);
  if (explicitlyEditsCart) {
    contextPolicy.cart = 'active';
    entities.cartMutationRequested = true;
    entities.cartMutationConfirmed = true;
    const removedItem = input.state.cart?.items.find((item) => text.includes(normalizedPolicyText(item.name)));
    if (removedItem) add({ toolName: 'updateCart', arguments: { itemCode: removedItem.itemCode, quantity: 0 } });
    else add({ toolName: 'previewCart', arguments: {} });
  }

  return { ...output, contextPolicy, entities, toolCalls };
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
      response = await fetchPlannerResponse(this.fetchImpl, `${this.baseUrl}/responses`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${this.options.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.options.model,
          temperature: 0,
          instructions: [
            'You are a KFC Vietnam ordering tool planner. Return only JSON matching the requested schema.',
            'Choose tools for facts; do not invent business outcomes.',
            'You may be called repeatedly in one customer turn. After each tool result, use updated verified state for the next tool decision.',
            'Do not repeat a tool call when state.toolTrace already contains a successful current-turn result for the same tool name and same arguments.',
            'Use planningExamples as few-shot guidance for tool selection and argument shape, adapting to the current state and latest user message.',
            'For neutral greetings or small talk, set entities.smallTalk=true, return no tool calls, and use directResponse for a short natural greeting. Mentioning KFC by name does not make a greeting a menu-discovery request.',
            'When a plan has no tools or only read-only discovery tools such as searchMenu, searchPromotions, getItemDetails, or listPaymentMethods, always provide a short natural directResponse. For discovery, acknowledge that verified choices will be shown without inventing item details or tool outcomes.',
            'For broad menu discovery such as asking what is on the menu, call searchMenu with no query. For specific item/category requests, call searchMenu with the specific item or category text before updateCart.',
            'For group or budget discovery without a concrete item or category, call searchMenu with no query.',
            'For broad best-seller discovery without a concrete item or category, call searchMenu with no query.',
            'Use item codes only when they already appear in verified state.cart, state.menuSearchResults, or other verified state. Never infer catalog codes from examples.',
            'You may call multiple tools in one plan. If the user explicitly orders, adds, accepts, reorders, removes, or edits cart items, always include the cart tool in that same plan instead of stopping at lookup.',
            'If the user explicitly asks to order, add, remove, replace, or edit cart items, set entities.cartMutationRequested=true even when lookup must happen before mutation.',
            'For concrete multi-item order text, search each requested item separately and updateCart each verified item with the requested quantity.',
            'For group meal, budget, best-seller, promotion, or upsell turns, do not answer with prose only. Call searchMenu, searchPromotions, recommendAddOns, or getItemDetails so the UI can render verified menu/promotion choices.',
            'For budget/group recommendation turns, searchMenu is mandatory even when the budget may be too low; return choices or nearby alternatives from verified menu data instead of only explaining constraints.',
            'For group meal, budget, best-seller, promotion, or upsell turns, combine searchMenu/searchPromotions with updateCart, previewCart, recommendAddOns, or getItemDetails when the user asks to choose or prepare a cart.',
            'When a follow-up names or selects a concrete combo/item from verified menuSearchResults, include updateCart plus previewCart or recommendAddOns in that plan; do not repeat searchMenu alone.',
            'Do not call updateCart for early recommendation, budget, or open-ended suggestion turns until the user chooses a concrete item or accepts an upsell.',
            'If the user asks for a generic menu category without size/count, searchMenu first and do not updateCart until they choose a concrete item.',
            'When the user gives a voucher or promo code, call validateVoucher. Use searchPromotions only for general promotion discovery without a code.',
            'When the user only says they need an invoice but has not provided company name, tax code, or invoice email, do not call collectInvoice yet. Ask for those details.',
            'When your directResponse asks the customer for missing or clarifying information, set entities.asksClarification to true.',
            'Return contextPolicy for every state slice needed by this turn. Mark a slice active only when the current request depends on it; otherwise omit it.',
            'For menu recommendations and follow-up menu choices, set contextPolicy.menuSearchResults=active. For ambiguous references such as "that one", set recentTurns=active and mark the relevant cart or menuSearchResults slice active.',
            'For order tracking, cancellation, post-order edits, or ETA, set contextPolicy.order=active and payment=active. For previous-order reorder, set recentOrder=active and cart=active without activating order.',
            'For saved-address confirmations or checkout continuation, set contextPolicy.cart=active, fulfillment=active, and customer=active. For complaint follow-ups after escalation, set contextPolicy.handoff=active.',
            'For previous-order reorder, set entities.reorderConfirmed=true and call updateCart only after the current turn explicitly confirms reordering the previous order. If confirmation is missing, set contextPolicy.recentOrder=confirm_before_use, entities.asksClarification=true, and do not mutate the cart.',
            'For destructive cart edits such as reducing quantity or removing an item, set entities.cartMutationConfirmed=true only when the current turn unambiguously identifies the target cart item. If the target is ambiguous, set contextPolicy.cart=confirm_before_use, entities.asksClarification=true, and do not call updateCart.',
            'When the user asks to use a saved/prior address, set entities.useSavedAddress to true; otherwise do not assume saved address context.',
            'When the user gives company name, tax code, or invoice email, call collectInvoice.',
            'For payment-method availability questions, including whether KFC supports a named method, call listPaymentMethods before answering. Do not infer support from examples.',
            'When the user confirms an order and state has a cart plus fulfillment, call previewOrder then placeOrder. If payment method is requested after order creation, call createPaymentLink.',
            'On an explicit order confirmation, always set entities.orderConfirmed=true in the same plan. Never request createPaymentLink for a cart that has not been placed; include previewOrder and placeOrder before createPaymentLink.',
            'If an earlier turn requested a supported payment method and the current turn confirms the order, include createPaymentLink with that method after placeOrder. Use only methods listed as supported in paymentMethodEvidence.',
            'If the user only asks whether a payment method is available before confirming an order, do not call createPaymentLink.',
            'Delivery tracking phrases such as "kiểm tra giao hàng", "đơn giao hàng tới chưa", "đơn tới đâu rồi", or "ETA đơn hàng" are post-order status requests, not menu discovery. Do not call searchMenu for them.',
            'For order status, delivery tracking, ETA, cancellation, post-order add-on, or reorder requests, call getOrderStatus when the user message contains an order id or verified state.order.id exists. Use verified state.order.id; do not ask the user for an order id when verified state already has one.',
            'For previous-order reorder turns, if state.customerContext.recentOrders[0].cart or state.order.cart exists, call updateCart or previewCart with verified item codes so the UI can render a cart preview. Do not ask for prior-order details that are already in verified state.',
            'When the customer explicitly confirms reordering a previous order, set entities.reorderConfirmed=true and call updateCart for each verified item in state.customerContext.recentOrders[0].cart.items.',
            'If verified state contains an order id and the user asks to add an item to an existing order, getOrderStatus is mandatory in the same plan.',
            'If the user wants to continue after availability, address, or fulfillment risk, call checkStoreAvailability or quoteFulfillment before previewing or placing anything.',
            'For address ambiguity, out-of-area, store availability, or fulfillment risk, call findStores, checkStoreAvailability, or quoteFulfillment as appropriate.',
            'For allergen, cheese, spicy, ingredient, content-policy, spam, ambiguous, or out-of-scope safety turns, call searchContentPolicy or answerAllergenQuestion when food-safety facts are requested.',
            'Negative food preferences such as not spicy, no cheese, no dairy, or avoiding an ingredient are food-safety/content evidence requests: call searchContentPolicy or answerAllergenQuestion, not searchMenu alone.',
            'For membership, rewards, wallet vouchers, loyalty points, favorite items, or member profile turns, call getMembershipProfile first before listMembershipRewards, listMembershipWallet, or getMembershipPointHistory. Mention current-cart applicability only when cart context is present in state.',
            'For favorite-item turns, use verified recent order, cart, membership, or menu context first. Search or add a likely verified item; do not ask the user to restate favorites before using available context.',
            'If a membership turn also asks to add a referenced menu item, add that verified item with updateCart before membership lookup.',
            'Do not call handoff for loyalty, favorites, reorder, cart edit, remove, replace, or normal membership turns. Handoff is only for explicit human requests, active complaints, persistent verified payment failure, or abnormal large orders.',
            'For payment failure, payment link failure, or payment status turns, call checkPaymentStatus when the user message contains an order id or verified state.order.id exists. Use verified state.order.id; do not ask for the order id when verified state already has one. For abnormal large orders or explicit human review, call handoff.',
            'For modifier questions, call getModifierOptions with the selected item code when known, otherwise searchMenu first.',
            'When the customer accepts replacing separate items with a verified combo, include updateCart, getModifierOptions, and previewCart in the same plan so any follow-up size upsell is grounded in verified modifier options.',
            'If the user asks to remove or replace an item, always include updateCart or previewCart; do not stop at getModifierOptions.',
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
                intent: 'ordering|cart_edit|voucher|payment|order_status|complaint|feedback|handoff|safety|unclear',
                contextPolicy: {
                  cart: 'active|confirm_before_use|irrelevant',
                  order: 'active|confirm_before_use|irrelevant',
                  fulfillment: 'active|confirm_before_use|irrelevant',
                  menuSearchResults: 'active|confirm_before_use|irrelevant',
                  payment: 'active|confirm_before_use|irrelevant',
                  handoff: 'active|confirm_before_use|irrelevant',
                  recentTurns: 'active|confirm_before_use|irrelevant',
                  customer: 'active|confirm_before_use|irrelevant',
                  membership: 'active|confirm_before_use|irrelevant',
                  recentOrder: 'active|confirm_before_use|irrelevant',
                },
                entities: {
                  smallTalk: 'true only for greetings or small talk; omit otherwise',
                },
                toolCalls: [
                  {
                    toolName: 'searchMenu',
                    arguments: {
                      query: '<specific item/category text or omit for full menu>',
                    },
                  },
                ],
                responseClaims: [],
                directResponse: 'model-written response for no-tool or read-only discovery plans',
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
    return ensureAcceptedComboModifierLookup(input, repairPlannerToolPolicy(input, {
      intent: parsed.intent,
      contextPolicy: parsed.contextPolicy,
      entities: parsed.entities,
      toolCalls: validateToolCalls(parsed.toolCalls, input.availableTools),
      responseClaims: parsed.responseClaims,
      directResponse: parsed.directResponse,
    }));
  }
}
