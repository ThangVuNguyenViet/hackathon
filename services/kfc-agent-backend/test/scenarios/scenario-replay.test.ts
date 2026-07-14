import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  StaticToolPlanner,
  type ToolPlannerOutput,
} from "../../src/llm/toolPlanner.js";
import { runScenario } from "../../src/scenarios/runner.js";
import {
  loadScenarioScript,
  type ScenarioScript,
} from "../../src/scenarios/scenarioScript.js";
import { liveScenarioFixtures } from "./liveScenarioFixtures.js";

const scenariosRoot = join(
  process.cwd(),
  "../../ai-talent-tracks/fnb/conversations",
);

type ScenarioResult = Awaited<ReturnType<typeof runScenario>>;

interface ScenarioCase {
  fileName: string;
  createPlanner: () => StaticToolPlanner;
  expectedFinalState: string;
  expectedToolNames: string[];
  expectedEventTypes: string[];
  extraAssertions?: (script: ScenarioScript, result: ScenarioResult) => void;
}

async function replay(fileName: string, toolPlanner: StaticToolPlanner) {
  const script = await loadScenarioScript(join(scenariosRoot, fileName));
  const scenarioFixtures = fileName.startsWith("03-")
    ? liveScenarioFixtures(fileName)
    : {};
  return {
    script,
    result: await runScenario(script, {
      ...scenarioFixtures,
      toolPlanner,
      testFulfillmentQuoteProvider: async () => ({
        ok: true,
        value: { feeVnd: 18000, etaMinutes: 25 },
        message: "scenario_quote_fixture",
      }),
    }),
  };
}

function output(partial: ToolPlannerOutput): ToolPlannerOutput {
  return partial;
}

function toolNames(result: ScenarioResult) {
  return result.toolTrace.map((entry) => entry.toolName);
}

function eventTypes(result: ScenarioResult) {
  return [...new Set(result.dashboardEvents.map((event) => event.type))];
}

function eventPayloads(result: ScenarioResult, type: string) {
  return result.dashboardEvents
    .filter((event) => event.type === type)
    .map((event) => event.payload);
}

function createScenario01Planner() {
  return new StaticToolPlanner([
    output({
      intent: "ordering",
      entities: {
        itemText: "Combo Hợp Gu 99K, Burger Gà Zinger, Pepsi (Lon)",
        fulfillmentMethod: "delivery",
      },
      toolCalls: [
        { toolName: "searchMenu", arguments: { query: "Combo Hợp Gu 99K" } },
        {
          toolName: "updateCart",
          arguments: { itemCode: "20751", quantity: 1 },
        },
        { toolName: "searchMenu", arguments: { query: "Burger Gà Zinger" } },
        {
          toolName: "updateCart",
          arguments: { itemCode: "41141", quantity: 1 },
        },
        { toolName: "searchMenu", arguments: { query: "Pepsi" } },
        {
          toolName: "updateCart",
          arguments: { itemCode: "41086", quantity: 2 },
        },
      ],
      responseClaims: [],
    }),
    output({
      intent: "ordering",
      entities: {
        fulfillmentMethod: "delivery",
        addressDraft: {
          line1: "Chung cư Sunrise City, 23 Nguyễn Hữu Thọ, phường Tân Hưng",
        },
      },
      toolCalls: [
        {
          toolName: "quoteFulfillment",
          arguments: {
            method: "delivery",
            address: {
              label: "Chung cư Sunrise City",
              line1: "Chung cư Sunrise City, 23 Nguyễn Hữu Thọ, phường Tân Hưng",
              district: "Quận 7",
              city: "Hồ Chí Minh",
            },
            itemCodes: ["20751", "41141", "41086"],
          },
        },
      ],
      responseClaims: [],
    }),
    output({
      intent: "voucher",
      entities: { voucherText: "KFC50" },
      toolCalls: [
        {
          toolName: "validateVoucher",
          arguments: { voucherText: "KFC50", subtotalVnd: 250000 },
        },
      ],
      responseClaims: [],
    }),
    output({
      intent: "payment",
      entities: { paymentMethod: "zalopay" },
      toolCalls: [{ toolName: "listPaymentMethods", arguments: {} }],
      responseClaims: [],
    }),
    output({
      intent: "ordering",
      entities: {
        invoice: {
          companyName: "Công ty ABC",
          taxCode: "0312345678",
          email: "finance@abc.test",
        },
      },
      toolCalls: [
        {
          toolName: "collectInvoice",
          arguments: {
            companyName: "Công ty ABC",
            taxCode: "0312345678",
            email: "finance@abc.test",
          },
        },
      ],
      responseClaims: [],
    }),
    output({
      intent: "ordering",
      entities: { paymentMethod: "zalopay", orderConfirmed: true },
      toolCalls: [
        { toolName: "previewOrder", arguments: {} },
        { toolName: "placeOrder", arguments: {} },
        { toolName: "createPaymentLink", arguments: { method: "zalopay" } },
      ],
      responseClaims: [],
    }),
  ]);
}

