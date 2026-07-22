import {
  AIMessage,
  isSystemMessage,
  type BaseMessage,
} from '@langchain/core/messages';
import { fakeModel } from '@langchain/core/testing';
import { Command, MemorySaver } from '@langchain/langgraph';
import { describe, expect, it, vi } from 'vitest';
import { createKfcAgentStateGraph } from '../../src/agent/agentStateGraph.js';
import {
  selectedActionResponseReferenceSchema,
  type SelectedActionResponseReference,
} from '../../src/agent/selectedActionResponseAuthority.js';
import { STRUCTURED_RESPONSE_REFERENCE_MESSAGE_ID } from '../../src/agent/structuredCustomerAction.js';
import {
  createAgentTurnExternalCallScope,
  type SingleAgentRuntimeContext,
} from '../../src/agent/singleAgentRuntime.js';
import { DashboardEventBus } from '../../src/dashboard/eventBus.js';
import { createTrustedCustomerActionEnvelope } from '../../src/domain/customerCommand.js';
import type { CustomerAccessScope } from '../../src/domain/types.js';
import { kfcGenUiVerifiedStateRevision } from '../../src/genui/kfcGenUi.js';
import { runAgentTurn } from '../../src/graph/buildGraph.js';
import type { ResponseProfile } from '../../src/presentation/responseProfile.js';
import { toolExecutionContext } from '../../src/graph/turnSupport.js';
import { createMockClients } from '../../src/mock/createMockClients.js';
import { createNoopAgentTracer } from '../../src/observability/agentTracing.js';
import { buildCurrentAgentApprovalBinding } from '../../src/ordering/agentToolExecutor.js';
import {
  createCommerceApprovalReceipt,
  digestCommerceAction,
} from '../../src/ordering/approvalReceipt.js';
import { createCommerceApprovalExecutionFence } from '../../src/ordering/approvalExecutionFence.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';
import {
  groundedResponseClaims,
  groundedResponseModelReply,
} from '../fixtures/groundedResponse.js';
import { controlledCustomerAccess } from '../fixtures/controlledCustomerAccess.js';
import { createTestFixtures } from '../fixtures/testFixtures.js';

function turnInput(
  model: ReturnType<typeof fakeModel>,
  sessionId: string,
  responseProfile?: ResponseProfile,
) {
  return {
    sessionId,
    customerId: 'selected-action-customer',
    channel: 'kfc' as const,
    text: 'Execute the selected typed action',
    externalMessageId: `${sessionId}-message`,
    checkpointRunId: `${sessionId}-checkpoint`,
    clients: createMockClients(createTestFixtures()),
    store: new MemoryStore(),
    dashboard: new DashboardEventBus(),
    checkpointer: new MemorySaver(),
    agentModel: model,
    ...(responseProfile ? { responseProfile } : {}),
  };
}

async function seedTrustedActionSourceTurn(
  input: ReturnType<typeof turnInput>,
): Promise<void> {
  await input.store.appendTurn({
    sessionId: input.sessionId,
    channel: input.channel,
    role: 'user',
    text: 'Show the current verified commerce surface.',
    externalMessageId: `${input.externalMessageId}-source`,
    externalUserId: input.customerId,
    deliveryStatus: 'received',
    metadata: input.responseProfile
      ? { responseProfile: input.responseProfile }
      : null,
  });
}

