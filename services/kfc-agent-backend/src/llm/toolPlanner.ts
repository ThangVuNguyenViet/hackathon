import { z } from "zod";
import type { ConversationTurn, Intent } from "../domain/types.js";
import type { AgentGraphState } from "../graph/state.js";
import { toolNames } from "../ordering/toolCatalog.js";
import type { ToolCallRequest, ToolName } from "../ordering/types.js";

export interface ToolPlannerInput {
  state: AgentGraphState;
  availableTools: ToolName[];
  recentTurns: ConversationTurn[];
}

export interface ToolPlannerOutput {
  intent: Intent;
  entities: Record<string, unknown>;
  toolCalls: ToolCallRequest[];
  responseClaims: Array<"promotion" | "payment_success" | "allergen_certainty">;
  directResponse?: string;
}

export interface ToolPlanner {
  supportsMultiStep?: boolean;
  plan(input: ToolPlannerInput): Promise<ToolPlannerOutput>;
}

const plannerOutputSchema = z.object({
  intent: z.enum([
    "ordering",
    "cart_edit",
    "voucher",
    "payment",
    "order_status",
    "complaint",
    "feedback",
    "handoff",
    "safety",
    "unclear",
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
  responseClaims: z
    .array(z.enum(["promotion", "payment_success", "allergen_certainty"]))
    .default([]),
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
  if (
    typeof body.output_text === "string" &&
    body.output_text.trim().length > 0
  ) {
    return body.output_text.trim();
  }
  for (const item of body.output ?? []) {
    for (const content of item.content ?? []) {
      if (typeof content.text === "string" && content.text.trim().length > 0) {
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
      throw new Error(
        `OpenAI tool planner proposed unavailable tool: ${toolName}`,
      );
    }

    return {
      toolName,
      arguments: args,
    } satisfies ToolCallRequest;
  });
}

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

const toolArgumentExamples: Record<ToolName, Record<string, unknown>> = {
  searchMenu: {
    query: "<specific item/category text; omit for full menu discovery>",
  },
  getItemDetails: { code: "<verified_menu_item_code>" },
  getModifierOptions: { code: "<verified_menu_item_code>" },
  updateCart: { itemCode: "<verified_menu_item_code>", quantity: 1 },
  previewCart: {},
  recommendAddOns: {},
  findStores: { city: "Hồ Chí Minh", district: "Quận 1" },
  checkStoreAvailability: {
    storeId: "<verified_store_id>",
    itemCodes: ["<verified_menu_item_code>"],
    disposition: "delivery",
  },
  quoteFulfillment: {
    address: {
      label: "Nhà",
      line1: "72 Lê Thánh Tôn",
      district: "Quận 1",
      city: "Hồ Chí Minh",
    },
    method: "delivery",
    itemCodes: ["<verified_menu_item_code>"],
  },
  searchPromotions: {
    query:
      "<specific promotion text; omit for current active promotion discovery>",
  },
  explainPromotion: { offerId: "promotion-offer-id" },
  validateVoucher: {
    voucherText: "<customer voucher text>",
    subtotalVnd: 250000,
  },
  getMembershipProfile: {},
  listMembershipRewards: { query: "đổi quà thành viên" },
  listMembershipWallet: { status: "active" },
  getMembershipPointHistory: { days: 30 },
  listMembershipTools: { sideEffect: "voucher_acquisition" },
  listPaymentMethods: {
    query: "<payment method name or omit for all website checkout methods>",
  },
  acquireVoucher: { rewardId: "reward-discount-10k", confirmed: false },
  redeemReward: {
    voucherId: "wallet-new-member-25k",
    channel: "kiosk",
    confirmed: false,
  },
  searchContentPolicy: {
    kind: "allergen",
    query: "<specific safety/content text; omit for broad policy discovery>",
  },
  answerAllergenQuestion: {
    query: "<specific allergen question; omit for broad allergen evidence>",
  },
  previewOrder: {},
  placeOrder: {},
  getOrderStatus: { orderId: "<verified_order_id>" },
  createPaymentLink: { method: "zalopay" },
  checkPaymentStatus: { orderId: "<verified_order_id>" },
  collectInvoice: {
    companyName: "<company_name>",
    taxCode: "<tax_code>",
    email: "<invoice_email>",
  },
  handoff: { reasons: ["customer_requested_human"] },
};

const planningExamples = [
  {
    user: "Cho mình vài món theo mô tả này.",
    toolCalls: [
      {
        toolName: "searchMenu",
        arguments: { query: "<requested category or preference text>" },
      },
    ],
  },
  {
    user: "Cho mình 1 món chính, 1 món ăn kèm và 2 đồ uống, giao về địa chỉ mình vừa cung cấp.",
    toolCalls: [
      {
        toolName: "searchMenu",
        arguments: { query: "<first requested item text>" },
      },
      {
        toolName: "updateCart",
        arguments: {
          itemCode: "<code_from_state_menu_search_results>",
          quantity: 1,
        },
      },
      {
        toolName: "searchMenu",
        arguments: { query: "<second requested item text>" },
      },
      {
        toolName: "updateCart",
        arguments: {
          itemCode: "<code_from_state_menu_search_results>",
          quantity: 1,
        },
      },
      { toolName: "searchMenu", arguments: { query: "<drink text>" } },
      {
        toolName: "updateCart",
        arguments: {
          itemCode: "<code_from_state_menu_search_results>",
          quantity: 2,
        },
      },
    ],
  },
  {
    user: "Mình có mã giảm giá, áp dụng giúp mình.",
    toolCalls: [
      {
        toolName: "validateVoucher",
        arguments: {
          voucherText: "<customer voucher text>",
          subtotalVnd: 250000,
        },
      },
    ],
  },
  {
    user: "Thanh toán bằng phương thức này được không?",
    toolCalls: [
      {
        toolName: "listPaymentMethods",
        arguments: {
          query: "<requested payment method or omit for all methods>",
        },
      },
    ],
  },
  {
    user: "KFC có những phương thức thanh toán nào?",
    toolCalls: [{ toolName: "listPaymentMethods", arguments: {} }],
  },
  {
    user: "Mình có ghi chú giao hàng và cần xuất hóa đơn.",
    toolCalls: [],
  },
  {
    user: "Tên công ty <company_name>, MST <tax_code>, email <invoice_email>. Xác nhận đơn.",
    toolCalls: [
      {
        toolName: "collectInvoice",
        arguments: {
          companyName: "<company_name>",
          taxCode: "<tax_code>",
          email: "<invoice_email>",
        },
      },
      { toolName: "previewOrder", arguments: {} },
      { toolName: "placeOrder", arguments: {} },
      { toolName: "createPaymentLink", arguments: { method: "zalopay" } },
    ],
  },
  {
    user: "Đơn của mình tới đâu rồi?",
    toolCalls: [],
  },
  {
    user: "Kiểm tra giao hàng giúp mình.",
    toolCalls: [],
  },
  {
    user: "Đơn giao hàng của mình tới chưa?",
    toolCalls: [],
  },
  {
    user: "Kiểm tra đơn <verified_order_id> giúp mình.",
    toolCalls: [
      {
        toolName: "getOrderStatus",
        arguments: { orderId: "<verified_order_id>" },
      },
    ],
  },
  {
    user: "Mình đặt cho một nhóm với ngân sách này.",
    toolCalls: [
      {
        toolName: "searchMenu",
        arguments: { query: "<group size and budget text>" },
      },
    ],
  },
  {
    user: "Ok, thêm món đầu tiên vừa tìm được.",
    toolCalls: [
      {
        toolName: "updateCart",
        arguments: {
          itemCode: "<code_from_state_menu_search_results>",
          quantity: 1,
        },
      },
    ],
  },
  {
    user: "Cho mình một nhóm món chung chung.",
    toolCalls: [
      {
        toolName: "searchMenu",
        arguments: { query: "<generic menu category text>" },
      },
    ],
  },
  {
    user: "Ok, đổi sang lựa chọn có thành phần này.",
    toolCalls: [
      {
        toolName: "searchMenu",
        arguments: { query: "<requested replacement preference text>" },
      },
    ],
  },
  {
    user: "Không, giữ vậy thôi, đừng thêm món nữa.",
    toolCalls: [{ toolName: "previewCart", arguments: {} }],
  },
  {
    user: "Cho mình 1 món này, giao về địa chỉ này được không?",
    toolCalls: [
      { toolName: "searchMenu", arguments: { query: "<requested item text>" } },
      {
        toolName: "findStores",
        arguments: { city: "<city>", district: "<district>" },
      },
    ],
  },
  {
    user: "Vậy lấy món vừa chọn và dùng địa chỉ đã xác minh.",
    toolCalls: [
      {
        toolName: "updateCart",
        arguments: {
          itemCode: "<code_from_state_menu_search_results>",
          quantity: 1,
        },
      },
    ],
  },
  {
    user: "Mình thêm 1 món nữa vào đơn hiện tại được không?",
    toolCalls: [
      {
        toolName: "getOrderStatus",
        arguments: { orderId: "<verified_order_id>" },
      },
      {
        toolName: "searchMenu",
        arguments: { query: "<requested add-on text>" },
      },
    ],
  },
  {
    user: "Mình muốn hủy đơn vừa đặt.",
    toolCalls: [],
  },
  {
    user: "Tiếp tục đặt.",
    toolCalls: [
      {
        toolName: "checkStoreAvailability",
        arguments: {
          storeId: "<verified_store_id>",
          itemCodes: ["<verified_menu_item_code>"],
          disposition: "delivery",
        },
      },
    ],
  },
  {
    user: "Nếu đơn đã chuẩn bị hoặc đang giao rồi thì sao, mình vẫn muốn hủy.",
    toolCalls: [
      {
        toolName: "getOrderStatus",
        arguments: { orderId: "<verified_order_id>" },
      },
    ],
  },
  {
    user: "Chưa hủy, cho mình đặt lại đơn lần trước cho đồng nghiệp.",
    toolCalls: [
      {
        toolName: "getOrderStatus",
        arguments: { orderId: "<verified_order_id>" },
      },
      {
        toolName: "searchMenu",
        arguments: { query: "<reorder description text>" },
      },
    ],
  },
  {
    user: "Cho tui 2 món bị gõ sai tên và 1 món khác nha.",
    toolCalls: [
      {
        toolName: "searchMenu",
        arguments: { query: "<original customer item text>" },
      },
    ],
  },
  {
    user: "Món nào phù hợp với yêu cầu dị ứng hoặc thành phần này?",
    toolCalls: [
      {
        toolName: "searchContentPolicy",
        arguments: { kind: "allergen", query: "<food safety question text>" },
      },
      {
        toolName: "answerAllergenQuestion",
        arguments: { query: "<food safety question text>" },
      },
    ],
  },
  {
    user: "Mình có điểm thành viên không?",
    toolCalls: [
      { toolName: "getMembershipProfile", arguments: {} },
      { toolName: "listMembershipRewards", arguments: { query: "đổi điểm" } },
      { toolName: "listMembershipWallet", arguments: { status: "active" } },
      { toolName: "getMembershipPointHistory", arguments: { days: 30 } },
    ],
  },
  {
    user: "Ok, thêm món đó. Mình có điểm thành viên không?",
    toolCalls: [
      {
        toolName: "updateCart",
        arguments: {
          itemCode: "<code_from_state_menu_search_results>",
          quantity: 1,
        },
      },
      { toolName: "getMembershipProfile", arguments: {} },
      { toolName: "listMembershipRewards", arguments: { query: "đổi điểm" } },
      { toolName: "listMembershipWallet", arguments: { status: "active" } },
      { toolName: "getMembershipPointHistory", arguments: { days: 30 } },
    ],
  },
  {
    user: "Bỏ món này ra, đổi thành món khác được không?",
    toolCalls: [
      {
        toolName: "searchMenu",
        arguments: { query: "<replacement item text>" },
      },
      { toolName: "previewCart", arguments: {} },
    ],
  },
  {
    user: "Mình thanh toán rồi mà báo lỗi.",
    toolCalls: [
      {
        toolName: "checkPaymentStatus",
        arguments: { orderId: "<verified_order_id>" },
      },
    ],
  },
  {
    user: "Mình bấm thanh toán mà lỗi hoài.",
    toolCalls: [],
  },
  {
    user: "Đặt cho mình số lượng rất lớn, giao trong thời gian rất gấp.",
    toolCalls: [
      {
        toolName: "searchMenu",
        arguments: { query: "<large order item text>" },
      },
      {
        toolName: "handoff",
        arguments: {
          reasons: ["abnormal_large_order", "human_review_required"],
        },
      },
    ],
  },
] satisfies Array<{
  user: string;
  toolCalls: Array<{ toolName: ToolName; arguments: Record<string, unknown> }>;
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
        intent: "unclear",
        entities: {},
        toolCalls: [],
        responseClaims: [],
        directResponse: "Mình cần thêm thông tin để hỗ trợ đúng.",
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
    this.baseUrl = trimTrailingSlash(
      options.baseUrl ?? "https://api.openai.com/v1",
    );
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
  }

  async plan(input: ToolPlannerInput): Promise<ToolPlannerOutput> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.options.timeoutMs ?? 60_000,
    );

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/responses`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${this.options.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.options.model,
          temperature: 0,
          instructions: [
            "You are a KFC Vietnam ordering tool planner. Return only JSON matching the requested schema.",
            "Choose tools for facts; do not invent business outcomes.",
            "You may be called repeatedly in one customer turn. After each tool result, use updated verified state for the next tool decision.",
            "Do not repeat a tool call when state.toolTrace already contains a successful current-turn result for the same tool name and same arguments.",
            "Use planningExamples as few-shot guidance for tool selection and argument shape, adapting to the current state and latest user message.",
            "For neutral greetings or small talk, return no tool calls and use directResponse for a short natural greeting.",
            "For broad menu discovery such as asking what is on the menu, call searchMenu with no query. For specific item/category requests, call searchMenu with the specific item or category text before updateCart.",
            "Use item codes only when they already appear in verified state.cart, state.menuSearchResults, or other verified state. Never infer catalog codes from examples.",
            "You may call multiple tools in one plan. If the user explicitly orders, adds, accepts, reorders, removes, or edits cart items, always include the cart tool in that same plan instead of stopping at lookup.",
            "If the user explicitly asks to order, add, remove, replace, or edit cart items, set entities.cartMutationRequested=true even when lookup must happen before mutation.",
            "For concrete multi-item order text, search each requested item separately and updateCart each verified item with the requested quantity.",
            "For group meal, budget, best-seller, promotion, or upsell turns, combine searchMenu/searchPromotions with updateCart, previewCart, recommendAddOns, or getItemDetails when the user asks to choose or prepare a cart.",
            "Do not call updateCart for early recommendation, budget, or open-ended suggestion turns until the user chooses a concrete item or accepts an upsell.",
            "If the user asks for a generic menu category without size/count, searchMenu first and do not updateCart until they choose a concrete item.",
            "When the user gives a voucher or promo code, call validateVoucher. Use searchPromotions only for general promotion discovery without a code.",
            "When the user only says they need an invoice but has not provided company name, tax code, or invoice email, do not call collectInvoice yet. Ask for those details.",
            "When your directResponse asks the customer for missing or clarifying information, set entities.asksClarification to true.",
            "When the user asks to use a saved/prior address, set entities.useSavedAddress to true; otherwise do not assume saved address context.",
            "When the user gives company name, tax code, or invoice email, call collectInvoice.",
            "For payment-method availability questions, including whether KFC supports a named method, call listPaymentMethods before answering. Do not infer support from examples.",
            "When the user confirms an order and state has a cart plus fulfillment, call previewOrder then placeOrder. If payment method is requested after order creation, call createPaymentLink.",
            "If an earlier turn requested a supported payment method and the current turn confirms the order, include createPaymentLink with that method after placeOrder. Use only methods listed as supported in paymentMethodEvidence.",
            "If the user only asks whether a payment method is available before confirming an order, do not call createPaymentLink.",
            'Delivery tracking phrases such as "kiểm tra giao hàng", "đơn giao hàng tới chưa", "đơn tới đâu rồi", or "ETA đơn hàng" are post-order status requests, not menu discovery. Do not call searchMenu for them.',
            "For order status, delivery tracking, ETA, cancellation, post-order add-on, or reorder requests, call getOrderStatus only when the user message or verified state contains an order id; otherwise ask for the order id with no tool calls.",
            "For previous-order reorder turns, do not call updateCart until the customer confirms a specific previous order. If confirmation is missing, summarize state.customerContext.recentOrders[0] and ask whether to reorder it with entities.asksClarification=true.",
            "When the customer explicitly confirms reordering a previous order, set entities.reorderConfirmed=true and call updateCart for each verified item in state.customerContext.recentOrders[0].cart.items.",
            "If verified state contains an order id and the user asks to add an item to an existing order, getOrderStatus is mandatory in the same plan.",
            "If the user wants to continue after availability, address, or fulfillment risk, call checkStoreAvailability or quoteFulfillment before previewing or placing anything.",
            "For address ambiguity, out-of-area, store availability, or fulfillment risk, call findStores, checkStoreAvailability, or quoteFulfillment as appropriate.",
            "For allergen, cheese, spicy, ingredient, content-policy, spam, ambiguous, or out-of-scope safety turns, call searchContentPolicy or answerAllergenQuestion when food-safety facts are requested.",
            "For membership, rewards, wallet vouchers, loyalty points, favorite items, or member profile turns, call getMembershipProfile first before listMembershipRewards, listMembershipWallet, or getMembershipPointHistory. Mention current-cart applicability only when cart context is present in state.",
            "If a membership turn also asks to add a referenced menu item, add that verified item with updateCart before membership lookup.",
            "Do not call handoff for loyalty, favorites, reorder, cart edit, remove, replace, or normal membership turns. Handoff is only for explicit human requests, active complaints, persistent verified payment failure, or abnormal large orders.",
            "For payment failure, payment link failure, or payment status turns, call checkPaymentStatus only when the user message or verified state contains an order id; otherwise ask for the order id. For abnormal large orders or explicit human review, call handoff.",
            "For modifier questions, call getModifierOptions with the selected item code when known, otherwise searchMenu first.",
            "If the user asks to remove or replace an item, always include updateCart or previewCart; do not stop at getModifierOptions.",
            "Remove/replace instructions override modifier-only lookup. For drink replacement requests, include updateCart or previewCart even if you also call getModifierOptions.",
            "If state.cart has exactly one item and the user asks about changing drinks, substitutions, or options without remove/replace wording, call getModifierOptions with that cart itemCode; do not answer modifier availability from searchMenu alone.",
            "For delivery or pickup requests, call quoteFulfillment only with a complete address object, method, and itemCodes from verified cart/menu state.",
            "If state.cart has items and the user gives a delivery address, call quoteFulfillment with method delivery and itemCodes from state.cart.items.",
            "For broad promotion discovery, call searchPromotions with no query. For specific voucher or promotion questions, call searchPromotions or validateVoucher with the specific user text.",
            "Only include responseClaims when the response will claim promotion, payment success, or allergen certainty; leave it empty for normal menu/cart actions.",
          ].join(" "),
          input: JSON.stringify(
            {
              locale: "vi-VN",
              state: input.state,
              availableTools: input.availableTools,
              recentTurns: input.recentTurns.slice(-8),
              toolArgumentExamples,
              planningExamples,
              outputSchema: {
                intent:
                  "ordering|cart_edit|voucher|payment|order_status|complaint|feedback|handoff|safety|unclear",
                entities: {},
                toolCalls: [
                  {
                    toolName: "searchMenu",
                    arguments: {
                      query:
                        "<specific item/category text or omit for full menu>",
                    },
                  },
                ],
                responseClaims: [],
                directResponse: "optional response when no tool call is needed",
              },
            },
            null,
            2,
          ),
        }),
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(
          `OpenAI tool planning timed out after ${this.options.timeoutMs ?? 60_000}ms`,
        );
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }

    const body = (await response.json().catch(() => ({}))) as ResponsesBody;
    if (!response.ok) {
      const message =
        typeof body.error?.message === "string"
          ? body.error.message
          : response.statusText;
      throw new Error(`OpenAI tool planning failed: ${message}`);
    }

    const text = extractText(body);
    if (!text) throw new Error("OpenAI tool planning returned no text");
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
