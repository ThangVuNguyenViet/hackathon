import type {
  AgentRun,
  ConversationTurn,
  SessionAgentState,
} from '../domain/types.js';
import {
  beginAgentRunTextDeliveryAttempt,
  completeAgentRunTextDeliveryAttempt,
  createPendingAgentRunTextDelivery,
  rebindRetryableAgentRunTextDelivery,
  reconcileAgentRunTextDelivery,
  type AgentRunTextDeliveryRecord,
  type BeginAgentRunTextDeliveryAttemptInput,
  type BeginAgentRunTextDeliveryAttemptResult,
  type CompleteAgentRunTextDeliveryAttemptInput,
  type CompleteAgentRunTextDeliveryAttemptResult,
  type CreatePendingAgentRunTextDeliveryInput,
  type ReconcileAgentRunTextDeliveryInput,
  type ReconcileAgentRunTextDeliveryResult,
} from './agentRunTextDelivery.js';
import {
  sameAgentRunTextDeliveryBinding,
} from './agentRunTextDeliveryStorage.js';
import type {
  ClaimAgentRunExecutionResult,
  CreateAgentRunTextDeliveryResult,
  SessionControl,
  SupersedeAgentRunExecutionIfNoLongerCurrentInput,
  SupersedeAgentRunExecutionIfNoLongerCurrentResult,
} from './contracts.js';
import {
  captureActiveMemorySessionAuthority,
} from './memoryStoreSessionAuthority.js';

export interface MemoryAgentRunTextDeliveryState {
  agentRuns: Map<string, AgentRun>;
  deliveries: Map<string, AgentRunTextDeliveryRecord>;
  sessionAgentStates: Map<string, SessionAgentState>;
  sessionControls: Map<string, SessionControl>;
  turns: ConversationTurn[];
}

export async function createMemoryAgentRunTextDelivery(
  input: CreatePendingAgentRunTextDeliveryInput,
  storage: MemoryAgentRunTextDeliveryState,
  now = Date.now(),
): Promise<CreateAgentRunTextDeliveryResult> {
  const pending = await createPendingAgentRunTextDelivery(input);
  if (!memoryDeliveryExecutionIsCurrent(pending, storage, now)) {
    return { status: 'stale' };
  }
  const existing = storage.deliveries.get(pending.runId);
  if (!existing) {
    storage.deliveries.set(pending.runId, structuredClone(pending));
    return { status: 'created', record: structuredClone(pending) };
  }
  if (sameAgentRunTextDeliveryBinding(existing, pending)) {
    return { status: 'replay', record: structuredClone(existing) };
  }
  const rebound = await rebindRetryableAgentRunTextDelivery(existing, {
    execution: input.execution,
    channel: input.channel,
    assistantTurnId: input.assistantTurnId,
    recipientId: input.recipientId,
    presentationText: input.presentationText,
    updatedAt: input.createdAt,
  });
  if (rebound.status !== 'rebound') {
    return { status: 'conflict', record: structuredClone(existing) };
  }
  storage.deliveries.set(
    rebound.record.runId,
    structuredClone(rebound.record),
  );
  return { status: 'rebound', record: structuredClone(rebound.record) };
}

export function getMemoryAgentRunTextDelivery(
  runId: string,
  storage: MemoryAgentRunTextDeliveryState,
): AgentRunTextDeliveryRecord | undefined {
  const record = storage.deliveries.get(runId);
  return record ? structuredClone(record) : undefined;
}

