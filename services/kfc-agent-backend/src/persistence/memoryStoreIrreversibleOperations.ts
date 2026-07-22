import {
  assertSameIrreversibleOperation,
  type IrreversibleOperationCompletion,
  type IrreversibleOperationInput,
  type IrreversibleOperationOwner,
  type MarkIrreversibleOperationOutcomeUnknownIfExpiredInput,
  type MarkIrreversibleOperationOutcomeUnknownIfExpiredResult,
} from './contracts.js';

export interface MemoryIrreversibleOperationRecord {
  input: IrreversibleOperationInput;
  status: 'attempting' | 'unknown' | 'completed';
  attempt: number;
  leaseToken: string;
  leaseExpiresAt: number;
  sessionAuthorityGeneration: number;
  lastError?: string;
  result?: Record<string, unknown>;
  completedAt?: number;
}

export function markMemoryIrreversibleOperationOutcomeUnknownIfExpired(input: {
  operation: MarkIrreversibleOperationOutcomeUnknownIfExpiredInput;
  operations: Map<string, MemoryIrreversibleOperationRecord>;
  activeAuthorityGeneration(sessionId: string): number | undefined;
}): MarkIrreversibleOperationOutcomeUnknownIfExpiredResult {
  const existing = input.operations.get(input.operation.requestId);
  if (!existing) return { status: 'pending' };
  assertSameIrreversibleOperation(existing.input, input.operation);
  if (
    input.activeAuthorityGeneration(input.operation.sessionId) !==
    existing.sessionAuthorityGeneration
  ) {
    return { status: 'pending' };
  }
  if (existing.status === 'completed') {
    return {
      status: 'completed',
      result: structuredClone(existing.result!),
    };
  }
  if (existing.status === 'unknown') {
    return {
      status: 'unknown',
      lastError: existing.lastError ?? null,
      transitioned: false,
    };
  }
  if (existing.leaseExpiresAt > Date.now()) {
    return { status: 'pending' };
  }
  existing.status = 'unknown';
  existing.lastError = input.operation.reason;
  existing.leaseExpiresAt = 0;
  return {
    status: 'unknown',
    lastError: existing.lastError,
    transitioned: true,
  };
}

export function completeMemoryIrreversibleOperation(input: {
  operation: IrreversibleOperationInput;
  owner: IrreversibleOperationOwner;
  result: Record<string, unknown>;
  operations: Map<string, MemoryIrreversibleOperationRecord>;
  activeAuthorityGeneration(sessionId: string): number | undefined;
}): IrreversibleOperationCompletion {
  const existing = input.operations.get(input.operation.requestId);
  if (!existing) {
    throw new Error(
      `Irreversible operation reservation not found: ${input.operation.requestId}`,
    );
  }
  assertSameIrreversibleOperation(existing.input, input.operation);
  if (
    existing.sessionAuthorityGeneration !==
      input.owner.sessionAuthorityGeneration ||
    input.activeAuthorityGeneration(input.operation.sessionId) !==
      input.owner.sessionAuthorityGeneration
  ) {
    return { status: 'lost' };
  }
  if (existing.status === 'completed') {
    return {
      status: 'completed',
      result: structuredClone(existing.result!),
    };
  }
  if (
    existing.status !== 'attempting' ||
    existing.attempt !== input.owner.attempt ||
    existing.leaseToken !== input.owner.leaseToken ||
    existing.leaseExpiresAt <= Date.now() ||
    existing.sessionAuthorityGeneration !==
      input.owner.sessionAuthorityGeneration
  ) {
    return { status: 'lost' };
  }
  existing.result = structuredClone(input.result);
  existing.status = 'completed';
  existing.completedAt = Date.now();
  existing.leaseExpiresAt = 0;
  return {
    status: 'completed',
    result: structuredClone(existing.result),
  };
}

export function failMemoryIrreversibleOperation(input: {
  operation: IrreversibleOperationInput;
  owner: IrreversibleOperationOwner;
  error: string;
  operations: Map<string, MemoryIrreversibleOperationRecord>;
  activeAuthorityGeneration(sessionId: string): number | undefined;
}): void {
  const existing = input.operations.get(input.operation.requestId);
  if (!existing) {
    throw new Error(
      `Irreversible operation reservation not found: ${input.operation.requestId}`,
    );
  }
  assertSameIrreversibleOperation(existing.input, input.operation);
  if (
    existing.status !== 'attempting' ||
    existing.attempt !== input.owner.attempt ||
    existing.leaseToken !== input.owner.leaseToken ||
    existing.sessionAuthorityGeneration !==
      input.owner.sessionAuthorityGeneration ||
    existing.leaseExpiresAt <= Date.now() ||
    input.activeAuthorityGeneration(input.operation.sessionId) !==
      input.owner.sessionAuthorityGeneration
  ) {
    return;
  }
  existing.status = 'unknown';
  existing.lastError = input.error;
  existing.leaseExpiresAt = 0;
}
