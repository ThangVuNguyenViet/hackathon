import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  persistAuthenticatedApprovalRejection,
} from '../../src/agent/approvalRejectionPersistence.js';
import {
  createAgentTurnExternalCallScope,
  type SingleAgentRuntimeContext,
} from '../../src/agent/singleAgentRuntime.js';
import { DashboardEventBus } from '../../src/dashboard/eventBus.js';
import type { AgentGraphState } from '../../src/graph/state.js';
import {
  loadPriorVerifiedState,
  persistVerifiedStateSnapshot,
} from '../../src/graph/verifiedState.js';
import { createNoopAgentTracer } from '../../src/observability/agentTracing.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';
import { createMockClients } from '../../src/mock/createMockClients.js';
import { createTestFixtures } from '../fixtures/testFixtures.js';

class RaceableRunCommitStore extends MemoryStore {
  beforeConditionalCommit?: () => Promise<void>;

  override async appendEventIfRunCurrent(
    input: Parameters<MemoryStore['appendEventIfRunCurrent']>[0],
  ): ReturnType<MemoryStore['appendEventIfRunCurrent']> {
    await this.beforeConditionalCommit?.();
    return super.appendEventIfRunCurrent(input);
  }
}

function paymentSelectionState(sessionId: string): AgentGraphState {
  return {
    sessionId,
    customerId: 'customer-1',
    channel: 'kfc',
    latestUserMessage: '',
    userConfirmedOrder: false,
    escalationReasons: [],
    retrievedEvidence: [],
    toolTrace: [],
    selectedPaymentMethod: {
      methodId: 'momo_wallet',
      collectionKey: 'payment-collection',
      collectionRevision: 'collection-revision',
      providerRevision: 'provider-revision',
    },
  };
}

async function rejectionRuntime(
  store: MemoryStore,
  state: AgentGraphState,
  runGuard?: SingleAgentRuntimeContext['turnInput']['runGuard'],
): Promise<{
  runtime: SingleAgentRuntimeContext;
  dispose(): void;
}> {
  const scope = createAgentTurnExternalCallScope(1_000);
  return {
    runtime: {
      turnInput: {
        sessionId: state.sessionId,
        customerId: state.customerId,
        channel: state.channel,
        text: '',
        clients: createMockClients(createTestFixtures()),
        store,
        dashboard: new DashboardEventBus(),
        ...(runGuard ? { runGuard } : {}),
      },
      turnTrace: await createNoopAgentTracer().startTurn({
        name: 'approval_rejection_persistence',
        inputs: {},
      }),
      externalCallContext: scope.context,
      abortExternalCalls: scope.abort,
      disposeExternalCalls: scope.dispose,
      state,
    },
    dispose: scope.dispose,
  };
}

const rejectedPaymentCall = {
  id: 'payment-call',
  toolName: 'createPaymentLink' as const,
  arguments: { methodId: 'momo_wallet' },
};

