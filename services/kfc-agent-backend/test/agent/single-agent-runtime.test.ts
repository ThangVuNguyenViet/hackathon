import {
  AIMessage,
  type BaseMessage,
} from '@langchain/core/messages';
import { RunnableLambda } from '@langchain/core/runnables';
import { fakeModel } from '@langchain/core/testing';
import { MemorySaver } from '@langchain/langgraph';
import { describe, expect, it, vi } from 'vitest';
import { DashboardEventBus } from '../../src/dashboard/eventBus.js';
import type {
  AgentTraceSpan,
  AgentTracer,
} from '../../src/observability/agentTracing.js';
import {
  createNoopAgentTracer,
} from '../../src/observability/agentTracing.js';
import type {
  ExternalCallContext,
  IrreversibleConfirmationBinding,
} from '../../src/clients/interfaces.js';
import {
  createAgentTurnExternalCallScope,
  loadTurnState,
} from '../../src/agent/singleAgentRuntime.js';
import {
  loadPublicationTurn,
  publicationBundle,
  publicationToolTracePrefixDigest,
  rehydratePublicationTurn,
} from '../../src/agent/agentPublicationRuntime.js';
import {
  runAgentTurn,
  type AgentTurnInput,
} from '../../src/graph/buildGraph.js';
import {
  createTrustedCustomerActionEnvelope,
} from '../../src/domain/customerCommand.js';
import type { CustomerAccessScope } from '../../src/domain/types.js';
import { createMockClients } from '../../src/mock/createMockClients.js';
import type { AppendConversationTurnInput } from '../../src/persistence/contracts.js';
import type {
  CreateConfirmationPauseInput,
} from '../../src/persistence/contracts.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';
import {
  createCommerceApprovalReceipt,
  digestCommerceAction,
} from '../../src/ordering/approvalReceipt.js';
import {
  createCommerceApprovalExecutionFence,
} from '../../src/ordering/approvalExecutionFence.js';
import type { ToolTraceEntry } from '../../src/ordering/types.js';
import { stateRevision } from '../../src/graph/turnSupport.js';
import {
  controlledCustomerAccess,
} from '../fixtures/controlledCustomerAccess.js';
import {
  groundedResponseClaims,
  groundedResponseModelReply,
  groundedResponseVerifierModel,
} from '../fixtures/groundedResponse.js';
import { createTestFixtures } from '../fixtures/testFixtures.js';

function turnInput(
  model: ReturnType<typeof fakeModel>,
  sessionId: string,
  verifierClaims = groundedResponseClaims(),
) {
  return {
    sessionId,
    customerId: 'single-agent-customer',
    channel: 'kfc' as const,
    text: 'Help with my KFC order',
    externalMessageId: `${sessionId}-message`,
    clients: createMockClients(createTestFixtures()),
    store: new MemoryStore(),
    dashboard: new DashboardEventBus(),
    checkpointer: new MemorySaver(),
    agentModel: model,
    responseVerifierModel: groundedResponseVerifierModel(verifierClaims),
  };
}

function approvalTurnInput(
  model: ReturnType<typeof fakeModel>,
  sessionId: string,
  scope: CustomerAccessScope,
) {
  const input = turnInput(model, sessionId);
  const accessContext = controlledCustomerAccess({
    sessionId,
    customerId: input.customerId,
    channel: input.channel,
  });
  accessContext.authorizedScopes.push(scope);
  return { ...input, accessContext };
}

function canonicalConfirmationRecord(
  output: Awaited<ReturnType<typeof runAgentTurn>>,
): CreateConfirmationPauseInput {
  const descriptor = Object.getOwnPropertyDescriptor(
    output.pause ?? {},
    'confirmationRecord',
  );
  const record: unknown = descriptor?.value;
  if (!isCanonicalConfirmationRecord(record)) {
    throw new Error('canonical confirmation record missing');
  }
  return record;
}

function isCanonicalConfirmationRecord(
  value: unknown,
): value is CreateConfirmationPauseInput {
  return (
    typeof value === 'object' &&
    value !== null &&
    'schemaVersion' in value &&
    value.schemaVersion === 'kfc-confirmation-pause-v1' &&
    'requestId' in value &&
    typeof value.requestId === 'string' &&
    'checkpointThreadId' in value &&
    typeof value.checkpointThreadId === 'string' &&
    'checkpointNamespace' in value &&
    typeof value.checkpointNamespace === 'string' &&
    'checkpointId' in value &&
    typeof value.checkpointId === 'string' &&
    'approvalBinding' in value &&
    typeof value.approvalBinding === 'object' &&
    value.approvalBinding !== null &&
    'approvalBindingDigest' in value &&
    typeof value.approvalBindingDigest === 'string'
  );
}

async function authenticatedRejectionResume(
  record: CreateConfirmationPauseInput,
) {
  const signingSecret =
    'single-agent-rejection-signing-secret-at-least-32-bytes';
  const commerceReceipt = await createCommerceApprovalReceipt({
    binding: record.approvalBinding,
    secret: signingSecret,
    decision: 'reject',
    receiptId: record.requestId,
  });
  const approvalBindingDigest = await digestCommerceAction(
    record.approvalBinding,
  );
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
        `confirmation:${record.requestId}:handoff:test`,
      attempt: 1,
      leaseToken: crypto.randomUUID(),
    },
  });
  const externalCallScope = createAgentTurnExternalCallScope(1_000);
  return {
    externalCallScope,
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
      externalCallContext: externalCallScope.context,
      abortExternalCalls: externalCallScope.abort,
    },
  };
}

class InterleavingMemoryStore extends MemoryStore {
  private releaseFirstPersisted!: () => void;
  private releaseSecondPersisted!: () => void;
  private readonly firstPersisted = new Promise<void>((resolve) => {
    this.releaseFirstPersisted = resolve;
  });
  private readonly secondPersisted = new Promise<void>((resolve) => {
    this.releaseSecondPersisted = resolve;
  });