function createUnderPlanningScenario01Planner() {
  return new StaticToolPlanner([
    output({
      intent: "ordering",
      entities: { itemText: "combo gà cay" },
      toolCalls: [
        { toolName: "searchMenu", arguments: { query: "combo gà cay" } },
      ],
      responseClaims: [],
    }),
    output({
      intent: "ordering",
      entities: {},
      toolCalls: [],
      responseClaims: [],
    }),
  ]);
}

function createScenario02Planner() {
  return new StaticToolPlanner([
    output({
      intent: "ordering",
      entities: { itemText: "đồ ăn cho nhóm 4 người", partySize: 4, budgetVnd: 300000 },
      toolCalls: [
        { toolName: "searchMenu", arguments: { query: "3 miếng gà rán" } },
        { toolName: "searchMenu", arguments: { query: "1 miếng gà rán" } },
        { toolName: "searchMenu", arguments: { query: "Pepsi tiêu chuẩn" } },
        { toolName: "searchMenu", arguments: { query: "Combo Đẫy Đà 129K" } },
        { toolName: "recommendAddOns", arguments: {} },
      ],
      responseClaims: [],
    }),
    output({
      intent: "ordering",
      entities: { rejectedUpsell: "món tráng miệng" },
      toolCalls: [
        {
          toolName: "searchPromotions",
          arguments: { query: "ưu đãi nhóm dưới 300k" },
        },
      ],
      responseClaims: [],
    }),
    output({
      intent: "ordering",
      entities: {
        itemText: "10 miếng gà rán và 4 Pepsi tiêu chuẩn",
        preference: "best_seller",
        cartMutationConfirmed: true,
      },
      toolCalls: [
        {
          toolName: "searchMenu",
          arguments: { query: "10 miếng gà rán 4 Pepsi tiêu chuẩn" },
        },
        { toolName: "updateCart", arguments: { itemCode: "41037", quantity: 3 } },
        { toolName: "updateCart", arguments: { itemCode: "41035", quantity: 1 } },
        { toolName: "updateCart", arguments: { itemCode: "41074", quantity: 4 } },
        { toolName: "getItemDetails", arguments: { code: "20752" } },
        { toolName: "previewCart", arguments: {} },
      ],
      responseClaims: [],
    }),
    output({
      intent: "ordering",
      entities: { acceptedComboConversion: "20752", cartMutationConfirmed: true },
      toolCalls: [
        { toolName: "updateCart", arguments: { itemCode: "41037", quantity: 0 } },
        { toolName: "updateCart", arguments: { itemCode: "41035", quantity: 0 } },
        { toolName: "updateCart", arguments: { itemCode: "41074", quantity: 0 } },
        { toolName: "updateCart", arguments: { itemCode: "20752", quantity: 2 } },
        { toolName: "getModifierOptions", arguments: { code: "20752" } },
        { toolName: "previewCart", arguments: {} },
      ],
      responseClaims: [],
    }),
    output({
      intent: "cart_edit",
      entities: { acceptedUpsell: "4 Pepsi size đại", cartMutationConfirmed: true },
      toolCalls: [
        {
          toolName: "updateCart",
          arguments: {
            itemCode: "20752",
            quantity: 2,
            modifiers: [
              {
                groupId: "2",
                groupName: "Drink 1",
                modifierId: "41091",
                modifierName: "Pepsi (Đại)",
                quantity: 1,
                priceDeltaVnd: 7000,
              },
              {
                groupId: "3",
                groupName: "Drink 2",
                modifierId: "41091",
                modifierName: "Pepsi (Đại)",
                quantity: 1,
                priceDeltaVnd: 7000,
              },
            ],
          },
        },
        { toolName: "previewCart", arguments: {} },
      ],
      responseClaims: [],
    }),
  ]);
}

