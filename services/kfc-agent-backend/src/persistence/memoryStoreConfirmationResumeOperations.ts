import {
  assertSameIrreversibleOperation,
  type IrreversibleOperationCompletion,
  type IrreversibleOperationInput,
  type IrreversibleOperationOwner,
  type MarkIrreversibleOperationOutcomeUnknownIfExpiredInput,
  type MarkIrreversibleOperationOutcomeUnknownIfExpiredResult,
  type ReserveConfirmationResumeOperationInput,
  type ReserveConfirmationResumeOperationResult,
} from './contracts.js';
import {
  confirmationResumeOperationAuthorityMatches,
  parseConfirmationPauseRecord,
  parseReserveConfirmationResumeOperationInput,
} from './confirmationPause.js';

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

export function markMemoryIrreversibleOperationOutcomeUnknownIfExpired(
  input: {
    operation: MarkIrreversibleOperationOutcomeUnknownIfExpiredInput;
    operations: Map<string, MemoryIrreversibleOperationRecord>;
    activeAuthorityGeneration(sessionId: string): number | undefined;
  },
): MarkIrreversibleOperationOutcomeUnknownIfExpiredResult {
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
      `Irreversible operation reservation not found: ${
        input.operation.requestId
      }`,
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
      `Irreversible operation reservation not found: ${
        input.operation.requestId
      }`,
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

export async function reserveMemoryConfirmationResumeOperation(input: {
  value: ReserveConfirmationResumeOperationInput;
  currentGeneration(sessionId: string): number;
  getPause(requestId: string): unknown | undefined;
  getPauseGeneration(requestId: string): number | undefined;
  getPauseAuthorityGeneration(requestId: string): number | undefined;
  getPauseIdentityDigest(requestId: string): string | undefined;
  activeAuthorityGeneration(sessionId: string): number | undefined;
  operations: Map<string, MemoryIrreversibleOperationRecord>;
  withLock<Result>(operation: () => Promise<Result>): Promise<Result>;
}): Promise<ReserveConfirmationResumeOperationResult> {
  const value = await parseReserveConfirmationResumeOperationInput(
    input.value,
  );
  return input.withLock(async () => {
    if (
      input.currentGeneration(value.sessionId) !==
        value.expectedSessionGeneration
    ) {
      return { status: 'not_found' };
    }
    const storedPause = input.getPause(value.requestId);
    const activeAuthorityGeneration =
      input.activeAuthorityGeneration(value.sessionId);
    if (
      storedPause === undefined ||
      input.getPauseGeneration(value.requestId) !==
        value.expectedSessionGeneration ||
      activeAuthorityGeneration === undefined ||
      input.getPauseAuthorityGeneration(value.requestId) !==
        activeAuthorityGeneration ||
      input.getPauseIdentityDigest(value.requestId) !==
        value.pauseIdentityDigest
    ) {
      return { status: 'not_found' };
    }
    const pause = await parseConfirmationPauseRecord(storedPause);
    if (
      input.currentGeneration(value.sessionId) !==
        value.expectedSessionGeneration
    ) {
      return { status: 'not_found' };
    }
    if (
      pause.status === 'expired' ||
      Date.parse(pause.expiresAt) <= Date.parse(value.claimedAt)
    ) {
      return { status: 'expired' };
    }
    if (
      !(await confirmationResumeOperationAuthorityMatches(pause, value))
    ) {
      return { status: 'conflict' };
    }
    if (
      input.currentGeneration(value.sessionId) !==
        value.expectedSessionGeneration
    ) {
      return { status: 'not_found' };
    }

    const operationInput: IrreversibleOperationInput = {
      requestId: value.requestId,
      sessionId: value.sessionId,
      operation: value.operation,
      bindingFingerprint: value.bindingFingerprint,
    };
    const sessionAuthorityGeneration =
      input.activeAuthorityGeneration(value.sessionId);
    if (sessionAuthorityGeneration === undefined) {
      return { status: 'conflict' };
    }
    const existing = input.operations.get(value.requestId);
    if (existing) {
      try {
        assertSameIrreversibleOperation(existing.input, operationInput);
      } catch {
        return { status: 'conflict' };
      }
      if (existing.status === 'completed') {
        return {
          status: 'completed',
          result: structuredClone(existing.result!),
        };
      }
      const claimedAt = Date.parse(value.claimedAt);
      if (
        existing.sessionAuthorityGeneration ===
          sessionAuthorityGeneration &&
        (
          existing.status === 'unknown' ||
          existing.leaseExpiresAt <= claimedAt
        )
      ) {
        existing.status = 'attempting';
        existing.attempt += 1;
        existing.leaseToken = crypto.randomUUID();
        existing.leaseExpiresAt = claimedAt + value.leaseTtlMs;
        existing.lastError = undefined;
        return {
          status: 'reserved',
          attempt: existing.attempt,
          leaseToken: existing.leaseToken,
          reconciliation: true,
          sessionAuthorityGeneration,
        };
      }
      return { status: 'pending' };
    }
    const leaseToken = crypto.randomUUID();
    input.operations.set(value.requestId, {
      input: structuredClone(operationInput),
      status: 'attempting',
      attempt: 1,
      leaseToken,
      leaseExpiresAt: Date.parse(value.claimedAt) + value.leaseTtlMs,
      sessionAuthorityGeneration,
    });
    return {
      status: 'reserved',
      attempt: 1,
      leaseToken,
      reconciliation: false,
      sessionAuthorityGeneration,
    };
  });
}