  override async appendTurn(input: AppendConversationTurnInput) {
    if (
      input.role === 'user' &&
      input.externalMessageId === 'concurrent-second'
    ) {
      await this.firstPersisted;
    }
    const turn = await super.appendTurn(input);
    if (
      input.role === 'user' &&
      input.externalMessageId === 'concurrent-first'
    ) {
      this.releaseFirstPersisted();
      await this.secondPersisted;
    }
    if (
      input.role === 'user' &&
      input.externalMessageId === 'concurrent-second'
    ) {
      this.releaseSecondPersisted();
    }
    return turn;
  }
}

function recordedPrompt(model: ReturnType<typeof fakeModel>): string {
  return model.calls[0]?.messages.map((message) => message.text).join('\n') ?? '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value);
}

function currentToolEvidenceId(
  messages: BaseMessage[],
  toolName: string,
): string {
  for (const message of [...messages].reverse()) {
    if (typeof message.content !== 'string') continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(message.content);
    } catch {
      continue;
    }
    if (!isRecord(parsed) || !isRecord(parsed.publication)) continue;
    const evidence = parsed.publication.evidence;
    if (!Array.isArray(evidence)) continue;
    const match = evidence.find(
      (entry) =>
        isRecord(entry) &&
        typeof entry.evidenceId === 'string' &&
        entry.evidenceId.startsWith(`current:${toolName}:`),
    );
    if (isRecord(match) && typeof match.evidenceId === 'string') {
      return match.evidenceId;
    }
  }
  throw new Error(`current_tool_evidence_missing:${toolName}`);
}