function createScenario03Planner() {
  return new StaticToolPlanner([
    output({
      intent: "ordering",
      entities: { itemText: "burger tôm", district: "Nhà Bè" },
      toolCalls: [
        { toolName: "searchMenu", arguments: { query: "burger tôm" } },
        {
          toolName: "findStores",
          arguments: { city: "Hồ Chí Minh", district: "Nhà Bè" },
        },
      ],
      responseClaims: [],
    }),
    output({
      intent: "ordering",
      entities: { itemText: "Burger Gà Zinger" },
      toolCalls: [
        { toolName: "searchMenu", arguments: { query: "Burger Gà Zinger" } },
        {
          toolName: "updateCart",
          arguments: { itemCode: "41141", quantity: 1 },
        },
      ],
      responseClaims: [],
    }),
    output({
      intent: "ordering",
      entities: {
        asksClarification: true,
        useSavedAddress: false,
        savedAddressDecision: { addressIndex: 0, decision: "suggest" },
      },
      toolCalls: [],
      responseClaims: [],
    }),
    output({
      intent: "ordering",
      contextPolicy: { cart: "active", fulfillment: "active", customer: "active" },
      entities: {
        fulfillmentAccepted: true,
        useSavedAddress: true,
        savedAddressDecision: { addressIndex: 0, decision: "accept" },
      },
      toolCalls: [],
      responseClaims: [],
    }),
    output({
      intent: "ordering",
      contextPolicy: { cart: "active", fulfillment: "active" },
      entities: { fulfillmentAccepted: true },
      toolCalls: [],
      responseClaims: [],
    }),
    output({
      intent: "ordering",
      entities: { addressDraft: { district: "Quận 3" }, asksClarification: true },
      toolCalls: [
        {
          toolName: "findStores",
          arguments: { city: "Hồ Chí Minh", district: "Quận 3" },
        },
      ],
      responseClaims: [],
    }),
  ]);
}

