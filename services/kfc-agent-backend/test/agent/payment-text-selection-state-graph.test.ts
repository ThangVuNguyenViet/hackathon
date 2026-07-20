import { fakeModel } from '@langchain/core/testing';
import { MemorySaver } from '@langchain/langgraph';
import { describe, expect, it, vi } from 'vitest';
import {
  createAgentTurnExternalCallScope,
} from '../../src/agent/singleAgentRuntime.js';
import { DashboardEventBus } from '../../src/dashboard/eventBus.js';
import type { Order } from '../../src/domain/types.js';
import { runAgentTurn } from '../../src/graph/buildGraph.js';
import type { AgentGraphState } from '../../src/graph/state.js';
import {
  applyAgentCollectionToVerifiedState,
  buildVerifiedStateSnapshot,
  loadPriorVerifiedState,
} from '../../src/graph/verifiedState.js';
import { createMockClients } from '../../src/mock/createMockClients.js';
import {
  createCommerceApprovalReceipt,
  digestCommerceAction,
} from '../../src/ordering/approvalReceipt.js';
import {
  createCommerceApprovalExecutionFence,
} from '../../src/ordering/approvalExecutionFence.js';
import { executeAgentToolCall } from '../../src/ordering/agentToolExecutor.js';
import {
  activePaymentMethodCollectionAuthority,
} from '../../src/ordering/paymentMethodAuthority.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';
import type {
  CreateConfirmationPauseInput,
} from '../../src/persistence/contracts.js';
import {
  groundedResponseModelReply,
  groundedResponseVerifierModel,
} from '../fixtures/groundedResponse.js';
import {
  controlledCustomerAccess,
} from '../fixtures/controlledCustomerAccess.js';
import { createTestFixtures } from '../fixtures/testFixtures.js';

const opaqueMethodId =
  `provider/支払?account=α#${'長'.repeat(512)}!()[]{};,:@&=+$`;

function externalCallContext() {
  return {
    signal: new AbortController().signal,
    deadlineAt: Date.now() + 60_000,
  };
}

function createdOrder(): Order {
  return {
    id: 'order/text-payment-支払-Σ',
    cart: {
      id: 'cart/text-payment-支払-Σ',
      items: [{
        itemCode: 'item/provider-20751',
        name: 'Verified item',
        quantity: 1,
        unitPriceVnd: 99_000,
      }],
      subtotalVnd: 99_000,
      discountVnd: 0,
      deliveryFeeVnd: 18_000,
      totalVnd: 117_000,
      voucherCode: null,
    },
    status: 'created',
    paymentStatus: 'not_started',
    assignedStoreId: 'store/opaque-東京',
    createdAt: '2026-07-20T00:00:00.000Z',
  };
}

async function paymentState(input: {
  sessionId: string;
  customerId: string;
}) {
  const fixtures = createTestFixtures();
  const sourceMethod = fixtures.paymentMethods.find(
    (method) =>
      method.supported &&
      method.supportStatus === 'listed_supported' &&
      method.category !== 'cash_on_delivery',
  );
  if (!sourceMethod) throw new Error('supported payment fixture missing');
  const clients = createMockClients({
    ...fixtures,
    paymentMethods: [{
      ...sourceMethod,
      methodId: opaqueMethodId,
      displayName: 'Provider display alias',
    }],
  });
  const order = createdOrder();
  const state: AgentGraphState = {
    sessionId: input.sessionId,
    customerId: input.customerId,
    channel: 'kfc',
    latestUserMessage: 'Use the exact verified payment method',
    cart: order.cart,
    order,
    userConfirmedOrder: false,
    escalationReasons: [],
    retrievedEvidence: [],
    toolTrace: [],
  };
  const collection = await executeAgentToolCall(
    clients,
    {
      toolName: 'listPaymentMethods',
      arguments: { query: null, paymentSurface: null },
    },
    {
      state,
      externalCallContext: externalCallContext(),
    },
  );
  if (!collection.ok || collection.toolName !== 'listPaymentMethods') {
    throw new Error('payment collection failed');
  }
  applyAgentCollectionToVerifiedState(state, collection);
  const collectionAuthority =
    activePaymentMethodCollectionAuthority(state);
  if (!collectionAuthority) {
    throw new Error('active payment collection authority missing');
  }
  return { clients, collectionAuthority, order, state };
}

