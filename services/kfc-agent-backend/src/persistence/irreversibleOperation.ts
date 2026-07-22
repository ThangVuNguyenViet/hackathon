export interface IrreversibleOperationInput {
  requestId: string;
  sessionId: string;
  operation: string;
  bindingFingerprint: string;
}

export type IrreversibleOperationReservation =
  | {
      status: 'reserved';
      attempt: number;
      leaseToken: string;
      reconciliation: boolean;
      sessionAuthorityGeneration: number;
    }
  | { status: 'pending' }
  | { status: 'unknown'; lastError: string | null }
  | { status: 'completed'; result: Record<string, unknown> };

export type IrreversibleOperationCompletion =
  { status: 'completed'; result: Record<string, unknown> } | { status: 'lost' };

export interface IrreversibleOperationOwner {
  attempt: number;
  leaseToken: string;
  sessionAuthorityGeneration: number;
}

export interface MarkIrreversibleOperationOutcomeUnknownIfExpiredInput extends IrreversibleOperationInput {
  /** Server-owned diagnostic persisted when the lease expires unresolved. */
  reason: string;
}

export type MarkIrreversibleOperationOutcomeUnknownIfExpiredResult =
  | { status: 'completed'; result: Record<string, unknown> }
  | { status: 'pending' }
  | {
      status: 'unknown';
      lastError: string | null;
      transitioned: boolean;
    };

export class SessionResetConflictError extends Error {
  readonly code = 'session_reset_conflict';

  constructor() {
    super('Session reset conflicts with an unresolved irreversible operation');
    this.name = 'SessionResetConflictError';
  }
}

export function assertSameIrreversibleOperation(
  existing: IrreversibleOperationInput,
  input: IrreversibleOperationInput,
): void {
  if (
    existing.sessionId !== input.sessionId ||
    existing.operation !== input.operation ||
    existing.bindingFingerprint !== input.bindingFingerprint
  ) {
    throw new Error(
      `Irreversible operation binding conflict: ${input.requestId}`,
    );
  }
}