function createScenario04Planner() {
  return new StaticToolPlanner([
    output({
      intent: "order_status",
      entities: { orderId: "KFC-MOCK-1001" },
      toolCalls: [
        { toolName: "getOrderStatus", arguments: { orderId: "KFC-MOCK-1001" } },
      ],
      responseClaims: [],
    }),
    output({
      intent: "order_status",
      entities: { orderId: "KFC-MOCK-1001", etaRequested: true },
      toolCalls: [
        { toolName: "getOrderStatus", arguments: { orderId: "KFC-MOCK-1001" } },
      ],
      responseClaims: [],
    }),
    output({
      intent: "order_status",
      entities: { orderId: "KFC-MOCK-1001" },
      toolCalls: [
        { toolName: "getOrderStatus", arguments: { orderId: "KFC-MOCK-1001" } },
      ],
      responseClaims: [],
    }),
    output({
      intent: "ordering",
      entities: { itemText: "Pepsi" },
      toolCalls: [
        { toolName: "searchMenu", arguments: { query: "Pepsi" } },
        {
          toolName: "updateCart",
          arguments: { itemCode: "41086", quantity: 1 },
        },
      ],
      responseClaims: [],
    }),
    output({
      intent: "order_status",
      entities: { cancellationRequested: true },
      toolCalls: [
        { toolName: "getOrderStatus", arguments: { orderId: "KFC-MOCK-1001" } },
      ],
      responseClaims: [],
    }),
    output({
      intent: "order_status",
      entities: { cancellationRequestedAfterPrep: true },
      toolCalls: [
        { toolName: "getOrderStatus", arguments: { orderId: "KFC-MOCK-1001" } },
      ],
      responseClaims: [],
    }),
    output({
      intent: "ordering",
      entities: { reorderRequested: true },
      toolCalls: [
        {
          toolName: "searchMenu",
          arguments: { query: "đơn cũ Combo Hợp Gu 99K" },
        },
        {
          toolName: "updateCart",
          arguments: { itemCode: "20751", quantity: 1 },
        },
        { toolName: "previewCart", arguments: {} },
      ],
      responseClaims: [],
    }),
  ]);
}

function createScenario05Planner() {
  return new StaticToolPlanner([
    output({
      intent: "complaint",
      entities: { issues: ["missing_item"] },
      toolCalls: [],
      responseClaims: [],
    }),
    output({
      intent: "complaint",
      entities: { issues: ["missing_item", "wrong_item"] },
      toolCalls: [],
      responseClaims: [],
    }),
    output({
      intent: "complaint",
      entities: {
        issues: [
          "missing_item",
          "wrong_item",
          "late_delivery",
          "angry_customer",
        ],
      },
      toolCalls: [],
      responseClaims: [],
    }),
    output({
      intent: "handoff",
      entities: {
        reasons: [
          "missing_item",
          "wrong_item",
          "late_delivery",
          "angry_customer",
          "human_requested",
        ],
      },
      toolCalls: [
        {
          toolName: "handoff",
          arguments: {
            reasons: [
              "missing_item",
              "wrong_item",
              "late_delivery",
              "angry_customer",
              "human_requested",
            ],
          },
        },
      ],
      responseClaims: [],
    }),
    output({
      intent: "feedback",
      entities: { sentiment: "mixed" },
      toolCalls: [],
      responseClaims: [],
    }),
  ]);
}

function createScenario06Planner() {
  return new StaticToolPlanner([
    output({
      intent: "ordering",
      entities: { normalizedText: "gà cay và Pepsi" },
      toolCalls: [
        { toolName: "searchMenu", arguments: { query: "gà cay Pepsi" } },
        {
          toolName: "updateCart",
          arguments: { itemCode: "41086", quantity: 1 },
        },
      ],
      responseClaims: [],
    }),
    output({
      intent: "safety",
      entities: { allergenQuestion: "không cay không phô mai" },
      toolCalls: [
        {
          toolName: "searchContentPolicy",
          arguments: { kind: "allergen", query: "không cay không phô mai" },
        },
        {
          toolName: "answerAllergenQuestion",
          arguments: { query: "không cay không phô mai" },
        },
      ],
      responseClaims: [],
    }),
    output({
      intent: "safety",
      entities: { spam: true },
      toolCalls: [],
      responseClaims: [],
      directResponse: "Mình chỉ hỗ trợ đặt món và thông tin KFC liên quan.",
    }),
    output({
      intent: "unclear",
      entities: { ambiguousReference: true },
      toolCalls: [],
      responseClaims: [],
      directResponse: "Bạn muốn đổi món nào trong giỏ hiện tại?",
    }),
    output({
      intent: "unclear",
      entities: { missingOrderHistory: true },
      toolCalls: [],
      responseClaims: [],
      directResponse:
        "Mình chưa có đủ thông tin đơn cũ để đặt lại. Bạn cho mình món hoặc mã đơn nhé.",
    }),
    output({
      intent: "safety",
      entities: { disallowedRequest: "private_staff_phone" },
      toolCalls: [],
      responseClaims: [],
      directResponse:
        "Mình không thể cung cấp số riêng của nhân viên. Mình có thể chuyển kênh hỗ trợ chính thức nếu cần.",
    }),
  ]);
}

