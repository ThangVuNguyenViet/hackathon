import {
  AIMessage,
  isSystemMessage,
  type BaseMessage,
} from '@langchain/core/messages';
import { fakeModel } from '@langchain/core/testing';
import { MemorySaver } from '@langchain/langgraph';
import { describe, expect, it, vi } from 'vitest';
import { isRecord } from '../../src/agent/agentBoundaryPolicy.js';
import {
  selectedActionResponseReferenceSchema,
  type SelectedActionResponseReference,
} from '../../src/agent/selectedActionResponseAuthority.js';
import { STRUCTURED_RESPONSE_REFERENCE_MESSAGE_ID } from '../../src/agent/structuredCustomerAction.js';
import { DashboardEventBus } from '../../src/dashboard/eventBus.js';
import {
  createTrustedCustomerActionEnvelope,
  customerCommandFromVerifiedAction,
} from '../../src/domain/customerCommand.js';
import type { Address, Cart } from '../../src/domain/types.js';
import {
  KFC_GENUI_SCHEMA_VERSION,
  digestTrustedKfcGenUiAction,
} from '../../src/genui/kfcGenUi.js';
import { runAgentTurn } from '../../src/graph/buildGraph.js';
import { stateRevision } from '../../src/graph/turnSupport.js';
import { createMockClients } from '../../src/mock/createMockClients.js';
import type {
  AgentTracer,
  AgentTraceSpan,
  AgentTraceSpanInput,
} from '../../src/observability/agentTracing.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';
import { groundedResponseModelReply } from '../fixtures/groundedResponse.js';
import { controlledCustomerAccess } from '../fixtures/controlledCustomerAccess.js';
import { createTestFixtures } from '../fixtures/testFixtures.js';

interface TraceEvent {
  phase: 'start' | 'end' | 'fail';
  name: string;
  payload: Record<string, unknown>;
}

class CaptureSpan implements AgentTraceSpan {
  constructor(
    private readonly name: string,
    private readonly events: TraceEvent[],
  ) {}

  async startSpan(input: AgentTraceSpanInput): Promise<AgentTraceSpan> {
    this.events.push({
      phase: 'start',
      name: input.name,
      payload: input.inputs,
    });
    return new CaptureSpan(input.name, this.events);
  }

  async end(outputs: Record<string, unknown> = {}): Promise<void> {
    this.events.push({
      phase: 'end',
      name: this.name,
      payload: outputs,
    });
  }

  async fail(error: unknown): Promise<void> {
    this.events.push({
      phase: 'fail',
      name: this.name,
      payload: {
        message: error instanceof Error ? error.message : String(error),
      },
    });
  }
}

class CaptureTracer implements AgentTracer {
  readonly events: TraceEvent[] = [];

  async startTurn(
    input: Omit<AgentTraceSpanInput, 'runType'>,
  ): Promise<AgentTraceSpan> {
    this.events.push({
      phase: 'start',
      name: input.name,
      payload: input.inputs,
    });
    return new CaptureSpan(input.name, this.events);
  }

  async flush(): Promise<void> {}
}

