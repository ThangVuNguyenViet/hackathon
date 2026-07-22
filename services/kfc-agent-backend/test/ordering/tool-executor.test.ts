import { describe, expect, it, vi } from "vitest";
import type {
  ExternalCallContext,
  ExternalClients,
} from "../../src/clients/interfaces.js";
import { createMockClients } from "../../src/mock/createMockClients.js";
import type { Address, Order } from "../../src/domain/types.js";
import type { AgentGraphState } from "../../src/graph/state.js";
import {
  classifyToolSideEffect,
  executeToolCall as executeToolCallWithContext,
  type ExecutorContext,
} from "../../src/ordering/toolExecutor.js";
import type {
  ToolCallRequest,
  ToolCallResult,
  SourceProvenance,
} from "../../src/ordering/types.js";
import { createTestFixtures } from "../fixtures/testFixtures.js";
import { controlledCustomerAccess } from "../fixtures/controlledCustomerAccess.js";

const clients = createMockClients(createTestFixtures());
function mutationIdentity(suffix: string) {
  return {
    idempotencyKey: `tool-executor-test:${suffix}`,
    bindingFingerprint: "a".repeat(64),
  };
}

function createTestExternalCallContext(): ExternalCallContext {
  return {
    signal: new AbortController().signal,
    deadlineAt: Date.now() + 60_000,
  };
}

function deferred<Value>(): {
  promise: Promise<Value>;
  resolve(value: Value): void;
} {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

type TestExecutorContext = Omit<ExecutorContext, "externalCallContext"> & {
  externalCallContext?: ExternalCallContext;
};

function withExternalCallContext(
  context: TestExecutorContext = {},
): ExecutorContext {
  return {
    ...context,
    externalCallContext:
      context.externalCallContext ?? createTestExternalCallContext(),
  };
}

function executeToolCall(
  externalClients: ExternalClients,
  request: ToolCallRequest,
  context?: TestExecutorContext,
): Promise<ToolCallResult>;
function executeToolCall(
  externalClients: ExternalClients,
  state: AgentGraphState,
  request: ToolCallRequest,
  context?: TestExecutorContext,
): Promise<ToolCallResult>;
function executeToolCall(
  externalClients: ExternalClients,
  requestOrState: ToolCallRequest | AgentGraphState,
  requestOrContext?: ToolCallRequest | TestExecutorContext,
  context?: TestExecutorContext,
): Promise<ToolCallResult> {
  if ("toolName" in requestOrState) {
    return executeToolCallWithContext(
      externalClients,
      requestOrState,
      withExternalCallContext(
        requestOrContext as TestExecutorContext | undefined,
      ),
    );
  }
  return executeToolCallWithContext(
    externalClients,
    requestOrState,
    requestOrContext as ToolCallRequest,
    withExternalCallContext(context),
  );
}

const controlledAccess = controlledCustomerAccess({
  sessionId: "session_1",
  customerId: "customer_1",
});

function buildState(overrides: Partial<AgentGraphState> = {}): AgentGraphState {
  return {
    sessionId: "session_1",
    customerId: "customer_1",
    channel: "kfc",
    latestUserMessage: "thanh toan",
    userConfirmedOrder: false,
    escalationReasons: [],
    retrievedEvidence: [],
    toolTrace: [],
    ...overrides,
  };
}

function buildOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: "KFC-MOCK-1001",
    cart: {
      id: "cart_1",
      items: [],
      subtotalVnd: 120000,
      discountVnd: 0,
      deliveryFeeVnd: 18000,
      totalVnd: 138000,
      voucherCode: null,
    },
    status: "created",
    paymentStatus: "pending",
    assignedStoreId: "KFCVN0002",
    createdAt: "2026-07-08T00:00:00.000Z",
    ...overrides,
  };
}

