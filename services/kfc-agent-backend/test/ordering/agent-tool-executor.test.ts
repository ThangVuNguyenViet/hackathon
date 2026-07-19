import { describe, expect, it, vi } from 'vitest';
import type { CustomerAccessContext, Order } from '../../src/domain/types.js';
import { applyAgentCollectionToVerifiedState } from '../../src/graph/verifiedState.js';
import type { AgentGraphState } from '../../src/graph/state.js';
import { createMockClients } from '../../src/mock/createMockClients.js';
import {
  createCommerceApprovalReceipt,
} from '../../src/ordering/approvalReceipt.js';
import {
  executeAgentToolCall,
  type AgentApprovalExecutionContext,
} from '../../src/ordering/agentToolExecutor.js';
import { agentToolArgumentSchemas } from '../../src/ordering/toolCatalog.js';
import type {
  CommerceApprovalBinding,
  CommerceApprovalCapability,
  CommerceApprovalPrincipal,
  ToolCallRequest,
} from '../../src/ordering/types.js';
import { projectVerifiedMenuCollectionToText } from '../../src/ordering/verifiedCollections.js';
import { createTestFixtures } from '../fixtures/testFixtures.js';
import { controlledCustomerAccess } from '../fixtures/controlledCustomerAccess.js';

const signingSecret = 'commerce-approval-test-secret-at-least-thirty-two-bytes';

function state(overrides: Partial<AgentGraphState> = {}): AgentGraphState {
  return {
    sessionId: 'session_1',
    customerId: 'customer_1',
    channel: 'kfc',
    latestUserMessage: '',
    intent: 'ordering',
    userConfirmedOrder: false,
    escalationReasons: [],
    retrievedEvidence: [],
    toolTrace: [],
    ...overrides,
  };
}

function access(): CustomerAccessContext {
  const value = controlledCustomerAccess({
    sessionId: 'session_1',
    customerId: 'customer_1',
  });
  return {
    ...value,
    authorizedScopes: [
      ...value.authorizedScopes,
      'order:write',
      'payment:write',
      'handoff:write',
    ],
  };
}

function principal(): CommerceApprovalPrincipal {
  return {
    sessionId: 'session_1',
    customerId: 'customer_1',
    channel: 'kfc',
    authenticatedSubject: 'customer_1',
    authenticationEvidenceRef: 'controlled-test:customer_1',
  };
}

function orderPreview(): Order {
  return {
    id: 'preview_1',
    cart: {
      id: 'cart_1',
      items: [{
        itemCode: '20751',
        name: 'Combo Hợp Gu 99K',
        quantity: 1,
        unitPriceVnd: 99000,
      }],
      subtotalVnd: 99000,
      discountVnd: 0,
      deliveryFeeVnd: 18000,
      totalVnd: 117000,
      voucherCode: null,
    },
    status: 'previewed',
    paymentStatus: 'not_started',
    assignedStoreId: 'KFCVN0318',
    createdAt: '2026-07-19T00:00:00.000Z',
  };
}

function createdOrder(): Order {
  return {
    ...orderPreview(),
    id: 'KFC-MOCK-1001',
    status: 'created',
    paymentStatus: 'pending',
  };
}

async function approvalContext(
  binding: CommerceApprovalBinding,
  overrides: Partial<AgentApprovalExecutionContext> = {},
): Promise<AgentApprovalExecutionContext> {
  const consumed = new Set<string>();
  return {
    principal: principal(),
    receipt: await createCommerceApprovalReceipt({
      binding,
      secret: signingSecret,
    }),
    signingSecret,
    claimExecution: async ({ receipt, runGuard, toolName }) => {
      if (!(await runGuard.isCurrent())) {
        return { ok: false, errorCode: 'stale_agent_run' as const };
      }
      if (consumed.has(receipt.receiptId)) {
        return { ok: false, errorCode: 'approval_receipt_consumed' as const };
      }
      consumed.add(receipt.receiptId);
      await runGuard.recordIrreversibleBoundary?.(toolName);
      return { ok: true };
    },
    ...overrides,
  };
}