function createScenario07Planner() {
  return new StaticToolPlanner([
    output({
      intent: "ordering",
      entities: { reorderRequested: true },
      toolCalls: [
        {
          toolName: "searchMenu",
          arguments: { query: "đơn gần nhất Combo Hợp Gu 99K Pepsi" },
        },
        {
          toolName: "updateCart",
          arguments: { itemCode: "20751", quantity: 1 },
        },
        {
          toolName: "updateCart",
          arguments: { itemCode: "41086", quantity: 1 },
        },
      ],
      responseClaims: [],
    }),
    output({
      intent: "ordering",
      entities: { favoriteRequested: true },
      toolCalls: [
        {
          toolName: "searchMenu",
          arguments: { query: "món yêu thích Burger Gà Zinger" },
        },
        {
          toolName: "updateCart",
          arguments: { itemCode: "41141", quantity: 1 },
        },
      ],
      responseClaims: [],
    }),
    output({
      intent: "ordering",
      entities: { membershipLookup: true },
      toolCalls: [
        { toolName: "getMembershipProfile", arguments: {} },
        { toolName: "listMembershipRewards", arguments: { query: "đổi điểm" } },
        { toolName: "listMembershipWallet", arguments: { status: "active" } },
        { toolName: "getMembershipPointHistory", arguments: { days: 30 } },
      ],
      responseClaims: [],
    }),
    output({
      intent: "cart_edit",
      entities: { removeItem: "Pepsi", addItem: "trà đào", cartMutationConfirmed: true },
      toolCalls: [
        { toolName: "searchMenu", arguments: { query: "trà đào" } },
        {
          toolName: "updateCart",
          arguments: { itemCode: "41086", quantity: 0 },
        },
        { toolName: "previewCart", arguments: {} },
      ],
      responseClaims: [],
    }),
    output({
      intent: "cart_edit",
      entities: { holdCart: true },
      toolCalls: [{ toolName: "previewCart", arguments: {} }],
      responseClaims: [],
    }),
  ]);
}

function createScenario08Planner() {
  return new StaticToolPlanner([
    output({
      intent: "payment",
      entities: { orderId: "KFC-MOCK-1001", paymentRetryRequested: true },
      toolCalls: [
        {
          toolName: "checkPaymentStatus",
          arguments: { orderId: "KFC-MOCK-1001" },
        },
      ],
      responseClaims: [],
    }),
    output({
      intent: "payment",
      entities: { paymentLinkClickFailed: true },
      toolCalls: [
        {
          toolName: "checkPaymentStatus",
          arguments: { orderId: "KFC-MOCK-1001" },
        },
      ],
      responseClaims: [],
    }),
    output({
      intent: "handoff",
      entities: { abnormalLargeOrder: true },
      toolCalls: [
        { toolName: "searchMenu", arguments: { query: "Combo Hợp Gu 99K" } },
        {
          toolName: "updateCart",
          arguments: { itemCode: "20751", quantity: 200 },
        },
        {
          toolName: "handoff",
          arguments: {
            reasons: [
              "payment_failed",
              "abnormal_large_order",
              "human_review_required",
            ],
          },
        },
      ],
      responseClaims: [],
    }),
  ]);
}