function cart(): Cart {
  return {
    id: 'stategraph-saved-address-cart',
    items: [
      {
        itemCode: '20751',
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

async function seedCart(store: MemoryStore, sessionId: string): Promise<void> {
  await store.appendEvent(sessionId, 'graph:verified_state', {
    verifiedState: {
      cart: cart(),
      toolTrace: [],
    },
  });
}

async function customerRunGuard(input: {
  store: MemoryStore;
  sessionId: string;
  customerId: string;
  externalMessageId: string;
}) {
  const runId = `saved-address-run:${input.externalMessageId}`;
  const run = await input.store.createCustomerRun({
    id: runId,
    schemaVersion: 1,
    sessionId: input.sessionId,
    customerId: input.customerId,
    clientMessageId: input.externalMessageId,
    requestFingerprint: `${runId}:fingerprint`,
    generation: 1,
    status: 'running',
    phase: 'read_only_tool',
    nextEventSequence: 1,
    clientSchemaVersion: 1,
    acceptedAt: '2026-07-20T00:00:00.000Z',
    startedAt: '2026-07-20T00:00:00.000Z',
    terminalAt: null,
    updatedAt: '2026-07-20T00:00:00.000Z',
  });
  return {
    isCurrent: async () => true,
    commitFence: {
      kind: 'customer_run' as const,
      runId,
      sessionAuthorityGeneration: run.sessionAuthorityGeneration,
    },
  };
}

function structuredActionReference(
  messages: BaseMessage[],
): SelectedActionResponseReference {
  const referenceMessage = messages.find(
    (message) =>
      isSystemMessage(message) &&
      message.id === STRUCTURED_RESPONSE_REFERENCE_MESSAGE_ID,
  );
  if (!referenceMessage || typeof referenceMessage.content !== 'string') {
    throw new Error('structured_action_reference_message_missing');
  }
  const parsed: unknown = JSON.parse(referenceMessage.content);
  if (!isRecord(parsed)) {
    throw new Error('structured_action_reference_message_invalid');
  }
  return selectedActionResponseReferenceSchema.parse(
    parsed.selectedActionResponse,
  );
}

function publishedModelState(messages: BaseMessage[]): Record<string, unknown> {
  for (const message of [...messages].reverse()) {
    if (!isSystemMessage(message) || typeof message.content !== 'string') {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(message.content);
    } catch {
      continue;
    }
    if (
      !isRecord(parsed) ||
      !isRecord(parsed.publication) ||
      !isRecord(parsed.publication.modelState)
    ) {
      continue;
    }
    const valueTable = isRecord(parsed.publication.valueTable)
      ? parsed.publication.valueTable
      : {};
    const resolveValue = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(resolveValue);
      if (!isRecord(value)) return value;
      const reference = value.__kfcPublicationValue_v1;
      if (
        isRecord(reference) &&
        reference.kind === 'reference' &&
        typeof reference.id === 'string' &&
        Object.hasOwn(valueTable, reference.id)
      ) {
        return resolveValue(valueTable[reference.id]);
      }
      return Object.fromEntries(
        Object.entries(value).map(([key, nested]) => [
          key,
          resolveValue(nested),
        ]),
      );
    };
    const resolved = resolveValue(parsed.publication.modelState);
    if (isRecord(resolved)) return resolved;
  }
  throw new Error('model_publication_state_missing');
}

function structuredGroundedResponse(messages: BaseMessage[]): AIMessage {
  return groundedResponseModelReply({
    customerText: 'Please review the verified result.',
    selectedActionResponse: structuredActionReference(messages),
  })(messages);
}

async function serializedCheckpointHistory(
  checkpointer: MemorySaver,
): Promise<string> {
  const history: unknown[] = [];
  for await (const tuple of checkpointer.list({ configurable: {} })) {
    history.push({
      checkpoint: tuple.checkpoint.channel_values,
      pendingWrites: tuple.pendingWrites,
    });
  }
  return JSON.stringify(history);
}

describe('maintained StateGraph saved-address invariants', () => {
  it('reuses one opaque saved-address read across text turns without publishing private address data', async () => {
    const savedAddress: Address = {
      label: 'Text-only private label Ψ-31',
      line1: 'Text-only private street Ψ-31',
      district: 'Quận 7',
      city: 'Hồ Chí Minh',
    };
    const sessionId = 'kfc:stategraph-saved-address-text-ref';
    const customerId = 'stategraph-saved-address-text-customer';
    const store = new MemoryStore();
    const checkpointer = new MemorySaver();
    const dashboard = new DashboardEventBus();
    const tracer = new CaptureTracer();
    await seedCart(store, sessionId);

    const savedAddressesProvider = vi.fn(() => ({
      ok: true as const,
      value: [savedAddress],
      message: 'text-private-saved-address-provider-prose',
    }));
    const fulfillmentQuoteProvider = vi.fn(
      (_input: {
        address: Address;
        method: 'delivery' | 'pickup';
        itemCodes: string[];
        storeId: string;
        storeName: string;
      }) => ({
        ok: true as const,
        value: {
          feeVnd: 18_000,
          etaMinutes: 45,
        },
        message: `text-private-fulfillment-provider-prose ${savedAddress.line1}`,
      }),
    );
    const clients = createMockClients(createTestFixtures(), {
      savedAddressesProvider,
      fulfillmentQuoteProvider,
    });
    const accessContext = controlledCustomerAccess({
      sessionId,
      customerId,
    });
    const addressReadModel = fakeModel()
      .respondWithTools([
        {
          name: 'getSavedAddresses',
          args: {},
        },
      ])
      .respondWithTools([
        {
          name: 'updateCart',
          args: {
            changes: [
              {
                itemCode: '20751',
                quantity: 2,
                modifiers: [],
              },
            ],
          },
        },
      ])
      .respond(
        groundedResponseModelReply({
          customerText:
            'I updated the cart and found one saved delivery option to review.',
        }),
      );

    const candidateTurn = await runAgentTurn({
      sessionId,
      customerId,
      channel: 'kfc',
      responseProfile: 'social',
      text: 'Please check whether I have a saved delivery destination.',
      externalMessageId: 'saved-address-text-candidate-message',
      accessContext,
      clients,
      store,
      dashboard,
      checkpointer,
      agentModel: addressReadModel,
      tracer,
      runGuard: await customerRunGuard({
        store,
        sessionId,
        customerId,
        externalMessageId: 'saved-address-text-candidate-message',
      }),
    });
    const pendingRef = candidateTurn.state.pendingSavedAddressRef;
    if (pendingRef?.kind !== 'saved_address') {
      throw new Error('text_saved_address_ref_missing');
    }

    expect(savedAddressesProvider).toHaveBeenCalledOnce();
    expect(candidateTurn.genUi).toBeUndefined();
    expect(candidateTurn.state.address).toBeUndefined();
    expect(candidateTurn.state.customerContext).toBeUndefined();
    expect(candidateTurn.state.cart?.items[0]?.quantity).toBe(2);
    expect(addressReadModel.callCount).toBe(3);
    const candidateEvents = JSON.stringify(await store.listEvents(sessionId));
    expect(candidateEvents).toContain(pendingRef.id);
    expect(candidateEvents).not.toContain(savedAddress.line1);
    expect(JSON.stringify(await store.listTurns(sessionId))).not.toContain(
      savedAddress.line1,
    );

    const quoteModel = fakeModel()
      .respond((messages) => {
        const published = publishedModelState(messages);
        expect(published.pendingSavedAddressRef).toEqual(pendingRef);
        expect(published.cart).toMatchObject({
          id: cart().id,
          items: [
            expect.objectContaining({
              itemCode: '20751',
              quantity: 2,
            }),
          ],
        });
        expect(JSON.stringify(messages)).not.toContain(savedAddress.line1);
        return new AIMessage({
          content: '',
          tool_calls: [
            {
              name: 'quoteFulfillment',
              args: {
                savedAddressRef: published.pendingSavedAddressRef,
                method: 'delivery',
              },
              id: 'saved-address-reloaded-quote',
              type: 'tool_call',
            },
          ],
        });
      })
      .respond((messages) => {
        expect(JSON.stringify(messages)).not.toContain(savedAddress.line1);
        return groundedResponseModelReply({
          customerText: 'The verified delivery quote is ready.',
        })(messages);
      });
    const quotedTurn = await runAgentTurn({
      sessionId,
      customerId,
      channel: 'kfc',
      responseProfile: 'social',
      text: 'Use that saved destination and quote delivery.',
      externalMessageId: 'saved-address-text-quote-message',
      accessContext,
      clients,
      store,
      dashboard,
      checkpointer,
      agentModel: quoteModel,
      tracer,
      runGuard: await customerRunGuard({
        store,
        sessionId,
        customerId,
        externalMessageId: 'saved-address-text-quote-message',
      }),
    });

    expect(savedAddressesProvider).toHaveBeenCalledOnce();
    expect(fulfillmentQuoteProvider).toHaveBeenCalledOnce();
    expect(fulfillmentQuoteProvider.mock.calls[0]?.[0]).toMatchObject({
      address: savedAddress,
      method: 'delivery',
      itemCodes: ['20751'],
    });
    expect(quotedTurn.state.address).toEqual(savedAddress);
    expect(quotedTurn.state.pendingSavedAddressRef).toBeUndefined();
    expect(quotedTurn.state.fulfillment).toMatchObject({
      method: 'delivery',
      disposition: 'delivery',
    });
    expect(quotedTurn.state.toolTrace?.map(({ toolName }) => toolName)).toEqual(
      ['getSavedAddresses', 'updateCart', 'quoteFulfillment'],
    );
    expect(
      quotedTurn.state.toolTrace?.find(
        ({ toolName }) => toolName === 'quoteFulfillment',
      )?.arguments,
    ).toEqual({
      savedAddressRef: pendingRef,
      method: 'delivery',
    });
    expect(
      quotedTurn.state.toolTrace?.find(
        ({ toolName }) => toolName === 'quoteFulfillment',
      )?.resultSummary,
    ).toBe('fulfillment_quote_observed');
    expect(JSON.stringify(await store.listTurns(sessionId))).not.toContain(
      savedAddress.line1,
    );
    expect(JSON.stringify(await store.listEvents(sessionId))).not.toContain(
      savedAddress.line1,
    );
    expect(JSON.stringify(dashboard.getEvents(sessionId))).not.toContain(
      savedAddress.line1,
    );
  });

  it('sanitizes saved-address provider failures before tracing and application-durable boundaries', async () => {
    const savedAddress: Address = {
      label: 'Failure-only private label Φ-41',
      line1: 'Failure-only private street Φ-41',
      district: 'Quận 7',
      city: 'Hồ Chí Minh',
    };
    const rawProviderFailure = `provider exploded for ${savedAddress.line1}`;
    const sessionId = 'kfc:stategraph-saved-address-provider-failure';
    const customerId = 'stategraph-saved-address-provider-failure-customer';
    const store = new MemoryStore();
    const checkpointer = new MemorySaver();
    const dashboard = new DashboardEventBus();
    const tracer = new CaptureTracer();
    await seedCart(store, sessionId);

    const clients = createMockClients(createTestFixtures(), {
      savedAddressesProvider: () => ({
        ok: true,
        value: [savedAddress],
        message: 'failure-case-private-saved-address-prose',
      }),
      fulfillmentQuoteProvider: () => {
        throw new Error(rawProviderFailure);
      },
    });
    const accessContext = controlledCustomerAccess({
      sessionId,
      customerId,
    });
    const candidateModel = fakeModel()
      .respondWithTools([
        {
          name: 'getSavedAddresses',
          args: {},
        },
      ])
      .respond(
        groundedResponseModelReply({
          customerText: 'I found one saved delivery option to review.',
        }),
      );
    const candidate = await runAgentTurn({
      sessionId,
      customerId,
      channel: 'kfc',
      responseProfile: 'social',
      text: 'Check my saved delivery destination.',
      externalMessageId: 'saved-address-provider-failure-candidate',
      accessContext,
      clients,
      store,
      dashboard,
      checkpointer,
      agentModel: candidateModel,
      tracer,
      runGuard: await customerRunGuard({
        store,
        sessionId,
        customerId,
        externalMessageId: 'saved-address-provider-failure-candidate',
      }),
    });
    const pendingRef = candidate.state.pendingSavedAddressRef;
    if (pendingRef?.kind !== 'saved_address') {
      throw new Error('failure_case_saved_address_ref_missing');
    }

    const quoteModel = fakeModel().respondWithTools([
      {
        name: 'quoteFulfillment',
        args: {
          savedAddressRef: pendingRef,
          method: 'delivery',
        },
      },
    ]);
    await expect(
      runAgentTurn({
        sessionId,
        customerId,
        channel: 'kfc',
        responseProfile: 'social',
        text: 'Use that saved destination and quote delivery.',
        externalMessageId: 'saved-address-provider-failure-quote',
        accessContext,
        clients,
        store,
        dashboard,
        checkpointer,
        agentModel: quoteModel,
        tracer,
        runGuard: await customerRunGuard({
          store,
          sessionId,
          customerId,
          externalMessageId: 'saved-address-provider-failure-quote',
        }),
      }),
    ).rejects.toThrow('agent_tool_execution_failed');

    expect(tracer.events).toContainEqual({
      phase: 'fail',
      name: 'tool_call:quoteFulfillment',
      payload: { message: 'fulfillment_quote_failed' },
    });
    const quoteSpanStart = tracer.events.find(
      (event) =>
        event.phase === 'start' && event.name === 'tool_call:quoteFulfillment',
    );
    expect(quoteSpanStart?.payload).toEqual({
      toolName: 'quoteFulfillment',
      boundary: 'fulfillment',
      argumentsRedacted: true,
      argumentsDigest: await stateRevision({
        savedAddressRef: pendingRef,
        method: 'delivery',
      }),
      addressSource: 'saved_address_ref',
      method: 'delivery',
    });
    expect(JSON.stringify(quoteSpanStart?.payload)).not.toContain(
      pendingRef.id,
    );
    const durableApplicationArtifacts = JSON.stringify({
      events: await store.listEvents(sessionId),
      turns: await store.listTurns(sessionId),
      dashboard: dashboard.getEvents(sessionId),
    });
    for (const privateValue of [
      savedAddress.label,
      savedAddress.line1,
      rawProviderFailure,
      'failure-case-private-saved-address-prose',
    ]) {
      expect(durableApplicationArtifacts).not.toContain(privateValue);
    }
  });

  it('presents an authenticated saved-address read as an unconfirmed candidate, then accepts and quotes that exact candidate', async () => {
    const savedAddress: Address = {
      label: 'Provider label Ω-17',
      line1: 'Private provider street Ω-17',
      district: 'Quận 7',
      city: 'Hồ Chí Minh',
    };
    const sessionId = 'kfc:stategraph-saved-address-candidate';
    const customerId = 'stategraph-saved-address-customer';
    const store = new MemoryStore();
    const checkpointer = new MemorySaver();
    await seedCart(store, sessionId);

    const savedAddressesProvider = vi.fn(() => ({
      ok: true as const,
      value: [savedAddress],
      message: 'provider-private-saved-address-prose',
    }));
    const clients = createMockClients(createTestFixtures(), {
      savedAddressesProvider,
      fulfillmentQuoteProvider: () => ({
        ok: true,
        value: {
          feeVnd: 18_000,
          etaMinutes: 30,
        },
        message: 'provider-private-fulfillment-prose',
      }),
    });
    const quoteFulfillment = vi.spyOn(clients.fulfillment, 'quoteFulfillment');
    const baseModel = fakeModel()
      .respondWithTools([
        {
          name: 'getSavedAddresses',
          args: {},
        },
      ])
      .respond(
        groundedResponseModelReply({
          customerText: 'Please review the available delivery option.',
        }),
      )
      .respond(structuredGroundedResponse);
    const accessContext = controlledCustomerAccess({
      sessionId,
      customerId,
    });

    const candidateTurn = await runAgentTurn({
      sessionId,
      customerId,
      channel: 'kfc',
      responseProfile: 'genui',
      text: 'Can I use a saved delivery destination?',
      externalMessageId: 'saved-address-candidate-message',
      accessContext,
      clients,
      store,
      dashboard: new DashboardEventBus(),
      checkpointer,
      agentModel: baseModel,
      runGuard: await customerRunGuard({
        store,
        sessionId,
        customerId,
        externalMessageId: 'saved-address-candidate-message',
      }),
    });

    expect(baseModel.callCount).toBe(2);
    expect(savedAddressesProvider).toHaveBeenCalledOnce();
    expect(candidateTurn.state.address).toBeUndefined();
    expect(candidateTurn.state.fulfillment).toBeUndefined();
    expect(candidateTurn.state.customerContext).toBeUndefined();
    expect(candidateTurn.genUi).toMatchObject({
      widgetKind: 'addressFulfillmentCheck',
      data: {
        address: savedAddress,
        addressStatus: 'candidate',
        fulfillment: null,
      },
      actions: expect.arrayContaining([
        expect.objectContaining({
          id: 'accept_fulfillment',
          intent: 'primary',
        }),
      ]),
    });
    if (!candidateTurn.genUi?.authority || !candidateTurn.assistantTurnId) {
      throw new Error('saved_address_candidate_authority_missing');
    }
    const selectedAction = {
      attachmentId: candidateTurn.genUi.id,
      actionId: 'accept_fulfillment',
      value: candidateTurn.genUi.actions.find(
        ({ id }) => id === 'accept_fulfillment',
      )?.value,
    };
    const selectedCommand = customerCommandFromVerifiedAction(selectedAction);
    if (
      selectedCommand?.kind !== 'accept_fulfillment' ||
      !selectedCommand.savedAddressRef
    ) {
      throw new Error('saved_address_candidate_ref_missing');
    }
    expect(selectedAction.value).toBe(selectedCommand.savedAddressRef.id);
    expect(selectedAction.value).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
    expect(JSON.stringify(selectedAction)).not.toContain(savedAddress.line1);
    const actionDigest = await digestTrustedKfcGenUiAction({
      attachment: candidateTurn.genUi,
      assistantTurnId: candidateTurn.assistantTurnId,
      action: selectedAction,
    });

    const acceptedTurn = await runAgentTurn({
      sessionId,
      customerId,
      channel: 'kfc',
      responseProfile: 'genui',
      text: '',
      externalMessageId: 'saved-address-accept-message',
      accessContext,
      clients,
      store,
      dashboard: new DashboardEventBus(),
      checkpointer,
      agentModel: baseModel,
      runGuard: await customerRunGuard({
        store,
        sessionId,
        customerId,
        externalMessageId: 'saved-address-accept-message',
      }),
      trustedCustomerAction: createTrustedCustomerActionEnvelope({
        source: 'kfc_genui_action',
        assistantTurnId: candidateTurn.assistantTurnId,
        attachmentId: candidateTurn.genUi.id,
        actionDigest,
        verifiedRevision: candidateTurn.genUi.authority.verifiedRevision,
        lifecycle: 'one_shot',
        command: selectedCommand,
      }),
    });

    expect(baseModel.callCount).toBe(3);
    expect(quoteFulfillment).toHaveBeenCalledOnce();
    expect(quoteFulfillment.mock.calls[0]?.[0]).toEqual({
      address: savedAddress,
      method: 'delivery',
      itemCodes: ['20751'],
    });
    expect(acceptedTurn.state.address).toEqual(savedAddress);
    expect(acceptedTurn.state.fulfillment).toMatchObject({
      method: 'delivery',
      disposition: 'delivery',
    });
    expect(acceptedTurn.state.orderPreview).toBeUndefined();
    expect(acceptedTurn.state.order).toBeUndefined();
    expect(acceptedTurn.responseText).not.toContain(savedAddress.line1);
    expect(
      acceptedTurn.state.toolTrace?.map(({ toolName }) => toolName),
    ).toEqual(
      expect.arrayContaining(['getSavedAddresses', 'quoteFulfillment']),
    );
    expect(
      acceptedTurn.state.toolTrace?.map(({ toolName }) => toolName),
    ).not.toEqual(expect.arrayContaining(['previewOrder', 'placeOrder']));
    expect(
      acceptedTurn.state.toolTrace?.find(
        ({ toolName }) => toolName === 'quoteFulfillment',
      )?.arguments,
    ).toEqual({
      savedAddressRef: selectedCommand.savedAddressRef,
      method: 'delivery',
    });
    const turns = await store.listTurns(sessionId);
    expect(turns.filter(({ role }) => role === 'user')).toEqual([
      expect.objectContaining({
        text: 'Can I use a saved delivery destination?',
        externalMessageId: 'saved-address-candidate-message',
      }),
      expect.objectContaining({
        text: '',
        externalMessageId: 'saved-address-accept-message',
        metadata: {
          responseProfile: 'genui',
          rawEvent: {
            source: 'kfc_genui_action',
            schemaVersion: KFC_GENUI_SCHEMA_VERSION,
            assistantTurnId: candidateTurn.assistantTurnId,
            verifiedRevision: candidateTurn.genUi.authority.verifiedRevision,
            actionDigest,
          },
        },
      }),
    ]);
    expect(JSON.stringify(turns.map(({ metadata }) => metadata))).not.toContain(
      'customerCommand',
    );
    const candidatePersistedTurn = turns.find(
      ({ id }) => id === candidateTurn.assistantTurnId,
    );
    expect(candidatePersistedTurn?.metadata?.genUi).toMatchObject({
      widgetKind: 'addressFulfillmentCheck',
      data: {
        addressStatus: 'candidate',
        fulfillment: null,
      },
      actions: expect.arrayContaining([
        expect.objectContaining({
          id: 'accept_fulfillment',
          value: selectedCommand.savedAddressRef.id,
        }),
      ]),
    });
    expect(candidatePersistedTurn?.metadata?.genUi?.data).not.toHaveProperty(
      'address',
    );
    const serializedMetadata = JSON.stringify(
      turns.map(({ metadata }) => metadata),
    );
    const serializedEvents = JSON.stringify(await store.listEvents(sessionId));
    const serializedCheckpoints =
      await serializedCheckpointHistory(checkpointer);
    for (const privateValue of [
      savedAddress.label,
      savedAddress.line1,
      'provider-private-saved-address-prose',
      'provider-private-fulfillment-prose',
    ]) {
      expect(serializedMetadata).not.toContain(privateValue);
      expect(serializedEvents).not.toContain(privateValue);
      expect(serializedCheckpoints).not.toContain(privateValue);
    }
    expect(serializedCheckpoints).toContain(selectedCommand.savedAddressRef.id);
  });

  it('asks for model-authored clarification when multiple private addresses have no safe discriminator', async () => {
    const savedAddresses: Address[] = [
      {
        label: 'Private first label Θ-11',
        line1: 'Private first street Θ-11',
        district: 'Quận 5',
        city: 'Hồ Chí Minh',
      },
      {
        label: 'Private second label Θ-22',
        line1: 'Private second street Θ-22',
        district: 'Quận 7',
        city: 'Hồ Chí Minh',
      },
    ];
    const sessionId = 'kfc:stategraph-saved-address-ambiguous';
    const customerId = 'stategraph-saved-address-ambiguous-customer';
    const externalMessageId = 'saved-address-ambiguous-message';
    const store = new MemoryStore();
    const checkpointer = new MemorySaver();
    await seedCart(store, sessionId);
    const savedAddressesProvider = vi.fn(() => ({
      ok: true as const,
      value: savedAddresses,
      message: 'multiple-private-addresses-observed',
    }));
    const clients = createMockClients(createTestFixtures(), {
      savedAddressesProvider,
    });
    const clarification =
      'I found multiple saved delivery options. Which one would you like to use?';
    let modelMessages = '';
    const agentModel = fakeModel()
      .respondWithTools([
        {
          name: 'getSavedAddresses',
          args: {},
        },
      ])
      .respond((messages) => {
        modelMessages = JSON.stringify(messages);
        return groundedResponseModelReply({
          customerText: clarification,
        })(messages);
      });

    const output = await runAgentTurn({
      sessionId,
      customerId,
      channel: 'kfc',
      responseProfile: 'social',
      text: 'Please use one of my saved delivery destinations.',
      externalMessageId,
      accessContext: controlledCustomerAccess({
        sessionId,
        customerId,
      }),
      clients,
      store,
      dashboard: new DashboardEventBus(),
      checkpointer,
      agentModel,
      runGuard: await customerRunGuard({
        store,
        sessionId,
        customerId,
        externalMessageId,
      }),
    });

    expect(savedAddressesProvider).toHaveBeenCalledOnce();
    expect(modelMessages).toContain('\\"savedAddressCount\\":2');
    for (const address of savedAddresses) {
      expect(modelMessages).not.toContain(address.label);
      expect(modelMessages).not.toContain(address.line1);
    }
    expect(output.responseText).toBe(clarification);
    expect(output.state.pendingSavedAddressRef).toBeUndefined();
    expect(output.state.address).toBeUndefined();
    expect(output.state.fulfillment).toBeUndefined();
    expect(output.state.toolTrace?.map(({ toolName }) => toolName)).toEqual([
      'getSavedAddresses',
    ]);
    const durableArtifacts = JSON.stringify({
      events: await store.listEvents(sessionId),
      turns: await store.listTurns(sessionId),
      checkpoints: await serializedCheckpointHistory(checkpointer),
    });
    for (const address of savedAddresses) {
      expect(durableArtifacts).not.toContain(address.label);
      expect(durableArtifacts).not.toContain(address.line1);
    }
  });

  it('keeps repeated ordinary delivery turns at the address step without previewing or placing an order', async () => {
    const sessionId = 'kfc:stategraph-repeated-delivery';
    const customerId = 'stategraph-repeated-delivery-customer';
    const store = new MemoryStore();
    const checkpointer = new MemorySaver();
    await seedCart(store, sessionId);

    const savedAddressesProvider = vi.fn(() => ({
      ok: true as const,
      value: [],
      message: 'no saved addresses',
    }));
    const clients = createMockClients(createTestFixtures(), {
      savedAddressesProvider,
    });
    const previewOrder = vi.spyOn(clients.oms, 'previewOrder');
    const placeOrder = vi.spyOn(clients.oms, 'placeOrder');
    const model = fakeModel()
      .respondWithTools([
        {
          name: 'getSavedAddresses',
          args: {},
        },
      ])
      .respond(
        groundedResponseModelReply({
          customerText: 'Please provide a delivery destination.',
        }),
      )
      .respondWithTools([
        {
          name: 'getSavedAddresses',
          args: {},
        },
      ])
      .respond(
        groundedResponseModelReply({
          customerText: 'A delivery destination is still required.',
        }),
      );
    const accessContext = controlledCustomerAccess({
      sessionId,
      customerId,
    });

    for (const [index, text] of [
      'Please arrange delivery for this cart.',
      'I still want this cart delivered.',
    ].entries()) {
      const output = await runAgentTurn({
        sessionId,
        customerId,
        channel: 'kfc',
        responseProfile: 'genui',
        text,
        externalMessageId: `repeated-delivery-message-${index}`,
        accessContext,
        clients,
        store,
        dashboard: new DashboardEventBus(),
        checkpointer,
        agentModel: model,
      });

      expect(output.state.address).toBeUndefined();
      expect(output.state.fulfillment).toBeUndefined();
      expect(output.state.orderPreview).toBeUndefined();
      expect(output.state.order).toBeUndefined();
      expect(output.genUi).toMatchObject({
        widgetKind: 'addressFulfillmentCheck',
        data: {
          address: null,
          addressStatus: 'missing',
          fulfillment: null,
        },
      });
      expect(
        output.state.toolTrace?.map(({ toolName }) => toolName),
      ).not.toEqual(expect.arrayContaining(['previewOrder', 'placeOrder']));
    }

    expect(model.callCount).toBe(4);
    expect(savedAddressesProvider).toHaveBeenCalledTimes(2);
    expect(previewOrder).not.toHaveBeenCalled();
    expect(placeOrder).not.toHaveBeenCalled();
  });
});