export function beginMemoryAgentRunTextDeliveryAttempt(
  input: BeginAgentRunTextDeliveryAttemptInput,
  storage: MemoryAgentRunTextDeliveryState,
  now = Date.now(),
): BeginAgentRunTextDeliveryAttemptResult {
  const existing = storage.deliveries.get(input.execution.runId);
  if (!existing) {
    return {
      status: 'dispatch_blocked',
      reason: 'execution_binding_mismatch',
    };
  }
  const transition = beginAgentRunTextDeliveryAttempt(existing, input);
  if (transition.status !== 'dispatch_authorized') return transition;
  if (
    memoryDeliveryAttemptTokenExists(
      input.deliveryAttemptToken,
      storage,
    )
  ) {
    return {
      status: 'dispatch_blocked',
      reason: 'delivery_attempt_token_reused',
    };
  }
  if (!memoryDeliveryExecutionIsCurrent(existing, storage, now)) {
    return {
      status: 'dispatch_blocked',
      reason: 'execution_binding_mismatch',
    };
  }
  storage.deliveries.set(
    transition.record.runId,
    structuredClone(transition.record),
  );
  return {
    status: 'dispatch_authorized',
    record: structuredClone(transition.record),
  };
}

function memoryDeliveryAttemptTokenExists(
  token: string,
  storage: MemoryAgentRunTextDeliveryState,
): boolean {
  for (const delivery of storage.deliveries.values()) {
    if (
      delivery.deliveryAttemptToken === token ||
      delivery.priorDeliveryAttemptTokens.some(
        (priorToken) => priorToken === token,
      )
    ) {
      return true;
    }
  }
  return false;
}

export function completeMemoryAgentRunTextDeliveryAttempt(
  input: CompleteAgentRunTextDeliveryAttemptInput,
  storage: MemoryAgentRunTextDeliveryState,
): CompleteAgentRunTextDeliveryAttemptResult {
  const existing = storage.deliveries.get(input.execution.runId);
  if (!existing || !memoryStoredRunExecutionMatches(existing, storage)) {
    return {
      status: 'transition_blocked',
      reason: 'execution_binding_mismatch',
    };
  }
  const transition = completeAgentRunTextDeliveryAttempt(existing, input);
  if (transition.status !== 'transitioned') return transition;
  storage.deliveries.set(
    transition.record.runId,
    structuredClone(transition.record),
  );
  if (transition.record.status === 'confirmed_sent') {
    completeMemoryAgentRunDelivery(storage, transition.record, input.updatedAt);
  } else if (transition.record.status === 'delivery_outcome_unknown') {
    reconcileMemoryAgentRun(storage, transition.record, input.updatedAt);
  }
  return {
    status: 'transitioned',
    record: structuredClone(transition.record),
  };
}

export function reconcileMemoryAgentRunTextDelivery(
  input: ReconcileAgentRunTextDeliveryInput,
  storage: MemoryAgentRunTextDeliveryState,
): ReconcileAgentRunTextDeliveryResult {
  const existing = storage.deliveries.get(input.execution.runId);
  if (!existing || !memoryStoredRunExecutionMatches(existing, storage)) {
    return {
      status: 'reconciliation_blocked',
      reason: 'execution_binding_mismatch',
      ...(existing ? { record: structuredClone(existing) } : {}),
    };
  }
  const transition = reconcileAgentRunTextDelivery(existing, input);
  if (
    transition.status !== 'reconciled' &&
    transition.status !== 'replay'
  ) {
    return transition;
  }
  storage.deliveries.set(
    transition.record.runId,
    structuredClone(transition.record),
  );
  reconcileMemoryAgentRun(storage, transition.record, input.updatedAt);
  return {
    status: transition.status,
    record: structuredClone(transition.record),
  };
}