describe('authenticated approval rejection persistence', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps a rejected model-authored payment selection cleared after later response failure', async () => {
    const sessionId = 'rejected-payment-persistence';
    const store = new MemoryStore();
    const state = paymentSelectionState(sessionId);
    await persistVerifiedStateSnapshot(store, state);
    const harness = await rejectionRuntime(store, state);

    const rejected = await persistAuthenticatedApprovalRejection({
      runtime: harness.runtime,
      state,
      call: rejectedPaymentCall,
      hasStructuredAction: false,
    });
    expect(rejected.selectedPaymentMethod).toBeUndefined();

    await expect(Promise.reject(
      new Error('forced_response_composition_failure'),
    )).rejects.toThrow('forced_response_composition_failure');
    expect(
      (await loadPriorVerifiedState(store, sessionId))
        .selectedPaymentMethod,
    ).toBeUndefined();
    harness.dispose();
  });

  it('does not persist rejected state when customer-run authority is lost inside the conditional append', async () => {
    const sessionId = 'rejected-payment-customer-run-race';
    const runId = 'rejected-payment-customer-run';
    const store = new RaceableRunCommitStore();
    const state = paymentSelectionState(sessionId);
    await persistVerifiedStateSnapshot(store, state);
    const run = await store.createCustomerRun({
      id: runId,
      schemaVersion: 1,
      sessionId,
      customerId: state.customerId,
      clientMessageId: `${runId}-message`,
      requestFingerprint: `${runId}-fingerprint`,
      generation: 1,
      status: 'running',
      phase: 'planning',
      nextEventSequence: 1,
      clientSchemaVersion: 1,
      acceptedAt: '2026-07-20T00:00:00.000Z',
      startedAt: '2026-07-20T00:00:00.000Z',
      terminalAt: null,
      updatedAt: '2026-07-20T00:00:00.000Z',
    });
    const harness = await rejectionRuntime(store, state, {
      isCurrent: vi.fn(async () => true),
      commitFence: {
        kind: 'customer_run',
        runId,
        sessionAuthorityGeneration: run.sessionAuthorityGeneration,
      },
    });
    store.beforeConditionalCommit = async () => {
      await store.updateCustomerRun(runId, {
        status: 'superseded',
        terminalAt: '2026-07-20T00:00:01.000Z',
      });
    };

    await expect(persistAuthenticatedApprovalRejection({
      runtime: harness.runtime,
      state,
      call: rejectedPaymentCall,
      hasStructuredAction: false,
    })).rejects.toThrow('customer_run_cancelled');

    expect(harness.runtime.externalCallContext.signal.aborted).toBe(true);
    expect(harness.runtime.state).toBe(state);
    expect(
      (await loadPriorVerifiedState(store, sessionId))
        .selectedPaymentMethod?.methodId,
    ).toBe('momo_wallet');
    expect((await store.listEvents(sessionId)).filter(
      ({ sourceType }) => sourceType === 'graph:verified_state',
    )).toHaveLength(1);
    harness.dispose();
  });

  it('does not persist rejected state when an agent-run execution lease expires inside the conditional append', async () => {
    const now = new Date('2026-07-20T00:00:00.000Z');
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const sessionId = 'rejected-payment-agent-run-race';
    const runId = 'rejected-payment-agent-run';
    const leaseToken = 'rejected-payment-agent-lease-token-0001';
    const store = new RaceableRunCommitStore();
    const state = paymentSelectionState(sessionId);
    await persistVerifiedStateSnapshot(store, state);
    const created = await store.createAgentRun({
      id: runId,
      sessionId,
      generation: 1,
      channel: 'messenger',
      externalUserId: state.customerId,
      status: 'scheduled',
      coalescedInputText: 'reject the payment selection',
      deliveryStatus: 'pending',
      scheduledAt: now.toISOString(),
    });
    await store.setSessionAgentState({
      sessionId,
      currentRunId: runId,
      generation: created.generation,
      debounceDeadlineAt: null,
    });
    const claimed = await store.claimAgentRunExecution({
      runId,
      sessionId,
      generation: created.generation,
      sessionAuthorityGeneration: created.sessionAuthorityGeneration,
      claimedAt: now.toISOString(),
      executionLeaseToken: leaseToken,
      executionLeaseExpiresAt: new Date(now.getTime() + 1_000).toISOString(),
    });
    if (claimed.status !== 'claimed') {
      throw new Error('test_agent_run_execution_claim_failed');
    }
    const harness = await rejectionRuntime(store, state, {
      isCurrent: vi.fn(async () => true),
      commitFence: {
        kind: 'agent_run',
        runId,
        generation: claimed.run.generation,
        sessionAuthorityGeneration:
          claimed.run.sessionAuthorityGeneration,
        executionAttempt: claimed.run.executionAttempt,
        executionLeaseToken: leaseToken,
      },
    });
    store.beforeConditionalCommit = async () => {
      vi.setSystemTime(new Date(now.getTime() + 2_000));
    };

    await expect(persistAuthenticatedApprovalRejection({
      runtime: harness.runtime,
      state,
      call: rejectedPaymentCall,
      hasStructuredAction: false,
    })).rejects.toThrow('customer_run_cancelled');

    expect(harness.runtime.externalCallContext.signal.aborted).toBe(true);
    expect(harness.runtime.state).toBe(state);
    expect(
      (await loadPriorVerifiedState(store, sessionId))
        .selectedPaymentMethod?.methodId,
    ).toBe('momo_wallet');
    expect((await store.listEvents(sessionId)).filter(
      ({ sourceType }) => sourceType === 'graph:verified_state',
    )).toHaveLength(1);
    harness.dispose();
  });
});
