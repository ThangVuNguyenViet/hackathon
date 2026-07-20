import { describe, expect, it, vi } from "vitest";
import type { ExternalCallContext } from "../../src/clients/interfaces.js";
import type { Order } from "../../src/domain/types.js";
import {
  createMockClients,
  type MockedUpstreamApiProfile,
} from "../../src/mock/createMockClients.js";
import { loadGeneratedFixtures } from "../../src/fixtures/loadFixtures.js";
import { OrderingDataService } from "../../src/ordering/orderingDataService.js";
import { createTestFixtures } from "../fixtures/testFixtures.js";

const fixtures = createTestFixtures();
const externalCallContext: ExternalCallContext = {
  signal: new AbortController().signal,
  deadlineAt: Date.now() + 60_000,
};

const opaquePaymentMethodId =
  "provider/支付?method=ví điện tử#%" + "🧾".repeat(300);

function mutationIdentity(suffix: string) {
  return {
    idempotencyKey: `mock-client-test:${suffix}`,
    bindingFingerprint: "a".repeat(64),
  };
}

function paymentOrder(id: string): Order {
  return {
    id,
    cart: {
      id: "cart-payment",
      items: [],
      subtotalVnd: 0,
      discountVnd: 0,
      deliveryFeeVnd: 0,
      totalVnd: 0,
      voucherCode: null,
    },
    status: "created",
    paymentStatus: "not_started",
    assignedStoreId: "KFCVN0001",
    createdAt: "2026-07-20T00:00:00.000Z",
  };
}

