import { describe, expect, it, vi } from "vitest";
import type {
  ExternalCallContext,
  ExternalClients,
} from "../../src/clients/interfaces.js";
import type { CustomerAccessContext, Order } from "../../src/domain/types.js";
import { applyAgentCollectionToVerifiedState } from "../../src/graph/verifiedState.js";
import type { AgentGraphState } from "../../src/graph/state.js";
import { createMockClients } from "../../src/mock/createMockClients.js";
import {
  MemoryStore,
  type IrreversibleOperationInput,
  type IrreversibleOperationOwner,
  type RunCommitFence,
} from "../../src/persistence/memoryStore.js";
import {
  createCommerceApprovalReceipt,
  digestCommerceAction,
} from "../../src/ordering/approvalReceipt.js";
import {
  createCommerceApprovalExecutionFence,
  type CommerceApprovalExecutionFence,
} from "../../src/ordering/approvalExecutionFence.js";
import {
  buildCurrentAgentApprovalBinding,
  executeAgentToolCall as executeAgentToolCallWithContext,
  type AgentApprovalExecutionContext,
  type AgentToolExecutorContext,
} from "../../src/ordering/agentToolExecutor.js";
import {
  agentToolArgumentSchemas,
  parseAgentToolArguments,
} from "../../src/ordering/toolCatalog.js";
import type {
  CommerceApprovalBinding,
  CommerceApprovalCapability,
  CommerceApprovalPrincipal,
  AgentToolCallResult,
  ToolCallRequest,
  VerifiedGuestApprovalResumeAuthority,
} from "../../src/ordering/types.js";
import { projectVerifiedMenuCollectionToText } from "../../src/ordering/verifiedCollections.js";
import { createTestFixtures } from "../fixtures/testFixtures.js";
import { controlledCustomerAccess } from "../fixtures/controlledCustomerAccess.js";

const signingSecret = "commerce-approval-test-secret-at-least-thirty-two-bytes";
function createTestExternalCallContext(): ExternalCallContext {
  return {
    signal: new AbortController().signal,
    deadlineAt: Date.now() + 60_000,
  };
}

type TestAgentToolExecutorContext = Omit<
  AgentToolExecutorContext,
  "externalCallContext"
> & {
  externalCallContext?: ExternalCallContext;
};

function executeAgentToolCall(
  clients: ExternalClients,
  request: ToolCallRequest,
  context: TestAgentToolExecutorContext,
): Promise<AgentToolCallResult> {
  return executeAgentToolCallWithContext(clients, request, {
    ...context,
    externalCallContext:
      context.externalCallContext ?? createTestExternalCallContext(),
  });
}

function state(overrides: Partial<AgentGraphState> = {}): AgentGraphState {
  return {
    sessionId: "session_1",
    customerId: "customer_1",
    channel: "kfc",
    latestUserMessage: "",
    userConfirmedOrder: false,
    escalationReasons: [],
    retrievedEvidence: [],
    toolTrace: [],
    ...overrides,
  };
}

function access(): CustomerAccessContext {
  const value = controlledCustomerAccess({
    sessionId: "session_1",
    customerId: "customer_1",
  });
  return {
    ...value,
    authorizedScopes: [
      ...value.authorizedScopes,
      "order:write",
      "payment:write",
      "handoff:write",
    ],
  };
}

function principal(): CommerceApprovalPrincipal {
  return {
    sessionId: "session_1",
    customerId: "customer_1",
    channel: "kfc",
    authenticatedSubject: "customer_1",
    authenticationEvidenceRef: "controlled-test:customer_1",
  };
}

function forgedGuestApprovalAuthority(): VerifiedGuestApprovalResumeAuthority {
  const issuedAt = new Date(Date.now() - 60_000).toISOString();
  const expiresAt = new Date(Date.now() + 60_000).toISOString();
  const guestPrincipal = {
    principalKind: "guest_checkout" as const,
    sessionId: "session_1",
    customerId: "customer_1",
    channel: "messenger" as const,
    tenantScope: "kfc-vietnam" as const,
    surfaceSubjectRef: "customer_1",
    externalThreadRef: "customer_1",
    externalMessageId: "forged-guest-message",
    ingressEvidenceRef: "forged-ingress",
    ingressEvidenceDigest: "forged-ingress-digest",
    sourceRunKind: "operation_lease" as const,
    sourceRunRef: "forged-operation",
    sourceRunGeneration: 1,
    sourceRunFenceDigest: "forged-run-fence",
    sessionAuthorityGeneration: 0,
    issuedAt,
    expiresAt,
    guestAuthorityDigest: "forged-guest-authority",
  };
  return {
    requestId: "00000000-0000-4000-8000-000000000098",
    principalDigest: "forged-principal-digest",
    principal: guestPrincipal,
    guestAuthorityDigest: guestPrincipal.guestAuthorityDigest,
    tenantScope: guestPrincipal.tenantScope,
    surfaceSubjectRef: guestPrincipal.surfaceSubjectRef,
    externalThreadRef: guestPrincipal.externalThreadRef,
    externalMessageId: guestPrincipal.externalMessageId,
    ingressEvidenceRef: guestPrincipal.ingressEvidenceRef,
    ingressEvidenceDigest: guestPrincipal.ingressEvidenceDigest,
    sourceRunFenceDigest: guestPrincipal.sourceRunFenceDigest,
    sessionId: guestPrincipal.sessionId,
    customerId: guestPrincipal.customerId,
    channel: guestPrincipal.channel,
    sessionGeneration: 0,
    checkpointThreadId: "forged-thread",
    checkpointNamespace: "",
    checkpointId: "forged-checkpoint",
    toolName: "placeOrder",
    actionDigest: "forged-action-digest",
    approvalBindingDigest: "forged-binding-digest",
    pauseIdentityDigest: "forged-pause-digest",
    expiresAt,
  };
}

function orderPreview(): Order {
  return {
    id: "preview_1",
    cart: {
      id: "cart_1",
      items: [
        {
          itemCode: "20751",
          name: "Combo Hợp Gu 99K",
          quantity: 1,
          unitPriceVnd: 99000,
        },
      ],
      subtotalVnd: 99000,
      discountVnd: 0,
      deliveryFeeVnd: 18000,
      totalVnd: 117000,
      voucherCode: null,
    },
    status: "previewed",
    paymentStatus: "not_started",
    assignedStoreId: "KFCVN0318",
    createdAt: "2026-07-19T00:00:00.000Z",
  };
}

function createdOrder(): Order {
  return {
    ...orderPreview(),
    id: "KFC-MOCK-1001",
    status: "created",
    paymentStatus: "pending",
  };
}

async function approvalContext(
  binding: CommerceApprovalBinding,
  overrides: Partial<AgentApprovalExecutionContext> = {},
): Promise<AgentApprovalExecutionContext> {
  const receipt =
    overrides.receipt ??
    await createCommerceApprovalReceipt({
      binding,
      secret: signingSecret,
    });
  const preclaimedExecution =
    overrides.preclaimedExecution ??
    await createCommerceApprovalExecutionFence({
      secret: signingSecret,
      claim: {
        schemaVersion: "kfc-commerce-approval-execution-v1",
        operation: "confirmation_resume",
        requestId: receipt.receiptId,
        expectedSessionGeneration: 7,
        sessionAuthorityGeneration: 7,
        checkpointThreadId: "test-agent-thread",
        checkpointNamespace: "",
        checkpointId: "test-checkpoint",
        bindingFingerprint: await digestCommerceAction({
          schemaVersion: "test-provider-mutation-v1",
          receipt,
        }),
        approvalBindingDigest: await digestCommerceAction(binding),
        providerIdempotencyKey: [
          "confirmation",
          receipt.receiptId,
          binding.capability,
          binding.actionDigest,
        ].join(":"),
        attempt: 1,
        leaseToken: crypto.randomUUID(),
      },
    });
  return {
    principal: principal(),
    receipt,
    signingSecret,
    preclaimedExecution,
    ...overrides,
  };
}

function currentRunGuard() {
  return {
    isCurrent: async () => true,
    recordIrreversibleBoundary: async () => undefined,
  };
}

async function reserveApprovalOperationLease(input: {
  store: MemoryStore;
  sessionId: string;
  requestId: string;
  bindingFingerprint: string;
}): Promise<{
  operation: IrreversibleOperationInput;
  owner: IrreversibleOperationOwner;
  fence: Extract<RunCommitFence, { kind: "operation_lease" }>;
}> {
  const operation: IrreversibleOperationInput = {
    requestId: input.requestId,
    sessionId: input.sessionId,
    operation: "confirmation_resume",
    bindingFingerprint: input.bindingFingerprint,
  };
  const reservation =
    await input.store.reserveIrreversibleOperation(operation);
  if (reservation.status !== "reserved") {
    throw new Error("expected exact approval operation lease");
  }
  const owner: IrreversibleOperationOwner = {
    attempt: reservation.attempt,
    leaseToken: reservation.leaseToken,
    sessionAuthorityGeneration:
      reservation.sessionAuthorityGeneration,
  };
  return {
    operation,
    owner,
    fence: {
      kind: "operation_lease",
      requestId: operation.requestId,
      operation: operation.operation,
      bindingFingerprint: operation.bindingFingerprint,
      attempt: owner.attempt,
      leaseToken: owner.leaseToken,
      sessionAuthorityGeneration:
        owner.sessionAuthorityGeneration,
    },
  };
}