function verifiedCart() {
  return {
    id: 'cart-selected-action',
    items: [
      {
        itemCode: 'item/provider-20751',
        name: 'Verified item',
        quantity: 1,
        unitPriceVnd: 99_000,
      },
    ],
    subtotalVnd: 99_000,
    discountVnd: 0,
    deliveryFeeVnd: 0,
    totalVnd: 99_000,
    voucherCode: null,
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

function structuredGroundedResponse(
  messages: BaseMessage[],
  customerText: string,
): AIMessage {
  return groundedResponseModelReply({
    customerText,
    selectedActionResponse: structuredActionReference(messages),
  })(messages);
}

function bindResponseOnlyModel(
  baseModel: ReturnType<typeof fakeModel>,
  responseModel: ReturnType<typeof fakeModel>,
) {
  const planningModel = fakeModel().respond(
    new AIMessage('planning must not run'),
  );
  vi.spyOn(baseModel, 'bindTools').mockImplementation((tools) => {
    const names = (tools as Array<{ name?: string }>).flatMap(({ name }) =>
      name ? [name] : [],
    );
    return (names.length === 0 ? responseModel : planningModel) as ReturnType<
      NonNullable<typeof baseModel.bindTools>
    >;
  });
  return planningModel;
}

async function invokeGraphDirect(
  turnInput: SingleAgentRuntimeContext['turnInput'],
) {
  const turnTrace = await createNoopAgentTracer().startTurn({
    name: 'selected_action_direct_graph',
    inputs: {},
  });
  const scope = createAgentTurnExternalCallScope(1_000);
  try {
    return await createKfcAgentStateGraph({
      model: turnInput.agentModel!,
      checkpointer: turnInput.checkpointer!,
      resolveRuntime: async () => ({
        turnInput,
        turnTrace,
        externalCallContext: scope.context,
        abortExternalCalls: scope.abort,
        disposeExternalCalls: scope.dispose,
      }),
    }).invoke(
      {
        sessionId: turnInput.sessionId,
        customerId: turnInput.customerId,
        channel: turnInput.channel,
        text: turnInput.text,
        externalMessageId: turnInput.externalMessageId ?? null,
        metadata: turnInput.metadata ?? null,
        messages: [],
      },
      {
        configurable: { thread_id: turnInput.externalMessageId },
      },
    );
  } finally {
    scope.dispose();
  }
}

describe('selected action StateGraph response authority', () => {
  it('accepts a graph-verified read with exact opaque Unicode identities', async () => {
    const baseModel = fakeModel();
    let selectedActionResponse: SelectedActionResponseReference | undefined;
    const responseModel = fakeModel().respond((messages) => {
      selectedActionResponse = structuredActionReference(messages);
      return structuredGroundedResponse(
        messages,
        'The verified payment choices are ready.',
      );
    });
    const planningModel = bindResponseOnlyModel(baseModel, responseModel);
    const input = turnInput(baseModel, 'selected-action-read-unicode');
    await seedTrustedActionSourceTurn(input);
    const forbiddenSyntheticInput =
      'SYNTHETIC_ACTION_TEXT_MUST_NOT_REACH_MODEL_OR_TRANSCRIPT';
    const envelope = createTrustedCustomerActionEnvelope({
      source: 'kfc_genui_action',
      assistantTurnId: 'trợ-lý/Đơn-Σ-🧾',
      attachmentId: 'đính-kèm/Thanh-toán-東京',
      actionDigest: 'd'.repeat(64),
      verifiedRevision: kfcGenUiVerifiedStateRevision({}),
      lifecycle: 'one_shot',
      command: { kind: 'change_payment_method' },
    });

    const output = await runAgentTurn({
      ...input,
      text: forbiddenSyntheticInput,
      trustedCustomerAction: envelope,
    });

    expect(planningModel.callCount).toBe(0);
    expect(responseModel.callCount).toBe(1);
    const responsePrompt =
      responseModel.calls[0]?.messages
        .map((message) => message.text)
        .join('\n') ?? '';
    expect(responsePrompt).not.toContain(forbiddenSyntheticInput);
    expect(responsePrompt).not.toContain('Current customer message:');
    expect(responsePrompt).toContain(
      '"presentationMode":"structured_companion"',
    );
    expect(output.state.toolTrace?.at(-1)).toMatchObject({
      toolName: 'listPaymentMethods',
      ok: true,
    });
    expect(selectedActionResponse).toMatchObject({
      actionDigest: envelope.actionDigest,
      selection: {
        entityIds: expect.arrayContaining([
          'assistant_turn:trợ-lý/Đơn-Σ-🧾',
          'attachment:đính-kèm/Thanh-toán-東京',
        ]),
        verifiedRevision: envelope.verifiedRevision,
      },
      effect: { outcome: 'tool_succeeded' },
      assertion: 'outcome_acknowledged',
    });
    const turns = await input.store.listTurns(input.sessionId);
    expect(turns.filter(({ role }) => role === 'user')).toEqual([
      expect.objectContaining({
        text: 'Show the current verified commerce surface.',
      }),
      expect.objectContaining({
        text: '',
        metadata: expect.objectContaining({
          rawEvent: expect.objectContaining({
            source: 'kfc_genui_action',
            assistantTurnId: envelope.assistantTurnId,
            actionDigest: envelope.actionDigest,
          }),
        }),
      }),
    ]);
    expect(turns.map(({ text }) => text)).not.toContain(
      forbiddenSyntheticInput,
    );
    expect(turns).toContainEqual(
      expect.objectContaining({
        role: 'assistant',
        text: 'The verified payment choices are ready.',
      }),
    );
  });

  it('accepts a revalidated rejection without claiming a mutation', async () => {
    const baseModel = fakeModel();
    let selectedActionResponse: SelectedActionResponseReference | undefined;
    const responseModel = fakeModel().respond((messages) => {
      selectedActionResponse = structuredActionReference(messages);
      return structuredGroundedResponse(
        messages,
        'The selected payment action remains unexecuted.',
      );
    });
    const planningModel = bindResponseOnlyModel(baseModel, responseModel);
    const input = turnInput(
      baseModel,
      'selected-action-rejection-unicode',
      'social',
    );
    await seedTrustedActionSourceTurn(input);
    const cart = verifiedCart();
    const order = {
      id: 'order/不透明-🧾',
      cart,
      status: 'created' as const,
      paymentStatus: 'not_started' as const,
      assignedStoreId: 'store/opaque-東京',
      createdAt: '2026-07-20T00:00:00.000Z',
    };
    const paymentMethod = createTestFixtures().paymentMethods[0]!;
    const paymentCollectionKey = 'payment/collection-東京';
    const paymentProviderRevision =
      input.clients.confirmationAuthority!.providerRevision;
    const selectedPaymentMethod = {
      methodId: paymentMethod.methodId,
      collectionKey: paymentCollectionKey,
      collectionRevision: 'payment/collection-revision-Σ',
      providerRevision: paymentProviderRevision,
    };
    const verifiedState = {
      cart,
      order,
      selectedPaymentMethod,
      paymentMethodEvidence: [paymentMethod],
      activeCollectionKeys: {
        listPaymentMethods: paymentCollectionKey,
      },
      verifiedCollections: {
        listPaymentMethods: {
          [paymentCollectionKey]: {
            key: paymentCollectionKey,
            revision: selectedPaymentMethod.collectionRevision,
            providerRevision: selectedPaymentMethod.providerRevision,
            result: {
              items: [paymentMethod],
              total: 1,
              returned: 1,
              complete: true,
              scope: { scope: 'all' as const },
            },
          },
        },
      },
      toolTrace: [],
    };
    await input.store.appendEvent(input.sessionId, 'graph:verified_state', {
      verifiedState,
    });
    const envelope = createTrustedCustomerActionEnvelope({
      source: 'kfc_genui_action',
      assistantTurnId: 'trợ-lý/Từ-chối-Σ',
      attachmentId: 'đính-kèm/拒否-🧾',
      actionDigest: 'e'.repeat(64),
      verifiedRevision: kfcGenUiVerifiedStateRevision(verifiedState),
      lifecycle: 'one_shot',
      command: { kind: 'continue_payment' },
    });
    const accessContext = {
      ...controlledCustomerAccess({
        sessionId: input.sessionId,
        customerId: input.customerId,
        channel: input.channel,
      }),
      authorizedScopes: [
        'payment:read',
        'payment:write',
      ] satisfies CustomerAccessScope[],
    };
    const baseInput = {
      ...input,
      accessContext,
      confirmationRequestId: '00000000-0000-4000-8000-000000000731',
      trustedCustomerAction: envelope,
    };
    let currentInput: SingleAgentRuntimeContext['turnInput'] = baseInput;
    let cachedRuntime: SingleAgentRuntimeContext | undefined;
    const scopes: ReturnType<typeof createAgentTurnExternalCallScope>[] = [];
    const turnTrace = await createNoopAgentTracer().startTurn({
      name: 'selected_action_rejection_graph',
      inputs: {},
    });
    const resolveRuntime = async (): Promise<SingleAgentRuntimeContext> => {
      if (cachedRuntime) return cachedRuntime;
      const scope = createAgentTurnExternalCallScope(1_000);
      scopes.push(scope);
      const runtime: SingleAgentRuntimeContext = {
        turnInput: currentInput,
        turnTrace,
        externalCallContext: scope.context,
        abortExternalCalls: scope.abort,
        disposeExternalCalls: () => {
          scope.dispose();
          if (cachedRuntime === runtime) cachedRuntime = undefined;
        },
      };
      cachedRuntime = runtime;
      return runtime;
    };
    const graph = createKfcAgentStateGraph({
      model: baseModel,
      checkpointer: baseInput.checkpointer,
      resolveRuntime,
    });
    const config = {
      configurable: { thread_id: baseInput.externalMessageId },
    };
    const paused = await graph.invoke(
      {
        sessionId: baseInput.sessionId,
        customerId: baseInput.customerId,
        channel: baseInput.channel,
        text: baseInput.text,
        externalMessageId: baseInput.externalMessageId,
        metadata: null,
        messages: [],
      },
      config,
    );
    const pausedState = paused.domainState!;
    const action = {
      toolName: 'createPaymentLink' as const,
      arguments: { methodId: selectedPaymentMethod.methodId },
    };
    const bindingScope = createAgentTurnExternalCallScope(1_000);
    const approvalBinding = await buildCurrentAgentApprovalBinding(
      baseInput.clients,
      action,
      {
        ...toolExecutionContext(baseInput),
        approval: {
          principal: {
            sessionId: baseInput.sessionId,
            customerId: baseInput.customerId,
            channel: baseInput.channel,
            authenticatedSubject: accessContext.kfcSubjectRef,
            authenticationEvidenceRef:
              accessContext.authenticationEvidence.state === 'verified'
                ? accessContext.authenticationEvidence.evidenceRef
                : 'missing',
          },
        },
        externalCallContext: bindingScope.context,
        state: pausedState,
        cart: pausedState.cart,
        address: pausedState.address,
        order: pausedState.order,
        orderPreview: pausedState.orderPreview,
      },
    );
    bindingScope.dispose();
    if ('ok' in approvalBinding) {
      throw new Error(
        `selected_action_approval_binding_failed:${
          approvalBinding.errorCode ?? 'unknown'
        }`,
      );
    }
    const signingSecret = 'selected-action-rejection-signing-secret-32-bytes';
    const commerceReceipt = await createCommerceApprovalReceipt({
      binding: approvalBinding,
      secret: signingSecret,
      decision: 'reject',
      receiptId: baseInput.confirmationRequestId,
    });
    const approvalBindingDigest = await digestCommerceAction(approvalBinding);
    const pausedCheckpoint = await baseInput.checkpointer.getTuple(config);
    const pausedCheckpointConfig = pausedCheckpoint?.config.configurable;
    if (!pausedCheckpoint || !pausedCheckpointConfig) {
      throw new Error('paused checkpoint missing');
    }
    const executionFence = await createCommerceApprovalExecutionFence({
      secret: signingSecret,
      claim: {
        schemaVersion: 'kfc-commerce-approval-execution-v1',
        operation: 'confirmation_resume',
        requestId: commerceReceipt.receiptId,
        expectedSessionGeneration: 0,
        sessionAuthorityGeneration: 0,
        checkpointThreadId: pausedCheckpointConfig.thread_id,
        checkpointNamespace: pausedCheckpointConfig.checkpoint_ns ?? '',
        checkpointId: pausedCheckpoint.checkpoint.id,
        bindingFingerprint: approvalBindingDigest,
        approvalBindingDigest,
        providerIdempotencyKey: `confirmation:${commerceReceipt.receiptId}:payment:test`,
        attempt: 1,
        leaseToken: '00000000-0000-4000-8000-000000000732',
      },
    });
    currentInput = {
      ...baseInput,
      confirmationResume: {
        requestId: commerceReceipt.receiptId,
        approved: false,
        action,
        commerceReceipt,
        executionFence,
        signingSecret,
      },
    };
    const output = await graph.invoke(
      new Command({
        resume: { requestId: commerceReceipt.receiptId },
      }),
      config,
    );

    expect(planningModel.callCount).toBe(0);
    expect(responseModel.callCount).toBe(1);
    expect(output.domainState?.paymentAttempt).toBeUndefined();
    expect(output.domainState?.selectedPaymentMethod).toEqual(
      selectedPaymentMethod,
    );
    expect(output.output?.responseText).toBe(
      'The selected payment action remains unexecuted.',
    );
    expect(
      responseModel.calls[0]?.messages
        .map((message) => message.text)
        .join('\n') ?? '',
    ).toContain('"presentationMode":"standalone_text"');
    expect(selectedActionResponse).toMatchObject({
      actionDigest: envelope.actionDigest,
      selection: {
        entityIds: expect.arrayContaining([
          'assistant_turn:trợ-lý/Từ-chối-Σ',
          'attachment:đính-kèm/拒否-🧾',
        ]),
      },
      effect: { outcome: 'customer_rejected' },
      assertion: 'outcome_acknowledged',
    });
    scopes.at(-1)?.dispose();
  });

  it.each([
    [0, 1],
    [1, 0],
  ] as const)(
    'fails closed when the author declares prose about payment method %i is misaligned with selected method %i',
    async (claimedIndex, selectedIndex) => {
      const fixtureSet = createTestFixtures();
      const methods = fixtureSet.paymentMethods.filter(
        ({ supported }) => supported,
      );
      const selectedMethod = methods[selectedIndex]!;
      const claimedMethod = methods[claimedIndex]!;
      const baseModel = fakeModel();
      let selectedActionResponse: SelectedActionResponseReference | undefined;
      const response = (messages: BaseMessage[]) => {
        selectedActionResponse = structuredActionReference(messages);
        return groundedResponseModelReply({
          customerText: `${claimedMethod.displayName} remains a verified option.`,
          evidenceReferences: [
            {
              evidenceId: 'active_collection:listPaymentMethods',
              claimKinds: ['payment', 'status'],
            },
          ],
          publicationDeclaration: {
            semanticRelevance: 'misaligned',
            privateDataDisclosure: 'none',
            disclosureAuthorities: [],
            disclosesInternalMetadata: false,
          },
          selectedActionResponse,
        })(messages);
      };
      const responseModel = fakeModel().respond(response);
      const planningModel = bindResponseOnlyModel(baseModel, responseModel);
      const input = turnInput(
        baseModel,
        `selected-action-semantic-swap-${selectedIndex}-${claimedIndex}`,
      );
      await seedTrustedActionSourceTurn(input);
      const collectionKey = 'payment/collection-semantic-東京';
      const collectionRevision = 'payment/collection-semantic-revision-Σ';
      const providerRevision =
        input.clients.confirmationAuthority!.providerRevision;
      const verifiedState = {
        paymentMethodEvidence: methods,
        activeCollectionKeys: {
          listPaymentMethods: collectionKey,
        },
        verifiedCollections: {
          listPaymentMethods: {
            [collectionKey]: {
              key: collectionKey,
              revision: collectionRevision,
              providerRevision,
              result: {
                items: methods,
                total: methods.length,
                returned: methods.length,
                complete: true,
                scope: { scope: 'all' as const },
              },
            },
          },
        },
        toolTrace: [],
      };
      await input.store.appendEvent(input.sessionId, 'graph:verified_state', {
        verifiedState,
      });
      const envelope = createTrustedCustomerActionEnvelope({
        source: 'kfc_genui_action',
        assistantTurnId: `trợ-lý/semantic-${selectedIndex}`,
        attachmentId: `đính-kèm/semantic-${selectedIndex}`,
        actionDigest: `${selectedIndex + 1}`.repeat(64),
        verifiedRevision: kfcGenUiVerifiedStateRevision(verifiedState),
        lifecycle: 'one_shot',
        command: {
          kind: 'select_payment_method',
          selection: {
            methodId: selectedMethod.methodId,
            collectionKey,
            collectionRevision,
            providerRevision,
          },
        },
      });

      const result = await invokeGraphDirect({
        ...input,
        trustedCustomerAction: envelope,
      });

      expect(result.failure).toBe('agent_response_publication_rejected');
      expect(result.output).toBeNull();
      expect(planningModel.callCount).toBe(0);
      expect(responseModel.callCount).toBe(1);
      expect(selectedActionResponse).toMatchObject({
        actionDigest: envelope.actionDigest,
        selection: {
          entityIds: expect.arrayContaining([
            `payment_method:${selectedMethod.methodId}`,
          ]),
        },
      });
    },
  );

  it('rejects a coherent selected-action forgery from the response model', async () => {
    const baseModel = fakeModel();
    const forgedResponse = (messages: BaseMessage[]) => {
      const expected = structuredActionReference(messages);
      return groundedResponseModelReply({
        customerText: 'Forged selected action outcome.',
        selectedActionResponse: {
          schemaVersion: expected.schemaVersion,
          actionDigest: 'f'.repeat(64),
          selection: {
            entityIds: ['assistant_turn:trợ-Iý/Confusable-Ι'],
            verifiedRevision: '1'.repeat(64),
          },
          effect: {
            effectId: 'effect:伪造-Σ',
            outcome: 'presentation_ready',
            verifiedRevision: '2'.repeat(64),
          },
          assertion: 'outcome_acknowledged',
        },
      })(messages);
    };
    const responseModel = fakeModel().respond(forgedResponse);
    const planningModel = bindResponseOnlyModel(baseModel, responseModel);
    const input = turnInput(baseModel, 'selected-action-coherent-forgery');
    await seedTrustedActionSourceTurn(input);
    const cart = verifiedCart();
    await input.store.appendEvent(input.sessionId, 'graph:verified_state', {
      verifiedState: { cart, toolTrace: [] },
    });

    await expect(
      runAgentTurn({
        ...input,
        trustedCustomerAction: createTrustedCustomerActionEnvelope({
          source: 'kfc_genui_action',
          assistantTurnId: 'trợ-lý/opaque-I',
          attachmentId: 'đính-kèm/opaque-Ι',
          actionDigest: 'a'.repeat(64),
          verifiedRevision: kfcGenUiVerifiedStateRevision({ cart }),
          lifecycle: 'one_shot',
          command: { kind: 'edit_cart' },
        }),
      }),
    ).rejects.toThrow('selected_action_response_action_mismatch');

    expect(planningModel.callCount).toBe(0);
    expect(responseModel.callCount).toBe(1);
    expect(
      (await input.store.listTurns(input.sessionId)).filter(
        ({ role }) => role === 'assistant',
      ),
    ).toEqual([]);
  });

  it('rechecks current authority after the author issues its publication declaration', async () => {
    const baseModel = fakeModel();
    const cart = verifiedCart();
    const input = turnInput(baseModel, 'selected-action-stale-current');
    const staleResponse = (messages: BaseMessage[]) => {
      const response = structuredGroundedResponse(
        messages,
        'This response was bound before the state changed.',
      );
      const changedCart = structuredClone(cart);
      changedCart.totalVnd += 1;
      void input.store.appendEvent(input.sessionId, 'graph:verified_state', {
        verifiedState: { cart: changedCart, toolTrace: [] },
      });
      return response;
    };
    const responseModel = fakeModel().respond(staleResponse);
    const planningModel = bindResponseOnlyModel(baseModel, responseModel);
    await seedTrustedActionSourceTurn(input);
    await input.store.appendEvent(input.sessionId, 'graph:verified_state', {
      verifiedState: { cart, toolTrace: [] },
    });

    await expect(
      runAgentTurn({
        ...input,
        trustedCustomerAction: createTrustedCustomerActionEnvelope({
          source: 'kfc_genui_action',
          assistantTurnId: 'trợ-lý/Stale-Σ',
          attachmentId: 'đính-kèm/Stale-東京',
          actionDigest: 'b'.repeat(64),
          verifiedRevision: kfcGenUiVerifiedStateRevision({ cart }),
          lifecycle: 'one_shot',
          command: { kind: 'edit_cart' },
        }),
      }),
    ).rejects.toThrow('selected_action_response_stale_outcome');

    expect(planningModel.callCount).toBe(0);
    expect(responseModel.callCount).toBe(1);
    expect(
      (await input.store.listTurns(input.sessionId)).filter(
        ({ role }) => role === 'assistant',
      ),
    ).toEqual([]);
  });
});
