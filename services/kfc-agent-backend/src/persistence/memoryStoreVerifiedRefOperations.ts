import {
  issueVerifiedRefRecord,
  verifiedRefRecordSchema,
  type IssueVerifiedRefInput,
  type VerifiedRef,
  type VerifiedRefLifecycle,
  type VerifiedRefRecord,
} from '../domain/verifiedRef.js';
import type {
  AuthenticatedCommerceApprovalPrincipal,
} from '../ordering/types.js';
import type {
  ClaimVerifiedRefInput,
  ClaimVerifiedRefResult,
  IsRunCommitFenceCurrentInput,
  IssueVerifiedRefResult,
  ResolveVerifiedRefInput,
} from './contracts.js';
import type { VerifiedRefStorageSnapshot } from './verifiedRef.js';
import {
  cloneVerifiedRefRecord,
  parseClaimVerifiedRefInput,
  parseResolveVerifiedRefInput,
} from './verifiedRefOperations.js';

interface PersistenceLock {
  tail: Promise<void>;
  release(): void;
}

export interface MemoryVerifiedRefStorageSnapshot
  extends VerifiedRefStorageSnapshot
{
  /** Immutable storage owner used by reset without parsing the payload. */
  sessionId: string;
  /** Immutable lookup envelope checked before parsing untrusted payload data. */
  authority: MemoryVerifiedRefAuthority;
}

interface MemoryVerifiedRefAuthority {
  readonly ref: VerifiedRef;
  readonly principal: AuthenticatedCommerceApprovalPrincipal;
  readonly verifiedRevision: string;
  readonly lifecycle: VerifiedRefLifecycle;
  readonly createdAt: string;
  readonly expiresAt: string;
}

export abstract class MemoryStoreVerifiedRefOperations {
  protected readonly confirmationPauseGenerations = new Map<string, number>();
  protected readonly verifiedRefs =
    new Map<string, MemoryVerifiedRefStorageSnapshot>();
  private persistenceLock: Promise<void> = Promise.resolve();

  protected abstract verifiedRefRunFenceIsCurrent(
    input: IsRunCommitFenceCurrentInput,
  ): boolean;

  async issueVerifiedRef(
    rawInput: IssueVerifiedRefInput,
  ): Promise<IssueVerifiedRefResult> {
    const record = issueVerifiedRefRecord(rawInput);
    const capturedGeneration =
      this.confirmationPauseGenerations.get(record.principal.sessionId) ?? 0;
    return this.withConfirmationPauseLock(async () => {
      if (
        (this.confirmationPauseGenerations.get(
          record.principal.sessionId,
        ) ?? 0) !== capturedGeneration
      ) {
        return { status: 'generation_conflict' };
      }
      if (this.verifiedRefs.has(record.ref.id)) {
        throw new Error('verified_ref_id_collision');
      }
      this.verifiedRefs.set(
        record.ref.id,
        memoryVerifiedRefStorageSnapshot(record, capturedGeneration),
      );
      return {
        status: 'created',
        record: cloneVerifiedRefRecord(record),
      };
    });
  }

  async resolveVerifiedRef(
    rawInput: ResolveVerifiedRefInput,
  ): Promise<VerifiedRefRecord | undefined> {
    const input = parseResolveVerifiedRefInput(rawInput);
    return this.withConfirmationPauseLock(async () => {
      const snapshot = this.verifiedRefs.get(input.ref.id);
      if (!snapshot) return undefined;
      const currentGeneration =
        this.confirmationPauseGenerations.get(input.principal.sessionId) ?? 0;
      if (
        !memoryVerifiedRefAuthorityMatches(
          snapshot,
          currentGeneration,
          input,
          'replayable',
        )
      ) {
        return undefined;
      }
      return cloneVerifiedRefRecord(
        parseMemoryVerifiedRefRecord(snapshot),
      );
    });
  }