function createScenario09Planner() {
  return new StaticToolPlanner([
    output({
      intent: "payment",
      entities: {},
      toolCalls: [{ toolName: "listPaymentMethods", arguments: {} }],
      responseClaims: [],
    }),
    output({
      intent: "payment",
      entities: { paymentMethod: "momo" },
      toolCalls: [{ toolName: "listPaymentMethods", arguments: {} }],
      responseClaims: [],
    }),
  ]);
}

const scenarioCases: ScenarioCase[] = [
  {
    fileName: "01-dat-mon-ro-rang-giao-hang.json",
    createPlanner: createScenario01Planner,
    expectedFinalState: "order_created",
    expectedToolNames: [
      "searchMenu",
      "updateCart",
      "quoteFulfillment",
      "validateVoucher",
      "listPaymentMethods",
      "collectInvoice",
      "previewOrder",
      "placeOrder",
      "createPaymentLink",
    ],
    expectedEventTypes: [
      "order_created",
      "payment_link_created",
      "voucher_applied",
      "session_updated",
    ],
    extraAssertions: (_script, result) => {
      expect(
        result.eventsBeforeFinalUserTurn.some(
          (event) => event.type === "order_created",
        ),
      ).toBe(false);
      expect(eventPayloads(result, "order_created")).toHaveLength(1);
      expect(eventPayloads(result, "payment_link_created")[0]).toMatchObject({
        method: "zalopay",
        status: "pending",
      });
      expect(eventPayloads(result, "voucher_applied")).toHaveLength(1);
      expect(eventPayloads(result, "voucher_rejected")).toEqual([]);
      expect(eventPayloads(result, "voucher_applied")[0]).toMatchObject({
        validation: expect.objectContaining({
          ok: true,
          publicCode: "KFC50",
          discountVnd: 50000,
        }),
      });
      expect(eventPayloads(result, "session_updated")).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ updateType: "store_assigned" }),
          expect.objectContaining({
            updateType: "delivery_quote",
            feeVnd: 18000,
            etaMinutes: 25,
          }),
          expect.objectContaining({
            updateType: "invoice_requested",
            taxCode: "0312345678",
            email: "finance@abc.test",
          }),
        ]),
      );
      expect(result.order).toMatchObject({
        status: "created",
        paymentStatus: "pending",
        assignedStoreId: expect.any(String),
      });
      expect(eventPayloads(result, "order_created")[0]).toMatchObject({
        order: expect.objectContaining({
          status: "created",
          paymentStatus: "pending",
        }),
      });
    },
  },
  {
    fileName: "02-tu-van-combo-va-upsell.json",
    createPlanner: createScenario02Planner,
    expectedFinalState: "cart_ready",
    expectedToolNames: [
      "searchMenu",
      "searchPromotions",
      "updateCart",
      "previewCart",
      "getItemDetails",
      "getModifierOptions",
    ],
    expectedEventTypes: ["cart_changed", "session_updated"],
    extraAssertions: (_script, result) => {
      expect(result.cart?.items).toEqual([
        expect.objectContaining({
          itemCode: "20752",
          quantity: 2,
          unitPriceVnd: 143000,
        }),
      ]);
      expect(result.cart?.subtotalVnd).toBe(286000);
      expect(result.cart?.totalVnd).toBe(286000);
      expect(
        result.cart?.items.some((item) =>
          ["41037", "41035", "41074"].includes(item.itemCode),
        ),
      ).toBe(
        false,
      );
    },
  },
  {
    fileName: "03-ton-kho-dia-chi-va-cua-hang.json",
    createPlanner: createScenario03Planner,
    expectedFinalState: "needs_customer_decision",
    expectedToolNames: [
      "searchMenu",
      "findStores",
      "updateCart",
      "quoteFulfillment",
      "checkStoreAvailability",
    ],
    expectedEventTypes: ["cart_changed", "session_updated"],
    extraAssertions: (_script, result) => {
      expect(result.order).toBeUndefined();
      expect(result.toolTrace).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ toolName: "quoteFulfillment", ok: true }),
          expect.objectContaining({ toolName: "checkStoreAvailability", ok: true }),
        ]),
      );
      expect(result.toolTraceByTurn.find(({ turnIndex }) => turnIndex === 5)?.entries).toEqual(
        expect.arrayContaining([expect.objectContaining({ toolName: "quoteFulfillment", ok: true })]),
      );
      expect(result.toolTraceByTurn.find(({ turnIndex }) => turnIndex === 7)?.entries).toEqual(
        expect.arrayContaining([expect.objectContaining({ toolName: "checkStoreAvailability", ok: true })]),
      );
    },
  },
  {
    fileName: "04-sau-khi-dat-don.json",
    createPlanner: createScenario04Planner,
    expectedFinalState: "post_order_handled",
    expectedToolNames: [
      "getOrderStatus",
      "handoff",
      "searchMenu",
      "updateCart",
    ],
    expectedEventTypes: ["handoff_required", "cart_changed", "session_updated"],
    extraAssertions: (_script, result) => {
      expect(
        toolNames(result).filter((name) => name === "getOrderStatus"),
      ).toHaveLength(5);
      expect(result.cart?.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ itemCode: "20751" }),
        ]),
      );
    },
  },
  {
    fileName: "05-khieu-nai-va-human-handoff.json",
    createPlanner: createScenario05Planner,
    expectedFinalState: "human_handoff_created",
    expectedToolNames: ["handoff"],
    expectedEventTypes: ["handoff_required"],
    extraAssertions: (_script, result) => {
      expect(toolNames(result)).toEqual(expect.arrayContaining(["handoff"]));
      expect(eventPayloads(result, "handoff_required")[0]).toMatchObject({
        escalationId: expect.stringContaining("handoff_"),
        reasons: expect.arrayContaining([
          "missing_item",
          "wrong_item",
          "late_delivery",
          "angry_customer",
          "human_requested",
        ]),
      });
    },
  },
  {
    fileName: "06-ngon-ngu-tu-nhien-va-an-toan.json",
    createPlanner: createScenario06Planner,
    expectedFinalState: "clarification_needed",
    expectedToolNames: [
      "searchMenu",
      "updateCart",
      "searchContentPolicy",
      "answerAllergenQuestion",
    ],
    expectedEventTypes: ["cart_changed", "session_updated"],
    extraAssertions: (_script, result) => {
      expect(result.toolTrace).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            toolName: "searchContentPolicy",
            ok: true,
          }),
          expect.objectContaining({
            toolName: "answerAllergenQuestion",
            ok: true,
          }),
        ]),
      );
      expect(result.order).toBeUndefined();
    },
  },
  {
    fileName: "07-ca-nhan-hoa-va-loyalty.json",
    createPlanner: createScenario07Planner,
    expectedFinalState: "cart_updated",
    expectedToolNames: [
      "searchMenu",
      "updateCart",
      "getMembershipProfile",
      "listMembershipRewards",
      "listMembershipWallet",
      "getMembershipPointHistory",
      "previewCart",
    ],
    expectedEventTypes: ["cart_changed", "session_updated"],
    extraAssertions: (_script, result) => {
      expect(result.cart?.items.some((item) => item.itemCode === "41086")).toBe(
        false,
      );
      expect(result.cart?.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ itemCode: "41141" }),
        ]),
      );
    },
  },
  {
    fileName: "08-thanh-toan-loi-va-don-bat-thuong.json",
    createPlanner: createScenario08Planner,
    expectedFinalState: "human_review_required",
    expectedToolNames: [
      "checkPaymentStatus",
      "searchMenu",
      "updateCart",
      "handoff",
    ],
    expectedEventTypes: ["session_updated", "cart_changed", "handoff_required"],
    extraAssertions: (_script, result) => {
      expect(
        result.toolTrace.filter(
          (entry) => entry.toolName === "checkPaymentStatus",
        ),
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            ok: false,
            resultSummary: "payment_failed",
          }),
        ]),
      );
      expect(eventPayloads(result, "handoff_required")[0]).toMatchObject({
        reasons: expect.arrayContaining([
          "payment_failed",
          "abnormal_large_order",
          "human_review_required",
        ]),
      });
      expect(result.cart?.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ itemCode: "20751", quantity: 200 }),
        ]),
      );
    },
  },
  {
    fileName: "09-phuong-thuc-thanh-toan.json",
    createPlanner: createScenario09Planner,
    expectedFinalState: "payment_methods_answered",
    expectedToolNames: ["listPaymentMethods"],
    expectedEventTypes: ["session_updated"],
    extraAssertions: (_script, result) => {
      expect(
        toolNames(result).filter((name) => name === "listPaymentMethods"),
      ).toHaveLength(2);
      expect(result.order).toBeUndefined();
      expect(result.cart).toBeUndefined();
      expect(eventPayloads(result, "payment_link_created")).toEqual([]);
      expect(result.toolTrace).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            toolName: "listPaymentMethods",
            ok: true,
          }),
        ]),
      );
    },
  },
];