function currentRunGuard() {
  return {
    isCurrent: async () => true,
    recordIrreversibleBoundary: async () => undefined,
  };
}

describe('provider-neutral agent commerce executor', () => {
  it('uses one strict schema surface without model-controlled authoritative fields', () => {
    expect(agentToolArgumentSchemas.searchMenu.safeParse({ scope: 'all', query: null }).success).toBe(true);
    expect(agentToolArgumentSchemas.searchMenu.safeParse({ query: 'Món mới' }).success).toBe(false);
    expect(agentToolArgumentSchemas.validateVoucher.safeParse({
      voucherText: 'KFC50',
      subtotalVnd: 1,
    }).success).toBe(false);
    expect(agentToolArgumentSchemas.quoteFulfillment.safeParse({
      address: { label: null, line1: '12 Nguyễn Văn Linh', district: 'Quận 7', city: 'Hồ Chí Minh' },
      method: 'delivery',
      itemCodes: ['forged'],
    }).success).toBe(false);
    expect(agentToolArgumentSchemas.acquireVoucher.safeParse({
      rewardId: 'reward-discount-10k',
      confirmed: true,
    }).success).toBe(false);
    expect(agentToolArgumentSchemas.updateCart.safeParse({
      changes: [{
        itemCode: '20751',
        quantity: 1,
        modifiers: [{
          groupId: 'drink_choice',
          modifierId: 'pepsi_zero',
          quantity: 1,
          modifierName: 'forged',
          priceDeltaVnd: 999999,
        }],
      }],
    }).success).toBe(false);
  });

  it('returns exact complete all/filtered menu collections and replaces only the same scope key', async () => {
    const fixtures = createTestFixtures();
    fixtures.menuItems.push({
      ...fixtures.menuItems[0]!,
      code: 'drink_1',
      itemId: 'drink_1',
      posItemId: 'drink_1',
      productCode: 'DRINK_1',
      category: 'Nước Uống',
      name: 'Pepsi',
      productUrlSlug: 'pepsi',
      builderUrl: 'https://www.kfcvietnam.com.vn/order/delivery/drink/pepsi/builder',
    });
    const clients = createMockClients(fixtures);
    const currentState = state();

    const all = await executeAgentToolCall(
      clients,
      { toolName: 'searchMenu', arguments: { scope: 'all', query: null } },
      { state: currentState },
    );
    expect(all).toMatchObject({
      ok: true,
      value: {
        total: 2,
        returned: 2,
        complete: true,
        scope: { scope: 'all' },
      },
    });
    if (!all.ok || all.toolName !== 'searchMenu') {
      throw new Error('all-menu lookup failed');
    }
    expect(all.value.items.map((item) => item.code)).toEqual(['20751', 'drink_1']);
    const textProjection = projectVerifiedMenuCollectionToText(all.value, 200);
    expect(textProjection).toMatchObject({
      itemCodes: ['20751', 'drink_1'],
      complete: true,
    });
    expect(textProjection.chunks.join('\n')).toContain('Combo Hợp Gu 99K');
    expect(textProjection.chunks.join('\n')).toContain('Pepsi');
    applyAgentCollectionToVerifiedState(currentState, all);

    const filtered = await executeAgentToolCall(
      clients,
      { toolName: 'searchMenu', arguments: { scope: 'filtered', query: 'DRINK_1' } },
      { state: currentState },
    );
    if (!filtered.ok || filtered.toolName !== 'searchMenu') {
      throw new Error('filtered lookup failed');
    }
    applyAgentCollectionToVerifiedState(currentState, filtered);

    expect(Object.keys(currentState.verifiedCollections?.searchMenu ?? {}).sort()).toEqual([
      'all',
      'filtered:drink_1',
    ]);
    expect(currentState.activeMenuCollection?.result.items.map((item) => item.code)).toEqual(['drink_1']);

    const filteredReplacement = await executeAgentToolCall(
      clients,
      { toolName: 'searchMenu', arguments: { scope: 'filtered', query: ' DRINK_1 ' } },
      { state: currentState },
    );
    if (!filteredReplacement.ok || filteredReplacement.toolName !== 'searchMenu') {
      throw new Error('replacement lookup failed');
    }
    applyAgentCollectionToVerifiedState(currentState, filteredReplacement);
    expect(Object.keys(currentState.verifiedCollections?.searchMenu ?? {}).sort()).toEqual([
      'all',
      'filtered:drink_1',
    ]);
    await expect(executeAgentToolCall(
      clients,
      { toolName: 'getItemDetails', arguments: { code: '20751' } },
      { state: currentState },
    )).resolves.toMatchObject({
      ok: false,
      errorCode: 'unverified_item_code',
    });
  });

  it('injects exact cart item codes and rejects incomplete provider coverage', async () => {
    const clients = createMockClients(createTestFixtures());
    const checkInventory = vi.fn(async (_storeId: string, itemCodes: string[]) => ({
      ok: true,
      value: Object.fromEntries(itemCodes.map((code) => [code, true])),
      message: 'ok',
    }));
    clients.inventory.checkInventory = checkInventory;
    const currentState = state({
      cart: {
        id: 'cart_1',
        items: [
          { itemCode: '20751', name: 'Combo', quantity: 1, unitPriceVnd: 99000 },
          { itemCode: 'drink_1', name: 'Drink', quantity: 1, unitPriceVnd: 20000 },
        ],
        subtotalVnd: 119000,
        discountVnd: 0,
        deliveryFeeVnd: 0,
        totalVnd: 119000,
        voucherCode: null,
      },
    });

    const result = await executeAgentToolCall(
      clients,
      {
        toolName: 'checkStoreAvailability',
        arguments: { storeId: 'KFCVN0318', disposition: 'delivery' },
      },
      { state: currentState },
    );
    expect(result.ok).toBe(true);
    expect(checkInventory).toHaveBeenCalledWith(
      'KFCVN0318',
      ['20751', 'drink_1'],
      'delivery',
    );

    clients.inventory.checkInventory = async () => ({
      ok: true,
      value: { 20751: true },
      message: 'partial',
    });
    await expect(executeAgentToolCall(
      clients,
      {
        toolName: 'checkStoreAvailability',
        arguments: { storeId: 'KFCVN0318', disposition: 'delivery' },
      },
      { state: currentState },
    )).resolves.toMatchObject({ ok: false, errorCode: 'incomplete_cart_availability' });
  });

  it('injects authoritative modifier names and prices after verified ID selection', async () => {
    const clients = createMockClients(createTestFixtures());
    const currentState = state({
      cart: {
        id: 'cart_1',
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
        toolName: 'searchMenu',
        arguments: { scope: 'filtered', query: 'Combo Hợp Gu 99K' },
      },
      { state: currentState },
    );
    if (!menuResult.ok) throw new Error('menu lookup failed');
    applyAgentCollectionToVerifiedState(currentState, menuResult);
    const modifierResult = await executeAgentToolCall(
      clients,
      { toolName: 'getModifierOptions', arguments: { code: '20751' } },
      { state: currentState },
    );
    if (!modifierResult.ok || modifierResult.toolName !== 'getModifierOptions') {
      throw new Error('modifier lookup failed');
    }
    currentState.menuModifierOptions = modifierResult.value;
    const applyChanges = vi.spyOn(clients.cart, 'applyChanges');

    const result = await executeAgentToolCall(
      clients,
      {
        toolName: 'updateCart',
        arguments: {
          changes: [{
            itemCode: '20751',
            quantity: 1,
            modifiers: [{
              groupId: 'drink_choice',
              modifierId: 'pepsi_zero',
              quantity: 1,
            }],
          }],
        },
      },
      { state: currentState },
    );
    expect(result.ok).toBe(true);
    expect(applyChanges).toHaveBeenCalledWith(
      currentState.cart,
      [{
        itemCode: '20751',
        quantity: 1,
        modifiers: [{
          groupId: 'drink_choice',
          groupName: 'Chọn nước',
          modifierId: 'pepsi_zero',
          modifierName: 'Pepsi Không Calo',
          priceDeltaVnd: 0,
          quantity: 1,
        }],
      }],
    );
  });

  it.each([
    ['acquireVoucher', 'rewardId', 'reward-discount-10k'],
    ['redeemReward', 'voucherId', 'wallet-new-member-25k'],
  ] as const)(
    'requires a current signed, consumed approval receipt for %s',
    async (toolName, targetField, targetId) => {
      const clients = createMockClients(createTestFixtures());
      const currentState = state();
      const readTool = toolName === 'acquireVoucher'
        ? 'listMembershipRewards' as const
        : 'listMembershipWallet' as const;
      const readArguments = toolName === 'acquireVoucher'
        ? { scope: 'all', query: null }
        : { status: null };
      const collection = await executeAgentToolCall(
        clients,
        { toolName: readTool, arguments: readArguments },
        { state: currentState, accessContext: access() },
      );
      if (!collection.ok) throw new Error('membership collection failed');
      applyAgentCollectionToVerifiedState(currentState, collection);
      const request: ToolCallRequest = {
        toolName,
        arguments: { [targetField]: targetId },
      };
      const baseContext = {
        state: currentState,
        accessContext: access(),
        approval: { principal: principal() },
      };
      const pending = await executeAgentToolCall(clients, request, baseContext);
      expect(pending).toMatchObject({
        ok: false,
        errorCode: 'approval_required',
        approvalBinding: {
          capability: toolName,
          principal: principal(),
          revisions: expect.objectContaining({
            providerRevision: clients.confirmationAuthority!.providerRevision,
          }),
        },
      });
      if (pending.ok || !pending.approvalBinding) throw new Error('approval binding missing');

      const consumed = new Set<string>();
      const approved = await approvalContext(pending.approvalBinding, {
        claimExecution: async ({ receipt, runGuard, toolName: claimedTool }) => {
          if (!(await runGuard.isCurrent())) {
            return { ok: false, errorCode: 'stale_agent_run' as const };
          }
          if (consumed.has(receipt.receiptId)) {
            return { ok: false, errorCode: 'approval_receipt_consumed' as const };
          }
          consumed.add(receipt.receiptId);
          await runGuard.recordIrreversibleBoundary?.(claimedTool);
          return { ok: true };
        },
      });
      await expect(executeAgentToolCall(clients, request, {
        state: currentState,
        accessContext: access(),
        approval: approved,
        runGuard: currentRunGuard(),
      })).resolves.toMatchObject({ ok: true });
      await expect(executeAgentToolCall(clients, request, {
        state: currentState,
        accessContext: access(),
        approval: approved,
        runGuard: currentRunGuard(),
      })).resolves.toMatchObject({ ok: false, errorCode: 'approval_receipt_consumed' });
    },
  );

  it('rejects wrong-principal, stale-revision, expired, and tampered order receipts before placeOrder', async () => {
    const clients = createMockClients(createTestFixtures());
    const placeOrder = vi.spyOn(clients.oms, 'placeOrder');
    const currentState = state({ orderPreview: orderPreview(), cart: orderPreview().cart });
    const request: ToolCallRequest = { toolName: 'placeOrder', arguments: {} };
    const pending = await executeAgentToolCall(clients, request, {
      state: currentState,
      accessContext: access(),
      approval: { principal: principal() },
    });
    if (pending.ok || !pending.approvalBinding) throw new Error('approval binding missing');

    const goodReceipt = await createCommerceApprovalReceipt({
      binding: pending.approvalBinding,
      secret: signingSecret,
    });
    const baseApproval = await approvalContext(pending.approvalBinding);
    baseApproval.receipt = goodReceipt;
    await expect(executeAgentToolCall(clients, request, {
      state: currentState,
      accessContext: access(),
      approval: { ...baseApproval, principal: { ...principal(), customerId: 'other' } },
      runGuard: currentRunGuard(),
    })).resolves.toMatchObject({ ok: false, errorCode: 'approval_principal_mismatch' });
    const originalCart = currentState.cart;
    currentState.cart = { ...orderPreview().cart, totalVnd: 118000 };
    await expect(executeAgentToolCall(clients, request, {
      state: currentState,
      accessContext: access(),
      approval: baseApproval,
      runGuard: currentRunGuard(),
    })).resolves.toMatchObject({ ok: false, errorCode: 'approval_binding_mismatch' });
    currentState.cart = originalCart;
    const originalRevalidate = clients.confirmationAuthority!.revalidate;
    clients.confirmationAuthority!.revalidate = async () => ({
      ok: false,
      reason: 'provider changed',
    });
    await expect(executeAgentToolCall(clients, request, {
      state: currentState,
      accessContext: access(),
      approval: baseApproval,
      runGuard: currentRunGuard(),
    })).resolves.toMatchObject({ ok: false, errorCode: 'provider_authority_stale' });
    clients.confirmationAuthority!.revalidate = originalRevalidate;
    const expired = await createCommerceApprovalReceipt({
      binding: pending.approvalBinding,
      secret: signingSecret,
      issuedAt: new Date(Date.now() - 60_000),
      ttlMs: 1,
    });
    await expect(executeAgentToolCall(clients, request, {
      state: currentState,
      accessContext: access(),
      approval: { ...baseApproval, receipt: expired },
      runGuard: currentRunGuard(),
    })).resolves.toMatchObject({ ok: false, errorCode: 'approval_receipt_expired' });
    await expect(executeAgentToolCall(clients, request, {
      state: currentState,
      accessContext: access(),
      approval: {
        ...baseApproval,
        receipt: {
          ...goodReceipt,
          signature: `${goodReceipt.signature.slice(0, -1)}${
            goodReceipt.signature.endsWith('0') ? '1' : '0'
          }`,
        },
      },
      runGuard: currentRunGuard(),
    })).resolves.toMatchObject({ ok: false, errorCode: 'invalid_approval_receipt' });
    expect(placeOrder).not.toHaveBeenCalled();

    await expect(executeAgentToolCall(clients, request, {
      state: currentState,
      accessContext: access(),
      approval: baseApproval,
      runGuard: currentRunGuard(),
    })).resolves.toMatchObject({ ok: true });
    expect(placeOrder).toHaveBeenCalledWith(expect.objectContaining({ userConfirmed: true }));
  });

  it('authenticates an exact reject receipt without authorizing execution or consuming a claim', async () => {
    const clients = createMockClients(createTestFixtures());
    const placeOrder = vi.spyOn(clients.oms, 'placeOrder');
    const currentState = state({ orderPreview: orderPreview(), cart: orderPreview().cart });
    const request: ToolCallRequest = { toolName: 'placeOrder', arguments: {} };
    const pending = await executeAgentToolCall(clients, request, {
      state: currentState,
      accessContext: access(),
      approval: { principal: principal() },
    });
    if (pending.ok || !pending.approvalBinding) throw new Error('approval binding missing');
    const claimExecution = vi.fn<NonNullable<AgentApprovalExecutionContext['claimExecution']>>();
    const rejected = await createCommerceApprovalReceipt({
      binding: pending.approvalBinding,
      decision: 'reject',
      secret: signingSecret,
    });

    await expect(executeAgentToolCall(clients, request, {
      state: currentState,
      accessContext: access(),
      approval: {
        principal: principal(),
        receipt: rejected,
        signingSecret,
        claimExecution,
      },
      runGuard: currentRunGuard(),
    })).resolves.toMatchObject({ ok: false, errorCode: 'approval_rejected' });
    expect(claimExecution).not.toHaveBeenCalled();
    expect(placeOrder).not.toHaveBeenCalled();
  });

  it.each([
    {
      toolName: 'createPaymentLink' as const,
      arguments: { method: 'zalopay' as const },
      state: state({
        order: createdOrder(),
        selectedPaymentMethod: 'zalopay',
      }),
      providerSpy: (clients: ReturnType<typeof createMockClients>) =>
        vi.spyOn(clients.payment, 'createPaymentLink'),
    },
    {
      toolName: 'handoff' as const,
      arguments: { reasons: ['customer_requested_support'] },
      state: state(),
      providerSpy: (clients: ReturnType<typeof createMockClients>) =>
        vi.spyOn(clients.handoff, 'escalateToHuman'),
    },
  ])(
    'binds and consumes approval before $toolName',
    async ({ toolName, arguments: requestArguments, state: currentState, providerSpy }) => {
      const clients = createMockClients(createTestFixtures());
      const provider = providerSpy(clients);
      const request: ToolCallRequest = { toolName, arguments: requestArguments };
      const pending = await executeAgentToolCall(clients, request, {
        state: currentState,
        accessContext: access(),
        approval: { principal: principal() },
      });
      if (pending.ok || !pending.approvalBinding) {
        throw new Error(`${toolName} approval binding missing`);
      }
      expect(pending).toMatchObject({
        errorCode: 'approval_required',
        approvalBinding: { capability: toolName },
      });

      const approved = await approvalContext(pending.approvalBinding);
      await expect(executeAgentToolCall(clients, request, {
        state: currentState,
        accessContext: access(),
        approval: approved,
        runGuard: currentRunGuard(),
      })).resolves.toMatchObject({ ok: true });
      expect(provider).toHaveBeenCalledTimes(1);
    },
  );

  it('suppresses a stale irreversible run without consuming its valid receipt', async () => {
    const clients = createMockClients(createTestFixtures());
    const placeOrder = vi.spyOn(clients.oms, 'placeOrder');
    const currentState = state({ orderPreview: orderPreview(), cart: orderPreview().cart });
    const request: ToolCallRequest = { toolName: 'placeOrder', arguments: {} };
    const pending = await executeAgentToolCall(clients, request, {
      state: currentState,
      accessContext: access(),
      approval: { principal: principal() },
    });
    if (pending.ok || !pending.approvalBinding) throw new Error('approval binding missing');
    let consumed = false;
    const claimExecution = vi.fn<NonNullable<AgentApprovalExecutionContext['claimExecution']>>(
      async ({ runGuard }) => {
        if (!(await runGuard.isCurrent())) {
          return { ok: false, errorCode: 'stale_agent_run' as const };
        }
        consumed = true;
        return { ok: true };
      },
    );
    const approved = await approvalContext(pending.approvalBinding, { claimExecution });

    await expect(executeAgentToolCall(clients, request, {
      state: currentState,
      accessContext: access(),
      approval: approved,
      runGuard: { isCurrent: async () => false },
    })).resolves.toMatchObject({ ok: false, errorCode: 'stale_agent_run' });
    expect(claimExecution).toHaveBeenCalledTimes(1);
    expect(consumed).toBe(false);
    expect(placeOrder).not.toHaveBeenCalled();
  });

  it('atomically admits only one concurrent replay at the receipt and run boundary', async () => {
    const clients = createMockClients(createTestFixtures());
    const provider = vi.spyOn(clients.handoff, 'escalateToHuman');
    const currentState = state();
    const request: ToolCallRequest = {
      toolName: 'handoff',
      arguments: { reasons: ['customer_requested_support'] },
    };
    const pending = await executeAgentToolCall(clients, request, {
      state: currentState,
      accessContext: access(),
      approval: { principal: principal() },
    });
    if (pending.ok || !pending.approvalBinding) throw new Error('approval binding missing');
    let claimed = false;
    const approved = await approvalContext(pending.approvalBinding, {
      claimExecution: async ({ runGuard, toolName }) => {
        if (!(await runGuard.isCurrent())) {
          return { ok: false, errorCode: 'stale_agent_run' as const };
        }
        if (claimed) {
          return { ok: false, errorCode: 'approval_receipt_consumed' as const };
        }
        claimed = true;
        await runGuard.recordIrreversibleBoundary?.(toolName);
        return { ok: true };
      },
    });
    const execute = () => executeAgentToolCall(clients, request, {
      state: currentState,
      accessContext: access(),
      approval: approved,
      runGuard: currentRunGuard(),
    });

    const results = await Promise.all([execute(), execute()]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results).toEqual(expect.arrayContaining([
      expect.objectContaining({
        ok: false,
        errorCode: 'approval_receipt_consumed',
      }),
    ]));
    expect(provider).toHaveBeenCalledTimes(1);
  });
});
