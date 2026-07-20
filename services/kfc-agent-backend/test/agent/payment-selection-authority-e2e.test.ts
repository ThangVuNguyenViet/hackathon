import {
  AIMessage,
  isSystemMessage,
  type BaseMessage,
} from '@langchain/core/messages';
import { fakeModel } from '@langchain/core/testing';
import { MemorySaver } from '@langchain/langgraph';
import { describe, expect, it, vi } from 'vitest';
import {
  GROUNDED_RESPONSE_TOOL_NAME,
} from '../../src/agent/responseGrounding.js';
import {
  selectedActionResponseReferenceSchema,
  type SelectedActionResponseReference,
} from '../../src/agent/selectedActionResponseAuthority.js';
import {
  STRUCTURED_RESPONSE_REFERENCE_MESSAGE_ID,
} from '../../src/agent/structuredCustomerAction.js';
import { createChatRouteHandlers } from '../../src/api/routeChatHandlers.js';
import type { RouteHandlerContext } from '../../src/api/routeHandlerContext.js';
import { DashboardEventBus } from '../../src/dashboard/eventBus.js';
import {
  paymentMethodCollectionAuthoritySchema,
} from '../../src/domain/opaqueProviderId.js';
import type { Order } from '../../src/domain/types.js';
import { selectKfcGenUiAttachment } from '../../src/genui/kfcGenUiSelector.js';
import { runAgentTurn } from '../../src/graph/buildGraph.js';
import type { AgentGraphState } from '../../src/graph/state.js';
import {
  applyAgentCollectionToVerifiedState,
  buildVerifiedStateSnapshot,
} from '../../src/graph/verifiedState.js';
import { createMockClients } from '../../src/mock/createMockClients.js';
import {
  createCommerceApprovalReceipt,
  digestCommerceAction,
} from '../../src/ordering/approvalReceipt.js';
import {
  createCommerceApprovalExecutionFence,
} from '../../src/ordering/approvalExecutionFence.js';
import {
  buildCurrentAgentApprovalBinding,
  executeAgentToolCall,
} from '../../src/ordering/agentToolExecutor.js';
import {
  activePaymentMethodCollectionAuthority,
} from '../../src/ordering/paymentMethodAuthority.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';
import {
  groundedResponseModelReply,
  groundedResponseVerifierModel,
} from '../fixtures/groundedResponse.js';
import { controlledCustomerAccess } from '../fixtures/controlledCustomerAccess.js';
import { createTestFixtures } from '../fixtures/testFixtures.js';

type AgentResponseInput = Parameters<
  RouteHandlerContext['kfcAgentResponse']
>[0];

function externalCallContext() {
  return {
    signal: new AbortController().signal,
    deadlineAt: Date.now() + 60_000,
  };
}

function initialState(input: {
  sessionId: string;
  customerId: string;
}): AgentGraphState {
  return {
    sessionId: input.sessionId,
    customerId: input.customerId,
    channel: 'kfc',
    latestUserMessage: 'Choose the exact payment method',
    userConfirmedOrder: false,
    escalationReasons: [],
    retrievedEvidence: [],
    toolTrace: [],
  };
}

function structuredActionReference(
  messages: BaseMessage[],
): SelectedActionResponseReference {
  const authorityMessage = messages.find(
    (message) =>
      isSystemMessage(message) &&
      message.id === STRUCTURED_RESPONSE_REFERENCE_MESSAGE_ID,
  );
  if (!authorityMessage || typeof authorityMessage.content !== 'string') {
    throw new Error('structured_action_reference_message_missing');
  }
  const parsed = JSON.parse(authorityMessage.content) as {
    selectedActionResponse?: unknown;
  };
  return selectedActionResponseReferenceSchema.parse(
    parsed.selectedActionResponse,
  );
}

function bindResponseOnlyModel(
  baseModel: ReturnType<typeof fakeModel>,
  responseModel: ReturnType<typeof fakeModel>,
) {
  const planningModel = fakeModel().respond(
    new AIMessage('planning must not run'),
  );
  vi.spyOn(baseModel, 'bindTools').mockImplementation((tools) => {
    const names = (tools as Array<{ name?: string }>).flatMap(
      ({ name }) => name ? [name] : [],
    );
    return (
      names.length === 1 &&
      names[0] === GROUNDED_RESPONSE_TOOL_NAME
        ? responseModel
        : planningModel
    ) as ReturnType<NonNullable<typeof baseModel.bindTools>>;
  });
  return planningModel;
}