  async claimVerifiedRef(
    rawInput: ClaimVerifiedRefInput,
  ): Promise<ClaimVerifiedRefResult> {
    const input = parseClaimVerifiedRefInput(rawInput);
    return this.withConfirmationPauseLock(async () => {
      if (!this.verifiedRefRunFenceIsCurrent(input.runFence)) {
        return { status: 'unavailable' };
      }
      const snapshot = this.verifiedRefs.get(input.ref.id);
      if (!snapshot) return { status: 'unavailable' };
      const currentGeneration =
        this.confirmationPauseGenerations.get(input.principal.sessionId) ?? 0;
      if (
        !memoryVerifiedRefAuthorityMatches(
          snapshot,
          currentGeneration,
          input,
          'one_shot',
        )
      ) {
        return { status: 'unavailable' };
      }
      const existing = parseMemoryVerifiedRefRecord(snapshot);
      if (existing.claimedUseId !== undefined) {
        return existing.claimedUseId === input.useId
          ? {
              status: 'replay',
              record: cloneVerifiedRefRecord(existing),
            }
          : { status: 'unavailable' };
      }
      const claimed = verifiedRefRecordSchema.parse({
        ...existing,
        claimedUseId: input.useId,
        claimedAt: input.now,
      });
      this.verifiedRefs.set(input.ref.id, {
        record: cloneVerifiedRefRecord(claimed),
        sessionGeneration: snapshot.sessionGeneration,
        sessionId: snapshot.sessionId,
        authority: snapshot.authority,
      });
      return {
        status: 'claimed',
        record: cloneVerifiedRefRecord(claimed),
      };
    });
  }

  protected async withConfirmationPauseLock<Result>(
    operation: () => Promise<Result>,
  ): Promise<Result> {
    const previous = this.persistenceLock;
    const lock = createPersistenceLock(previous);
    this.persistenceLock = lock.tail;
    await previous;
    try {
      return await operation();
    } finally {
      lock.release();
      if (this.persistenceLock === lock.tail) {
        this.persistenceLock = Promise.resolve();
      }
    }
  }
}

export function memoryVerifiedRefStorageSnapshot(
  record: VerifiedRefRecord,
  sessionGeneration: number,
): MemoryVerifiedRefStorageSnapshot {
  const authority = Object.freeze({
    ref: Object.freeze(structuredClone(record.ref)),
    principal: Object.freeze(structuredClone(record.principal)),
    verifiedRevision: record.verifiedRevision,
    lifecycle: record.lifecycle,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
  });
  return {
    record: cloneVerifiedRefRecord(record),
    sessionGeneration,
    sessionId: record.principal.sessionId,
    authority,
  };
}

function memoryVerifiedRefAuthorityMatches(
  snapshot: MemoryVerifiedRefStorageSnapshot,
  currentSessionGeneration: number,
  input: ResolveVerifiedRefInput,
  lifecycle: VerifiedRefLifecycle,
): boolean {
  const authority = snapshot.authority;
  return (
    snapshot.sessionId === input.principal.sessionId &&
    snapshot.sessionGeneration === currentSessionGeneration &&
    authority.lifecycle === lifecycle &&
    authority.ref.id === input.ref.id &&
    authority.ref.kind === input.ref.kind &&
    authority.principal.sessionId === input.principal.sessionId &&
    authority.principal.customerId === input.principal.customerId &&
    authority.principal.channel === input.principal.channel &&
    authority.principal.authenticatedSubject ===
      input.principal.authenticatedSubject &&
    authority.principal.authenticationEvidenceRef ===
      input.principal.authenticationEvidenceRef &&
    authority.verifiedRevision === input.expectedVerifiedRevision &&
    Date.parse(authority.createdAt) <= Date.parse(input.now) &&
    Date.parse(authority.expiresAt) > Date.parse(input.now)
  );
}

function parseMemoryVerifiedRefRecord(
  snapshot: MemoryVerifiedRefStorageSnapshot,
): VerifiedRefRecord {
  const record = verifiedRefRecordSchema.parse(snapshot.record);
  const authority = snapshot.authority;
  if (
    record.ref.id !== authority.ref.id ||
    record.ref.kind !== authority.ref.kind ||
    record.principal.sessionId !== authority.principal.sessionId ||
    record.principal.customerId !== authority.principal.customerId ||
    record.principal.channel !== authority.principal.channel ||
    record.principal.authenticatedSubject !==
      authority.principal.authenticatedSubject ||
    record.principal.authenticationEvidenceRef !==
      authority.principal.authenticationEvidenceRef ||
    record.verifiedRevision !== authority.verifiedRevision ||
    record.lifecycle !== authority.lifecycle ||
    record.createdAt !== authority.createdAt ||
    record.expiresAt !== authority.expiresAt
  ) {
    throw new Error('verified_ref_stored_authority_mismatch');
  }
  return record;
}

function createPersistenceLock(previous: Promise<void>): PersistenceLock {
  let release = (): void => undefined;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    tail: previous.then(() => current),
    release,
  };
}
