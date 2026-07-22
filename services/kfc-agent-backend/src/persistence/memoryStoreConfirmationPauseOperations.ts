import type {
  ClaimConfirmationRejectionInput,
  ClaimConfirmationRejectionResult,
  CompleteConfirmationResumeInput,
  CompleteConfirmationResumeResult,
  ConfirmationPauseRecord,
  CreateConfirmationPauseInput,
  CreateConfirmationPauseResult,
} from './contracts.js';
import {
  completionMatches,
  confirmationRejectionAuthorityMatches,
  confirmationRejectionMatches,
  parseClaimConfirmationRejectionInput,
  parseCompleteConfirmationResumeInput,
  parseConfirmationPauseRecord,
  rejectionClaimReplays,
  type ConfirmationPauseStorageSnapshot,
} from './confirmationPause.js';
import { currentMemoryConfirmationPause } from './memoryStoreConfirmationPauseSnapshot.js';
import { MemoryStoreNonAgentTextDeliveryOperations } from './memoryStoreNonAgentTextDeliveryOperations.js';
import { createMemoryConfirmationPause } from './memoryStorePauseCommit.js';

export abstract class MemoryStoreConfirmationPauseOperations extends MemoryStoreNonAgentTextDeliveryOperations {
  protected readonly confirmationPauses = new Map<string, unknown>();
  protected readonly confirmationPauseSessions = new Map<string, string>();
  protected readonly confirmationPauseStoredGenerations = new Map<
    string,
    number
  >();
  protected readonly confirmationPauseStoredAuthorityGenerations = new Map<
    string,
    number
  >();
  protected readonly confirmationPauseIdentityDigests = new Map<
    string,
    string
  >();

  async createConfirmationPause(
    value: CreateConfirmationPauseInput,
  ): Promise<CreateConfirmationPauseResult> {
    return createMemoryConfirmationPause({
      value,
      confirmationPauseGenerations: this.confirmationPauseGenerations,
      confirmationPauses: this.confirmationPauses,
      confirmationPauseSessions: this.confirmationPauseSessions,
      confirmationPauseStoredGenerations:
        this.confirmationPauseStoredGenerations,
      confirmationPauseStoredAuthorityGenerations:
        this.confirmationPauseStoredAuthorityGenerations,
      confirmationPauseIdentityDigests: this.confirmationPauseIdentityDigests,
      sessionControls: this.memoryNonAgentSessionControls(),
      withLock: (operation) => this.withConfirmationPauseLock(operation),
    });
  }

  async getConfirmationPauseStorageSnapshot(
    requestId: string,
  ): Promise<ConfirmationPauseStorageSnapshot | undefined> {
    return this.withConfirmationPauseLock(() =>
      this.currentConfirmationPause(requestId),
    );
  }

  async getConfirmationPause(
    requestId: string,
  ): Promise<ConfirmationPauseRecord | undefined> {
    return (await this.getConfirmationPauseStorageSnapshot(requestId))?.record;
  }

  async claimConfirmationRejection(
    value: ClaimConfirmationRejectionInput,
  ): Promise<ClaimConfirmationRejectionResult> {
    const input = await parseClaimConfirmationRejectionInput(value);
    return this.withConfirmationPauseLock(async () => {
      const snapshot = await this.currentConfirmationPause(input.requestId);
      if (!snapshot) return { status: 'not_found' };
      const existing = snapshot.record;
      if (existing.status === 'expired') return { status: 'expired' };
      if (existing.status === 'rejected') {
        return rejectionClaimReplays(existing, input)
          ? { status: 'replay', record: structuredClone(existing) }
          : { status: 'conflict' };
      }
      if (!(await confirmationRejectionAuthorityMatches(existing, input))) {
        return { status: 'conflict' };
      }
      if (Date.parse(existing.expiresAt) <= Date.parse(input.rejectedAt)) {
        const expired: ConfirmationPauseRecord = {
          ...existing,
          status: 'expired',
        };
        await parseConfirmationPauseRecord(expired);
        this.confirmationPauses.set(input.requestId, structuredClone(expired));
        return { status: 'expired' };
      }
      if (!(await confirmationRejectionMatches(existing, input))) {
        return { status: 'conflict' };
      }
      const rejected: ConfirmationPauseRecord = {
        ...existing,
        status: 'rejected',
        rejectionReceipt: structuredClone(input.receipt),
        rejectedAt: input.rejectedAt,
      };
      await parseConfirmationPauseRecord(rejected);
      this.confirmationPauses.set(input.requestId, structuredClone(rejected));
      return { status: 'claimed', record: structuredClone(rejected) };
    });
  }

  async completeConfirmationResume(
    value: CompleteConfirmationResumeInput,
  ): Promise<CompleteConfirmationResumeResult> {
    const input = parseCompleteConfirmationResumeInput(value);
    return this.withConfirmationPauseLock(async () => {
      const snapshot = await this.currentConfirmationPause(input.requestId);
      if (!snapshot) return { status: 'lost' };
      const existing = snapshot.record;
      if (
        existing.status !== 'rejected' ||
        existing.rejectionReceipt?.receiptId !== input.receiptId ||
        !existing.rejectedAt ||
        Date.parse(input.completedAt) < Date.parse(existing.rejectedAt)
      ) {
        return { status: 'conflict' };
      }
      if (existing.completionStatus !== 'pending') {
        return completionMatches(existing, input)
          ? { status: 'replay', record: structuredClone(existing) }
          : { status: 'conflict' };
      }
      const completed: ConfirmationPauseRecord =
        input.completion.status === 'completed'
          ? {
              ...existing,
              completionStatus: 'completed',
              result: structuredClone(input.completion.result),
              completionError: null,
              completedAt: input.completedAt,
            }
          : {
              ...existing,
              completionStatus: 'failed',
              result: null,
              completionError: input.completion.error,
              completedAt: input.completedAt,
            };
      await parseConfirmationPauseRecord(completed);
      this.confirmationPauses.set(input.requestId, structuredClone(completed));
      return { status: 'completed', record: structuredClone(completed) };
    });
  }

  async findConfirmationPause(
    requestId: string,
  ): Promise<ConfirmationPauseRecord | undefined> {
    return this.getConfirmationPause(requestId);
  }

  private currentConfirmationPause(
    requestId: string,
  ): Promise<ConfirmationPauseStorageSnapshot | undefined> {
    return currentMemoryConfirmationPause({
      requestId,
      confirmationPauses: this.confirmationPauses,
      confirmationPauseSessions: this.confirmationPauseSessions,
      confirmationPauseGenerations: this.confirmationPauseGenerations,
      confirmationPauseStoredGenerations:
        this.confirmationPauseStoredGenerations,
      confirmationPauseStoredAuthorityGenerations:
        this.confirmationPauseStoredAuthorityGenerations,
      confirmationPauseIdentityDigests: this.confirmationPauseIdentityDigests,
      sessionControls: this.memoryNonAgentSessionControls(),
    });
  }
}