function paymentWriteAccess(input: {
  sessionId: string;
  customerId: string;
}) {
  const access = controlledCustomerAccess(input);
  access.authorizedScopes = [...access.authorizedScopes, 'payment:write'];
  return access;
}

describe('mandatory-text payment selection StateGraph authority', () => {
  it('persists the exact model-authored selection before pause and durably clears it on authenticated rejection', async () => {
    const sessionId = 'kfc:text-payment-authority';
    const customerId = 'text-payment-authority';
    const store = new MemoryStore();
    const checkpointer = new MemorySaver();
    const {
      clients,
      collectionAuthority,
      state,
    } = await paymentState({ sessionId, customerId });
    await store.appendEvent(sessionId, 'graph:verified_state', {
      verifiedState: buildVerifiedStateSnapshot(state),
    });

    const model = fakeModel()
      .respondWithTools([{
        name: 'createPaymentLink',
        args: { methodId: opaqueMethodId },
      }])
      .respond(groundedResponseModelReply({
        customerText: 'The rejected payment action remains unexecuted.',
      }));
    const verifierModel = groundedResponseVerifierModel({
      hasUnsupportedFactualClaim: true,
    });
    const paymentProvider = vi.spyOn(
      clients.payment,
      'createPaymentLink',
    );
    const orderProvider = vi.spyOn(clients.oms, 'placeOrder');
    const input = {
      sessionId,
      customerId,
      channel: 'kfc' as const,
      responseProfile: 'social' as const,
      text: 'Use the exact verified payment method.',
      externalMessageId: 'text-payment-authority-message',
      clients,
      store,
      dashboard: new DashboardEventBus(),
      checkpointer,
      agentModel: model,
      responseVerifierModel: verifierModel,
      accessContext: paymentWriteAccess({ sessionId, customerId }),
    };

    const paused = await runAgentTurn(input);
    const expectedSelection = {
      methodId: opaqueMethodId,
      ...collectionAuthority,
    };
    expect(paused.status).toBe('paused');
    expect(paused.genUi).toBeUndefined();
    expect(paused.presentation).toEqual({
      profile: 'social',
      text: '',
    });
    expect(paused.pause?.action).toEqual({
      toolName: 'createPaymentLink',
      arguments: { methodId: opaqueMethodId },
    });
    expect(
      (await store.listTurns(sessionId))
        .find(({ role }) => role === 'user')
        ?.metadata?.responseProfile,
    ).toBe('social');
    expect(paused.state.selectedPaymentMethod).toEqual(expectedSelection);
    expect(
      (await loadPriorVerifiedState(store, sessionId))
        .selectedPaymentMethod,
    ).toEqual(expectedSelection);

    const descriptor = Object.getOwnPropertyDescriptor(
      paused.pause!,
      'confirmationRecord',
    );
    const record = descriptor?.value as
      | CreateConfirmationPauseInput
      | undefined;
    expect(record).toBeDefined();
    expect(record?.action).toEqual({
      toolName: 'createPaymentLink',
      arguments: { methodId: opaqueMethodId },
    });
    expect(record?.approvalBinding.actionDigest).toBe(
      await digestCommerceAction({
        toolName: 'createPaymentLink',
        order: paused.state.order,
        methodId: opaqueMethodId,
        paymentMethodCollection: {
          key: collectionAuthority.collectionKey,
          revision: collectionAuthority.collectionRevision,
          providerRevision: collectionAuthority.providerRevision,
        },
      }),
    );
    expect(paymentProvider).not.toHaveBeenCalled();
    expect(orderProvider).not.toHaveBeenCalled();
    if (!record) throw new Error('confirmation record missing');

    const signingSecret =
      'text-payment-rejection-secret-at-least-thirty-two-bytes';
    const commerceReceipt = await createCommerceApprovalReceipt({
      binding: record.approvalBinding,
      secret: signingSecret,
      decision: 'reject',
      receiptId: record.requestId,
    });
    const approvalBindingDigest =
      await digestCommerceAction(record.approvalBinding);
    const executionFence = await createCommerceApprovalExecutionFence({
      secret: signingSecret,
      claim: {
        schemaVersion: 'kfc-commerce-approval-execution-v1',
        operation: 'confirmation_resume',
        requestId: record.requestId,
        expectedSessionGeneration: 0,
        sessionAuthorityGeneration: 0,
        checkpointThreadId: record.checkpointThreadId,
        checkpointNamespace: record.checkpointNamespace,
        checkpointId: record.checkpointId,
        bindingFingerprint: approvalBindingDigest,
        approvalBindingDigest,
        providerIdempotencyKey:
          `confirmation:${record.requestId}:payment:test`,
        attempt: 1,
        leaseToken: '00000000-0000-4000-8000-000000000733',
      },
    });
    const resumeScope = createAgentTurnExternalCallScope(5_000);
    try {
      await expect(runAgentTurn({
        ...input,
        confirmationResume: {
          requestId: record.requestId,
          approved: false,
          action: record.action,
          checkpoint: {
            threadId: record.checkpointThreadId,
            namespace: record.checkpointNamespace,
            checkpointId: record.checkpointId,
          },
          commerceReceipt,
          executionFence,
          signingSecret,
          externalCallContext: resumeScope.context,
          abortExternalCalls: resumeScope.abort,
        },
      })).rejects.toThrow('agent_response_grounding_rejected');
    } finally {
      resumeScope.dispose();
    }

    expect(model.callCount).toBe(2);
    expect(await store.listEvents(sessionId)).toContainEqual(
      expect.objectContaining({
        sourceType: 'agent:failed_closed',
        payload: expect.objectContaining({
          errorCode: 'agent_response_grounding_rejected',
          responseVerification: expect.objectContaining({ calls: 1 }),
        }),
      }),
    );
    expect(
      (await loadPriorVerifiedState(store, sessionId))
        .selectedPaymentMethod,
    ).toBeUndefined();
    expect(paymentProvider).not.toHaveBeenCalled();
    expect(orderProvider).not.toHaveBeenCalled();
  });

  it.each([
    ['missing active collection', opaqueMethodId],
    ['provider display alias', 'Provider display alias'],
  ] as const)(
    'fails closed without pausing for %s',
    async (failureCase, requestedMethodId) => {
      const sessionId =
        `kfc:text-payment-invalid:${failureCase.replaceAll(' ', '-')}`;
      const customerId = 'text-payment-invalid';
      const store = new MemoryStore();
      const { clients, state } = await paymentState({
        sessionId,
        customerId,
      });
      if (failureCase === 'missing active collection') {
        state.activeCollectionKeys = {};
      }
      await store.appendEvent(sessionId, 'graph:verified_state', {
        verifiedState: buildVerifiedStateSnapshot(state),
      });
      const model = fakeModel()
        .respondWithTools([{
          name: 'createPaymentLink',
          args: { methodId: requestedMethodId },
        }])
        .respondWithTools([{
          name: 'createPaymentLink',
          args: { methodId: requestedMethodId },
        }]);
      const paymentProvider = vi.spyOn(
        clients.payment,
        'createPaymentLink',
      );
      const orderProvider = vi.spyOn(clients.oms, 'placeOrder');

      await expect(runAgentTurn({
        sessionId,
        customerId,
        channel: 'kfc',
        responseProfile: 'social',
        text: 'Use this payment choice.',
        externalMessageId:
          `text-payment-invalid-${failureCase.replaceAll(' ', '-')}`,
        clients,
        store,
        dashboard: new DashboardEventBus(),
        checkpointer: new MemorySaver(),
        agentModel: model,
        accessContext: paymentWriteAccess({ sessionId, customerId }),
      })).rejects.toThrow('agent_semantic_correction_limit_exceeded');

      expect(
        (await loadPriorVerifiedState(store, sessionId))
          .selectedPaymentMethod,
      ).toBeUndefined();
      expect(paymentProvider).not.toHaveBeenCalled();
      expect(orderProvider).not.toHaveBeenCalled();
    },
  );
});