async function approvalContextForOperationLease(input: {
  binding: CommerceApprovalBinding;
  receipt: Awaited<ReturnType<typeof createCommerceApprovalReceipt>>;
  lease: Awaited<ReturnType<typeof reserveApprovalOperationLease>>;
}): Promise<AgentApprovalExecutionContext> {
  const preclaimedExecution =
    await createCommerceApprovalExecutionFence({
      secret: signingSecret,
      claim: {
        schemaVersion: "kfc-commerce-approval-execution-v1",
        operation: "confirmation_resume",
        requestId: input.lease.operation.requestId,
        expectedSessionGeneration: 0,
        sessionAuthorityGeneration:
          input.lease.owner.sessionAuthorityGeneration,
        checkpointThreadId: "test-agent-thread",
        checkpointNamespace: "",
        checkpointId: "test-checkpoint",
        bindingFingerprint:
          input.lease.operation.bindingFingerprint,
        approvalBindingDigest:
          await digestCommerceAction(input.binding),
        providerIdempotencyKey: [
          "confirmation",
          input.receipt.receiptId,
          input.binding.capability,
          input.binding.actionDigest,
        ].join(":"),
        attempt: input.lease.owner.attempt,
        leaseToken: input.lease.owner.leaseToken,
      },
    });
  return {
    principal: principal(),
    receipt: input.receipt,
    signingSecret,
    preclaimedExecution,
  };
}

async function approvedResolveHandoffFixture() {
  const clients = createMockClients(createTestFixtures());
  const created = await clients.handoff.escalateToHuman(
    "session_1",
    ["customer_requested_support"],
    createTestExternalCallContext(),
    {
      idempotencyKey: "resolve-handoff-fixture",
      bindingFingerprint: "b".repeat(64),
    },
  );
  const escalationId = created.value?.escalationId;
  if (!created.ok || !escalationId) {
    throw new Error("active handoff fixture failed");
  }
  const currentState = state({
    handoff: {
      escalationId,
      reasons: ["customer_requested_support"],
    },
  });
  const request: ToolCallRequest = {
    toolName: "resolveHandoff",
    arguments: {},
  };
  const pending = await executeAgentToolCall(clients, request, {
    state: currentState,
    accessContext: access(),
    approval: { principal: principal() },
  });
  if (pending.ok || !pending.approvalBinding) {
    throw new Error("resolve handoff approval binding missing");
  }
  return {
    clients,
    currentState,
    escalationId,
    request,
    approved: await approvalContext(pending.approvalBinding),
  };
}

async function attachExactPlaceOrderAvailability(
  clients: ExternalClients,
  currentState: AgentGraphState,
): Promise<void> {
  const preview = currentState.orderPreview;
  if (!currentState.cart || !preview) {
    throw new Error("place-order availability fixture requires checkout");
  }
  currentState.fulfillment = {
    method: "delivery",
    disposition: "delivery",
    storeId: preview.assignedStoreId,
    storeName: "Verified test store",
    feeVnd: currentState.cart.deliveryFeeVnd,
    etaMinutes: 35,
    availability: {
      ok: true,
      checkedItemIds: currentState.cart.items.map((item) => item.itemCode),
      unavailableItemIds: [],
      blockedTimeslotItemIds: [],
      source: {
        fixtureMode: "test_only",
        sourceFile: "test/ordering/agent-tool-executor.test.ts",
      },
    },
  };
  const checked = await executeAgentToolCall(
    clients,
    {
      toolName: "checkStoreAvailability",
      arguments: {
        storeId: preview.assignedStoreId,
        disposition: "delivery",
      },
    },
    { state: currentState, accessContext: access() },
  );
  if (
    !checked.ok ||
    checked.toolName !== "checkStoreAvailability" ||
    !checked.verifiedAvailabilityObservation
  ) {
    throw new Error("exact place-order availability fixture failed");
  }
  currentState.exactCartAvailabilityObservation =
    checked.verifiedAvailabilityObservation;
}

function selectCurrentPaymentMethod(
  currentState: AgentGraphState,
  methodId: string,
): void {
  const collectionKey =
    currentState.activeCollectionKeys?.listPaymentMethods;
  const collection = collectionKey
    ? currentState.verifiedCollections?.listPaymentMethods?.[collectionKey]
    : undefined;
  if (!collectionKey || !collection) {
    throw new Error("active payment collection missing");
  }
  currentState.selectedPaymentMethod = {
    methodId,
    collectionKey,
    collectionRevision: collection.revision,
    providerRevision: collection.providerRevision,
  };
}