export function reconcileExpiredSendingMemoryAgentRun(input: {
  runId: string;
  reconciledAt: string;
  storage: MemoryAgentRunTextDeliveryState;
  now?: number;
}): ClaimAgentRunExecutionResult | undefined {
  const run = input.storage.agentRuns.get(input.runId);
  const delivery = input.storage.deliveries.get(input.runId);
  const now = input.now ?? Date.now();
  if (
    run &&
    delivery?.status === 'confirmed_sent' &&
    delivery.runExecutionAttempt === run.executionAttempt &&
    delivery.runExecutionLeaseToken === run.executionLeaseToken
  ) {
    const completed = completeMemoryAgentRunDelivery(
      input.storage,
      delivery,
      input.reconciledAt,
    );
    return {
      status: 'stale',
      reason: 'not_current',
      run: structuredClone(completed),
    };
  }
  if (
    run &&
    delivery?.status === 'delivery_outcome_unknown' &&
    delivery.runExecutionAttempt === run.executionAttempt &&
    delivery.runExecutionLeaseToken === run.executionLeaseToken
  ) {
    const reconciled = reconcileMemoryAgentRun(
      input.storage,
      delivery,
      input.reconciledAt,
    );
    return {
      status: 'reconciliation_required',
      reason: 'delivery_outcome_unknown',
      run: structuredClone(reconciled),
    };
  }
  if (
    !run ||
    run.status !== 'running' ||
    run.executionLeaseExpiresAt === null ||
    Date.parse(run.executionLeaseExpiresAt) > now ||
    !delivery ||
    delivery.status !== 'sending' ||
    delivery.runExecutionAttempt !== run.executionAttempt ||
    delivery.runExecutionLeaseToken !== run.executionLeaseToken
  ) {
    return undefined;
  }
  const reconciledAt = new Date(Math.max(
    Date.parse(input.reconciledAt),
    Date.parse(delivery.updatedAt),
  )).toISOString();
  const transition = reconcileAgentRunTextDelivery(delivery, {
    execution: {
      runId: run.id,
      executionAttempt: run.executionAttempt,
      executionLeaseToken: delivery.runExecutionLeaseToken,
    },
    outcomeCode: 'agent_run_execution_lease_expired',
    updatedAt: reconciledAt,
  });
  if (transition.status !== 'reconciled') return undefined;
  input.storage.deliveries.set(run.id, structuredClone(transition.record));
  const reconciled = reconcileMemoryAgentRun(
    input.storage,
    transition.record,
    reconciledAt,
  );
  return {
    status: 'reconciliation_required',
    reason: 'delivery_outcome_unknown',
    run: structuredClone(reconciled),
  };
}

export function supersedeMemoryAgentRunExecutionIfNoLongerCurrent(
  input: SupersedeAgentRunExecutionIfNoLongerCurrentInput,
  storage: MemoryAgentRunTextDeliveryState,
  now = Date.now(),
): SupersedeAgentRunExecutionIfNoLongerCurrentResult {
  const run = storage.agentRuns.get(input.fence.runId);
  if (
    !run ||
    run.sessionId !== input.sessionId ||
    run.generation !== input.fence.generation ||
    run.sessionAuthorityGeneration !==
      input.fence.sessionAuthorityGeneration ||
    run.executionAttempt !== input.fence.executionAttempt ||
    run.executionLeaseToken !== input.fence.executionLeaseToken ||
    run.status !== 'running'
  ) {
    return {
      status: 'stale',
      ...(run ? { run: structuredClone(run) } : {}),
    };
  }
  if (
    run.irreversibleSideEffectAt !== null ||
    run.irreversibleToolName !== null
  ) {
    return {
      status: 'reconciliation_required',
      reason: 'irreversible_outcome_unknown',
      run: structuredClone(run),
    };
  }
  const delivery = storage.deliveries.get(run.id);
  if (
    delivery?.status === 'sending' ||
    delivery?.status === 'delivery_outcome_unknown' ||
    delivery?.status === 'confirmed_sent'
  ) {
    return {
      status: 'reconciliation_required',
      reason: 'delivery_outcome_unknown',
      run: structuredClone(run),
    };
  }
  if (memoryRunOwnerIsCurrent(run, storage, now)) {
    return { status: 'still_current', run: structuredClone(run) };
  }
  const superseded: AgentRun = {
    ...run,
    status: 'superseded',
    supersededByRunId: input.supersededByRunId ?? null,
    deliveryStatus: 'suppressed',
    errorCode: 'stale_agent_run',
    errorMessage: input.errorMessage,
    completedAt: input.completedAt,
    updatedAt: input.completedAt,
  };
  storage.agentRuns.set(run.id, superseded);
  return { status: 'superseded', run: structuredClone(superseded) };
}