describe("tool executor", () => {
  it("passes the exact external-call context to the provider", async () => {
    const externalCallContext: ExternalCallContext = {
      signal: new AbortController().signal,
      deadlineAt: Date.now() + 10_000,
    };
    const searchMenu = vi.spyOn(clients.menu, "searchMenu");

    await expect(
      executeToolCallWithContext(
        clients,
        {
          toolName: "searchMenu",
          arguments: { query: "" },
        },
        { externalCallContext },
      ),
    ).resolves.toMatchObject({ ok: true });

    expect(searchMenu.mock.calls.at(-1)?.[1]).toBe(externalCallContext);
  });

  it("preserves separately attested sections from the same source file", async () => {
    const governedProvenance: SourceProvenance[] = [
      {
        fixtureMode: "public_crawl_seed",
        sourceFile: "fixtures/generated/content-pages.json",
        sourceUrl: "https://kfcvietnam.com.vn/policy",
        officialAuthority: {
          kind: "official_kfc",
          issuer: "kfc-policy-ingestion-v1",
          authorityRef: "kfc-official-content:policy/section-a",
          subject: "policy/section-a",
          revision: "a".repeat(64),
          attestedAt: "2026-07-20T00:00:00.000Z",
        },
      },
      {
        fixtureMode: "public_crawl_seed",
        sourceFile: "fixtures/generated/content-pages.json",
        sourceUrl: "https://kfcvietnam.com.vn/policy",
        officialAuthority: {
          kind: "official_kfc",
          issuer: "kfc-policy-ingestion-v1",
          authorityRef: "kfc-official-content:policy/section-b",
          subject: "policy/section-b",
          revision: "b".repeat(64),
          attestedAt: "2026-07-20T00:00:00.000Z",
        },
      },
    ];
    const governedClients: ExternalClients = {
      ...clients,
      content: {
        ...clients.content,
        searchContent: async () => ({
          ok: true,
          value: [],
          message: "ok",
          provenance: governedProvenance,
        }),
      },
    };

    const result = await executeToolCallWithContext(
      governedClients,
      {
        toolName: "searchContentPolicy",
        arguments: { kind: "policy", query: "" },
      },
      { externalCallContext: createTestExternalCallContext() },
    );

    expect(result).toMatchObject({ ok: true });
    expect(
      result.provenance.map(
        (entry) => entry.officialAuthority?.authorityRef,
      ),
    ).toEqual([
      "kfc-official-content:policy/section-a",
      "kfc-official-content:policy/section-b",
    ]);
  });

  it("does not dispatch a provider call for an aborted context", async () => {
    const guardedClients = createMockClients(createTestFixtures());
    const searchMenu = vi.spyOn(guardedClients.menu, "searchMenu");
    const controller = new AbortController();
    controller.abort();

    await expect(
      executeToolCallWithContext(
        guardedClients,
        {
          toolName: "searchMenu",
          arguments: { query: "" },
        },
        {
          externalCallContext: {
            signal: controller.signal,
            deadlineAt: Date.now() + 10_000,
          },
        },
      ),
    ).resolves.toMatchObject({
      ok: false,
      errorCode: "agent_tool_execution_cancelled",
    });
    expect(searchMenu).not.toHaveBeenCalled();
  });

  it("does not dispatch a provider call after the absolute deadline", async () => {
    const guardedClients = createMockClients(createTestFixtures());
    const searchMenu = vi.spyOn(guardedClients.menu, "searchMenu");

    await expect(
      executeToolCallWithContext(
        guardedClients,
        {
          toolName: "searchMenu",
          arguments: { query: "" },
        },
        {
          externalCallContext: {
            signal: new AbortController().signal,
            deadlineAt: Date.now() - 1,
          },
        },
      ),
    ).resolves.toMatchObject({
      ok: false,
      errorCode: "agent_tool_execution_cancelled",
    });
    expect(searchMenu).not.toHaveBeenCalled();
  });

  it("does not record or dispatch after abort while awaiting the run guard", async () => {
    const guardedClients = createMockClients(createTestFixtures());
    const placeOrder = vi.spyOn(guardedClients.oms, "placeOrder");
    const controller = new AbortController();
    const guardEntered = deferred<void>();
    const guardResult = deferred<boolean>();
    const isCurrent = vi.fn(() => {
      guardEntered.resolve();
      return guardResult.promise;
    });
    const recordIrreversibleBoundary = vi.fn(async () => undefined);
    const externalCallContext: ExternalCallContext = {
      signal: controller.signal,
      deadlineAt: Date.now() + 10_000,
    };

    const execution = executeToolCall(
      guardedClients,
      buildState({
        orderPreview: buildOrder({
          id: "preview_1",
          status: "previewed",
          paymentStatus: "not_started",
        }),
        userConfirmedOrder: true,
      }),
      { toolName: "placeOrder", arguments: {} },
      {
        externalCallContext,
        providerMutationIdentity:
          mutationIdentity("abort-during-run-guard"),
        runGuard: { isCurrent, recordIrreversibleBoundary },
      },
    );
    await guardEntered.promise;
    controller.abort();
    guardResult.resolve(true);

    await expect(execution).resolves.toMatchObject({
      ok: false,
      errorCode: "agent_tool_execution_cancelled",
    });
    expect(isCurrent).toHaveBeenCalledTimes(1);
    expect(recordIrreversibleBoundary).not.toHaveBeenCalled();
    expect(placeOrder).not.toHaveBeenCalled();
    expect(externalCallContext.signal).toBe(controller.signal);
  });

  it("does not dispatch after the deadline passes during irreversible-boundary recording", async () => {
    const guardedClients = createMockClients(createTestFixtures());
    const placeOrder = vi.spyOn(guardedClients.oms, "placeOrder");
    const boundaryEntered = deferred<void>();
    const boundaryRecorded = deferred<void>();
    const isCurrent = vi.fn(async () => true);
    const recordIrreversibleBoundary = vi.fn(() => {
      boundaryEntered.resolve();
      return boundaryRecorded.promise;
    });
    const now = vi.spyOn(Date, "now").mockReturnValue(100);

    try {
      const execution = executeToolCall(
        guardedClients,
        buildState({
          orderPreview: buildOrder({
            id: "preview_1",
            status: "previewed",
            paymentStatus: "not_started",
          }),
          userConfirmedOrder: true,
        }),
        { toolName: "placeOrder", arguments: {} },
        {
          externalCallContext: {
            signal: new AbortController().signal,
            deadlineAt: 200,
          },
          providerMutationIdentity:
            mutationIdentity("deadline-during-boundary"),
          runGuard: { isCurrent, recordIrreversibleBoundary },
        },
      );
      await boundaryEntered.promise;
      now.mockReturnValue(200);
      boundaryRecorded.resolve();

      await expect(execution).resolves.toMatchObject({
        ok: false,
        errorCode: "agent_tool_execution_cancelled",
      });
      expect(isCurrent).toHaveBeenCalledTimes(1);
      expect(recordIrreversibleBoundary).toHaveBeenCalledTimes(1);
      expect(placeOrder).not.toHaveBeenCalled();
    } finally {
      now.mockRestore();
    }
  });

  it("classifies tool side effects centrally", () => {
    expect(classifyToolSideEffect("searchMenu", {})).toBe("read");
    expect(classifyToolSideEffect("updateCart", {})).toBe("reversible");
    expect(
      classifyToolSideEffect("acquireVoucher", {
        rewardId: "reward-discount-10k",
      }),
    ).toBe("irreversible");
    expect(
      classifyToolSideEffect("acquireVoucher", {
        rewardId: "reward-discount-10k",
        confirmed: true,
      }),
    ).toBe("irreversible");
    expect(classifyToolSideEffect("placeOrder", {})).toBe("irreversible");
    expect(
      classifyToolSideEffect("createPaymentLink", {
        methodId: "momo_wallet",
      }),
    ).toBe("irreversible");
    expect(classifyToolSideEffect("handoff", { reasons: ["operator"] })).toBe(
      "irreversible",
    );
  });

  it("blocks stale irreversible tool calls before executing client side effects", async () => {
    const guardedClients = createMockClients(createTestFixtures());
    const placeOrder = guardedClients.oms.placeOrder;
    let placeOrderCalls = 0;
    guardedClients.oms.placeOrder = async (...args) => {
      placeOrderCalls += 1;
      return placeOrder(...args);
    };

    const result = await executeToolCall(
      guardedClients,
      buildState({
        orderPreview: buildOrder({
          id: "preview_1",
          status: "previewed",
          paymentStatus: "not_started",
        }),
        userConfirmedOrder: true,
      }),
      { toolName: "placeOrder", arguments: {} },
      {
        providerMutationIdentity: mutationIdentity("stale-run"),
        runGuard: {
          isCurrent: async () => false,
          recordIrreversibleBoundary: async () => {
            throw new Error("stale run must not record irreversible boundary");
          },
        },
      },
    );

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("stale_agent_run");
    expect(placeOrderCalls).toBe(0);
  });

  it("rejects missing or malformed provider identity before any irreversible boundary", async () => {
    const guardedClients = createMockClients(createTestFixtures());
    const placeOrder = vi.spyOn(guardedClients.oms, "placeOrder");
    const isCurrent = vi.fn(async () => true);
    const recordIrreversibleBoundary = vi.fn(async () => undefined);
    const currentState = buildState({
      orderPreview: buildOrder({
        id: "preview_1",
        status: "previewed",
        paymentStatus: "not_started",
      }),
      userConfirmedOrder: true,
    });
    const request: ToolCallRequest = {
      toolName: "placeOrder",
      arguments: {},
    };

    await expect(executeToolCall(
      guardedClients,
      currentState,
      request,
      { runGuard: { isCurrent, recordIrreversibleBoundary } },
    )).resolves.toMatchObject({
      ok: false,
      errorCode: "provider_mutation_identity_required",
    });
    await expect(executeToolCall(
      guardedClients,
      currentState,
      request,
      {
        providerMutationIdentity: {
          idempotencyKey: " noncanonical",
          bindingFingerprint: "not-a-digest",
        },
        runGuard: { isCurrent, recordIrreversibleBoundary },
      },
    )).resolves.toMatchObject({
      ok: false,
      errorCode: "provider_mutation_identity_required",
    });
    expect(isCurrent).not.toHaveBeenCalled();
    expect(recordIrreversibleBoundary).not.toHaveBeenCalled();
    expect(placeOrder).not.toHaveBeenCalled();
  });

  it("executes menu search through the state-centric contract", async () => {
    const result = await executeToolCall(
      clients,
      buildState(),
      {
        toolName: "searchMenu",
        arguments: { query: "Combo Hợp Gu 99K" },
      },
    );
    expect(result.ok).toBe(true);
    expect(JSON.stringify(result.value)).toContain("Combo Hợp Gu 99K");
  });

  it("keeps the direct request adapter for invalid argument rejection", async () => {
    const result = await executeToolCall(clients, {
      toolName: "searchMenu",
      arguments: { q: "wrong" },
    });
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("invalid_tool_arguments");
  });

  it("executes fixture-backed demo voucher validation from state", async () => {
    const result = await executeToolCall(
      clients,
      buildState(),
      {
        toolName: "validateVoucher",
        arguments: { voucherText: "KFC50", subtotalVnd: 250000 },
      },
    );
    expect(result.ok).toBe(true);
    expect(result.value).toMatchObject({
      ok: true,
      reason: "validated",
      publicCode: "KFC50",
      discountVnd: 50000,
    });
  });

  it("executes membership discovery and keeps writes behind a server mutation identity", async () => {
    const membershipClients = createMockClients(createTestFixtures());
    const acquireVoucher = vi.spyOn(
      membershipClients.membership,
      "acquireVoucher",
    );
    const tools = await executeToolCall(
      membershipClients,
      buildState(),
      {
        toolName: "listMembershipTools",
        arguments: { sideEffect: "voucher_acquisition" },
      },
      { accessContext: controlledAccess },
    );
    expect(tools.ok).toBe(true);
    expect(JSON.stringify(tools.value)).toContain("/users/acquire-voucher");

    const unconfirmedAcquire = await executeToolCall(
      membershipClients,
      buildState(),
      {
        toolName: "acquireVoucher",
        arguments: { rewardId: "reward-discount-10k" },
      },
      { accessContext: controlledAccess },
    );
    expect(unconfirmedAcquire.ok).toBe(false);
    expect(unconfirmedAcquire.errorCode).toBe(
      "provider_mutation_identity_required",
    );
    expect(acquireVoucher).not.toHaveBeenCalled();

    const confirmedAcquire = await executeToolCall(
      membershipClients,
      buildState(),
      {
        toolName: "acquireVoucher",
        arguments: { rewardId: "reward-discount-10k", confirmed: true },
      },
      {
        accessContext: controlledAccess,
        providerMutationIdentity:
          mutationIdentity("confirmed-acquire-voucher"),
      },
    );
    expect(confirmedAcquire.ok).toBe(true);
    expect(confirmedAcquire.value).toMatchObject({
      status: "completed",
      targetId: "reward-discount-10k",
    });
    expect(acquireVoucher).toHaveBeenCalledOnce();
  });

  it("fails closed before calling membership providers without verified caller access", async () => {
    const guardedClients = createMockClients(createTestFixtures());
    const getProfile = vi.spyOn(guardedClients.membership, "getProfile");

    const result = await executeToolCall(
      guardedClients,
      buildState(),
      { toolName: "getMembershipProfile", arguments: {} },
    );

    expect(result).toMatchObject({
      ok: false,
      errorCode: "authentication_required",
    });
    expect(getProfile).not.toHaveBeenCalled();
  });

  it("rejects private writes before recording an irreversible boundary", async () => {
    const isCurrent = vi.fn(async () => true);
    const recordIrreversibleBoundary = vi.fn(async () => undefined);

    const result = await executeToolCall(
      clients,
      buildState(),
      {
        toolName: "acquireVoucher",
        arguments: { rewardId: "reward-discount-10k", confirmed: true },
      },
      { runGuard: { isCurrent, recordIrreversibleBoundary } },
    );

    expect(result).toMatchObject({
      ok: false,
      errorCode: "authentication_required",
    });
    expect(isCurrent).not.toHaveBeenCalled();
    expect(recordIrreversibleBoundary).not.toHaveBeenCalled();
  });

  it("fails closed before calling private order and payment providers", async () => {
    const guardedClients = createMockClients(createTestFixtures());
    const getOrderStatus = vi.spyOn(guardedClients.oms, "getOrderStatus");
    const checkPaymentStatus = vi.spyOn(
      guardedClients.payment,
      "checkPaymentStatus",
    );

    const orderResult = await executeToolCall(
      guardedClients,
      buildState(),
      { toolName: "getOrderStatus", arguments: { orderId: "KFC-MOCK-1001" } },
    );
    const paymentResult = await executeToolCall(
      guardedClients,
      buildState(),
      {
        toolName: "checkPaymentStatus",
        arguments: { orderId: "KFC-MOCK-1001" },
      },
    );

    expect(orderResult).toMatchObject({
      ok: false,
      errorCode: "authentication_required",
    });
    expect(paymentResult).toMatchObject({
      ok: false,
      errorCode: "authentication_required",
    });
    expect(getOrderStatus).not.toHaveBeenCalled();
    expect(checkPaymentStatus).not.toHaveBeenCalled();
  });

  it("rejects order and payment reads when the requested order is not the verified current order", async () => {
    const guardedClients = createMockClients(createTestFixtures());
    const getOrderStatus = vi.spyOn(guardedClients.oms, "getOrderStatus");
    const checkPaymentStatus = vi.spyOn(
      guardedClients.payment,
      "checkPaymentStatus",
    );
    const state = buildState({ order: buildOrder() });

    const orderResult = await executeToolCall(
      guardedClients,
      state,
      {
        toolName: "getOrderStatus",
        arguments: { orderId: "ANOTHER-CUSTOMERS-ORDER" },
      },
      { accessContext: controlledAccess },
    );
    const paymentResult = await executeToolCall(
      guardedClients,
      state,
      {
        toolName: "checkPaymentStatus",
        arguments: { orderId: "ANOTHER-CUSTOMERS-ORDER" },
      },
      { accessContext: controlledAccess },
    );

    expect(orderResult).toMatchObject({
      ok: false,
      errorCode: "order_access_unverified",
    });
    expect(paymentResult).toMatchObject({
      ok: false,
      errorCode: "order_access_unverified",
    });
    expect(getOrderStatus).not.toHaveBeenCalled();
    expect(checkPaymentStatus).not.toHaveBeenCalled();
  });

  it("rejects a verified context bound to a different customer", async () => {
    const result = await executeToolCall(
      clients,
      buildState(),
      { toolName: "getMembershipProfile", arguments: {} },
      {
        accessContext: {
          ...controlledAccess,
          kfcSubjectRef: "customer_2",
        },
      },
    );

    expect(result).toMatchObject({
      ok: false,
      errorCode: "access_context_mismatch",
    });
  });

  it("executes fixture-backed payment method lookup", async () => {
    const result = await executeToolCall(
      clients,
      buildState(),
      {
        toolName: "listPaymentMethods",
        arguments: { query: "momo" },
      },
    );

    expect(result.ok).toBe(true);
    expect(result.value).toEqual([
      expect.objectContaining({
        methodId: "momo_wallet",
        displayName: "Ví MoMo",
        supported: false,
        supportStatus: "not_listed_in_policy",
      }),
    ]);
    expect(result.provenance).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fixtureMode: "public_crawl_seed",
          sourceUrl: "https://kfcvietnam.com.vn/privacy-policy",
        }),
      ]),
    );
  });

  it("uses the exact typed line as a display label but rejects district-only addresses", async () => {
    let quotedAddress: Address | undefined;
    const fulfillmentClients = createMockClients(createTestFixtures(), {
      fulfillmentQuoteProvider: async ({ address }) => {
        quotedAddress = address;
        return {
          ok: true,
          value: { feeVnd: 18000, etaMinutes: 35 },
          message: "ok",
        };
      },
    });
    const result = await executeToolCall(
      fulfillmentClients,
      buildState(),
      {
        toolName: "quoteFulfillment",
        arguments: {
          address: {
            line1: "Big C Đồng Nai",
            district: "Biên Hòa",
            city: "Đồng Nai",
          },
          method: "delivery",
          itemCodes: ["20751"],
        },
      },
    );

    expect(result).toMatchObject({ ok: true });
    expect(quotedAddress).toEqual({
      label: "Big C Đồng Nai",
      line1: "Big C Đồng Nai",
      district: "Biên Hòa",
      city: "Đồng Nai",
    });

    const districtOnly = await executeToolCall(
      fulfillmentClients,
      buildState(),
      {
        toolName: "quoteFulfillment",
        arguments: {
          address: {
            label: "Quận 7",
            line1: "Quận 7",
            district: "Quận 7",
            city: "Hồ Chí Minh",
          },
          method: "delivery",
          itemCodes: ["20751"],
        },
      },
    );
    expect(districtOnly).toMatchObject({
      ok: false,
      errorCode: "invalid_tool_arguments",
    });
  });

  it("propagates failing client results in the state-centric path", async () => {
    const order = buildOrder();
    const result = await executeToolCall(
      clients,
      buildState({
        order,
        paymentAttempt: {
          method: "momo_wallet",
          status: "pending",
          paymentUrl: "https://pay.mock/momo_wallet/KFC-MOCK-1001",
        },
      }),
      { toolName: "checkPaymentStatus", arguments: { orderId: order.id } },
      { accessContext: controlledAccess },
    );

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("payment_failed");
    expect(result.message).toContain("Mock payment is configured to fail");
  });

  it("binds a successful payment status result to the verified current order", async () => {
    const order = buildOrder();
    const successfulClients = createMockClients(
      createTestFixtures(),
      {
        paymentStatusProvider: async () => ({
          ok: true,
          value: { status: "pending" },
          message: "provider payment observation",
        }),
      },
    );

    const result = await executeToolCall(
      successfulClients,
      buildState({ order }),
      { toolName: "checkPaymentStatus", arguments: { orderId: order.id } },
      { accessContext: controlledAccess },
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        orderId: order.id,
        status: "pending",
      },
    });
  });

  it("rejects payment link creation when only an order preview exists", async () => {
    const result = await executeToolCall(
      clients,
      buildState({
        orderPreview: buildOrder({
          id: "preview_1",
          status: "previewed",
          paymentStatus: "not_started",
        }),
      }),
      {
        toolName: "createPaymentLink",
        arguments: { methodId: "momo_wallet" },
      },
      {
        providerMutationIdentity:
          mutationIdentity("payment-preview-only"),
      },
    );

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("order_required");
  });

  it("rejects payment link creation when the current order is not created", async () => {
    const result = await executeToolCall(
      clients,
      buildState({
        order: buildOrder({ status: "cancelled", paymentStatus: "failed" }),
      }),
      {
        toolName: "createPaymentLink",
        arguments: { methodId: "momo_wallet" },
      },
      {
        providerMutationIdentity:
          mutationIdentity("payment-non-created-order"),
      },
    );

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("created_order_required");
  });

  it("rejects payment link creation for methods not listed in website checkout policy", async () => {
    const result = await executeToolCall(
      clients,
      buildState({
        order: buildOrder(),
      }),
      {
        toolName: "createPaymentLink",
        arguments: { methodId: "momo_wallet" },
      },
      {
        providerMutationIdentity:
          mutationIdentity("payment-unsupported-method"),
      },
    );

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("payment_method_unsupported");
    expect(result.message).toContain("MoMo");
  });
});