describe("provider-neutral agent commerce executor", () => {
  it("passes one exact external-call context to provider and authority", async () => {
    const clients = createMockClients(createTestFixtures());
    const externalCallContext: ExternalCallContext = {
      signal: new AbortController().signal,
      deadlineAt: Date.now() + 10_000,
    };
    const searchMenu = vi.spyOn(clients.menu, "searchMenu");
    const revalidate = vi.spyOn(clients.confirmationAuthority!, "revalidate");

    await expect(
      executeAgentToolCallWithContext(
        clients,
        {
          toolName: "searchMenu",
          arguments: { scope: "all", query: null },
        },
        { state: state(), externalCallContext },
      ),
    ).resolves.toMatchObject({ ok: true });

    expect(searchMenu.mock.calls[0]?.[1]).toBe(externalCallContext);
    expect(revalidate.mock.calls[0]?.[1]).toBe(externalCallContext);
  });

  it("does not dispatch provider or authority calls for an aborted context", async () => {
    const clients = createMockClients(createTestFixtures());
    const controller = new AbortController();
    controller.abort();
    const externalCallContext: ExternalCallContext = {
      signal: controller.signal,
      deadlineAt: Date.now() + 10_000,
    };
    const searchMenu = vi.spyOn(clients.menu, "searchMenu");
    const revalidate = vi.spyOn(clients.confirmationAuthority!, "revalidate");

    await expect(
      executeAgentToolCallWithContext(
        clients,
        {
          toolName: "searchMenu",
          arguments: { scope: "all", query: null },
        },
        { state: state(), externalCallContext },
      ),
    ).resolves.toMatchObject({
      ok: false,
      errorCode: "agent_tool_execution_cancelled",
    });
    expect(searchMenu).not.toHaveBeenCalled();
    expect(revalidate).not.toHaveBeenCalled();
  });

  it("does not dispatch provider or authority calls after the deadline", async () => {
    const clients = createMockClients(createTestFixtures());
    const externalCallContext: ExternalCallContext = {
      signal: new AbortController().signal,
      deadlineAt: Date.now() - 1,
    };
    const searchMenu = vi.spyOn(clients.menu, "searchMenu");
    const revalidate = vi.spyOn(
      clients.confirmationAuthority!,
      "revalidate",
    );

    await expect(
      executeAgentToolCallWithContext(
        clients,
        {
          toolName: "searchMenu",
          arguments: { scope: "all", query: null },
        },
        { state: state(), externalCallContext },
      ),
    ).resolves.toMatchObject({
      ok: false,
      errorCode: "agent_tool_execution_cancelled",
    });
    expect(searchMenu).not.toHaveBeenCalled();
    expect(revalidate).not.toHaveBeenCalled();
  });

  it("normalizes current typed order-status evidence at the model-facing seam", async () => {
    const clients = createMockClients(createTestFixtures());
    const currentOrder = createdOrder();
    const observedAt = Date.now();
    currentOrder.deliveryEstimate = {
      kind: "remaining_delivery_window",
      minMinutes: 25,
      maxMinutes: 30,
      observedAt: new Date(observedAt - 1_000).toISOString(),
      expiresAt: new Date(observedAt + 5 * 60_000).toISOString(),
      providerRevision: "custom-oms:current-status",
    };
    clients.oms.getOrderStatus = async () => ({
      ok: true,
      value: currentOrder,
      message: "provider says ETA 25 to 30 minutes",
      provenance: [],
    });

    const result = await executeAgentToolCall(
      clients,
      {
        toolName: "getOrderStatus",
        arguments: {},
      },
      {
        state: state({ order: createdOrder() }),
        accessContext: access(),
      },
    );

    expect(result).toMatchObject({
      toolName: "getOrderStatus",
      ok: true,
      message: "order_status_observed",
      value: {
        id: currentOrder.id,
        status: currentOrder.status,
        deliveryEstimate: currentOrder.deliveryEstimate,
      },
    });
    expect(JSON.stringify(result)).not.toContain(
      "provider says ETA 25 to 30 minutes",
    );
  });

  it("fails closed on a malformed custom order-status response", async () => {
    const clients = createMockClients(createTestFixtures());
    const malformedOrder = createdOrder();
    Object.assign(malformedOrder, {
      deliveryEstimate: {
        kind: "remaining_delivery_window",
        minMinutes: 0,
        maxMinutes: 30,
        observedAt: "not-an-instant",
        expiresAt: "also-not-an-instant",
        providerRevision: "custom-oms:malformed-status",
      },
    });
    clients.oms.getOrderStatus = async () => ({
      ok: true,
      value: malformedOrder,
      message: "provider claims malformed ETA data",
      provenance: [],
    });

    await expect(
      executeAgentToolCall(
        clients,
        {
          toolName: "getOrderStatus",
          arguments: {},
        },
        {
          state: state({ order: createdOrder() }),
          accessContext: access(),
        },
      ),
    ).resolves.toMatchObject({
      toolName: "getOrderStatus",
      ok: false,
      errorCode: "order_status_invalid_provider_response",
      message: "order_status_provider_response_invalid",
    });
  });

  it("uses one strict schema surface with explicit semantic confirmation fields", () => {
    const legacyMenu = parseAgentToolArguments("searchMenu", {
      scope: "all",
      query: null,
    });
    expect(legacyMenu.success ? legacyMenu.data : undefined).toEqual({
      scope: "all",
      query: null,
      purpose: "browse",
    });
    expect(
      agentToolArgumentSchemas.searchMenu.safeParse({
        scope: "all",
        query: null,
        purpose: "recommend",
      }).success,
    ).toBe(false);
    expect(
      agentToolArgumentSchemas.searchMenu.safeParse({
        scope: "filtered",
        query: "combo",
        purpose: "browse",
      }).success,
    ).toBe(true);
    expect(
      agentToolArgumentSchemas.searchMenu.safeParse({
        scope: "filtered",
        query: "combo ga",
        purpose: "recommend",
      }).success,
    ).toBe(true);
    expect(
      agentToolArgumentSchemas.searchMenu.safeParse({ query: "Món mới" })
        .success,
    ).toBe(false);
    expect(
      agentToolArgumentSchemas.validateVoucher.safeParse({
        voucherText: "KFC50",
        subtotalVnd: 1,
      }).success,
    ).toBe(false);
    expect(
      agentToolArgumentSchemas.quoteFulfillment.safeParse({
        address: {
          label: null,
          line1: "12 Nguyễn Văn Linh",
          district: "Quận 7",
          city: "Hồ Chí Minh",
        },
        method: "delivery",
        itemCodes: ["forged"],
      }).success,
    ).toBe(false);
    expect(
      agentToolArgumentSchemas.acquireVoucher.safeParse({
        rewardId: "reward-discount-10k",
      }).success,
    ).toBe(true);
    expect(
      agentToolArgumentSchemas.acquireVoucher.safeParse({
        rewardId: "reward-discount-10k",
        confirmed: true,
      }).success,
    ).toBe(false);
    expect(
      agentToolArgumentSchemas.updateCart.safeParse({
        changes: [
          {
            itemCode: "20751",
            quantity: 1,
            modifiers: [
              {
                groupId: "drink_choice",
                modifierId: "pepsi_zero",
                quantity: 1,
                modifierName: "forged",
                priceDeltaVnd: 999999,
              },
            ],
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      agentToolArgumentSchemas.resolveHandoff.safeParse({
        escalationId: "model-forged-escalation",
      }).success,
    ).toBe(false);
  });

  it("rejects model-supplied handoff identity without provider dispatch", async () => {
    const clients = createMockClients(createTestFixtures());
    const resolve = vi.spyOn(clients.handoff, "resolveEscalation");

    await expect(executeAgentToolCall(
      clients,
      {
        toolName: "resolveHandoff",
        arguments: {
          escalationId: "model-forged-escalation",
        },
      },
      {
        state: state({
          handoff: {
            escalationId: "verified-escalation",
            reasons: ["customer_requested_support"],
          },
        }),
        accessContext: access(),
        approval: { principal: principal() },
      },
    )).resolves.toMatchObject({
      ok: false,
      errorCode: "invalid_tool_arguments",
    });
    expect(resolve).not.toHaveBeenCalled();
  });

  it("requires handoff scope and a consumed approval before resolution", async () => {
    const fixture = await approvedResolveHandoffFixture();
    const resolve = vi.spyOn(
      fixture.clients.handoff,
      "resolveEscalation",
    );
    const withoutHandoffScope = {
      ...access(),
      authorizedScopes: access().authorizedScopes.filter(
        (scope) => scope !== "handoff:write",
      ),
    };

    await expect(executeAgentToolCall(
      fixture.clients,
      fixture.request,
      {
        state: fixture.currentState,
        accessContext: withoutHandoffScope,
        approval: { principal: principal() },
      },
    )).resolves.toMatchObject({ ok: false });
    await expect(executeAgentToolCall(
      fixture.clients,
      fixture.request,
      {
        state: fixture.currentState,
        accessContext: access(),
        approval: { principal: principal() },
      },
    )).resolves.toMatchObject({
      ok: false,
      errorCode: "approval_required",
    });
    expect(resolve).not.toHaveBeenCalled();
  });

  it("rejects a handoff changed after approval was issued", async () => {
    const fixture = await approvedResolveHandoffFixture();
    const resolve = vi.spyOn(
      fixture.clients.handoff,
      "resolveEscalation",
    );
    fixture.currentState.handoff = {
      escalationId: "replacement-escalation",
      reasons: ["customer_requested_support"],
    };

    await expect(executeAgentToolCall(
      fixture.clients,
      fixture.request,
      {
        state: fixture.currentState,
        accessContext: access(),
        approval: fixture.approved,
      },
    )).resolves.toMatchObject({
      ok: false,
      errorCode: "approval_binding_mismatch",
    });
    expect(resolve).not.toHaveBeenCalled();
  });

  it.each([
    "wrong escalation",
    "wrong status",
    "missing provenance",
  ] as const)(
    "rejects handoff resolution provider result with %s",
    async (variant) => {
      const fixture = await approvedResolveHandoffFixture();
      const value = {
        escalationId:
          variant === "wrong escalation"
            ? "different-escalation"
            : fixture.escalationId,
        status: "resolved" as const,
      };
      if (variant === "wrong status") {
        Object.assign(value, { status: "active" });
      }
      fixture.clients.handoff.resolveEscalation = vi.fn(async () => ({
        ok: true,
        value,
        message: "provider response",
        provenance:
          variant === "missing provenance"
            ? []
            : [{
                fixtureMode: "provider_runtime" as const,
                sourceFile: "agent-tool-executor.test.ts",
                sourceApi: "mock://handoff/resolve",
              }],
      }));

      await expect(executeAgentToolCall(
        fixture.clients,
        fixture.request,
        {
          state: fixture.currentState,
          accessContext: access(),
          approval: fixture.approved,
        },
      )).resolves.toMatchObject({
        ok: false,
        errorCode:
          "handoff_resolution_provider_response_invalid",
      });
      expect(fixture.currentState.handoff?.escalationId).toBe(
        fixture.escalationId,
      );
    },
  );

  it("replays the exact approved handoff resolution identity", async () => {
    const fixture = await approvedResolveHandoffFixture();
    const execute = () => executeAgentToolCall(
      fixture.clients,
      fixture.request,
      {
        state: fixture.currentState,
        accessContext: access(),
        approval: fixture.approved,
      },
    );

    const first = await execute();
    const replay = await execute();
    expect(first).toMatchObject({
      ok: true,
      value: {
        escalationId: fixture.escalationId,
        status: "resolved",
      },
    });
    expect(replay).toEqual(first);
  });

  it("keeps the exported approval-binding boundary fail-closed for non-approval tools and malformed actions", async () => {
    const clients = createMockClients(createTestFixtures());
    const revalidate = vi.spyOn(
      clients.confirmationAuthority!,
      "revalidate",
    );
    const currentState = state({ order: createdOrder() });
    const bindingContext: AgentToolExecutorContext = {
      state: currentState,
      accessContext: access(),
      approval: { principal: principal() },
      externalCallContext: createTestExternalCallContext(),
    };

    await expect(
      buildCurrentAgentApprovalBinding(
        clients,
        {
          toolName: "searchMenu",
          arguments: { scope: "all", query: null },
        },
        bindingContext,
      ),
    ).resolves.toMatchObject({
      ok: false,
      errorCode: "approval_capability_required",
    });
    await expect(
      buildCurrentAgentApprovalBinding(
        clients,
        {
          toolName: "createPaymentLink",
          arguments: { methodId: "" },
        },
        bindingContext,
      ),
    ).resolves.toMatchObject({
      ok: false,
      errorCode: "invalid_tool_arguments",
    });
    expect(revalidate).not.toHaveBeenCalled();
  });

  it("returns exact complete all/filtered menu collections and replaces only the same scope key", async () => {
    const fixtures = createTestFixtures();
    fixtures.menuItems.push({
      ...fixtures.menuItems[0]!,
      code: "drink_1",
      itemId: "drink_1",
      posItemId: "drink_1",
      productCode: "DRINK_1",
      category: "Nước Uống",
      name: "Pepsi",
      productUrlSlug: "pepsi",
      builderUrl:
        "https://www.kfcvietnam.com.vn/order/delivery/drink/pepsi/builder",
    });
    const clients = createMockClients(fixtures);
    const currentState = state();

    const all = await executeAgentToolCall(
      clients,
      { toolName: "searchMenu", arguments: { scope: "all", query: null } },
      { state: currentState },
    );
    expect(all).toMatchObject({
      ok: true,
      value: {
        total: 2,
        returned: 2,
        complete: true,
        scope: { scope: "all" },
      },
    });
    if (!all.ok || all.toolName !== "searchMenu") {
      throw new Error("all-menu lookup failed");
    }
    expect(all.value.items.map((item) => item.code)).toEqual([
      "20751",
      "drink_1",
    ]);
    const textProjection = projectVerifiedMenuCollectionToText(all.value, 200);
    expect(textProjection).toMatchObject({
      itemCodes: ["20751", "drink_1"],
      complete: true,
    });
    expect(textProjection.chunks.join("\n")).toContain("Combo Hợp Gu 99K");
    expect(textProjection.chunks.join("\n")).toContain("Pepsi");
    applyAgentCollectionToVerifiedState(currentState, all);

    const filtered = await executeAgentToolCall(
      clients,
      {
        toolName: "searchMenu",
        arguments: { scope: "filtered", query: "DRINK_1" },
      },
      { state: currentState },
    );
    if (!filtered.ok || filtered.toolName !== "searchMenu") {
      throw new Error("filtered lookup failed");
    }
    applyAgentCollectionToVerifiedState(currentState, filtered);

    expect(
      Object.keys(currentState.verifiedCollections?.searchMenu ?? {}).sort(),
    ).toEqual(["all", "filtered:drink_1"]);
    expect(
      currentState.activeMenuCollection?.result.items.map((item) => item.code),
    ).toEqual(["drink_1"]);

    const filteredReplacement = await executeAgentToolCall(
      clients,
      {
        toolName: "searchMenu",
        arguments: { scope: "filtered", query: " DRINK_1 " },
      },
      { state: currentState },
    );
    if (
      !filteredReplacement.ok ||
      filteredReplacement.toolName !== "searchMenu"
    ) {
      throw new Error("replacement lookup failed");
    }
    applyAgentCollectionToVerifiedState(currentState, filteredReplacement);
    expect(
      Object.keys(currentState.verifiedCollections?.searchMenu ?? {}).sort(),
    ).toEqual(["all", "filtered:drink_1"]);
    await expect(
      executeAgentToolCall(
        clients,
        { toolName: "getItemDetails", arguments: { code: "20751" } },
        { state: currentState },
      ),
    ).resolves.toMatchObject({
      ok: false,
      errorCode: "unverified_item_code",
    });
  });

  it("bounds filtered menu evidence while preserving truthful provider counts", async () => {
    const fixtures = createTestFixtures();
    const seed = fixtures.menuItems[0]!;
    fixtures.menuItems = Array.from({ length: 8 }, (_, index) => ({
      ...seed,
      code: `combo_${index + 1}`,
      itemId: `combo_${index + 1}`,
      posItemId: `combo_${index + 1}`,
      productCode: `COMBO_${index + 1}`,
      name: `Combo ${index + 1}`,
      productUrlSlug: `combo-${index + 1}`,
      builderUrl:
        `https://www.kfcvietnam.com.vn/order/delivery/combo/combo-${index + 1}/builder`,
    }));

    const result = await executeAgentToolCall(
      createMockClients(fixtures),
      {
        toolName: "searchMenu",
        arguments: {
          scope: "filtered",
          query: "combo",
          purpose: "browse",
        },
      },
      { state: state() },
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        total: 8,
        returned: 5,
        complete: false,
        scope: { scope: "filtered", query: "combo" },
      },
    });
    if (!result.ok || result.toolName !== "searchMenu") {
      throw new Error("filtered menu lookup failed");
    }
    expect(result.value.items.map(({ code }) => code)).toEqual([
      "combo_1",
      "combo_2",
      "combo_3",
      "combo_4",
      "combo_5",
    ]);
  });

  it("keeps private mock profile data out of agent collection and checkpoint authority", async () => {
    const privateAddress = "private-customer-address-must-not-cross";
    const privateOrder = "private-customer-order-must-not-cross";
    const clients = createMockClients(createTestFixtures(), {
      mockedUpstreamApiProvider: () => ({
        savedAddresses: [{
          label: "Private",
          line1: privateAddress,
          district: "Private district",
          city: "Private city",
        }],
        paymentStatuses: {
          [privateOrder]: "paid",
        },
      }),
    });
    const currentState = state();

    const result = await executeAgentToolCall(
      clients,
      {
        toolName: "searchMenu",
        arguments: { scope: "all", query: null },
      },
      { state: currentState },
    );
    if (
      !result.ok ||
      result.toolName !== "searchMenu" ||
      !result.verifiedCollection
    ) {
      throw new Error("verified menu collection missing");
    }
    applyAgentCollectionToVerifiedState(currentState, result);

    expect(result.verifiedCollection.providerRevision).toMatch(
      /^mock:[a-f0-9]{64}$/u,
    );
    const checkpointAuthority = JSON.stringify({
      providerRevision:
        clients.confirmationAuthority?.providerRevision,
      verifiedCollections: currentState.verifiedCollections,
    });
    expect(checkpointAuthority).not.toContain(privateAddress);
    expect(checkpointAuthority).not.toContain(privateOrder);
    expect(JSON.stringify(result)).not.toContain(privateAddress);
    expect(JSON.stringify(result)).not.toContain(privateOrder);
  });

  it("keeps governed content independent from stale commerce authority", async () => {
    const clients = createMockClients(createTestFixtures());
    const revalidate = vi.fn(async () => ({
      ok: false,
      reason: "catalog changed",
    }));
    clients.confirmationAuthority!.revalidate = revalidate;

    const first = await executeAgentToolCall(
      clients,
      {
        toolName: "answerAllergenQuestion",
        arguments: { query: "phô mai" },
      },
      { state: state() },
    );
    if (
      !first.ok ||
      first.toolName !== "answerAllergenQuestion" ||
      !first.verifiedCollection
    ) {
      throw new Error("allergen evidence collection failed");
    }
    expect(first).toMatchObject({
      provenance: [
        expect.objectContaining({
          fixtureMode: "public_crawl_seed",
          sourceFile: first.value.items[0]?.sourceFile,
          sourceUrl: first.value.items[0]?.sourceUrl,
        }),
      ],
    });
    const expectedRevision = await digestCommerceAction({
      toolName: first.toolName,
      content: first.value.items,
      provenance: first.provenance,
    });
    expect(first.verifiedCollection.providerRevision).toBe(
      `content-result:${expectedRevision}`,
    );
    expect(revalidate).not.toHaveBeenCalled();

    const repeated = await executeAgentToolCall(
      clients,
      {
        toolName: "answerAllergenQuestion",
        arguments: { query: "phô mai" },
      },
      { state: state() },
    );
    if (
      !repeated.ok ||
      repeated.toolName !== "answerAllergenQuestion" ||
      !repeated.verifiedCollection
    ) {
      throw new Error("repeated allergen evidence collection failed");
    }
    expect(repeated.verifiedCollection.providerRevision).toBe(
      first.verifiedCollection.providerRevision,
    );
    expect(revalidate).not.toHaveBeenCalled();

    await expect(
      executeAgentToolCall(
        clients,
        {
          toolName: "searchMenu",
          arguments: { scope: "all", query: null },
        },
        { state: state() },
      ),
    ).resolves.toMatchObject({
      ok: false,
      errorCode: "provider_authority_stale",
    });
    expect(revalidate).toHaveBeenCalledOnce();
  });

  it("injects exact cart item codes and rejects incomplete provider coverage", async () => {
    const clients = createMockClients(createTestFixtures());
    const checkInventory = vi.fn(
      async (_storeId: string, itemCodes: string[]) => {
        const observedAtMs = Date.now();
        return {
          ok: true,
          value: {
            availability: Object.fromEntries(
              itemCodes.map((code) => [code, true]),
            ),
            providerRevision: "inventory:test-exact-coverage",
            observedAt: new Date(observedAtMs).toISOString(),
            expiresAt: new Date(
              observedAtMs + 5 * 60_000,
            ).toISOString(),
          },
          message: "ok",
          provenance: [{
            fixtureMode: "provider_runtime" as const,
            sourceFile: "agent-tool-executor.test.ts",
            sourceApi: "mock://inventory/availability",
          }],
        };
      },
    );
    clients.inventory.checkInventoryWithAuthority = checkInventory;
    const currentState = state({
      cart: {
        id: "cart_1",
        items: [
          {
            itemCode: "20751",
            name: "Combo",
            quantity: 1,
            unitPriceVnd: 99000,
          },
          {
            itemCode: "drink_1",
            name: "Drink",
            quantity: 1,
            unitPriceVnd: 20000,
          },
        ],
        subtotalVnd: 119000,
        discountVnd: 0,
        deliveryFeeVnd: 0,
        totalVnd: 119000,
        voucherCode: null,
      },
      fulfillment: {
        method: "delivery",
        disposition: "delivery",
        storeId: "KFCVN0318",
        storeName: "Verified store",
        feeVnd: 18_000,
        etaMinutes: 35,
        availability: {
          ok: true,
          checkedItemIds: ["20751", "drink_1"],
          unavailableItemIds: [],
          blockedTimeslotItemIds: [],
          source: {
            fixtureMode: "test_only",
            sourceFile: "agent-tool-executor.test.ts",
          },
        },
      },
    });

    const result = await executeAgentToolCall(
      clients,
      {
        toolName: "checkStoreAvailability",
        arguments: { storeId: "KFCVN0318", disposition: "delivery" },
      },
      { state: currentState },
    );
    expect(result.ok).toBe(true);
    expect(checkInventory).toHaveBeenCalledWith(
      "KFCVN0318",
      ["20751", "drink_1"],
      "delivery",
      expect.objectContaining({
        signal: expect.any(Object),
        deadlineAt: expect.any(Number),
      }),
    );

    const partialCheck = vi.fn(async () => {
      const observedAtMs = Date.now();
      return {
        ok: true,
        value: {
          availability: { 20751: true },
          providerRevision: "inventory:test-partial-coverage",
          observedAt: new Date(observedAtMs).toISOString(),
          expiresAt: new Date(
            observedAtMs + 5 * 60_000,
          ).toISOString(),
        },
        message: "partial",
        provenance: [{
          fixtureMode: "provider_runtime" as const,
          sourceFile: "agent-tool-executor.test.ts",
          sourceApi: "mock://inventory/availability",
        }],
      };
    });
    clients.inventory.checkInventoryWithAuthority = partialCheck;
    await expect(
      executeAgentToolCall(
        clients,
        {
          toolName: "checkStoreAvailability",
          arguments: { storeId: "KFCVN0318", disposition: "delivery" },
        },
        { state: currentState },
      ),
    ).resolves.toMatchObject({
      ok: false,
      errorCode: "incomplete_cart_availability",
    });

    const callsBeforeMismatch = partialCheck.mock.calls.length;
    await expect(
      executeAgentToolCall(
        clients,
        {
          toolName: "checkStoreAvailability",
          arguments: {
            storeId: "KFCVN0002",
            disposition: "delivery",
          },
        },
        { state: currentState },
      ),
    ).resolves.toMatchObject({
      ok: false,
      errorCode: "cart_availability_store_mismatch",
    });
    expect(partialCheck).toHaveBeenCalledTimes(callsBeforeMismatch);
  });

  it("rejects atomic availability without source provenance", async () => {
    const clients = createMockClients(createTestFixtures());
    clients.inventory.checkInventoryWithAuthority = async (
      _storeId,
      itemCodes,
    ) => {
      const observedAtMs = Date.now();
      return {
        ok: true,
        value: {
          availability: Object.fromEntries(
            itemCodes.map((itemCode) => [itemCode, false]),
          ),
          providerRevision: "inventory:missing-source",
          observedAt: new Date(observedAtMs).toISOString(),
          expiresAt: new Date(observedAtMs + 5 * 60_000).toISOString(),
        },
        message: "missing source",
        provenance: [],
      };
    };
    const cart = orderPreview().cart;
    const currentState = state({
      cart,
      fulfillment: {
        method: "delivery",
        disposition: "delivery",
        storeId: "KFCVN0318",
        storeName: "Verified store",
        feeVnd: 18_000,
        etaMinutes: 35,
        availability: {
          ok: true,
          checkedItemIds: cart.items.map(({ itemCode }) => itemCode),
          unavailableItemIds: [],
          blockedTimeslotItemIds: [],
          source: {
            fixtureMode: "test_only",
            sourceFile: "agent-tool-executor.test.ts",
          },
        },
      },
    });

    await expect(
      executeAgentToolCall(
        clients,
        {
          toolName: "checkStoreAvailability",
          arguments: {
            storeId: "KFCVN0318",
            disposition: "delivery",
          },
        },
        { state: currentState },
      ),
    ).resolves.toMatchObject({
      ok: false,
      errorCode: "inventory_availability_provenance_missing",
    });
  });

  it("injects authoritative modifier names and prices after verified ID selection", async () => {
    const clients = createMockClients(createTestFixtures());
    const currentState = state({
      cart: {
        id: "cart_1",
        items: [],
        subtotalVnd: 0,
        discountVnd: 0,
        deliveryFeeVnd: 0,
        totalVnd: 0,
        voucherCode: null,
      },
    });
    const menuResult = await executeAgentToolCall(
      clients,
      {
        toolName: "searchMenu",
        arguments: { scope: "filtered", query: "Combo Hợp Gu 99K" },
      },
      { state: currentState },
    );
    if (!menuResult.ok) throw new Error("menu lookup failed");
    applyAgentCollectionToVerifiedState(currentState, menuResult);
    const modifierResult = await executeAgentToolCall(
      clients,
      { toolName: "getModifierOptions", arguments: { code: "20751" } },
      { state: currentState },
    );
    if (
      !modifierResult.ok ||
      modifierResult.toolName !== "getModifierOptions"
    ) {
      throw new Error("modifier lookup failed");
    }
    currentState.menuModifierOptions = modifierResult.value;
    const applyChanges = vi.spyOn(clients.cart, "applyChanges");

    const result = await executeAgentToolCall(
      clients,
      {
        toolName: "updateCart",
        arguments: {
          changes: [
            {
              itemCode: "20751",
              quantity: 1,
              modifiers: [
                {
                  groupId: "drink_choice",
                  modifierId: "pepsi_zero",
                  quantity: 1,
                },
              ],
            },
          ],
        },
      },
      { state: currentState },
    );
    expect(result.ok).toBe(true);
    expect(applyChanges).toHaveBeenCalledWith(
      currentState.cart,
      [
        {
          itemCode: "20751",
          quantity: 1,
          modifiers: [
            {
              groupId: "drink_choice",
              groupName: "Chọn nước",
              modifierId: "pepsi_zero",
              modifierName: "Pepsi Không Calo",
              priceDeltaVnd: 0,
              quantity: 1,
            },
          ],
        },
      ],
      expect.objectContaining({
        signal: expect.any(Object),
        deadlineAt: expect.any(Number),
      }),
    );
  });

  it("uses the active recommended collection as exact menu authority", async () => {
    const fixtures = createTestFixtures();
    fixtures.menuItems.push({
      ...fixtures.menuItems[0]!,
      code: "drink_1",
      itemId: "drink_1",
      posItemId: "drink_1",
      productCode: "DRINK_1",
      category: "Nước Uống",
      name: "Pepsi",
      productUrlSlug: "pepsi",
      builderUrl:
        "https://www.kfcvietnam.com.vn/order/delivery/drink/pepsi/builder",
    });
    fixtures.menuModifiers.push({
      ...fixtures.menuModifiers[0]!,
      itemCode: "drink_1",
      itemId: "drink_1",
      productCode: "DRINK_1",
      name: "Pepsi",
    });
    const clients = createMockClients(fixtures);
    const currentState = state({
      cart: orderPreview().cart,
    });
    const recommended = await executeAgentToolCall(
      clients,
      { toolName: "recommendAddOns", arguments: {} },
      { state: currentState },
    );
    if (!recommended.ok || recommended.toolName !== "recommendAddOns") {
      throw new Error("add-on recommendation failed");
    }
    applyAgentCollectionToVerifiedState(currentState, recommended);
    expect(currentState.activeCollectionKeys?.searchMenu).toBeUndefined();

    await expect(
      executeAgentToolCall(
        clients,
        { toolName: "getItemDetails", arguments: { code: "drink_1" } },
        { state: currentState },
      ),
    ).resolves.toMatchObject({ ok: true, toolName: "getItemDetails" });
    const modifiers = await executeAgentToolCall(
      clients,
      { toolName: "getModifierOptions", arguments: { code: "drink_1" } },
      { state: currentState },
    );
    if (!modifiers.ok || modifiers.toolName !== "getModifierOptions") {
      throw new Error("recommended item modifier lookup failed");
    }
    currentState.menuModifierOptions = modifiers.value;
    const applyChanges = vi.spyOn(clients.cart, "applyChanges");

    await expect(
      executeAgentToolCall(
        clients,
        {
          toolName: "updateCart",
          arguments: {
            changes: [
              {
                itemCode: "drink_1",
                quantity: 1,
                modifiers: [
                  {
                    groupId: "drink_choice",
                    modifierId: "pepsi_zero",
                    quantity: 1,
                  },
                ],
              },
            ],
          },
        },
        { state: currentState },
      ),
    ).resolves.toMatchObject({ ok: true, toolName: "updateCart" });
    expect(applyChanges).toHaveBeenCalledWith(
      currentState.cart,
      [
        expect.objectContaining({
          itemCode: "drink_1",
          quantity: 1,
        }),
      ],
      expect.objectContaining({
        signal: expect.any(Object),
        deadlineAt: expect.any(Number),
      }),
    );
  });

  it.each([
    ["acquireVoucher", "rewardId", "reward-discount-10k"],
    ["redeemReward", "voucherId", "wallet-new-member-25k"],
  ] as const)(
    "requires a current signed, consumed approval receipt for %s",
    async (toolName, targetField, targetId) => {
      const clients = createMockClients(createTestFixtures());
      const currentState = state();
      const readTool =
        toolName === "acquireVoucher"
          ? ("listMembershipRewards" as const)
          : ("listMembershipWallet" as const);
      const readArguments =
        toolName === "acquireVoucher"
          ? { scope: "all", query: null }
          : { status: null };
      const collection = await executeAgentToolCall(
        clients,
        { toolName: readTool, arguments: readArguments },
        { state: currentState, accessContext: access() },
      );
      if (!collection.ok) throw new Error("membership collection failed");
      applyAgentCollectionToVerifiedState(currentState, collection);
      const toolCollection = await executeAgentToolCall(
        clients,
        {
          toolName: "listMembershipTools",
          arguments: {
            sideEffect: toolName === "acquireVoucher"
              ? "voucher_acquisition"
              : "reward_redemption",
          },
        },
        { state: currentState, accessContext: access() },
      );
      if (!toolCollection.ok) {
        throw new Error("membership tool collection failed");
      }
      applyAgentCollectionToVerifiedState(currentState, toolCollection);
      const request: ToolCallRequest = {
        toolName,
        arguments: {
          [targetField]: targetId,
          ...(toolName === "redeemReward"
            ? { channel: "zalo_miniapp" }
            : {}),
        },
      };
      const baseContext = {
        state: currentState,
        accessContext: access(),
        approval: { principal: principal() },
      };
      const pending = await executeAgentToolCall(clients, request, baseContext);
      expect(pending).toMatchObject({
        ok: false,
        errorCode: "approval_required",
        approvalBinding: {
          capability: toolName,
          principal: principal(),
          revisions: expect.objectContaining({
            providerRevision: clients.confirmationAuthority!.providerRevision,
          }),
        },
      });
      if (pending.ok || !pending.approvalBinding)
        throw new Error("approval binding missing");

      const approved = await approvalContext(pending.approvalBinding);
      await expect(
        executeAgentToolCall(clients, request, {
          state: currentState,
          accessContext: access(),
          approval: approved,
          runGuard: currentRunGuard(),
        }),
      ).resolves.toMatchObject({ ok: true });
      await expect(
        executeAgentToolCall(clients, request, {
          state: currentState,
          accessContext: access(),
          approval: approved,
          runGuard: currentRunGuard(),
        }),
      ).resolves.toMatchObject({ ok: true });
    },
  );

  it("rejects a model-supplied membership confirmation flag before provider dispatch", async () => {
    const clients = createMockClients(createTestFixtures());
    const providerMutation = vi.spyOn(
      clients.membership,
      "acquireVoucher",
    );

    await expect(executeAgentToolCall(
      clients,
      {
        toolName: "acquireVoucher",
        arguments: {
          rewardId: "reward-discount-10k",
          confirmed: false,
        },
      },
      {
        state: state(),
        accessContext: access(),
      },
    )).resolves.toMatchObject({
      ok: false,
      errorCode: "invalid_tool_arguments",
    });
    expect(providerMutation).not.toHaveBeenCalled();
  });

  it("rejects wrong-principal, stale-revision, expired, and tampered order receipts before placeOrder", async () => {
    const clients = createMockClients(createTestFixtures());
    const placeOrder = vi.spyOn(clients.oms, "placeOrder");
    const currentState = state({
      orderPreview: orderPreview(),
      cart: orderPreview().cart,
    });
    await attachExactPlaceOrderAvailability(clients, currentState);
    const request: ToolCallRequest = { toolName: "placeOrder", arguments: {} };
    const pending = await executeAgentToolCall(clients, request, {
      state: currentState,
      accessContext: access(),
      approval: { principal: principal() },
    });
    if (pending.ok || !pending.approvalBinding)
      throw new Error("approval binding missing");

    const goodReceipt = await createCommerceApprovalReceipt({
      binding: pending.approvalBinding,
      secret: signingSecret,
    });
    const baseApproval = await approvalContext(pending.approvalBinding, {
      receipt: goodReceipt,
    });
    await expect(
      executeAgentToolCall(clients, request, {
        state: currentState,
        accessContext: access(),
        approval: {
          ...baseApproval,
          principal: { ...principal(), customerId: "other" },
        },
        runGuard: currentRunGuard(),
      }),
    ).resolves.toMatchObject({
      ok: false,
      errorCode: "approval_principal_mismatch",
    });
    const originalCart = currentState.cart;
    const originalAvailability =
      currentState.exactCartAvailabilityObservation;
    currentState.cart = { ...orderPreview().cart, totalVnd: 118000 };
    await attachExactPlaceOrderAvailability(clients, currentState);
    await expect(
      executeAgentToolCall(clients, request, {
        state: currentState,
        accessContext: access(),
        approval: baseApproval,
        runGuard: currentRunGuard(),
      }),
    ).resolves.toMatchObject({
      ok: false,
      errorCode: "approval_binding_mismatch",
    });
    currentState.cart = originalCart;
    currentState.exactCartAvailabilityObservation = originalAvailability;
    const originalRevalidate = clients.confirmationAuthority!.revalidate;
    clients.confirmationAuthority!.revalidate = async () => ({
      ok: false,
      reason: "provider changed",
    });
    await expect(
      executeAgentToolCall(clients, request, {
        state: currentState,
        accessContext: access(),
        approval: baseApproval,
        runGuard: currentRunGuard(),
      }),
    ).resolves.toMatchObject({
      ok: false,
      errorCode: "provider_authority_stale",
    });
    clients.confirmationAuthority!.revalidate = originalRevalidate;
    const expired = await createCommerceApprovalReceipt({
      binding: pending.approvalBinding,
      secret: signingSecret,
      issuedAt: new Date(Date.now() - 60_000),
      ttlMs: 1,
    });
    await expect(
      executeAgentToolCall(clients, request, {
        state: currentState,
        accessContext: access(),
        approval: { ...baseApproval, receipt: expired },
        runGuard: currentRunGuard(),
      }),
    ).resolves.toMatchObject({
      ok: false,
      errorCode: "approval_receipt_expired",
    });
    await expect(
      executeAgentToolCall(clients, request, {
        state: currentState,
        accessContext: access(),
        approval: {
          ...baseApproval,
          receipt: {
            ...goodReceipt,
            signature: `${goodReceipt.signature.slice(0, -1)}${
              goodReceipt.signature.endsWith("0") ? "1" : "0"
            }`,
          },
        },
        runGuard: currentRunGuard(),
      }),
    ).resolves.toMatchObject({
      ok: false,
      errorCode: "invalid_approval_receipt",
    });
    expect(placeOrder).not.toHaveBeenCalled();

    await expect(
      executeAgentToolCall(clients, request, {
        state: currentState,
        accessContext: access(),
        approval: baseApproval,
        runGuard: currentRunGuard(),
      }),
    ).resolves.toMatchObject({ ok: true });
    expect(placeOrder).toHaveBeenCalledWith(
      expect.objectContaining({ userConfirmed: true }),
      expect.objectContaining({
        signal: expect.any(Object),
        deadlineAt: expect.any(Number),
      }),
      {
        idempotencyKey:
          baseApproval.preclaimedExecution!.providerIdempotencyKey,
        bindingFingerprint:
          baseApproval.preclaimedExecution!.bindingFingerprint,
      },
    );
  });

  it("rechecks inventory authority after approval revalidation before placeOrder", async () => {
    const clients = createMockClients(createTestFixtures());
    const placeOrder = vi.spyOn(clients.oms, "placeOrder");
    const currentState = state({
      orderPreview: orderPreview(),
      cart: orderPreview().cart,
    });
    await attachExactPlaceOrderAvailability(clients, currentState);
    const observedRevision =
      currentState.exactCartAvailabilityObservation
        ?.inventoryProviderRevision.revision;
    if (!observedRevision) {
      throw new Error("inventory authority revision missing");
    }
    let currentInventoryRevision = observedRevision;
    clients.inventory.getAvailabilityRevision = async () => ({
      ok: true,
      value: currentInventoryRevision,
      message: "ok",
      provenance: [],
    });
    const authority = clients.confirmationAuthority;
    if (!authority) throw new Error("confirmation authority missing");
    const originalRevalidate = authority.revalidate;
    let rotateDuringRevalidation = false;
    authority.revalidate = async (binding, externalCallContext) => {
      const decision = await originalRevalidate(
        binding,
        externalCallContext,
      );
      if (rotateDuringRevalidation) {
        currentInventoryRevision = "inventory:rotated-before-place-order";
      }
      return decision;
    };

    const request: ToolCallRequest = {
      toolName: "placeOrder",
      arguments: {},
    };
    const pending = await executeAgentToolCall(clients, request, {
      state: currentState,
      accessContext: access(),
      approval: { principal: principal() },
    });
    if (pending.ok || !pending.approvalBinding) {
      throw new Error("approval binding missing");
    }
    const approved = await approvalContext(pending.approvalBinding);
    rotateDuringRevalidation = true;

    await expect(executeAgentToolCall(clients, request, {
      state: currentState,
      accessContext: access(),
      approval: approved,
      runGuard: currentRunGuard(),
    })).resolves.toMatchObject({
      ok: false,
      errorCode: "cart_availability_inventory_provider_mismatch",
    });
    expect(placeOrder).not.toHaveBeenCalled();
  });

  it("authenticates an exact reject receipt without authorizing execution or consuming a claim", async () => {
    const clients = createMockClients(createTestFixtures());
    const placeOrder = vi.spyOn(clients.oms, "placeOrder");
    const currentState = state({
      orderPreview: orderPreview(),
      cart: orderPreview().cart,
    });
    await attachExactPlaceOrderAvailability(clients, currentState);
    const request: ToolCallRequest = { toolName: "placeOrder", arguments: {} };
    const pending = await executeAgentToolCall(clients, request, {
      state: currentState,
      accessContext: access(),
      approval: { principal: principal() },
    });
    if (pending.ok || !pending.approvalBinding)
      throw new Error("approval binding missing");
    const rejected = await createCommerceApprovalReceipt({
      binding: pending.approvalBinding,
      decision: "reject",
      secret: signingSecret,
    });

    await expect(
      executeAgentToolCall(clients, request, {
        state: currentState,
        accessContext: access(),
        approval: {
          principal: principal(),
          receipt: rejected,
          signingSecret,
        },
        runGuard: currentRunGuard(),
      }),
    ).resolves.toMatchObject({ ok: false, errorCode: "approval_rejected" });
    expect(placeOrder).not.toHaveBeenCalled();
  });

  it("accepts the exact durable execution fence without claiming the receipt twice", async () => {
    const clients = createMockClients(createTestFixtures());
    const escalate = vi.spyOn(clients.handoff, "escalateToHuman");
    const currentState = state();
    const request: ToolCallRequest = {
      toolName: "handoff",
      arguments: { reasons: ["customer_requested_support"] },
    };
    const pending = await executeAgentToolCall(clients, request, {
      state: currentState,
      accessContext: access(),
      approval: { principal: principal() },
    });
    if (pending.ok || !pending.approvalBinding) {
      throw new Error("approval binding missing");
    }
    const receipt = await createCommerceApprovalReceipt({
      binding: pending.approvalBinding,
      secret: signingSecret,
    });
    const fence: CommerceApprovalExecutionFence =
      await createCommerceApprovalExecutionFence({
        secret: signingSecret,
        claim: {
          schemaVersion: "kfc-commerce-approval-execution-v1",
          operation: "confirmation_resume",
          requestId: receipt.receiptId,
          expectedSessionGeneration: 7,
          sessionAuthorityGeneration: 7,
          checkpointThreadId: "test-agent-thread",
          checkpointNamespace: "",
          checkpointId: "test-checkpoint",
          bindingFingerprint: "a".repeat(64),
          approvalBindingDigest:
            await digestCommerceAction(pending.approvalBinding),
          providerIdempotencyKey: [
            "confirmation",
            receipt.receiptId,
            pending.approvalBinding.capability,
            pending.approvalBinding.actionDigest,
          ].join(":"),
          attempt: 1,
          leaseToken: crypto.randomUUID(),
        },
      });

    await expect(executeAgentToolCall(clients, request, {
      state: currentState,
      accessContext: access(),
      providerMutationIdentity: {
        idempotencyKey: fence.providerIdempotencyKey,
        bindingFingerprint: fence.bindingFingerprint,
      },
      approval: {
        principal: principal(),
        receipt,
        signingSecret,
      },
      runGuard: currentRunGuard(),
    })).resolves.toMatchObject({
      ok: false,
      errorCode: "approval_claim_unavailable",
    });

    await expect(executeAgentToolCall(clients, request, {
      state: currentState,
      accessContext: access(),
      providerMutationIdentity: {
        idempotencyKey: fence.providerIdempotencyKey,
        bindingFingerprint: fence.bindingFingerprint,
      },
      approval: {
        principal: principal(),
        receipt,
        signingSecret,
        preclaimedExecution: fence,
      },
    })).resolves.toMatchObject({ ok: true });

    await expect(executeAgentToolCall(clients, request, {
      state: currentState,
      accessContext: access(),
      providerMutationIdentity: {
        idempotencyKey: fence.providerIdempotencyKey,
        bindingFingerprint: "b".repeat(64),
      },
      approval: {
        principal: principal(),
        receipt,
        signingSecret,
        preclaimedExecution: fence,
      },
    })).resolves.toMatchObject({
      ok: false,
      errorCode: "approval_receipt_conflict",
    });

    expect(escalate).toHaveBeenCalledOnce();
    expect(escalate).toHaveBeenCalledWith(
      currentState.sessionId,
      request.arguments.reasons,
      expect.objectContaining({
        signal: expect.any(AbortSignal),
        deadlineAt: expect.any(Number),
      }),
      {
        idempotencyKey: fence.providerIdempotencyKey,
        bindingFingerprint: fence.bindingFingerprint,
      },
    );
  });

  it.each([
    {
      toolName: "createPaymentLink" as const,
      arguments: { methodId: "zalopay_wallet" },
      state: state({
        order: createdOrder(),
      }),
      providerSpy: (clients: ReturnType<typeof createMockClients>) =>
        vi.spyOn(clients.payment, "createPaymentLink"),
    },
    {
      toolName: "handoff" as const,
      arguments: { reasons: ["customer_requested_support"] },
      state: state(),
      providerSpy: (clients: ReturnType<typeof createMockClients>) =>
        vi.spyOn(clients.handoff, "escalateToHuman"),
    },
  ])(
    "binds and consumes approval before $toolName",
    async ({
      toolName,
      arguments: requestArguments,
      state: currentState,
      providerSpy,
    }) => {
      const clients = createMockClients(createTestFixtures());
      if (toolName === "createPaymentLink") {
        const collection = await executeAgentToolCall(
          clients,
          {
            toolName: "listPaymentMethods",
            arguments: { query: null, paymentSurface: null },
          },
          { state: currentState },
        );
        if (!collection.ok) throw new Error("payment collection failed");
        applyAgentCollectionToVerifiedState(currentState, collection);
        selectCurrentPaymentMethod(
          currentState,
          requestArguments.methodId,
        );
      }
      const provider = providerSpy(clients);
      const request: ToolCallRequest = {
        toolName,
        arguments: requestArguments,
      };
      const pending = await executeAgentToolCall(clients, request, {
        state: currentState,
        accessContext: access(),
        approval: { principal: principal() },
      });
      if (pending.ok || !pending.approvalBinding) {
        throw new Error(`${toolName} approval binding missing`);
      }
      expect(pending).toMatchObject({
        errorCode: "approval_required",
        approvalBinding: { capability: toolName },
      });

      const approved = await approvalContext(pending.approvalBinding);
      await expect(
        executeAgentToolCall(clients, request, {
          state: currentState,
          accessContext: access(),
          approval: approved,
          runGuard: currentRunGuard(),
        }),
      ).resolves.toMatchObject({ ok: true });
      expect(provider).toHaveBeenCalledTimes(1);
    },
  );

  it("authorizes an arbitrary exact provider payment method id without a local alias table", async () => {
    const fixtureSet = createTestFixtures();
    const supportedMethod = fixtureSet.paymentMethods.find(
      (method) =>
        method.supported &&
        method.supportStatus === "listed_supported" &&
        method.category !== "cash_on_delivery",
    );
    if (!supportedMethod) throw new Error("supported payment fixture missing");
    const methodId = "provider-method-rotation-2026-07-20-a91f";
    const clients = createMockClients({
      ...fixtureSet,
      paymentMethods: [{
        ...supportedMethod,
        methodId,
        displayName: "Provider rotated wallet",
      }],
    });
    const currentState = state({ order: createdOrder() });
    const collection = await executeAgentToolCall(
      clients,
      {
        toolName: "listPaymentMethods",
        arguments: { query: null, paymentSurface: null },
      },
      { state: currentState },
    );
    if (!collection.ok || collection.toolName !== "listPaymentMethods") {
      throw new Error("payment collection failed");
    }
    applyAgentCollectionToVerifiedState(currentState, collection);
    selectCurrentPaymentMethod(currentState, methodId);

    const request: ToolCallRequest = {
      toolName: "createPaymentLink",
      arguments: { methodId },
    };
    const pending = await executeAgentToolCall(clients, request, {
      state: currentState,
      accessContext: access(),
      approval: { principal: principal() },
    });
    if (pending.ok || !pending.approvalBinding) {
      throw new Error("payment approval binding missing");
    }
    const collectionKey =
      currentState.activeCollectionKeys?.listPaymentMethods;
    const collectionSnapshot = collectionKey
      ? currentState.verifiedCollections?.listPaymentMethods?.[collectionKey]
      : undefined;
    if (!collectionKey || !collectionSnapshot) {
      throw new Error("active payment collection missing");
    }
    expect(pending.approvalBinding.actionDigest).toBe(
      await digestCommerceAction({
      toolName: "createPaymentLink",
        order: currentState.order,
      methodId,
      paymentMethodCollection: {
          key: collectionKey,
          revision: collectionSnapshot.revision,
          providerRevision: collectionSnapshot.providerRevision,
      },
      }),
    );

    await expect(
      executeAgentToolCall(clients, request, {
        state: currentState,
        accessContext: access(),
        approval: await approvalContext(pending.approvalBinding),
        runGuard: currentRunGuard(),
      }),
    ).resolves.toMatchObject({
      ok: true,
      toolName: "createPaymentLink",
      value: {
        url: expect.stringContaining(methodId),
      },
    });

    await expect(
      executeAgentToolCall(
        clients,
        {
          toolName: "createPaymentLink",
          arguments: { methodId: "zalopay" },
        },
        {
          state: currentState,
          accessContext: access(),
          approval: { principal: principal() },
        },
      ),
    ).resolves.toMatchObject({
      ok: false,
      errorCode: "unverified_payment_method",
    });
  });

  it("rejects a payment snapshot whose provider revision is no longer current before irreversible side effects", async () => {
    const clients = createMockClients(createTestFixtures());
    const currentState = state({ order: createdOrder() });
    const collection = await executeAgentToolCall(
      clients,
      {
        toolName: "listPaymentMethods",
        arguments: { query: null, paymentSurface: null },
      },
      { state: currentState },
    );
    if (!collection.ok || collection.toolName !== "listPaymentMethods") {
      throw new Error("payment collection failed");
    }
    applyAgentCollectionToVerifiedState(currentState, collection);
    const methodId = collection.value.items.find((method) => method.supported)
      ?.methodId;
    if (!methodId) throw new Error("supported payment method missing");
    selectCurrentPaymentMethod(currentState, methodId);

    const payment = vi.spyOn(clients.payment, "createPaymentLink");
    const placeOrder = vi.spyOn(clients.oms, "placeOrder");
    clients.confirmationAuthority!.providerRevision =
      "provider-revision-after-payment-refresh";
    const revalidate = vi
      .spyOn(clients.confirmationAuthority!, "revalidate")
      .mockResolvedValue({ ok: true });

    await expect(
      executeAgentToolCall(
        clients,
        {
          toolName: "createPaymentLink",
          arguments: { methodId },
        },
        {
          state: currentState,
          accessContext: access(),
          approval: { principal: principal() },
          runGuard: currentRunGuard(),
        },
      ),
    ).resolves.toMatchObject({
      ok: false,
      errorCode: "provider_authority_stale",
    });
    expect(revalidate).toHaveBeenCalledTimes(1);
    expect(payment).not.toHaveBeenCalled();
    expect(placeOrder).not.toHaveBeenCalled();
  });

  it.each(["collection key", "collection revision"] as const)(
    "rejects %s drift during provider revalidation before irreversible side effects",
    async (drift) => {
      const clients = createMockClients(createTestFixtures());
      const currentState = state({ order: createdOrder() });
      const collection = await executeAgentToolCall(
        clients,
        {
          toolName: "listPaymentMethods",
          arguments: { query: null, paymentSurface: null },
        },
        { state: currentState },
      );
      if (!collection.ok || collection.toolName !== "listPaymentMethods") {
        throw new Error("payment collection failed");
      }
      applyAgentCollectionToVerifiedState(currentState, collection);
      const methodId = collection.value.items.find((method) => method.supported)
        ?.methodId;
      const originalKey =
        currentState.activeCollectionKeys?.listPaymentMethods;
      const originalSnapshot = originalKey
        ? currentState.verifiedCollections?.listPaymentMethods?.[originalKey]
        : undefined;
      if (!methodId || !originalKey || !originalSnapshot) {
        throw new Error("active payment authority missing");
      }
      selectCurrentPaymentMethod(currentState, methodId);

      const payment = vi.spyOn(clients.payment, "createPaymentLink");
      const placeOrder = vi.spyOn(clients.oms, "placeOrder");
      const revalidate = vi
        .spyOn(clients.confirmationAuthority!, "revalidate")
        .mockImplementation(async () => {
          if (drift === "collection key") {
            const nextKey = `${originalKey}:refreshed`;
            currentState.activeCollectionKeys = {
              ...currentState.activeCollectionKeys,
              listPaymentMethods: nextKey,
            };
            currentState.verifiedCollections = {
              ...currentState.verifiedCollections,
              listPaymentMethods: {
                ...currentState.verifiedCollections?.listPaymentMethods,
                [nextKey]: {
                  ...originalSnapshot,
                  key: nextKey,
                },
              },
            };
          } else {
            currentState.verifiedCollections = {
              ...currentState.verifiedCollections,
              listPaymentMethods: {
                ...currentState.verifiedCollections?.listPaymentMethods,
                [originalKey]: {
                  ...originalSnapshot,
                  revision: `${originalSnapshot.revision}:refreshed`,
                },
              },
            };
          }
          return { ok: true };
        });

      await expect(
        executeAgentToolCall(
          clients,
          {
            toolName: "createPaymentLink",
            arguments: { methodId },
          },
          {
            state: currentState,
            accessContext: access(),
            approval: { principal: principal() },
            runGuard: currentRunGuard(),
          },
        ),
      ).resolves.toMatchObject({
        ok: false,
        errorCode: "provider_authority_stale",
      });
      expect(revalidate).toHaveBeenCalledTimes(1);
      expect(payment).not.toHaveBeenCalled();
      expect(placeOrder).not.toHaveBeenCalled();
    },
  );

  it.each(["order", "selected method"] as const)(
    "rejects %s replacement during provider revalidation before irreversible side effects",
    async (drift) => {
      const clients = createMockClients(createTestFixtures());
      const currentState = state({ order: createdOrder() });
      const collection = await executeAgentToolCall(
        clients,
        {
          toolName: "listPaymentMethods",
          arguments: { query: null, paymentSurface: null },
        },
        { state: currentState },
      );
      if (!collection.ok || collection.toolName !== "listPaymentMethods") {
        throw new Error("payment collection failed");
      }
      applyAgentCollectionToVerifiedState(currentState, collection);
      const supportedMethods = collection.value.items.filter(
        (method) => method.supported,
      );
      const selectedMethod = supportedMethods[0];
      const replacementMethod = supportedMethods[1];
      if (!selectedMethod || !replacementMethod) {
        throw new Error("two supported payment methods are required");
      }
      selectCurrentPaymentMethod(currentState, selectedMethod.methodId);

      const payment = vi.spyOn(clients.payment, "createPaymentLink");
      const placeOrder = vi.spyOn(clients.oms, "placeOrder");
      const revalidate = vi
        .spyOn(clients.confirmationAuthority!, "revalidate")
        .mockImplementation(async () => {
          if (drift === "order") {
            currentState.order = {
              ...createdOrder(),
              id: "order-rotated-during-revalidation",
            };
          } else {
            selectCurrentPaymentMethod(
              currentState,
              replacementMethod.methodId,
            );
          }
          return { ok: true };
        });

      await expect(
        executeAgentToolCall(
          clients,
          {
            toolName: "createPaymentLink",
            arguments: { methodId: selectedMethod.methodId },
          },
          {
            state: currentState,
            accessContext: access(),
            approval: { principal: principal() },
            runGuard: currentRunGuard(),
          },
        ),
      ).resolves.toMatchObject({
        ok: false,
        errorCode: "provider_authority_stale",
      });
      expect(revalidate).toHaveBeenCalledTimes(1);
      expect(payment).not.toHaveBeenCalled();
      expect(placeOrder).not.toHaveBeenCalled();
    },
  );

  it.each(["removed", "duplicate", "unsupported"] as const)(
    "rejects an exact payment method id that is %s before any provider client call",
    async (invalidity) => {
      const clients = createMockClients(createTestFixtures());
      const currentState = state({ order: createdOrder() });
      const collection = await executeAgentToolCall(
        clients,
        {
          toolName: "listPaymentMethods",
          arguments: { query: null, paymentSurface: null },
        },
        { state: currentState },
      );
      if (!collection.ok || collection.toolName !== "listPaymentMethods") {
        throw new Error("payment collection failed");
      }
      applyAgentCollectionToVerifiedState(currentState, collection);
      const method = collection.value.items.find(
        (candidate) => candidate.supported,
      );
      const collectionKey =
        currentState.activeCollectionKeys?.listPaymentMethods;
      const snapshot = collectionKey
        ? currentState.verifiedCollections?.listPaymentMethods?.[collectionKey]
        : undefined;
      if (!method || !collectionKey || !snapshot) {
        throw new Error("active payment authority missing");
      }
      selectCurrentPaymentMethod(currentState, method.methodId);
      const items =
        invalidity === "removed"
          ? []
          : invalidity === "duplicate"
            ? [method, method]
            : [{
                ...method,
                supported: false,
                supportStatus: "not_listed_in_policy" as const,
              }];
      currentState.verifiedCollections = {
        ...currentState.verifiedCollections,
        listPaymentMethods: {
          ...currentState.verifiedCollections?.listPaymentMethods,
          [collectionKey]: {
            ...snapshot,
            result: {
              ...snapshot.result,
              items,
              total: items.length,
              returned: items.length,
            },
          },
        },
      };

      const payment = vi.spyOn(clients.payment, "createPaymentLink");
      const placeOrder = vi.spyOn(clients.oms, "placeOrder");
      const revalidate = vi.spyOn(
        clients.confirmationAuthority!,
        "revalidate",
      );

      await expect(
        executeAgentToolCall(
          clients,
          {
            toolName: "createPaymentLink",
            arguments: { methodId: method.methodId },
          },
          {
            state: currentState,
            accessContext: access(),
            approval: { principal: principal() },
            runGuard: currentRunGuard(),
          },
        ),
      ).resolves.toMatchObject({
        ok: false,
        errorCode: "unverified_payment_method",
      });
      expect(revalidate).not.toHaveBeenCalled();
      expect(payment).not.toHaveBeenCalled();
      expect(placeOrder).not.toHaveBeenCalled();
    },
  );

  it.each([
    "session authority",
    "operation lease",
  ] as const)(
    "rechecks the exact approval lease after %s loss and performs zero provider calls",
    async (lostAuthority) => {
      const clients = createMockClients(createTestFixtures());
      const placeOrder = vi.spyOn(clients.oms, "placeOrder");
      const currentState = state({
        orderPreview: orderPreview(),
        cart: orderPreview().cart,
      });
      await attachExactPlaceOrderAvailability(clients, currentState);
      const request: ToolCallRequest = {
        toolName: "placeOrder",
        arguments: {},
      };
      const pending = await executeAgentToolCall(
        clients,
        request,
        {
          state: currentState,
          accessContext: access(),
          approval: { principal: principal() },
        },
      );
      if (pending.ok || !pending.approvalBinding) {
        throw new Error("approval binding missing");
      }

      const store = new MemoryStore();
      const receipt = await createCommerceApprovalReceipt({
        binding: pending.approvalBinding,
        secret: signingSecret,
      });
      const lease = await reserveApprovalOperationLease({
        store,
        sessionId: currentState.sessionId,
        requestId: receipt.receiptId,
        bindingFingerprint:
          await digestCommerceAction({
            schemaVersion: "test-approval-operation-v1",
            actionDigest: pending.approvalBinding.actionDigest,
          }),
      });
      const approved = await approvalContextForOperationLease({
        binding: pending.approvalBinding,
        receipt,
        lease,
      });
      const isCurrent = vi.fn(async () => {
        if (lostAuthority === "session authority") {
          await store.transitionSessionAuthority({
            sessionId: currentState.sessionId,
            expectedGeneration:
              lease.owner.sessionAuthorityGeneration,
            agentMode: "human_paused",
            assignedAgentId: "agent-security-review",
          });
        } else {
          await store.failIrreversibleOperation(
            lease.operation,
            lease.owner,
            "test operation lease loss before provider dispatch",
          );
        }
        return store.isRunCommitFenceCurrent({
          sessionId: currentState.sessionId,
          fence: lease.fence,
        });
      });
      const recordIrreversibleBoundary =
        vi.fn(async () => undefined);

      await expect(
        executeAgentToolCall(clients, request, {
          state: currentState,
          accessContext: access(),
          approval: approved,
          runFence: lease.fence,
          confirmationResume: true,
          runGuard: {
            isCurrent,
            recordIrreversibleBoundary,
          },
        }),
      ).resolves.toMatchObject({
        ok: false,
        errorCode: "stale_agent_run",
      });
      expect(isCurrent).toHaveBeenCalledOnce();
      expect(recordIrreversibleBoundary).not.toHaveBeenCalled();
      expect(placeOrder).not.toHaveBeenCalled();
    },
  );

  it("rejects forged or cloned guest resume authority before irreversible reservation or provider dispatch", async () => {
    const clients = createMockClients(createTestFixtures());
    const createPaymentLink = vi.spyOn(
      clients.payment,
      "createPaymentLink",
    );
    const revalidate = vi.spyOn(
      clients.confirmationAuthority!,
      "revalidate",
    );
    const forged = forgedGuestApprovalAuthority();
    const request: ToolCallRequest = {
      toolName: "createPaymentLink",
      arguments: { methodId: "payment-method-1" },
    };
    const currentState = state({
      channel: "messenger",
      order: createdOrder(),
      cart: createdOrder().cart,
    });

    for (const candidate of [forged, structuredClone(forged)]) {
      await expect(executeAgentToolCall(
        clients,
        request,
        {
          state: currentState,
          confirmationResume: true,
          externalMessageId: candidate.externalMessageId,
          approval: {
            principal: candidate.principal,
            confirmationRequestId: candidate.requestId,
            verifiedGuestAuthority: candidate,
          },
        },
      )).resolves.toMatchObject({
        ok: false,
        errorCode: "guest_checkout_authority_missing",
      });
    }
    expect(revalidate).not.toHaveBeenCalled();
    expect(createPaymentLink).not.toHaveBeenCalled();
  });

  it("replays concurrent exact provider identities without a second lower claim", async () => {
    const clients = createMockClients(createTestFixtures());
    const currentState = state();
    const request: ToolCallRequest = {
      toolName: "handoff",
      arguments: { reasons: ["customer_requested_support"] },
    };
    const pending = await executeAgentToolCall(clients, request, {
      state: currentState,
      accessContext: access(),
      approval: { principal: principal() },
    });
    if (pending.ok || !pending.approvalBinding)
      throw new Error("approval binding missing");
    const approved = await approvalContext(pending.approvalBinding);
    const execute = () =>
      executeAgentToolCall(clients, request, {
        state: currentState,
        accessContext: access(),
        approval: approved,
      });

    const results = await Promise.all([execute(), execute()]);
    expect(results.every((result) => result.ok)).toBe(true);
    expect(results[0]).toEqual(results[1]);
  });
});