describe('single maintained KFC agent runtime', () => {
  it('uses one provider call for a tool-less turn', async () => {
    const model = fakeModel()
      .respond(groundedResponseModelReply({
        customerText: 'I can help with that.',
      }));

    const output = await runAgentTurn(turnInput(model, 'single-agent-one-call'));

    expect(output.responseText).toBe('I can help with that.');
    expect(model.callCount).toBe(1);
  });

  it('fails closed before model invocation when publication access is revoked after observation', async () => {
    const model = fakeModel().respond(groundedResponseModelReply({
      customerText: 'This response must never be produced.',
    }));
    const input = turnInput(
      model,
      'single-agent-publication-access-revoked',
    );
    const accessContext = controlledCustomerAccess({
      sessionId: input.sessionId,
      customerId: input.customerId,
      channel: input.channel,
    });

    await expect(runAgentTurn({
      ...input,
      accessContext,
      observeRun: async ({ kind }) => {
        if (kind === 'planning') accessContext.authorizedScopes.splice(0);
      },
    })).rejects.toThrow('agent_model_publication_authority_invalid');

    expect(model.callCount).toBe(0);
  });

  it('fails closed before model invocation when publication authentication expires after observation', async () => {
    const model = fakeModel().respond(groundedResponseModelReply({
      customerText: 'This response must never be produced.',
    }));
    const input = turnInput(
      model,
      'single-agent-publication-authentication-expired',
    );
    const accessContext = controlledCustomerAccess({
      sessionId: input.sessionId,
      customerId: input.customerId,
      channel: input.channel,
    });

    await expect(runAgentTurn({
      ...input,
      accessContext,
      observeRun: async ({ kind }) => {
        if (
          kind === 'planning' &&
          accessContext.authenticationEvidence.state === 'verified'
        ) {
          accessContext.authenticationEvidence.expiresAt =
            '2000-01-01T00:00:00.000Z';
        }
      },
    })).rejects.toThrow('agent_model_publication_authority_invalid');

    expect(model.callCount).toBe(0);
  });

  it('revalidates publication access immediately before verifier invocation', async () => {
    const model = fakeModel().respond(groundedResponseModelReply({
      customerText: 'I can help with that.',
    }));
    const input = turnInput(
      model,
      'single-agent-verifier-publication-access-revoked',
    );
    const accessContext = controlledCustomerAccess({
      sessionId: input.sessionId,
      customerId: input.customerId,
      channel: input.channel,
    });
    const verifierInvoke = vi.fn(async () => {
      throw new Error('verifier_must_not_receive_revoked_publication');
    });
    const verifierModel = fakeModel();
    Object.defineProperty(verifierModel, 'withStructuredOutput', {
      value: () => RunnableLambda.from(verifierInvoke),
    });
    const traceSpan: AgentTraceSpan = {
      async startSpan({ name }) {
        if (name === 'response_grounding_verification') {
          accessContext.authorizedScopes.splice(0);
        }
        return traceSpan;
      },
      async end() {
        return undefined;
      },
      async fail() {
        return undefined;
      },
    };
    const tracer: AgentTracer = {
      async startTurn() {
        return traceSpan;
      },
      async flush() {
        return undefined;
      },
    };

    await expect(runAgentTurn({
      ...input,
      accessContext,
      responseVerifierModel: verifierModel,
      tracer,
    })).rejects.toThrow('agent_model_publication_authority_invalid');

    expect(model.callCount).toBe(1);
    expect(verifierInvoke).not.toHaveBeenCalled();
  });

  it('reissues a cached publication when its verified domain state changes', async () => {
    const input = turnInput(
      fakeModel(),
      'single-agent-publication-state-reissue',
    );
    await input.store.appendTurn({
      sessionId: input.sessionId,
      channel: input.channel,
      role: 'user',
      text: input.text,
      externalMessageId: input.externalMessageId,
      externalUserId: input.customerId,
      deliveryStatus: 'received',
      metadata: null,
    });
    const externalCalls = createAgentTurnExternalCallScope(1_000);
    const runtime = {
      turnInput: input,
      turnTrace: await createNoopAgentTracer().startTurn({
        name: 'publication_state_reissue',
        inputs: {},
      }),
      externalCallContext: externalCalls.context,
      abortExternalCalls: externalCalls.abort,
      disposeExternalCalls: externalCalls.dispose,
    };

    try {
      const loaded = await loadPublicationTurn(runtime);
      const publicationState = {
        domainState: loaded.state,
        currentTurnToolTrace: [],
        currentUserTurn: loaded.currentUserTurn,
        modelPublicationAuthority: loaded.authority,
        modelPublicationBundle: loaded.bundle,
        graphExecutedToolResults: [],
        currentTurnResponseEvidence: [],
        toolEvidenceReceipts: [],
      };
      const initial = await publicationBundle(publicationState, runtime);
      loaded.state.cart = {
        id: 'publication-reissue-cart',
        items: [{
          itemCode: '20751',
          name: 'Verified item',
          quantity: 1,
          unitPriceVnd: 99_000,
        }],
        subtotalVnd: 99_000,
        discountVnd: 0,
        deliveryFeeVnd: 0,
        totalVnd: 99_000,
        voucherCode: null,
      };

      const reissued = await publicationBundle(publicationState, runtime);

      expect(reissued).not.toBe(initial);
      expect(reissued.modelState.cart).toMatchObject({
        id: 'publication-reissue-cart',
        totalVnd: 99_000,
      });
      await expect(publicationBundle(publicationState, runtime))
        .resolves.toBe(reissued);
    } finally {
      externalCalls.dispose();
    }
  });

  it('keeps trusted-action audit turns out of future ordinary prompts', async () => {
    const sessionId = 'single-agent-no-synthetic-action-history';
    const syntheticText =
      'SYNTHETIC_FIXED_ACTION_PROSE_MUST_NOT_REACH_FUTURE_PROMPTS';
    const priorModelReply = 'A model-generated action reply remains history.';
    const currentText = 'This is an ordinary customer message.';
    const model = fakeModel()
      .respond(groundedResponseModelReply({
        customerText: 'I received the ordinary message.',
      }));
    const input = turnInput(model, sessionId);
    await input.store.appendTurn({
      sessionId,
      channel: 'kfc',
      role: 'user',
      text: syntheticText,
      externalMessageId: 'historical-structured-action',
      externalUserId: input.customerId,
      deliveryStatus: 'received',
      metadata: {
        rawEvent: {
          source: 'kfc_genui_action',
          schemaVersion: 'kfc-genui-v1',
          assistantTurnId: 'historical-action-assistant',
          verifiedRevision: 'b'.repeat(64),
          actionDigest: 'a'.repeat(64),
        },
      },
    });
    const incompleteMarkerText =
      'INCOMPLETE_ACTION_AUDIT_MARKER_MUST_REMAIN_SEMANTIC_HISTORY';
    await input.store.appendTurn({
      sessionId,
      channel: 'kfc',
      role: 'user',
      text: incompleteMarkerText,
      externalMessageId: 'incomplete-structured-action-marker',
      externalUserId: input.customerId,
      deliveryStatus: 'received',
      metadata: {
        rawEvent: {
          source: 'kfc_genui_action',
        },
      },
    });
    await input.store.appendTurn({
      sessionId,
      channel: 'kfc',
      role: 'assistant',
      text: priorModelReply,
      externalMessageId: null,
      externalUserId: input.customerId,
      deliveryStatus: 'sent',
      metadata: null,
    });

    const output = await runAgentTurn({
      ...input,
      text: currentText,
      externalMessageId: 'ordinary-current-turn',
    });

    const prompt = recordedPrompt(model);
    expect(prompt).not.toContain(syntheticText);
    expect(prompt).toContain(incompleteMarkerText);
    expect(prompt).toContain(priorModelReply);
    expect(prompt).toContain(currentText);
    expect(output.responseText).toBe('I received the ordinary message.');
    expect((await input.store.listTurns(sessionId))).toContainEqual(
      expect.objectContaining({
        role: 'user',
        text: currentText,
      }),
    );
  });

  it('retries one trace-visible transient provider failure', async () => {
    const transient = Object.assign(new Error('temporary provider failure'), {
      status: 503,
    });
    const model = fakeModel()
      .respond(transient)
      .respond(groundedResponseModelReply({
        customerText: 'Recovered without changing the request.',
      }));

    const output = await runAgentTurn(
      turnInput(model, 'single-agent-provider-retry'),
    );

    expect(output.responseText).toBe('Recovered without changing the request.');
    expect(model.callCount).toBe(2);
  });

  it('returns the complete verified menu collection in two provider calls', async () => {
    const claims = groundedResponseClaims({
      evidenceReferences: [{
        evidenceId: 'menu_search_results',
        claimKinds: ['product'],
      }],
    });
    const model = fakeModel()
      .respondWithTools([{
        name: 'searchMenu',
        args: { scope: 'all', query: null },
      }])
      .respond(groundedResponseModelReply({
        customerText: 'I found verified menu options.',
        ...claims,
      }));

    const output = await runAgentTurn(
      turnInput(model, 'single-agent-two-call', claims),
    );

    expect(output.state.menuSearchResults?.length).toBeGreaterThan(0);
    expect(output.state.activeMenuCollection?.result).toMatchObject({
      scope: { scope: 'all' },
      complete: true,
      total: output.state.menuSearchResults?.length,
      returned: output.state.menuSearchResults?.length,
    });
    expect(output.responseText).toContain('I found verified menu options.');
    expect(output.genUi).toMatchObject({
      widgetKind: 'smartMenuPicker',
      data: {
        items: output.state.activeMenuCollection?.result.items,
        total: output.state.activeMenuCollection?.result.total,
        returned: output.state.activeMenuCollection?.result.returned,
        complete: true,
      },
    });
    expect(model.callCount).toBe(2);
  });

  it('restores verified collection authority on a follow-up turn', async () => {
    const sessionId = 'single-agent-persisted-collection';
    const store = new MemoryStore();
    const checkpointer = new MemorySaver();
    const clients = createMockClients(createTestFixtures());
    const dashboard = new DashboardEventBus();
    const firstClaims = groundedResponseClaims({
      evidenceReferences: [{
        evidenceId: 'menu_search_results',
        claimKinds: ['product'],
      }],
    });
    const firstModel = fakeModel()
      .respondWithTools([{
        name: 'searchMenu',
        args: { scope: 'filtered', query: 'combo' },
      }])
      .respond(groundedResponseModelReply({
        customerText: 'I loaded the complete verified menu.',
        ...firstClaims,
      }));
    const firstInput = {
      ...turnInput(firstModel, sessionId, firstClaims),
      store,
      checkpointer,
      clients,
      dashboard,
    };

    const firstOutput = await runAgentTurn(firstInput);
    const collectionKey =
      firstOutput.state.activeCollectionKeys?.searchMenu;
    expect(collectionKey).toBeTruthy();
    expect(
      firstOutput.state.verifiedCollections?.searchMenu?.[collectionKey!],
    ).toBeDefined();

    const secondClaims = groundedResponseClaims();
    const secondModel = fakeModel()
      .respondWithTools([{
        name: 'getItemDetails',
        args: { code: '20751' },
      }])
      .respond((messages) => {
        secondClaims.evidenceReferences.splice(0, 1, {
          evidenceId: currentToolEvidenceId(
            messages,
            'getItemDetails',
          ),
          claimKinds: ['product'],
        });
        return groundedResponseModelReply({
          customerText: 'I verified that menu item.',
          ...secondClaims,
        })(messages);
      });
    const secondOutput = await runAgentTurn({
      ...turnInput(secondModel, sessionId, secondClaims),
      externalMessageId: `${sessionId}-follow-up`,
      store,
      checkpointer,
      clients,
      dashboard,
    });

    expect(secondOutput.state.menuItemDetail?.code).toBe('20751');
    expect(secondOutput.responseText).toBe('I verified that menu item.');
    expect(secondModel.callCount).toBe(2);
  });

  it('projects server-injected fulfillment arguments back into verified state', async () => {
    const claims = groundedResponseClaims();
    const model = fakeModel()
      .respondWithTools([{
        name: 'searchMenu',
        args: { scope: 'all', query: null },
      }])
      .respondWithTools([{
        name: 'updateCart',
        args: {
          changes: [{
            itemCode: '20751',
            quantity: 1,
            modifiers: [],
          }],
        },
      }])
      .respondWithTools([{
        name: 'quoteFulfillment',
        args: {
          address: {
            label: null,
            line1: '60 Đ. Phạm Văn Nghị',
            district: 'Quận 7',
            city: 'Hồ Chí Minh',
          },
          method: 'delivery',
        },
      }])
      .respond((messages) => {
        claims.evidenceReferences.splice(0, 1, {
          evidenceId: currentToolEvidenceId(
            messages,
            'quoteFulfillment',
          ),
          claimKinds: ['fulfillment'],
        });
        return groundedResponseModelReply({
          customerText: 'I verified the delivery quote.',
          ...claims,
        })(messages);
      });

    const input = turnInput(
      model,
      'single-agent-fulfillment-projection',
      claims,
    );
    const output = await runAgentTurn({
      ...input,
      text:
        'Add item 20751 and deliver to 60 Đ. Phạm Văn Nghị, Quận 7, Hồ Chí Minh.',
    });

    expect(output.state.fulfillment?.storeId).toBe('KFCVN0318');
    expect(output.state.address).toMatchObject({
      label: '60 Đ. Phạm Văn Nghị',
      line1: '60 Đ. Phạm Văn Nghị',
      district: 'Quận 7',
      city: 'Hồ Chí Minh',
    });
    expect(model.callCount).toBe(4);
  });

  it('suppresses a reversible mutation when the customer run is superseded', async () => {
    let current = true;
    let planningObservations = 0;
    const model = fakeModel()
      .respondWithTools([{
        name: 'searchMenu',
        args: { scope: 'all', query: null },
      }])
      .respondWithTools([{
        name: 'updateCart',
        args: {
          changes: [{
            itemCode: '20751',
            quantity: 1,
            modifiers: [],
          }],
        },
      }]);
    const baseInput = turnInput(
      model,
      'single-agent-superseded-mutation',
    );
    const runId = 'single-agent-superseded-mutation-run';
    const run = await baseInput.store.createCustomerRun({
      id: runId,
      schemaVersion: 1,
      sessionId: baseInput.sessionId,
      customerId: baseInput.customerId,
      clientMessageId: baseInput.externalMessageId,
      requestFingerprint: `${runId}-fingerprint`,
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
    const input = {
      ...baseInput,
      runGuard: {
        isCurrent: async () => current,
        commitFence: {
          kind: 'customer_run' as const,
          runId,
          sessionAuthorityGeneration:
            run.sessionAuthorityGeneration,
        },
      },
      observeRun: async (
        observation: Parameters<
          NonNullable<AgentTurnInput['observeRun']>
        >[0],
      ) => {
        if (observation.kind !== 'planning') return;
        planningObservations += 1;
        if (planningObservations === 2) current = false;
      },
    };
    const applyChanges = vi.spyOn(input.clients.cart, 'applyChanges');

    await expect(runAgentTurn(input)).rejects.toThrow(
      'customer_run_cancelled',
    );
    expect(applyChanges).not.toHaveBeenCalled();
  });

  it('preserves promotion and allergen collection events', async () => {
    const model = fakeModel()
      .respondWithTools([{
        name: 'searchPromotions',
        args: { scope: 'all', query: null },
      }])
      .respondWithTools([{
        name: 'answerAllergenQuestion',
        args: { query: 'phô mai' },
      }])
      .respond(groundedResponseModelReply({
        customerText: 'I checked the verified information.',
      }));
    const input = turnInput(model, 'single-agent-collection-events');

    await runAgentTurn(input);

    const updateTypes = input.dashboard
      .getEvents(input.sessionId)
      .filter((event) => event.type === 'session_updated')
      .map((event) => event.payload.updateType);
    expect(updateTypes).toEqual(expect.arrayContaining([
      'promotion_answered',
      'content_evidence_found',
    ]));
  });

  it('allows one semantic correction and then continues', async () => {
    const claims = groundedResponseClaims({
      evidenceReferences: [{
        evidenceId: 'menu_search_results',
        claimKinds: ['product'],
      }],
    });
    const model = fakeModel()
      .respondWithTools([{
        name: 'getItemDetails',
        args: { code: '' },
      }])
      .respondWithTools([{
        name: 'searchMenu',
        args: { scope: 'filtered', query: 'burger' },
      }])
      .respond(groundedResponseModelReply({
        customerText: 'I corrected the lookup using verified results.',
        ...claims,
      }));

    const output = await runAgentTurn(
      turnInput(model, 'single-agent-one-correction', claims),
    );

    expect(output.state.menuSearchResults?.length).toBeGreaterThan(0);
    expect(model.callCount).toBe(3);
  });

  it('fails closed on a second semantic correction', async () => {
    const model = fakeModel()
      .respondWithTools([{
        name: 'getItemDetails',
        args: { code: '' },
      }])
      .respondWithTools([{
        name: 'getModifierOptions',
        args: { code: '' },
      }]);

    await expect(
      runAgentTurn(turnInput(model, 'single-agent-two-corrections')),
    ).rejects.toThrow('agent_semantic_correction_limit_exceeded');
    expect(model.callCount).toBe(2);
  });

  it('never makes a seventh provider call', async () => {
    const model = fakeModel();
    for (let call = 0; call < 7; call += 1) {
      model.respondWithTools([{
        name: 'searchMenu',
        args: { scope: 'filtered', query: `query-${call}` },
      }]);
    }

    await expect(
      runAgentTurn(turnInput(model, 'single-agent-six-call-limit')),
    ).rejects.toThrow('agent_provider_call_limit_exceeded');
    expect(model.callCount).toBe(6);
  });

  it('uses maintained HITL and emits an exact hidden action/revision binding', async () => {
    const model = fakeModel().respondWithTools([{
      name: 'handoff',
      args: { reasons: ['customer requested support'] },
    }]);
    const input = approvalTurnInput(
      model,
      'single-agent-hitl',
      'handoff:write',
    );

    const output = await runAgentTurn(input);

    expect(output).toMatchObject({
      status: 'paused',
      pause: {
        capability: 'handoff',
        requestId: expect.any(String),
        action: {
          toolName: 'handoff',
          arguments: { reasons: ['customer requested support'] },
        },
      },
    });
    const record = canonicalConfirmationRecord(output);
    expect(record).toMatchObject({
      requestId: output.pause?.requestId,
      action: output.pause?.action,
      principal: {
        sessionId: input.sessionId,
        customerId: input.customerId,
        channel: input.channel,
        authenticatedSubject: input.customerId,
        authenticationEvidenceRef:
          `controlled-test:${input.customerId}`,
      },
      approvalBinding: {
        capability: 'handoff',
        actionDigest: expect.any(String),
        revisions: {
          cartRevision: expect.any(String),
          fulfillmentRevision: expect.any(String),
          paymentRevision: expect.any(String),
          collectionRevision: expect.any(String),
          providerRevision: expect.any(String),
        },
      },
      approvalBindingDigest: expect.any(String),
      checkpointThreadId: expect.any(String),
      checkpointId: expect.any(String),
      expiresAt: expect.any(String),
    });
    expect(JSON.stringify(output.pause)).not.toContain(
      'authenticationEvidenceRef',
    );
    expect(model.callCount).toBe(1);
  });

  it('rejects legacy boolean approval in the maintained runtime', async () => {
    const model = fakeModel().respondWithTools([{
      name: 'handoff',
      args: { reasons: ['customer requested support'] },
    }]);
    const input = approvalTurnInput(
      model,
      'single-agent-legacy-approval',
      'handoff:write',
    );
    const paused = await runAgentTurn(input);

    await expect(runAgentTurn({
      ...input,
      confirmationResume: {
        requestId: paused.pause!.requestId,
        approved: true,
      },
    })).rejects.toThrow('agent_confirmation_resume_authority_required');
    expect(await input.store.listEvents(input.sessionId)).not.toContainEqual(
      expect.objectContaining({ sourceType: 'agent:failed_closed' }),
    );
    expect(model.callCount).toBe(1);
  });

  it('pauses a model-authored irreversible queue one exact action at a time', async () => {
    const model = fakeModel().respondWithTools([
      {
        name: 'handoff',
        args: { reasons: ['first support action'] },
      },
      {
        name: 'handoff',
        args: { reasons: ['second support action'] },
      },
    ]);
    const paused = await runAgentTurn(approvalTurnInput(
      model,
      'single-agent-multi-action-hitl',
      'handoff:write',
    ));

    expect(paused.pause?.action).toEqual({
      toolName: 'handoff',
      arguments: { reasons: ['first support action'] },
    });
    expect(model.callCount).toBe(1);
  });

  it('keeps concurrent approval checkpoints isolated by request', async () => {
    const sessionId = 'single-agent-concurrent-approvals';
    const store = new MemoryStore();
    const checkpointer = new MemorySaver();
    const clients = createMockClients(createTestFixtures());
    const dashboard = new DashboardEventBus();
    const orderModel = fakeModel()
      .respondWithTools([{
        name: 'handoff',
        args: { reasons: ['order support requested'] },
      }])
      .respond(groundedResponseModelReply({
        customerText: 'Order creation cancelled.',
      }));
    const handoffModel = fakeModel()
      .respondWithTools([{
        name: 'handoff',
        args: { reasons: ['customer requested support'] },
      }])
      .respond(groundedResponseModelReply({
        customerText: 'Human handoff cancelled.',
      }));
    const orderInput = {
      ...approvalTurnInput(orderModel, sessionId, 'handoff:write'),
      text: 'Submit my order',
      externalMessageId: 'concurrent-order',
      store,
      checkpointer,
      clients,
      dashboard,
    };
    const handoffInput = {
      ...approvalTurnInput(handoffModel, sessionId, 'handoff:write'),
      text: 'Please connect me to support',
      externalMessageId: 'concurrent-handoff',
      store,
      checkpointer,
      clients,
      dashboard,
    };

    const [orderPause, handoffPause] = await Promise.all([
      runAgentTurn(orderInput),
      runAgentTurn(handoffInput),
    ]);
    expect(orderPause.pause?.capability).toBe('handoff');
    expect(handoffPause.pause?.capability).toBe('handoff');
    expect(orderPause.pause?.requestId).not.toBe(handoffPause.pause?.requestId);

    const resumeRejected = async (
      input: typeof orderInput,
      record: CreateConfirmationPauseInput,
    ) => {
      const resume = await authenticatedRejectionResume(record);
      try {
        return await runAgentTurn({
          ...input,
          confirmationResume: resume.confirmationResume,
        });
      } finally {
        resume.externalCallScope.dispose();
      }
    };
    const orderOutput = await resumeRejected(
      orderInput,
      canonicalConfirmationRecord(orderPause),
    );
    const handoffOutput = await resumeRejected(
      handoffInput,
      canonicalConfirmationRecord(handoffPause),
    );
    expect(orderOutput.responseText).toBe('Order creation cancelled.');
    expect(handoffOutput.responseText).toBe('Human handoff cancelled.');
  });

  it('loads the checkpoint-bound customer turn without substituting a later turn', async () => {
    const input = turnInput(
      fakeModel(),
      'single-agent-checkpoint-turn-selection',
    );
    const first = await input.store.appendTurn({
      sessionId: input.sessionId,
      channel: input.channel,
      role: 'user',
      text: 'First checkpoint-bound request',
      externalMessageId: 'checkpoint-turn-a',
      externalUserId: input.customerId,
      deliveryStatus: 'received',
      metadata: null,
    });
    const second = await input.store.appendTurn({
      sessionId: input.sessionId,
      channel: input.channel,
      role: 'user',
      text: 'Later independent request',
      externalMessageId: 'checkpoint-turn-b',
      externalUserId: input.customerId,
      deliveryStatus: 'received',
      metadata: null,
    });

    const loaded = await loadTurnState(input, {
      currentUserTurnId: first.id,
    });

    expect(loaded.currentUserTurn?.id).toBe(first.id);
    expect(loaded.state.latestUserMessage).toBe(first.text);
    expect(loaded.state.recentTurns?.at(-1)?.id).toBe(first.id);
    expect(loaded.state.recentTurns?.map(({ id }) => id))
      .not.toContain(second.id);
    await expect(loadTurnState(input, {
      currentUserTurnId: 'missing-checkpoint-turn',
    })).rejects.toThrow('agent_current_user_turn_missing');
  });

  it('rehydrates an exact v2 error receipt against the failed checkpoint trace', async () => {
    const input = turnInput(
      fakeModel(),
      'single-agent-checkpoint-error-receipt',
    );
    const currentTurn = await input.store.appendTurn({
      sessionId: input.sessionId,
      channel: input.channel,
      role: 'user',
      text: input.text,
      externalMessageId: input.externalMessageId,
      externalUserId: input.customerId,
      deliveryStatus: 'received',
      metadata: null,
    });
    const failedTrace: ToolTraceEntry = {
      toolName: 'searchMenu' as const,
      arguments: { scope: 'filtered', query: 'unavailable' },
      ok: false,
      resultSummary: 'provider_error',
      provenance: [],
    };
    const receipt = {
      schemaVersion: 'kfc-checkpoint-tool-evidence-receipt-v2' as const,
      evidenceId: `current:searchMenu:${'a'.repeat(64)}`,
      evidenceDigest: 'a'.repeat(64),
      toolCallId: 'failed-search-menu-call',
      toolName: 'searchMenu' as const,
      executionOutcome: 'error' as const,
      result: 'audit_evidence_reference' as const,
    };
    failedTrace.publicationEvidenceAudit = {
      schemaVersion: 'kfc-tool-trace-publication-audit-v1',
      currentTurnId: currentTurn.id,
      traceIndex: 0,
      traceDigest: await stateRevision({
        toolName: failedTrace.toolName,
        arguments: failedTrace.arguments,
        ok: failedTrace.ok,
        resultSummary: failedTrace.resultSummary,
        provenance: failedTrace.provenance,
      }),
      argumentsDigest: await stateRevision(failedTrace.arguments),
      toolCallId: receipt.toolCallId,
      toolName: receipt.toolName,
      executionOutcome: receipt.executionOutcome,
      evidenceId: receipt.evidenceId,
      evidenceDigest: receipt.evidenceDigest,
    };
    await input.store.appendEvent(input.sessionId, 'graph:verified_state', {
      verifiedState: { toolTrace: [failedTrace] },
    });
    const externalCalls = createAgentTurnExternalCallScope(1_000);
    const runtime = {
      turnInput: input,
      turnTrace: await createNoopAgentTracer().startTurn({
        name: 'checkpoint_error_receipt_rehydration',
        inputs: {},
      }),
      externalCallContext: externalCalls.context,
      abortExternalCalls: externalCalls.abort,
      disposeExternalCalls: externalCalls.dispose,
    };

    try {
      const tracePrefixDigest =
        await publicationToolTracePrefixDigest([]);
      const hydrated = await rehydratePublicationTurn({
        runtime,
        currentTurnId: currentTurn.id,
        turnToolTraceStartIndex: 0,
        turnToolTracePrefixDigest: tracePrefixDigest,
        toolEvidenceReceipts: [receipt],
      });

      expect(hydrated.currentUserTurn.id).toBe(currentTurn.id);
      expect(hydrated.currentTurnToolTrace).toEqual([failedTrace]);
      for (const tamperedReceipt of [
        {
          ...receipt,
          executionOutcome: 'success',
        } as const,
        {
          ...receipt,
          toolCallId: 'forged-failed-search-menu-call',
        },
        {
          ...receipt,
          evidenceId: `current:searchMenu:${'b'.repeat(64)}`,
          evidenceDigest: 'b'.repeat(64),
        },
      ]) {
        await expect(rehydratePublicationTurn({
          runtime,
          currentTurnId: currentTurn.id,
          turnToolTraceStartIndex: 0,
          turnToolTracePrefixDigest: tracePrefixDigest,
          toolEvidenceReceipts: [tamperedReceipt],
        })).rejects.toThrow(
          'agent_checkpoint_tool_evidence_unrecoverable',
        );
      }

      for (const tamperedAudit of [
        { currentTurnId: `${currentTurn.id}-other` },
        { traceIndex: 1 },
      ]) {
        await input.store.appendEvent(
          input.sessionId,
          'graph:verified_state',
          {
            verifiedState: {
              toolTrace: [{
                ...failedTrace,
                publicationEvidenceAudit: {
                  ...failedTrace.publicationEvidenceAudit!,
                  ...tamperedAudit,
                },
              }],
            },
          },
        );
        await expect(rehydratePublicationTurn({
          runtime,
          currentTurnId: currentTurn.id,
          turnToolTraceStartIndex: 0,
          turnToolTracePrefixDigest: tracePrefixDigest,
          toolEvidenceReceipts: [receipt],
        })).rejects.toThrow(
          'agent_checkpoint_tool_evidence_unrecoverable',
        );
      }

      await input.store.appendEvent(
        input.sessionId,
        'graph:verified_state',
        {
          verifiedState: {
            toolTrace: [{
              ...failedTrace,
              arguments: { scope: 'all', query: null },
            }],
          },
        },
      );
      await expect(rehydratePublicationTurn({
        runtime,
        currentTurnId: currentTurn.id,
        turnToolTraceStartIndex: 0,
        turnToolTracePrefixDigest: tracePrefixDigest,
        toolEvidenceReceipts: [receipt],
      })).rejects.toThrow(
        'agent_checkpoint_tool_evidence_unrecoverable',
      );
    } finally {
      externalCalls.dispose();
    }
  });

  it('rejects a checkpoint trace boundary that omits earlier current-turn audits', async () => {
    const input = turnInput(
      fakeModel(),
      'single-agent-checkpoint-complete-trace-boundary',
    );
    const currentTurn = await input.store.appendTurn({
      sessionId: input.sessionId,
      channel: input.channel,
      role: 'user',
      text: input.text,
      externalMessageId: input.externalMessageId,
      externalUserId: input.customerId,
      deliveryStatus: 'received',
      metadata: null,
    });
    const auditedTrace = async (
      traceIndex: number,
      digestCharacter: string,
    ) => {
      const trace: ToolTraceEntry = {
        toolName: 'searchMenu',
        arguments: {
          scope: 'filtered',
          query: `unavailable-${traceIndex}`,
        },
        ok: false,
        resultSummary: `provider_error_${traceIndex}`,
        provenance: [],
      };
      const evidenceDigest = digestCharacter.repeat(64);
      const receipt = {
        schemaVersion:
          'kfc-checkpoint-tool-evidence-receipt-v2' as const,
        evidenceId: `current:searchMenu:${evidenceDigest}`,
        evidenceDigest,
        toolCallId: `failed-search-menu-call-${traceIndex}`,
        toolName: 'searchMenu' as const,
        executionOutcome: 'error' as const,
        result: 'audit_evidence_reference' as const,
      };
      trace.publicationEvidenceAudit = {
        schemaVersion: 'kfc-tool-trace-publication-audit-v1',
        currentTurnId: currentTurn.id,
        traceIndex,
        traceDigest: await stateRevision({
          toolName: trace.toolName,
          arguments: trace.arguments,
          ok: trace.ok,
          resultSummary: trace.resultSummary,
          provenance: trace.provenance,
        }),
        argumentsDigest: await stateRevision(trace.arguments),
        toolCallId: receipt.toolCallId,
        toolName: receipt.toolName,
        executionOutcome: receipt.executionOutcome,
        evidenceId: receipt.evidenceId,
        evidenceDigest: receipt.evidenceDigest,
      };
      return { receipt, trace };
    };
    const first = await auditedTrace(0, 'a');
    const second = await auditedTrace(1, 'b');
    const traces = [first.trace, second.trace];
    await input.store.appendEvent(input.sessionId, 'graph:verified_state', {
      verifiedState: { toolTrace: traces },
    });
    const externalCalls = createAgentTurnExternalCallScope(1_000);
    const runtime = {
      turnInput: input,
      turnTrace: await createNoopAgentTracer().startTurn({
        name: 'checkpoint_complete_trace_boundary',
        inputs: {},
      }),
      externalCallContext: externalCalls.context,
      abortExternalCalls: externalCalls.abort,
      disposeExternalCalls: externalCalls.dispose,
    };

    try {
      await expect(rehydratePublicationTurn({
        runtime,
        currentTurnId: currentTurn.id,
        turnToolTraceStartIndex: 0,
        turnToolTracePrefixDigest:
          await publicationToolTracePrefixDigest([]),
        toolEvidenceReceipts: [first.receipt, second.receipt],
      })).resolves.toMatchObject({
        currentTurnToolTrace: traces,
      });

      await expect(rehydratePublicationTurn({
        runtime,
        currentTurnId: currentTurn.id,
        turnToolTraceStartIndex: 1,
        turnToolTracePrefixDigest:
          await publicationToolTracePrefixDigest([first.trace]),
        toolEvidenceReceipts: [second.receipt],
      })).rejects.toThrow(
        'agent_checkpoint_publication_state_stale',
      );
      await expect(rehydratePublicationTurn({
        runtime,
        currentTurnId: currentTurn.id,
        turnToolTraceStartIndex: 2,
        turnToolTracePrefixDigest:
          await publicationToolTracePrefixDigest(traces),
        toolEvidenceReceipts: [],
      })).rejects.toThrow(
        'agent_checkpoint_publication_state_stale',
      );
      await expect(rehydratePublicationTurn({
        runtime,
        currentTurnId: currentTurn.id,
        turnToolTraceStartIndex: 0,
        turnToolTracePrefixDigest: 'f'.repeat(64),
        toolEvidenceReceipts: [first.receipt, second.receipt],
      })).rejects.toThrow(
        'agent_checkpoint_publication_state_stale',
      );
    } finally {
      externalCalls.dispose();
    }
  });

  it('revalidates the exact provider binding before a rejection resume', async () => {
    const model = fakeModel()
      .respondWithTools([{
        name: 'handoff',
        args: { reasons: ['customer requested support'] },
      }])
      .respond(groundedResponseModelReply({
        customerText: 'I left the order unsubmitted.',
      }));
    const input = approvalTurnInput(
      model,
      'single-agent-reject-revalidation',
      'handoff:write',
    );
    const paused = await runAgentTurn(input);
    const record = canonicalConfirmationRecord(paused);
    const authority = input.clients.confirmationAuthority!;
    const revalidate = vi.fn(authority.revalidate.bind(authority));
    input.clients.confirmationAuthority = { ...authority, revalidate };
    const resume = await authenticatedRejectionResume(record);

    let output;
    try {
      output = await runAgentTurn({
        ...input,
        confirmationResume: resume.confirmationResume,
      });
    } finally {
      resume.externalCallScope.dispose();
    }

    expect(output.responseText).toBe('I left the order unsubmitted.');
    expect(revalidate).toHaveBeenCalledOnce();
    expect(revalidate.mock.calls[0]?.[0]).toEqual({
      kind: 'confirm_order',
      requestId: 'agent-commerce:handoff',
      environment: authority.environment,
      scenarioId: authority.scenarioId,
      catalogObservationId: authority.catalogObservationId,
      catalogObservationHash: authority.catalogObservationHash,
      cartRevision: record.approvalBinding.revisions.cartRevision,
      fulfillmentRevision:
        record.approvalBinding.revisions.fulfillmentRevision,
      paymentRevision: record.approvalBinding.revisions.paymentRevision,
      providerRevision: record.approvalBinding.revisions.providerRevision,
    });
    expect(revalidate.mock.calls[0]?.[1]).toBe(
      resume.externalCallScope.context,
    );
    expect(model.callCount).toBe(2);
  });

  it('rejects a stale provider binding before either approval decision resumes', async () => {
    const model = fakeModel().respondWithTools([{
      name: 'handoff',
      args: { reasons: ['customer requested support'] },
    }]);
    const input = approvalTurnInput(
      model,
      'single-agent-stale-provider-binding',
      'handoff:write',
    );
    const paused = await runAgentTurn(input);
    const record = canonicalConfirmationRecord(paused);
    const authority = input.clients.confirmationAuthority!;
    const revalidate = vi.fn(
      async (
        _providerBinding: IrreversibleConfirmationBinding,
        _externalCallContext: ExternalCallContext,
      ) => ({
        ok: false,
        reason: 'provider changed',
      }),
    );
    input.clients.confirmationAuthority = { ...authority, revalidate };
    const resume = await authenticatedRejectionResume(record);

    try {
      await expect(runAgentTurn({
        ...input,
        confirmationResume: resume.confirmationResume,
      })).rejects.toThrow('agent_approval_receipt_binding_mismatch');
    } finally {
      resume.externalCallScope.dispose();
    }
    expect(revalidate).toHaveBeenCalledOnce();
    expect(revalidate.mock.calls[0]?.[0]).toEqual({
      kind: 'confirm_order',
      requestId: 'agent-commerce:handoff',
      environment: authority.environment,
      scenarioId: authority.scenarioId,
      catalogObservationId: authority.catalogObservationId,
      catalogObservationHash: authority.catalogObservationHash,
      cartRevision: record.approvalBinding.revisions.cartRevision,
      fulfillmentRevision:
        record.approvalBinding.revisions.fulfillmentRevision,
      paymentRevision: record.approvalBinding.revisions.paymentRevision,
      providerRevision: record.approvalBinding.revisions.providerRevision,
    });
    expect(revalidate.mock.calls[0]?.[1]).toBe(
      resume.externalCallScope.context,
    );
    expect(model.callCount).toBe(1);
  });

  it('rejects a receipt with a non-date expiry before resuming the model', async () => {
    const model = fakeModel().respondWithTools([{
      name: 'handoff',
      args: { reasons: ['customer requested support'] },
    }]);
    const input = approvalTurnInput(
      model,
      'single-agent-invalid-receipt-expiry',
      'handoff:write',
    );
    const paused = await runAgentTurn(input);
    const record = canonicalConfirmationRecord(paused);
    const resume = await authenticatedRejectionResume(record);

    try {
      await expect(runAgentTurn({
        ...input,
        confirmationResume: {
          ...resume.confirmationResume,
          commerceReceipt: {
            ...resume.confirmationResume.commerceReceipt,
            expiresAt: 'not-a-date',
          },
        },
      })).rejects.toThrow('agent_confirmation_resume_authority_required');
    } finally {
      resume.externalCallScope.dispose();
    }
    expect(model.callCount).toBe(1);
  });

  it('rejects stale trusted structured UI actions before model inference', async () => {
    const model = fakeModel().respond(new AIMessage('must not be used'));
    const input = turnInput(model, 'single-agent-structured-action');
    await input.store.appendTurn({
      sessionId: input.sessionId,
      channel: input.channel,
      role: 'user',
      text: input.text,
      externalMessageId: input.externalMessageId,
      externalUserId: input.customerId,
      deliveryStatus: 'received',
      metadata: null,
    });

    await expect(runAgentTurn({
      ...input,
      trustedCustomerAction: createTrustedCustomerActionEnvelope({
        source: 'kfc_genui_action',
        assistantTurnId: 'assistant-turn-1',
        attachmentId: 'attachment-1',
        actionDigest: '0'.repeat(64),
        verifiedRevision: '1'.repeat(64),
        lifecycle: 'one_shot',
        command: { kind: 'confirm_order' },
      }),
    })).rejects.toThrow('structured_action_verified_state_stale');
    expect(model.callCount).toBe(0);
  });

  it('isolates each concurrent prompt at its exact persisted customer turn', async () => {
    const sessionId = 'single-agent-concurrent-history';
    const store = new InterleavingMemoryStore();
    const checkpointer = new MemorySaver();
    const clients = createMockClients(createTestFixtures());
    const dashboard = new DashboardEventBus();
    const firstModel = fakeModel()
      .respond(groundedResponseModelReply({
        customerText: 'first response',
      }));
    const secondModel = fakeModel()
      .respond(groundedResponseModelReply({
        customerText: 'second response',
      }));
    const firstMarker = 'FIRST_EXACT_MESSAGE_49';
    const secondMarker = 'SECOND_EXACT_MESSAGE_49';

    await Promise.all([
      runAgentTurn({
        ...turnInput(firstModel, sessionId),
        text: firstMarker,
        externalMessageId: 'concurrent-first',
        store,
        checkpointer,
        clients,
        dashboard,
      }),
      runAgentTurn({
        ...turnInput(secondModel, sessionId),
        text: secondMarker,
        externalMessageId: 'concurrent-second',
        store,
        checkpointer,
        clients,
        dashboard,
      }),
    ]);

    const firstPrompt = recordedPrompt(firstModel);
    const secondPrompt = recordedPrompt(secondModel);
    expect(firstPrompt.match(new RegExp(firstMarker, 'g'))).toHaveLength(1);
    expect(firstPrompt).not.toContain(secondMarker);
    expect(secondPrompt.match(new RegExp(firstMarker, 'g'))).toHaveLength(1);
    expect(secondPrompt.match(new RegExp(secondMarker, 'g'))).toHaveLength(1);
  });
});
