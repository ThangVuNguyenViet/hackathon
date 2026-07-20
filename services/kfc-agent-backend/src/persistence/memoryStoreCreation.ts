import type { AgentRun } from '../domain/types.js';
import {
  CustomerRunIdempotencyConflictError,
  type CustomerRun,
} from '../customerRuns/contracts.js';
import {
  assertSameIrreversibleOperation,
  type CreateAgentRunInput,
  type CreateCustomerRunInput,
  type IrreversibleOperationInput,
  type IrreversibleOperationReservation,
  type SessionControl,
} from './contracts.js';
import type {
  MemoryIrreversibleOperationRecord,
} from './memoryStoreConfirmationResumeOperations.js';
import {
  captureActiveMemorySessionAuthority,
} from './memoryStoreSessionAuthority.js';

interface MemoryCreationState {
  sessionControls: Map<string, SessionControl>;
  irreversibleOperations: Map<string, MemoryIrreversibleOperationRecord>;
}

export function reserveMemoryIrreversibleOperation(
  input: IrreversibleOperationInput,
  storage: MemoryCreationState,
): IrreversibleOperationReservation {
  const generation = captureActiveMemorySessionAuthority(
    storage.sessionControls,
    input.sessionId,
  );
  const existing = storage.irreversibleOperations.get(input.requestId);
  if (existing) {
    assertSameIrreversibleOperation(existing.input, input);
    if (
      generation === undefined ||
      generation !== existing.sessionAuthorityGeneration
    ) {
      throw new Error('session_ai_authority_unavailable');
    }
    if (existing.status === 'completed') {
      return {
        status: 'completed',
        result: structuredClone(existing.result!),
      };
    }
    if (
      existing.status !== 'unknown' &&
      existing.leaseExpiresAt > Date.now()
    ) {
      return { status: 'pending' };
    }
    existing.status = 'attempting';
    existing.attempt += 1;
    existing.leaseToken = crypto.randomUUID();
    existing.leaseExpiresAt = Date.now() + 30_000;
    return {
      status: 'reserved',
      attempt: existing.attempt,
      leaseToken: existing.leaseToken,
      reconciliation: true,
      sessionAuthorityGeneration: generation,
    };
  }

  if (generation === undefined) {
    throw new Error('session_ai_authority_unavailable');
  }
  const record: MemoryIrreversibleOperationRecord = {
    input: structuredClone(input),
    status: 'attempting',
    attempt: 1,
    leaseToken: crypto.randomUUID(),
    leaseExpiresAt: Date.now() + 30_000,
    sessionAuthorityGeneration: generation,
  };
  storage.irreversibleOperations.set(input.requestId, record);
  return {
    status: 'reserved',
    attempt: 1,
    leaseToken: record.leaseToken,
    reconciliation: false,
    sessionAuthorityGeneration: generation,
  };
}

export function getMemoryIrreversibleOperation(
  input: IrreversibleOperationInput,
  storage: MemoryCreationState,
): IrreversibleOperationReservation | undefined {
  const existing = storage.irreversibleOperations.get(input.requestId);
  if (!existing) return undefined;
  assertSameIrreversibleOperation(existing.input, input);
  if (
    captureActiveMemorySessionAuthority(
      storage.sessionControls,
      input.sessionId,
    ) !== existing.sessionAuthorityGeneration
  ) {
    return undefined;
  }
  if (existing.status === 'completed') {
    return {
      status: 'completed',
      result: structuredClone(existing.result!),
    };
  }
  return existing.status === 'unknown'
    ? { status: 'unknown', lastError: existing.lastError ?? null }
    : { status: 'pending' };
}

export function createMemoryCustomerRun(input: {
  operation: CreateCustomerRunInput;
  sessionControls: Map<string, SessionControl>;
  customerRuns: Map<string, CustomerRun>;
  requestIndex: Map<string, string>;
}): CustomerRun {
  const { operation } = input;
  const requestKey = customerRequestKey(
    operation.sessionId,
    operation.clientMessageId,
  );
  const existingRunId = input.requestIndex.get(requestKey);
  if (existingRunId) {
    const existing = input.customerRuns.get(existingRunId);
    if (!existing) {
      throw new Error(`Customer run index is corrupt: ${existingRunId}`);
    }
    if (existing.requestFingerprint !== operation.requestFingerprint) {
      throw new CustomerRunIdempotencyConflictError(
        operation.sessionId,
        operation.clientMessageId,
      );
    }
    return existing;
  }

  const sessionAuthorityGeneration = captureActiveMemorySessionAuthority(
    input.sessionControls,
    operation.sessionId,
  );
  if (sessionAuthorityGeneration === undefined) {
    throw new Error('session_ai_authority_unavailable');
  }
  const run: CustomerRun = {
    ...operation,
    sessionAuthorityGeneration,
  };
  input.customerRuns.set(operation.id, run);
  input.requestIndex.set(requestKey, operation.id);
  return run;
}

export function createMemoryAgentRun(input: {
  operation: CreateAgentRunInput;
  sessionControls: Map<string, SessionControl>;
  agentRuns: Map<string, AgentRun>;
}): AgentRun {
  const now = new Date('2026-07-07T00:00:00.000Z').toISOString();
  const sessionAuthorityGeneration = captureActiveMemorySessionAuthority(
    input.sessionControls,
    input.operation.sessionId,
  );
  if (sessionAuthorityGeneration === undefined) {
    throw new Error('session_ai_authority_unavailable');
  }
  const run: AgentRun = {
    ...input.operation,
    sessionAuthorityGeneration,
    executionAttempt: 0,
    executionLeaseToken: null,
    executionLeaseExpiresAt: null,
    supersededByRunId: input.operation.supersededByRunId ?? null,
    irreversibleSideEffectAt:
      input.operation.irreversibleSideEffectAt ?? null,
    irreversibleToolName: input.operation.irreversibleToolName ?? null,
    assistantTurnId: input.operation.assistantTurnId ?? null,
    deliveryExternalMessageId:
      input.operation.deliveryExternalMessageId ?? null,
    errorCode: input.operation.errorCode ?? null,
    errorMessage: input.operation.errorMessage ?? null,
    startedAt: input.operation.startedAt ?? null,
    completedAt: input.operation.completedAt ?? null,
    updatedAt: input.operation.updatedAt ?? now,
  };
  input.agentRuns.set(run.id, run);
  return run;
}

function customerRequestKey(
  sessionId: string,
  clientMessageId: string,
): string {
  return `${sessionId}:${clientMessageId}`;
}