function createdOrder(): Order {
  return {
    id: 'order/opaque-支払-Σ',
    cart: {
      id: 'cart/opaque-支払-Σ',
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

describe('opaque payment selection authority integration', () => {
  it('preserves one exact opaque id from attachment through approval binding and mock dispatch', async () => {
    const sessionId = 'kfc:payment-authority-e2e';
    const customerId = 'payment-authority-e2e';
    const methodId =
      `ví.điện-tử/α?provider=opaque#${'長'.repeat(512)}!()[]{};,:@&=+$`;
    const fixtureSet = createTestFixtures();
    const supportedMethod = fixtureSet.paymentMethods.find(
      (method) => method.supported &&
        method.supportStatus === 'listed_supported' &&
        method.category !== 'cash_on_delivery',
    );
    if (!supportedMethod) throw new Error('supported payment fixture missing');
    const clients = createMockClients({
      ...fixtureSet,
      paymentMethods: [{
        ...supportedMethod,
        methodId,
        displayName: 'Opaque provider method',
      }],
    });
    const state = initialState({ sessionId, customerId });
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

    const attachment = selectKfcGenUiAttachment({
      state,
      turnToolNames: ['listPaymentMethods'],
    });
    if (!attachment) throw new Error('payment attachment missing');
    expect(attachment.widgetKind).toBe('paymentMethodPicker');
    expect(attachment.data.methods).toEqual([
      expect.objectContaining({ methodId }),
    ]);
    expect(
      paymentMethodCollectionAuthoritySchema.parse(
        attachment.data.paymentMethodCollection,
      ),
    ).toEqual(collectionAuthority);

    const store = new MemoryStore();
    await store.appendTurn({
      sessionId,
      channel: 'kfc',
      role: 'user',
      text: 'Show the verified payment methods.',
      externalMessageId: 'payment-authority-source-message',
      externalUserId: customerId,
      deliveryStatus: 'received',
      metadata: null,
    });
    const sourceTurn = await store.appendTurn({
      sessionId,
      channel: 'kfc',
      role: 'assistant',
      text: 'Choose a payment method',
      externalMessageId: null,
      externalUserId: customerId,
      deliveryStatus: 'sent',
      metadata: { genUi: attachment },
    });
    await store.appendEvent(sessionId, 'graph:verified_state', {
      verifiedState: buildVerifiedStateSnapshot(state),
    });

    const capturedCalls: AgentResponseInput[] = [];
    const handlers = createChatRouteHandlers({
      store,
      kfcProofAccessContext: async () => controlledCustomerAccess({
        sessionId,
        customerId,
      }),
      kfcAgentResponse: vi.fn(async (input: AgentResponseInput) => {
        capturedCalls.push(input);
        return {
          status: 200,
          body: { acceptedByTestBoundary: true },
        };
      }),
    } as unknown as RouteHandlerContext);
    await expect(handlers.chatKfcGenUiAction({
      sessionId,
      customerId,
      clientMessageId: 'payment-authority-action-e2e',
      action: {
        attachmentId: attachment.id,
        actionId: 'select_payment_method',
        payload: { methodId },
      },
    })).resolves.toEqual({
      status: 200,
      body: { acceptedByTestBoundary: true },
    });
    expect(capturedCalls).toHaveLength(1);
    const trustedInput = capturedCalls[0]!;
    expect(trustedInput.trustedCustomerAction).toEqual({
      source: 'kfc_genui_action',
      assistantTurnId: sourceTurn.id,
      attachmentId: attachment.id,
      actionDigest: expect.stringMatching(/^[0-9a-f]{64}$/u),
      verifiedRevision: attachment.authority?.verifiedRevision,
      lifecycle: 'one_shot',
      command: {
        kind: 'select_payment_method',
        selection: {
          methodId,
          ...collectionAuthority,
        },
      },
    });
    if (!trustedInput.trustedCustomerAction) {
      throw new Error('trusted customer action missing');
    }

    const baseModel = fakeModel();
    const responseModel = fakeModel().respond((messages) => {
      const selectedActionResponse =
        structuredActionReference(messages);
      return groundedResponseModelReply({
          customerText: 'Your exact payment selection is recorded.',
          selectedActionResponse,
        })(messages);
    });
    const planningModel = bindResponseOnlyModel(baseModel, responseModel);
    const graphOutput = await runAgentTurn({
      sessionId,
      customerId,
      channel: 'kfc',
      text: trustedInput.text,
      externalMessageId: 'payment-authority-action-e2e',
      clients,
      store,
      dashboard: new DashboardEventBus(),
      checkpointer: new MemorySaver(),
      agentModel: baseModel,
      responseVerifierModel: groundedResponseVerifierModel(),
      trustedCustomerAction: trustedInput.trustedCustomerAction,
      accessContext: controlledCustomerAccess({
        sessionId,
        customerId,
      }),
    });
    expect(planningModel.callCount).toBe(0);
    expect(responseModel.callCount).toBe(1);
    expect(graphOutput.state.selectedPaymentMethod).toEqual({
      methodId,
      ...collectionAuthority,
    });

    const paymentWriteAccess = controlledCustomerAccess({
      sessionId,
      customerId,
    });
    paymentWriteAccess.authorizedScopes = [
      ...paymentWriteAccess.authorizedScopes,
      'payment:write',
    ];
    const paymentProvider = vi.spyOn(
      clients.payment,
      'createPaymentLink',
    );
    const orderProvider = vi.spyOn(clients.oms, 'placeOrder');
    const order = createdOrder();
    const principal = {
      sessionId,
      customerId,
      channel: 'kfc' as const,
      authenticatedSubject: customerId,
      authenticationEvidenceRef: `controlled-test:${customerId}`,
    };
    const binding = await buildCurrentAgentApprovalBinding(
      clients,
      {
        toolName: 'createPaymentLink',
        arguments: { methodId },
      },
      {
        state: graphOutput.state,
        order,
        accessContext: paymentWriteAccess,
        externalCallContext: externalCallContext(),
        approval: {
          principal,
        },
      },
    );
    if ('ok' in binding) {
      throw new Error(
        `payment approval binding failed:${binding.errorCode ?? 'unknown'}`,
      );
    }
    expect(binding.actionDigest).toBe(
      await digestCommerceAction({
        toolName: 'createPaymentLink',
        order,
        methodId,
        paymentMethodCollection: {
          key: collectionAuthority.collectionKey,
          revision: collectionAuthority.collectionRevision,
          providerRevision: collectionAuthority.providerRevision,
        },
      }),
    );
    expect(paymentProvider).not.toHaveBeenCalled();
    expect(orderProvider).not.toHaveBeenCalled();

    const signingSecret =
      'opaque-payment-e2e-signing-secret-at-least-thirty-two-bytes';
    const receipt = await createCommerceApprovalReceipt({
      binding,
      secret: signingSecret,
    });
    const providerIdempotencyKey =
      `confirmation:${receipt.receiptId}:payment:e2e`;
    const preclaimedExecution =
      await createCommerceApprovalExecutionFence({
        secret: signingSecret,
        claim: {
          schemaVersion: 'kfc-commerce-approval-execution-v1',
          operation: 'confirmation_resume',
          requestId: receipt.receiptId,
          expectedSessionGeneration: 0,
          sessionAuthorityGeneration: 0,
          checkpointThreadId: 'payment-selection-e2e-thread',
          checkpointNamespace: '',
          checkpointId: 'payment-selection-e2e-checkpoint',
          bindingFingerprint: await digestCommerceAction({
            binding,
            providerIdempotencyKey,
          }),
          approvalBindingDigest:
            await digestCommerceAction(binding),
          providerIdempotencyKey,
          attempt: 1,
          leaseToken: crypto.randomUUID(),
        },
      });
    await expect(executeAgentToolCall(
      clients,
      {
        toolName: 'createPaymentLink',
        arguments: { methodId },
      },
      {
        state: graphOutput.state,
        order,
        accessContext: paymentWriteAccess,
        externalCallContext: externalCallContext(),
        approval: {
          principal,
          receipt,
          signingSecret,
          preclaimedExecution,
        },
        runGuard: {
          isCurrent: async () => true,
          recordIrreversibleBoundary: async () => undefined,
        },
      },
    )).resolves.toMatchObject({
      ok: true,
      toolName: 'createPaymentLink',
      value: {
        orderId: order.id,
        url:
          `https://pay.mock/method-${encodeURIComponent(methodId)}/` +
          `order-${encodeURIComponent(order.id)}`,
        status: 'pending',
      },
    });
    expect(paymentProvider).toHaveBeenCalledTimes(1);
    expect(paymentProvider.mock.calls[0]?.[1]).toBe(methodId);
    expect(orderProvider).not.toHaveBeenCalled();
  });
});
