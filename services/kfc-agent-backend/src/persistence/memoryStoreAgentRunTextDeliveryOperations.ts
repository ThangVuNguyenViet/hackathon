import type {
  AgentRunTextDeliveryRecord,
  BeginAgentRunTextDeliveryAttemptInput,
  BeginAgentRunTextDeliveryAttemptResult,
  CompleteAgentRunTextDeliveryAttemptInput,
  CompleteAgentRunTextDeliveryAttemptResult,
  CreatePendingAgentRunTextDeliveryInput,
  ReconcileAgentRunTextDeliveryInput,
  ReconcileAgentRunTextDeliveryResult,
} from './agentRunTextDelivery.js';
import type {
  ClaimAgentRunExecutionInput,
  ClaimAgentRunExecutionResult,
  CreateAgentRunTextDeliveryResult,
  SupersedeAgentRunExecutionIfNoLongerCurrentInput,
  SupersedeAgentRunExecutionIfNoLongerCurrentResult,
} from './contracts.js';
import {
  beginMemoryAgentRunTextDeliveryAttempt,
  completeMemoryAgentRunTextDeliveryAttempt,
  createMemoryAgentRunTextDelivery,
  getMemoryAgentRunTextDelivery,
  reconcileMemoryAgentRunTextDelivery,
  reconcileExpiredSendingMemoryAgentRun,
  supersedeMemoryAgentRunExecutionIfNoLongerCurrent,
  type MemoryAgentRunTextDeliveryState,
} from './memoryStoreAgentRunTextDelivery.js';
import { claimMemoryAgentRunExecution } from './memoryStoreAgentRunOwnership.js';
import { MemoryStoreVerifiedRefOperations } from './memoryStoreVerifiedRefOperations.js';

export abstract class MemoryStoreAgentRunTextDeliveryOperations extends MemoryStoreVerifiedRefOperations {
  protected readonly agentRunTextDeliveries = new Map<
    string,
    AgentRunTextDeliveryRecord
  >();

  protected abstract memoryAgentRunTextDeliveryState(): MemoryAgentRunTextDeliveryState;
  protected abstract memoryAgentRunState(): Parameters<
    typeof claimMemoryAgentRunExecution
  >[1];

  protected clearOrphanedAgentRunTextDeliveries(): void {
    const state = this.memoryAgentRunTextDeliveryState();
    for (const runId of this.agentRunTextDeliveries.keys()) {
      if (!state.agentRuns.has(runId)) {
        this.agentRunTextDeliveries.delete(runId);
      }
    }
  }

  async claimAgentRunExecution(
    input: ClaimAgentRunExecutionInput,
  ): Promise<ClaimAgentRunExecutionResult> {
    return this.withStoreLock(async () => {
      const reconciled = reconcileExpiredSendingMemoryAgentRun({
        runId: input.runId,
        reconciledAt: input.claimedAt,
        storage: this.memoryAgentRunTextDeliveryState(),
      });
      return (
        reconciled ??
        claimMemoryAgentRunExecution(input, this.memoryAgentRunState())
      );
    });
  }

  async supersedeAgentRunExecutionIfNoLongerCurrent(
    input: SupersedeAgentRunExecutionIfNoLongerCurrentInput,
  ): Promise<SupersedeAgentRunExecutionIfNoLongerCurrentResult> {
    return this.withStoreLock(async () =>
      supersedeMemoryAgentRunExecutionIfNoLongerCurrent(
        input,
        this.memoryAgentRunTextDeliveryState(),
      ),
    );
  }

  async createAgentRunTextDelivery(
    input: CreatePendingAgentRunTextDeliveryInput,
  ): Promise<CreateAgentRunTextDeliveryResult> {
    return this.withStoreLock(async () =>
      createMemoryAgentRunTextDelivery(
        input,
        this.memoryAgentRunTextDeliveryState(),
      ),
    );
  }

  async getAgentRunTextDelivery(
    runId: string,
  ): Promise<AgentRunTextDeliveryRecord | undefined> {
    return getMemoryAgentRunTextDelivery(
      runId,
      this.memoryAgentRunTextDeliveryState(),
    );
  }

  async beginAgentRunTextDeliveryAttempt(
    input: BeginAgentRunTextDeliveryAttemptInput,
  ): Promise<BeginAgentRunTextDeliveryAttemptResult> {
    return this.withStoreLock(async () =>
      beginMemoryAgentRunTextDeliveryAttempt(
        input,
        this.memoryAgentRunTextDeliveryState(),
      ),
    );
  }

  async completeAgentRunTextDeliveryAttempt(
    input: CompleteAgentRunTextDeliveryAttemptInput,
  ): Promise<CompleteAgentRunTextDeliveryAttemptResult> {
    return this.withStoreLock(async () =>
      completeMemoryAgentRunTextDeliveryAttempt(
        input,
        this.memoryAgentRunTextDeliveryState(),
      ),
    );
  }

  async reconcileAgentRunTextDelivery(
    input: ReconcileAgentRunTextDeliveryInput,
  ): Promise<ReconcileAgentRunTextDeliveryResult> {
    return this.withStoreLock(async () =>
      reconcileMemoryAgentRunTextDelivery(
        input,
        this.memoryAgentRunTextDeliveryState(),
      ),
    );
  }
}