describe("mock clients", () => {
  it("passes the exact external-call context to injected providers", async () => {
    const orderStatusProvider = vi.fn(
      async (_orderId: string, receivedContext: ExternalCallContext) => {
        expect(receivedContext).toBe(externalCallContext);
        return {
          ok: false as const,
          errorCode: "order_not_found",
          message: "not found",
        };
      },
    );
    const clients = createMockClients(fixtures, {
      orderStatusProvider,
    });

    await clients.oms.getOrderStatus("missing-order", externalCallContext);

    expect(orderStatusProvider).toHaveBeenCalledWith(
      "missing-order",
      externalCallContext,
    );
  });

  it("preserves an opaque payment method ID for exact mock lookup while encoding URL path segments", async () => {
    const listed = fixtures.paymentMethods.find(
      (method) => method.methodId === "zalopay_wallet",
    );
    if (!listed) throw new Error("listed payment fixture missing");
    const clients = createMockClients(
      createTestFixtures({
        paymentMethods: [
          {
            ...listed,
            methodId: opaquePaymentMethodId,
          },
        ],
      }),
    );
    const lookup = vi.spyOn(
      OrderingDataService.prototype,
      "getPaymentMethodForLink",
    );
    const order = paymentOrder("order/đặc biệt?#%");

    try {
      const result = await clients.payment.createPaymentLink(
        order,
        opaquePaymentMethodId,
        externalCallContext,
        mutationIdentity("opaque-payment-method"),
      );

      expect(lookup).toHaveBeenCalledOnce();
      expect(lookup).toHaveBeenCalledWith(opaquePaymentMethodId);
      expect(result).toMatchObject({
        ok: true,
        value: {
          url:
            `https://pay.mock/method-${encodeURIComponent(opaquePaymentMethodId)}/` +
            `order-${encodeURIComponent(order.id)}`,
          status: "pending",
        },
      });
    } finally {
      lookup.mockRestore();
    }
  });

  it("keeps dot-only opaque IDs as distinct mock payment URL segments", async () => {
    const listed = fixtures.paymentMethods.find(
      (method) => method.methodId === "zalopay_wallet",
    );
    if (!listed) throw new Error("listed payment fixture missing");
    const clients = createMockClients(
      createTestFixtures({
        paymentMethods: [
          { ...listed, methodId: "." },
          { ...listed, methodId: ".." },
        ],
      }),
    );
    const lookup = vi.spyOn(
      OrderingDataService.prototype,
      "getPaymentMethodForLink",
    );
    const order = paymentOrder("dot-segment-order");

    try {
      const [singleDot, doubleDot] = await Promise.all([
        clients.payment.createPaymentLink(
          order,
          ".",
          externalCallContext,
          mutationIdentity("single-dot-payment-method"),
        ),
        clients.payment.createPaymentLink(
          order,
          "..",
          externalCallContext,
          mutationIdentity("double-dot-payment-method"),
        ),
      ]);

      expect(lookup.mock.calls.map(([methodId]) => methodId)).toEqual([
        ".",
        "..",
      ]);
      expect(singleDot.value?.url).toBe(
        `https://pay.mock/method-./order-${encodeURIComponent(order.id)}`,
      );
      expect(doubleDot.value?.url).toBe(
        `https://pay.mock/method-../order-${encodeURIComponent(order.id)}`,
      );
      expect(new URL(singleDot.value!.url).pathname).toBe(
        `/method-./order-${encodeURIComponent(order.id)}`,
      );
      expect(new URL(doubleDot.value!.url).pathname).toBe(
        `/method-../order-${encodeURIComponent(order.id)}`,
      );
    } finally {
      lookup.mockRestore();
    }
  });

  it.each([".", ".."])(
    "rejects the unsafe dot-only mock order ID %j before payment lookup",
    async (orderId) => {
      const clients = createMockClients(fixtures);
      const lookup = vi.spyOn(
        OrderingDataService.prototype,
        "getPaymentMethodForLink",
      );

      await expect(clients.payment.createPaymentLink(
        paymentOrder(orderId),
        "zalopay_wallet",
        externalCallContext,
        mutationIdentity(`unsafe-order-${orderId.length}`),
      )).resolves.toMatchObject({
        ok: false,
        errorCode: "invalid_order_id",
      });
      expect(lookup).not.toHaveBeenCalled();
    },
  );

  it("derives cash-on-delivery behavior from verified category instead of a fixed provider ID", async () => {
    const cod = fixtures.paymentMethods.find(
      (method) => method.category === "cash_on_delivery",
    );
    const wallet = fixtures.paymentMethods.find(
      (method) => method.category === "digital_wallet" &&
        method.supported &&
        method.supportStatus === "listed_supported",
    );
    if (!cod || !wallet) throw new Error("payment fixtures missing");
    const clients = createMockClients(createTestFixtures({
      paymentMethods: [
        { ...cod, methodId: "rotated-opaque-cod-id" },
        { ...wallet, methodId: "cash_on_delivery" },
      ],
    }));
    const order = paymentOrder("category-derived-payment");

    await expect(clients.payment.createPaymentLink(
      order,
      "rotated-opaque-cod-id",
      externalCallContext,
      mutationIdentity("rotated-cod"),
    )).resolves.toMatchObject({
      ok: true,
      value: { url: "cod://pay-on-delivery" },
    });
    await expect(clients.payment.createPaymentLink(
      order,
      "cash_on_delivery",
      externalCallContext,
      mutationIdentity("rotated-wallet"),
    )).resolves.toMatchObject({
      ok: true,
      value: {
        url:
          "https://pay.mock/method-cash_on_delivery/" +
          "order-category-derived-payment",
      },
    });
  });

  it("rejects mock payment methods that are flagged supported without listed support authority", async () => {
    const listed = fixtures.paymentMethods.find(
      (method) => method.methodId === "zalopay_wallet",
    );
    if (!listed) throw new Error("listed payment fixture missing");
    const methodId = "provider-supported-but-not-listed";
    const clients = createMockClients(
      createTestFixtures({
        paymentMethods: [
          {
            ...listed,
            methodId,
            supported: true,
            supportStatus: "not_listed_in_policy",
          },
        ],
      }),
    );

    await expect(
      clients.payment.createPaymentLink(
        paymentOrder("order-not-listed"),
        methodId,
        externalCallContext,
        mutationIdentity("not-listed-method"),
      ),
    ).resolves.toMatchObject({
      ok: false,
      errorCode: "payment_method_unsupported",
    });
  });

  it("creates a distinct escalation for each handoff request", async () => {
    const clients = createMockClients(fixtures);
    const first = await clients.handoff.escalateToHuman(
      "session_1",
      ["order_cancellation_requested"],
      externalCallContext,
      mutationIdentity("handoff-first"),
    );
    const second = await clients.handoff.escalateToHuman(
      "session_1",
      ["order_cancellation_requested"],
      externalCallContext,
      mutationIdentity("handoff-second"),
    );

    expect(first.value?.escalationId).not.toBe(second.value?.escalationId);
  });

  it("resolves only the exact active escalation for the bound session", async () => {
    const clients = createMockClients(fixtures);
    const created = await clients.handoff.escalateToHuman(
      "session_1",
      ["order_cancellation_requested"],
      externalCallContext,
      mutationIdentity("handoff-to-resolve"),
    );
    const escalationId = created.value?.escalationId;
    expect(escalationId).toBeDefined();

    await expect(clients.handoff.resolveEscalation(
      "different_session",
      escalationId!,
      externalCallContext,
      mutationIdentity("wrong-session-resolution"),
    )).resolves.toMatchObject({
      ok: false,
      errorCode: "handoff_not_found",
    });
    await expect(clients.handoff.resolveEscalation(
      "session_1",
      escalationId!,
      externalCallContext,
      mutationIdentity("exact-resolution"),
    )).resolves.toMatchObject({
      ok: true,
      value: {
        escalationId,
        status: "resolved",
      },
    });
    await expect(clients.handoff.resolveEscalation(
      "session_1",
      escalationId!,
      externalCallContext,
      mutationIdentity("duplicate-resolution"),
    )).resolves.toMatchObject({
      ok: false,
      errorCode: "handoff_already_resolved",
    });
  });

  it("replays one bound provider mutation and rejects key rebinding", async () => {
    const clients = createMockClients(fixtures);
    const identity = {
      idempotencyKey: "confirmation:request-1:handoff:digest",
      bindingFingerprint: "a".repeat(64),
    };

    const first = await clients.handoff.escalateToHuman(
      "session_1",
      ["customer_requested_support"],
      externalCallContext,
      identity,
    );
    const replay = await clients.handoff.escalateToHuman(
      "session_1",
      ["customer_requested_support"],
      externalCallContext,
      identity,
    );
    const conflict = await clients.handoff.escalateToHuman(
      "session_1",
      ["customer_requested_support"],
      externalCallContext,
      { ...identity, bindingFingerprint: "b".repeat(64) },
    );
    // @ts-expect-error provider mutation identity is mandatory for handoff.
    const nextUnbound = await clients.handoff.escalateToHuman(
      "session_1",
      ["customer_requested_support"],
      externalCallContext,
    );

    expect(replay).toEqual(first);
    expect(conflict).toMatchObject({
      ok: false,
      errorCode: "provider_idempotency_conflict",
    });
    expect(nextUnbound).toMatchObject({
      ok: false,
      errorCode: "provider_mutation_identity_required",
    });
  });

  it("searches Vietnamese menu fixtures and builds priced carts", async () => {
    const clients = createMockClients(fixtures);
    const search = await clients.menu.searchMenu(
      "Combo 99K",
      externalCallContext,
    );
    expect(search.ok).toBe(true);
    expect(search.value?.[0]).toMatchObject({
      code: "20751",
      categoryId: "20000",
    });

    const cart = await clients.cart.createCart(
      "session_1",
      externalCallContext,
    );
    const updated = await clients.cart.updateCart(
      cart.value!,
      "20751",
      2,
      undefined,
      externalCallContext,
    );
    expect(updated.value?.subtotalVnd).toBe(198000);
  });

  it("applies a multi-item cart change atomically and rolls back invalid changes", async () => {
    const clients = createMockClients(
      await loadGeneratedFixtures(process.cwd()),
    );
    const original = (
      await clients.cart.createCart("atomic_cart", externalCallContext)
    ).value!;
    const applyChanges = clients.cart.applyChanges.bind(clients.cart);

    const changed = await applyChanges(
      original,
      [
        { itemCode: "41037", quantity: 3 },
        { itemCode: "41035", quantity: 1 },
        { itemCode: "41074", quantity: 4 },
      ],
      externalCallContext,
    );
    if (!changed.ok || !changed.value) {
      throw new Error("expected atomic cart update to succeed");
    }
    expect(changed.value).toMatchObject({ subtotalVnd: 404000 });

    const rejected = await applyChanges(
      changed.value,
      [
        { itemCode: "41037", quantity: 0 },
        { itemCode: "missing-item", quantity: 1 },
      ],
      externalCallContext,
    );
    expect(rejected).toMatchObject({ ok: false, errorCode: "item_not_found" });
    expect(changed.value.items).toEqual([
      expect.objectContaining({ itemCode: "41037", quantity: 3 }),
      expect.objectContaining({ itemCode: "41035", quantity: 1 }),
      expect.objectContaining({ itemCode: "41074", quantity: 4 }),
    ]);
  });

  it("atomically replaces individual items with two customized combos for 286000 VND", async () => {
    const clients = createMockClients(
      await loadGeneratedFixtures(process.cwd()),
    );
    const original = (
      await clients.cart.createCart("combo_cart", externalCallContext)
    ).value!;
    const applyChanges = clients.cart.applyChanges.bind(clients.cart);
    const individual = (
      await applyChanges(
        original,
        [
          { itemCode: "41037", quantity: 3 },
          { itemCode: "41035", quantity: 1 },
          { itemCode: "41074", quantity: 4 },
        ],
        externalCallContext,
      )
    ).value!;
    const modifierTree = (
      await clients.menu.getModifierOptions("20752", externalCallContext)
    ).value!;
    const largePepsi = modifierTree.modifierGroups.flatMap((group) => {
      const option = group.options.find(
        (candidate) => candidate.modifierId === "41091",
      );
      if (!option) return [];
      return {
        groupId: group.groupId,
        groupName: group.name,
        modifierId: option.modifierId,
        modifierName: option.name,
        quantity: 1,
        priceDeltaVnd: option.priceDeltaVnd,
      };
    });

    const converted = await applyChanges(
      individual,
      [
        { itemCode: "41037", quantity: 0 },
        { itemCode: "41035", quantity: 0 },
        { itemCode: "41074", quantity: 0 },
        { itemCode: "20752", quantity: 2, modifiers: largePepsi },
      ],
      externalCallContext,
    );
    expect(converted.value).toMatchObject({
      items: [{ itemCode: "20752", quantity: 2, unitPriceVnd: 143000 }],
      totalVnd: 286000,
    });
  });

  it("resolves flat nested modifier selections from fixture evidence", async () => {
    const clients = createMockClients(
      await loadGeneratedFixtures(process.cwd()),
    );
    const cart = (
      await clients.cart.createCart("nested_modifier_cart", externalCallContext)
    ).value!;
    const updated = await clients.cart.updateCart(
      cart,
      "20752",
      1,
      [
        { groupId: "1", modifierId: "41106" },
        { groupId: "60266", modifierId: "70258", quantity: 5 },
        { groupId: "2", modifierId: "41089" },
        { groupId: "3", modifierId: "41089" },
      ],
      externalCallContext,
    );

    expect(updated.ok).toBe(true);
    expect(updated.value?.items[0]).toMatchObject({
      itemCode: "20752",
      unitPriceVnd: 129000,
      modifiers: expect.arrayContaining([
        expect.objectContaining({
          groupId: "60266",
          modifierId: "70258",
          modifierName: "Gà Giòn Cay",
          quantity: 5,
        }),
      ]),
    });

    const nestedSelectionWithImplicitVerifiedParent =
      await clients.cart.updateCart(
        cart,
        "20752",
        1,
        [{ groupId: "60266", modifierId: "70258", quantity: 5 }],
        externalCallContext,
      );
    expect(nestedSelectionWithImplicitVerifiedParent).toMatchObject({
      ok: true,
    });
    expect(
      nestedSelectionWithImplicitVerifiedParent.value?.items[0]?.modifiers,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ groupId: "1", modifierId: "41106" }),
        expect.objectContaining({
          groupId: "60266",
          modifierId: "70258",
          modifierName: "Gà Giòn Cay",
        }),
      ]),
    );
  });

  it("matches menu items from AI-normalized item text", async () => {
    const clients = createMockClients(fixtures);
    const search = await clients.menu.searchMenu(
      "Combo Hợp Gu 99K",
      externalCallContext,
    );
    const addMoreSearch = await clients.menu.searchMenu(
      "Combo Hợp Gu 99K",
      externalCallContext,
    );

    expect(search.ok).toBe(true);
    expect(search.value?.[0]?.code).toBe("20751");
    expect(addMoreSearch.value?.[0]?.code).toBe("20751");
  });

  it("honors store item exclusions when checking inventory", async () => {
    const clients = createMockClients(
      createTestFixtures({
        storeAvailability: [
          {
            storeId: "KFCVN0002",
            storeName: "KFC BIG C ĐỒNG NAI",
            pickup: { excludedItemIds: ["20751"], timeslotExclusions: [] },
            delivery: { excludedItemIds: [], timeslotExclusions: [] },
            provenance: {
              sourceFile: "availability.json",
              sourceApi: "https://api.kfcvietnam.com.vn/stores",
              fixtureMode: "public_crawl_seed",
            },
          },
        ],
      }),
    );

    const availability = await clients.inventory.checkInventory(
      "KFCVN0002",
      ["20751"],
      undefined,
      externalCallContext,
    );
    expect(availability.value).toEqual({ "20751": false });
  });

  it("binds atomic inventory rows to an inventory-only opaque revision", async () => {
    let profile: MockedUpstreamApiProfile = {
      unavailableItemCodes: ["20751"],
      savedAddresses: [{
        label: "Private",
        line1: "secret-private-address",
        district: "Private district",
        city: "Private city",
      }],
      paymentStatuses: {
        "secret-private-order": "paid",
      },
    };
    const clients = createMockClients(fixtures, {
      mockedUpstreamApiProvider: () => profile,
    });

    const observed = await clients.inventory.checkInventoryWithAuthority!(
      "KFCVN0002",
      ["20751"],
      "delivery",
      externalCallContext,
    );
    expect(observed).toMatchObject({
      ok: true,
      value: {
        availability: { "20751": false },
        providerRevision: expect.stringMatching(
          /^inventory:[a-f0-9]{64}$/u,
        ),
      },
    });
    const observedRevision = observed.value?.providerRevision;
    expect(observedRevision).not.toContain("secret-private-address");
    expect(observedRevision).not.toContain("secret-private-order");

    profile = {
      ...profile,
      savedAddresses: [{
        label: "Changed private data",
        line1: "another-secret-address",
        district: "Changed district",
        city: "Changed city",
      }],
      paymentStatuses: {
        "another-secret-order": "failed",
      },
    };
    const privateDataChanged =
      await clients.inventory.getAvailabilityRevision!(externalCallContext);
    expect(privateDataChanged.value).toBe(observedRevision);

    profile = { ...profile, unavailableItemCodes: [] };
    const inventoryChanged =
      await clients.inventory.getAvailabilityRevision!(externalCallContext);
    expect(inventoryChanged.value).not.toBe(observedRevision);
  });

  it("applies one turn-scoped mocked upstream profile consistently across menu, cart, inventory, and fulfillment", async () => {
    let profile = {
      unavailableItemCodes: ["20751"],
    } as {
      unavailableItemCodes?: string[];
      deliveryFeeVnd?: number;
      deliveryEtaMinutes?: number;
    };
    const clients = createMockClients(fixtures, {
      mockedUpstreamApiProvider: () => profile,
    });
    const menu = await clients.menu.searchMenu(
      "Combo Hợp Gu 99K",
      externalCallContext,
    );
    const cart = (
      await clients.cart.createCart("turn_scoped_profile", externalCallContext)
    ).value!;
    const update = await clients.cart.updateCart(
      cart,
      "20751",
      1,
      undefined,
      externalCallContext,
    );
    const inventory = await clients.inventory.checkInventory(
      "KFCVN0002",
      ["20751"],
      "delivery",
      externalCallContext,
    );

    expect(
      menu.value?.find((candidate) => candidate.code === "20751")
        ?.available,
    ).toBe(false);
    expect(update).toMatchObject({ ok: false, errorCode: "item_unavailable" });
    expect(inventory.value).toEqual({ "20751": false });

    profile = { deliveryFeeVnd: 27_000, deliveryEtaMinutes: 45 };
    const quote = await clients.fulfillment.quoteFulfillment(
      {
        address: {
          label: "Home",
          line1: "Big C Đồng Nai",
          district: "Biên Hòa",
          city: "ĐỒNG NAI",
        },
        method: "delivery",
        itemCodes: ["20751"],
      },
      externalCallContext,
    );
    expect(quote.value).toMatchObject({ feeVnd: 27_000, etaMinutes: 45 });
  });

  it("rejects order placement without explicit confirmation", async () => {
    const clients = createMockClients(fixtures);
    const cart = (
      await clients.cart.createCart("session_1", externalCallContext)
    ).value!;
    const updated = (
      await clients.cart.updateCart(
        cart,
        "20751",
        1,
        undefined,
        externalCallContext,
      )
    ).value!;
    const preview = (
      await clients.oms.previewOrder(
        {
          cart: updated,
          address: {
            label: "Home",
            line1: "23 Nguyen Huu Tho",
            district: "Quan 7",
            city: "Ho Chi Minh",
          },
          storeId: "KFCVN0002",
        },
        externalCallContext,
      )
    ).value!;

    const placed = await clients.oms.placeOrder(
      { preview, userConfirmed: false },
      externalCallContext,
      mutationIdentity("unconfirmed-order"),
    );
    expect(placed.ok).toBe(false);
    expect(placed.errorCode).toBe("confirmation_required");
  });

  it("does not fake channel delivery unless explicit channel clients are injected", async () => {
    const clients = createMockClients(fixtures);
    const sent = await clients.messenger.sendText("psid_1", "Xin chao");
    expect(sent.ok).toBe(false);
    expect(sent.errorCode).toBe("channel_client_not_configured");
    await expect(
      clients.messenger.sendTextWithOutcome("psid_1", "Xin chao"),
    ).resolves.toEqual({
      status: "not_dispatched",
      errorCode: "channel_client_not_configured",
      message:
        "Messenger delivery must be provided by a live channel client",
    });

    const injected = createMockClients(fixtures, {
      channelClients: {
        messenger: {
          async sendText() {
            return {
              ok: true,
              value: { messageId: "live_messenger_message" },
              message: "sent",
            };
          },
          async sendSenderAction() {
            return {
              ok: true,
              value: { recipientId: "psid_1" },
              message: "typing_on",
            };
          },
          async getProfile() {
            return {
              ok: false,
              errorCode: "not_needed",
              message: "not used in this test",
            };
          },
        },
        zalo: {
          async sendText() {
            return {
              ok: true,
              value: { messageId: "live_zalo_message" },
              message: "sent",
            };
          },
          async getProfile() {
            return {
              ok: false,
              errorCode: "not_needed",
              message: "not used in this test",
            };
          },
        },
      },
    });

    expect(
      (await injected.messenger.sendText("psid_1", "Xin chao")).value
        ?.messageId,
    ).toBe("live_messenger_message");
    await expect(
      injected.messenger.sendTextWithOutcome("psid_1", "Xin chao"),
    ).resolves.toEqual({
      status: "confirmed_sent",
      messageId: "live_messenger_message",
    });
    await expect(
      injected.zalo.sendTextWithOutcome("zalo_1", "Xin chao"),
    ).resolves.toEqual({
      status: "confirmed_sent",
      messageId: "live_zalo_message",
    });

    const failedLegacy = createMockClients(fixtures, {
      channelClients: {
        messenger: {
          async sendText() {
            return {
              ok: false,
              errorCode: "messenger_timeout",
              message: "legacy Messenger outcome is ambiguous",
            };
          },
          async sendSenderAction() {
            return {
              ok: true,
              value: { recipientId: "psid_1" },
              message: "typing_on",
            };
          },
          async getProfile() {
            return {
              ok: false,
              errorCode: "not_needed",
              message: "not used in this test",
            };
          },
        },
        zalo: {
          async sendText() {
            return {
              ok: false,
              errorCode: "zalo_timeout",
              message: "legacy Zalo outcome is ambiguous",
            };
          },
          async getProfile() {
            return {
              ok: false,
              errorCode: "not_needed",
              message: "not used in this test",
            };
          },
        },
      },
    });
    await expect(
      failedLegacy.messenger.sendTextWithOutcome(
        "psid_1",
        "Xin chao",
      ),
    ).resolves.toEqual({
      status: "delivery_outcome_unknown",
      errorCode: "messenger_timeout",
      message: "legacy Messenger outcome is ambiguous",
    });
    await expect(
      failedLegacy.zalo.sendTextWithOutcome(
        "zalo_1",
        "Xin chao",
      ),
    ).resolves.toEqual({
      status: "delivery_outcome_unknown",
      errorCode: "zalo_timeout",
      message: "legacy Zalo outcome is ambiguous",
    });
  });

  it("returns modifier options from generated fixture data", async () => {
    const clients = createMockClients(fixtures);
    const details = await clients.menu.getModifierOptions(
      "20751",
      externalCallContext,
    );
    expect(details.ok).toBe(true);
    expect(details.value?.modifierGroups.length).toBeGreaterThan(0);
  });

  it("exposes fixture-backed modifier metadata through menu search and item details", async () => {
    const generated = await loadGeneratedFixtures(process.cwd());
    const tree = generated.menuModifiers.find(
      (candidate) => candidate.modifierGroups[0]?.options[0],
    );
    expect(tree).toBeDefined();
    const item = generated.menuItems.find(
      (candidate) => candidate.itemId === tree!.itemId,
    );
    expect(item).toBeDefined();
    const clients = createMockClients(generated);

    const search = await clients.menu.searchMenu(
      item!.name,
      externalCallContext,
    );
    const result = search.value?.find(
      (candidate) => candidate.code === item!.code,
    );
    const details = await clients.menu.getItemDetails(
      item!.code,
      externalCallContext,
    );

    expect(result).toMatchObject({
      itemId: item!.itemId,
      productCode: item!.productCode,
      isCustomize: item!.isCustomize,
      isQuickCombo: item!.isQuickCombo,
      hasModifiers: true,
      modifierGroups: expect.any(Array),
    });
    expect(details.value?.modifierGroups).toEqual(result?.modifierGroups);
  });

  it("applies fixture-backed demo-stable KFC50 validation", async () => {
    const clients = createMockClients(fixtures);
    const cart = (
      await clients.cart.createCart("session_1", externalCallContext)
    ).value!;
    const updated = (
      await clients.cart.updateCart(
        cart,
        "20751",
        3,
        undefined,
        externalCallContext,
      )
    ).value!;
    const validation = await clients.promotion.validateVoucher(
      updated,
      "KFC50",
      externalCallContext,
    );
    expect(validation.ok).toBe(true);
    expect(validation.value).toMatchObject({
      voucherCode: "KFC50",
      discountVnd: 50000,
    });
  });

  it("serves authenticated membership fixtures and gates account-mutating reward actions", async () => {
    const clients = createMockClients(fixtures);

    const rewards = await clients.membership.listRewards(
      { query: "10k" },
      externalCallContext,
    );
    expect(rewards.value?.[0]).toMatchObject({
      rewardId: "reward-discount-10k",
      pointsCost: 3000,
    });

    const tools = await clients.membership.listTools(
      { sideEffect: "reward_redemption" },
      externalCallContext,
    );
    expect(tools.value?.[0]).toMatchObject({
      toolName: "redeemReward",
      endpointPath: "/voucherify/redeem-reward",
      requiresUserConfirmation: true,
    });

    const unconfirmedAcquire = await clients.membership.acquireVoucher(
      {
        rewardId: "reward-discount-10k",
        confirmed: false,
      },
      externalCallContext,
    );
    expect(unconfirmedAcquire.ok).toBe(false);
    expect(unconfirmedAcquire.errorCode).toBe("confirmation_required");

    const confirmedRedeem = await clients.membership.redeemReward(
      {
        voucherId: "wallet-new-member-25k",
        channel: "kiosk",
        confirmed: true,
      },
      externalCallContext,
      mutationIdentity("confirmed-redeem"),
    );
    expect(confirmedRedeem.ok).toBe(true);
    expect(confirmedRedeem.value).toMatchObject({
      status: "completed",
      targetId: "wallet-new-member-25k",
    });
  });

  it("fails store assignment when the address cannot be resolved from fixtures", async () => {
    const clients = createMockClients(fixtures);
    const assignment = await clients.storeLocator.assignStore(
      {
        label: "Home",
        line1: "No KFC service area",
        district: "No district",
        city: "No city",
      },
      ["20751"],
      externalCallContext,
    );
    expect(assignment.ok).toBe(false);
    expect(assignment.errorCode).toBe("store_not_found");
  });

  it("does not substitute the first fixture store for a named district or building", async () => {
    const clients = createMockClients(fixtures);
    const assignment = await clients.storeLocator.assignStore(
      {
        label: "Home",
        line1: "Sunrise City",
        district: "Quận 12",
        city: "Hồ Chí Minh",
      },
      ["20751"],
      externalCallContext,
    );
    expect(assignment.ok).toBe(false);
    expect(assignment.errorCode).toBe("store_not_found");
  });

  it("resolves a typed address only through an explicit fixture-backed service area", async () => {
    const clients = createMockClients(fixtures, {
      fulfillmentQuoteProvider: async (input) => {
        expect(input.storeId).toBe("KFCVN0318");
        expect(input.address).toEqual({
          label: "Sunrise City",
          line1: "23 Nguyễn Hữu Thọ, phường Tân Hưng",
          district: "Quận 7",
          city: "Hồ Chí Minh",
        });
        return {
          ok: true,
          value: { feeVnd: 19000, etaMinutes: 33 },
          message: "service_area_quote",
        };
      },
    });
    const quote = await clients.fulfillment.quoteFulfillment(
      {
        address: {
          label: "Sunrise City",
          line1: "23 Nguyễn Hữu Thọ, phường Tân Hưng",
          district: "Quận 7",
          city: "Hồ Chí Minh",
        },
        method: "delivery",
        itemCodes: ["20751"],
      },
      externalCallContext,
    );

    expect(quote.ok).toBe(true);
    expect(quote.value).toMatchObject({
      storeId: "KFCVN0318",
      feeVnd: 19000,
      etaMinutes: 33,
    });
  });

  it("quotes fulfillment only when a quote seam provides fee and eta data", async () => {
    const clients = createMockClients(fixtures, {
      fulfillmentQuoteProvider: async (input) => {
        expect(input.storeId).toBe("KFCVN0002");
        expect(input.itemCodes).toEqual(["20751"]);
        return {
          ok: true,
          value: { feeVnd: 31000, etaMinutes: 42 },
          message: "quoted",
        };
      },
    });
    const quote = await clients.fulfillment.quoteFulfillment(
      {
        address: {
          label: "Home",
          line1: "Big C Đồng Nai",
          district: "Biên Hòa",
          city: "ĐỒNG NAI",
        },
        method: "delivery",
        itemCodes: ["20751"],
      },
      externalCallContext,
    );
    expect(quote.ok).toBe(true);
    expect(quote.value?.storeId).toBe("KFCVN0002");
    expect(quote.value?.feeVnd).toBe(31000);
    expect(quote.value?.etaMinutes).toBe(42);
    expect(quote.value?.availability.checkedItemIds).toEqual(["20751"]);
  });

  it("uses an exact fixture-backed quote when no provider override is configured", async () => {
    const clients = createMockClients(fixtures);
    const quote = await clients.fulfillment.quoteFulfillment(
      {
        address: {
          label: "Home",
          line1: "Big C Đồng Nai",
          district: "Biên Hòa",
          city: "ĐỒNG NAI",
        },
        method: "delivery",
        itemCodes: ["20751"],
      },
      externalCallContext,
    );
    expect(quote.ok).toBe(true);
    expect(quote.value).toMatchObject({
      storeId: "KFCVN0002",
      feeVnd: 18000,
      etaMinutes: 35,
    });
  });

  it("fails fulfillment quoting when no exact quote fixture or provider is configured", async () => {
    const clients = createMockClients({ ...fixtures, fulfillmentQuotes: [] });
    const quote = await clients.fulfillment.quoteFulfillment(
      {
        address: {
          label: "Home",
          line1: "Big C Đồng Nai",
          district: "Biên Hòa",
          city: "ĐỒNG NAI",
        },
        method: "delivery",
        itemCodes: ["20751"],
      },
      externalCallContext,
    );
    expect(quote.ok).toBe(false);
    expect(quote.errorCode).toBe("fulfillment_quote_unavailable");
  });

  it("uses the injected recent order provider when configured", async () => {
    const clients = createMockClients(fixtures, {
      recentOrderProvider: (customerId) => {
        expect(customerId).toBe("psid_recent_order");
        return { ok: true, value: null, message: "no_recent_order_for_test" };
      },
    });

    const recentOrder = await clients.customer.getRecentOrder(
      "psid_recent_order",
      externalCallContext,
    );

    expect(recentOrder).toMatchObject({
      ok: true,
      value: null,
      message: "no_recent_order_for_test",
    });
  });

  it("removes status-only ETA evidence from the recent-order route", async () => {
    const observedAt = Date.now();
    const recentOrder = {
      id: "KFC-RECENT-ETA",
      status: "preparing" as const,
      paymentStatus: "paid" as const,
      assignedStoreId: "KFCVN0001",
      createdAt: new Date(observedAt - 60_000).toISOString(),
      deliveryEstimate: {
        kind: "remaining_delivery_window" as const,
        minMinutes: 25,
        maxMinutes: 30,
        observedAt: new Date(observedAt - 1_000).toISOString(),
        expiresAt: new Date(observedAt + 5 * 60_000).toISOString(),
        providerRevision: "mock-recent-order:must-not-cross",
      },
      cart: {
        id: "cart-recent-eta",
        items: [],
        subtotalVnd: 0,
        discountVnd: 0,
        deliveryFeeVnd: 0,
        totalVnd: 0,
        voucherCode: null,
      },
    };
    const clients = createMockClients(fixtures, {
      recentOrderProvider: () => ({
        ok: true,
        value: recentOrder,
        message: "recent_order_with_status_eta",
      }),
    });

    const result = await clients.customer.getRecentOrder(
      "psid_recent_order",
      externalCallContext,
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        id: recentOrder.id,
        status: recentOrder.status,
      },
    });
    expect(result.value).not.toHaveProperty("deliveryEstimate");
    expect(JSON.stringify(result)).not.toContain(
      "mock-recent-order:must-not-cross",
    );
  });

  it("returns no favorite items by default and uses an injected customer provider when configured", async () => {
    const defaultClients = createMockClients(fixtures);
    await expect(
      defaultClients.customer.getFavoriteItems(
        "anonymous",
        externalCallContext,
      ),
    ).resolves.toMatchObject({
      ok: true,
      value: [],
    });

    const favorite = fixtures.menuItems[0]!;
    const clients = createMockClients(fixtures, {
      favoriteItemsProvider: (customerId) => {
        expect(customerId).toBe("member_with_favorite");
        return {
          ok: true,
          value: [favorite],
          message: "customer_favorites_fixture",
        };
      },
    });

    await expect(
      clients.customer.getFavoriteItems(
        "member_with_favorite",
        externalCallContext,
      ),
    ).resolves.toMatchObject({
      ok: true,
      value: [favorite],
      message: "customer_favorites_fixture",
    });
  });

  it("passes model-authored content queries to the ordinary governed content search", async () => {
    const clients = createMockClients(fixtures);
    const search = vi.spyOn(
      OrderingDataService.prototype,
      "searchContent",
    );

    try {
      const evidence = await clients.content.searchContent(
        "all",
        "the model's unconstrained search query",
        externalCallContext,
      );

      expect(search).toHaveBeenCalledOnce();
      expect(search).toHaveBeenCalledWith(
        "all",
        "the model's unconstrained search query",
      );
      expect(evidence).toMatchObject({
        ok: true,
        value: expect.any(Array),
        provenance: expect.arrayContaining([
          expect.objectContaining({
            fixtureMode: "public_crawl_seed",
          }),
        ]),
      });
    } finally {
      search.mockRestore();
    }
  });

  it("answers allergen questions from content fixtures", async () => {
    const clients = createMockClients(fixtures);
    const evidence = await clients.content.answerAllergenQuestion(
      "phô mai",
      externalCallContext,
    );
    expect(evidence.ok).toBe(true);
    expect(evidence.value?.[0]?.kind).toBe("allergen");
  });
});