describe("documented conversation scenario replay", () => {
  it.each(scenarioCases)(
    "$fileName uses production tool traces and dashboard events",
    async (scenarioCase) => {
      const { script, result } = await replay(
        scenarioCase.fileName,
        scenarioCase.createPlanner(),
      );

      expect(result.finalState).toBe(script.finalState);
      expect(result.finalState).toBe(scenarioCase.expectedFinalState);
      expect(result.coveredUseCases).toEqual(script.useCases);
      expect(result.transcript).toHaveLength(script.turns.length);
      expect(
        result.dashboardEvents.every(
          (event) => !event.id.includes("scenario_"),
        ),
      ).toBe(true);
      expect(toolNames(result)).toEqual(
        expect.arrayContaining(scenarioCase.expectedToolNames),
      );
      expect(eventTypes(result)).toEqual(
        expect.arrayContaining(scenarioCase.expectedEventTypes),
      );
      scenarioCase.extraAssertions?.(script, result);
    },
  );

  it("does not repair scenario 01 under-planning with hidden tools, cart, or order injection", async () => {
    const { result } = await replay(
      "01-dat-mon-ro-rang-giao-hang.json",
      createUnderPlanningScenario01Planner(),
    );

    expect(toolNames(result)).toEqual(["searchMenu"]);
    expect(result.cart).toBeUndefined();
    expect(result.order).toBeUndefined();
    expect(eventPayloads(result, "cart_changed")).toEqual([]);
    expect(eventPayloads(result, "order_created")).toEqual([]);
    expect(eventPayloads(result, "voucher_applied")).toEqual([]);
    expect(eventPayloads(result, "payment_link_created")).toEqual([]);

    const toolCallBoundaries = result.dashboardEvents
      .filter(
        (event) =>
          event.type === "session_updated" &&
          event.payload.updateType === "tool_called",
      )
      .map((event) => event.payload.boundary);
    expect(toolCallBoundaries).toEqual(["catalog"]);
  });

  it("all backend replay scripts cover exactly UC-01 through UC-39", async () => {
    expect(scenarioCases).toHaveLength(9);

    const scripts = await Promise.all(
      scenarioCases.map((scenarioCase) =>
        loadScenarioScript(join(scenariosRoot, scenarioCase.fileName)),
      ),
    );
    const actualUseCases = [
      ...new Set(
        scripts
          .flatMap((script) => [
            ...script.useCases,
            ...script.turns.flatMap((turn) => turn.useCases),
          ])
          .filter((useCase) => useCase !== "Filler"),
      ),
    ].sort();
    const expectedUseCases = Array.from(
      { length: 39 },
      (_, index) => `UC-${String(index + 1).padStart(2, "0")}`,
    );

    expect(actualUseCases).toEqual(expectedUseCases);
  });
});