function memoryDeliveryExecutionIsCurrent(
  delivery: AgentRunTextDeliveryRecord,
  storage: MemoryAgentRunTextDeliveryState,
  now: number,
): boolean {
  const run = storage.agentRuns.get(delivery.runId);
  const assistantTurn = storage.turns.find(
    (turn) => turn.id === delivery.assistantTurnId,
  );
  return Boolean(
    run &&
    assistantTurn?.sessionId === run.sessionId &&
    assistantTurn.role === 'assistant' &&
    assistantTurn.channel === delivery.channel &&
    run.channel === delivery.channel &&
    run.assistantTurnId === delivery.assistantTurnId &&
    run.executionAttempt === delivery.runExecutionAttempt &&
    run.executionLeaseToken === delivery.runExecutionLeaseToken &&
    memoryRunOwnerIsCurrent(run, storage, now)
  );
}

function memoryStoredRunExecutionMatches(
  delivery: AgentRunTextDeliveryRecord,
  storage: MemoryAgentRunTextDeliveryState,
): boolean {
  const run = storage.agentRuns.get(delivery.runId);
  return Boolean(
    run &&
    run.executionAttempt === delivery.runExecutionAttempt &&
    run.executionLeaseToken === delivery.runExecutionLeaseToken
  );
}

function memoryRunOwnerIsCurrent(
  run: AgentRun,
  storage: MemoryAgentRunTextDeliveryState,
  now: number,
): boolean {
  const state = storage.sessionAgentStates.get(run.sessionId);
  return (
    run.status === 'running' &&
    run.executionLeaseExpiresAt !== null &&
    Date.parse(run.executionLeaseExpiresAt) > now &&
    state?.currentRunId === run.id &&
    state.generation === run.generation &&
    captureActiveMemorySessionAuthority(
      storage.sessionControls,
      run.sessionId,
    ) === run.sessionAuthorityGeneration
  );
}

function reconcileMemoryAgentRun(
  storage: MemoryAgentRunTextDeliveryState,
  delivery: AgentRunTextDeliveryRecord,
  updatedAt: string,
): AgentRun {
  const run = storage.agentRuns.get(delivery.runId);
  if (
    !run ||
    run.executionAttempt !== delivery.runExecutionAttempt ||
    run.executionLeaseToken !== delivery.runExecutionLeaseToken
  ) {
    throw new Error('agent_run_text_delivery_execution_binding_lost');
  }
  const reconciled: AgentRun = {
    ...run,
    status: 'reconciliation_required',
    deliveryStatus: 'outcome_unknown',
    errorCode: 'agent_run_delivery_outcome_unknown',
    errorMessage: 'Channel delivery outcome requires reconciliation',
    completedAt: run.completedAt ?? updatedAt,
    updatedAt,
  };
  storage.agentRuns.set(run.id, reconciled);
  return reconciled;
}

function completeMemoryAgentRunDelivery(
  storage: MemoryAgentRunTextDeliveryState,
  delivery: Extract<
    AgentRunTextDeliveryRecord,
    { status: 'confirmed_sent' }
  >,
  updatedAt: string,
): AgentRun {
  const run = storage.agentRuns.get(delivery.runId);
  if (
    !run ||
    run.executionAttempt !== delivery.runExecutionAttempt ||
    run.executionLeaseToken !== delivery.runExecutionLeaseToken
  ) {
    throw new Error('agent_run_text_delivery_execution_binding_lost');
  }
  const completed: AgentRun = {
    ...run,
    status: 'completed',
    assistantTurnId: delivery.assistantTurnId,
    deliveryStatus: 'sent',
    deliveryExternalMessageId: delivery.providerMessageId,
    errorCode: null,
    errorMessage: null,
    completedAt: run.completedAt ?? updatedAt,
    updatedAt,
  };
  storage.agentRuns.set(run.id, completed);
  return completed;
}
