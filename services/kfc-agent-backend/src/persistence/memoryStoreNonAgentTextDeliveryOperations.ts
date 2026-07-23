import type {
  AppendConversationTurnInput,
  BeginNonAgentTextDeliveryAttemptInput,
  BeginNonAgentTextDeliveryAttemptResult,
  CompleteNonAgentTextDeliveryAttemptInput,
  CompleteNonAgentTextDeliveryAttemptResult,
  NonAgentTextDeliveryRecord,
  PrepareNonAgentTextDeliveryTurnInput,
  PrepareNonAgentTextDeliveryTurnResult,
  ReconcileNonAgentTextDeliveryInput,
  ReconcileNonAgentTextDeliveryResult,
  ReserveNonAgentTextDeliveryInput,
  ReserveNonAgentTextDeliveryResult,
  SessionControl,
} from './contracts.js';
import type { ConversationTurn } from '../domain/types.js';
import { MemoryStoreAgentRunTextDeliveryOperations } from './memoryStoreAgentRunTextDeliveryOperations.js';
import {
  beginMemoryNonAgentTextDeliveryAttempt,
  completeMemoryNonAgentTextDeliveryAttempt,
  reconcileMemoryNonAgentTextDelivery,
  reserveMemoryNonAgentTextDelivery,
} from './memoryStoreNonAgentTextDelivery.js';
import {
  nonAgentTextDeliveryAgentBindingDigest,
  nonAgentTextDeliverySessionBindingDigest,
  nonAgentTextDeliveryTurnBindingMatches,
  samePreparedNonAgentTextDeliveryTurn,
} from './nonAgentTextDelivery.js';
import {
  effectiveMemorySessionControl,
} from './memoryStoreSessionAuthority.js';

export abstract class MemoryStoreNonAgentTextDeliveryOperations
  extends MemoryStoreAgentRunTextDeliveryOperations
{
  protected readonly nonAgentTextDeliveries =
    new Map<string, NonAgentTextDeliveryRecord>();
  private readonly nonAgentTextDeliveryAttemptTokens = new Set<string>();

  protected abstract memoryNonAgentSessionControls():
    ReadonlyMap<string, SessionControl>;
  protected abstract memoryNonAgentTurns(): readonly ConversationTurn[];
  protected abstract appendMemoryNonAgentTurn(
    input: AppendConversationTurnInput,
  ): Promise<ConversationTurn>;

  async reserveNonAgentTextDelivery(
    input: ReserveNonAgentTextDeliveryInput,
  ): Promise<ReserveNonAgentTextDeliveryResult> {
    return this.withConfirmationPauseLock(async () =>
      reserveMemoryNonAgentTextDelivery(input, {
        sessionControls: this.memoryNonAgentSessionControls(),
        nonAgentTextDeliveries: this.nonAgentTextDeliveries,
      }));
  }

  async getNonAgentTextDelivery(
    requestKey: string,
  ): Promise<NonAgentTextDeliveryRecord | undefined> {
    const record = this.nonAgentTextDeliveries.get(requestKey);
    return record ? structuredClone(record) : undefined;
  }

  async prepareNonAgentTextDeliveryTurn(
    input: PrepareNonAgentTextDeliveryTurnInput,
  ): Promise<PrepareNonAgentTextDeliveryTurnResult> {
    return this.withConfirmationPauseLock(async () => {
      const record = this.nonAgentTextDeliveries.get(input.requestKey);
      if (
        !record ||
        record.sessionBindingDigest !==
          await nonAgentTextDeliverySessionBindingDigest(input.sessionId)
      ) {
        return { status: 'prepare_blocked', reason: 'not_found' };
      }
      const control = effectiveMemorySessionControl(
        this.memoryNonAgentSessionControls(),
        input.sessionId,
      );
      if (
        record.reservedSessionAuthorityGeneration !==
          input.expectedSessionAuthorityGeneration ||
        record.agentBindingDigest !==
          await nonAgentTextDeliveryAgentBindingDigest(input.expectedAgentId) ||
        control.sessionAuthorityGeneration !==
          input.expectedSessionAuthorityGeneration ||
        control.agentMode !== 'human_paused' ||
        control.assignedAgentId !== input.expectedAgentId
      ) {
        return {
          status: 'prepare_blocked',
          reason: 'stale_authority',
          record: structuredClone(record),
        };
      }
      if (
        record.status !== 'pending' &&
        record.status !== 'confirmed_not_sent'
      ) {
        return {
          status: 'prepare_blocked',
          reason: 'delivery_not_dispatchable',
          record: structuredClone(record),
        };
      }
      if (!await nonAgentTextDeliveryTurnBindingMatches(record, input)) {
        return {
          status: 'prepare_blocked',
          reason: 'turn_binding_conflict',
          record: structuredClone(record),
        };
      }
      const existing = this.memoryNonAgentTurns()
        .find((turn) => turn.id === input.turn.id);
      if (existing) {
        return samePreparedNonAgentTextDeliveryTurn(existing, input.turn)
          ? {
              status: 'replay',
              turn: structuredClone(existing),
              record: structuredClone(record),
            }
          : {
              status: 'prepare_blocked',
              reason: 'turn_binding_conflict',
              record: structuredClone(record),
              turn: structuredClone(existing),
            };
      }
      const turn = await this.appendMemoryNonAgentTurn(input.turn);
      return samePreparedNonAgentTextDeliveryTurn(turn, input.turn)
        ? {
            status: 'prepared',
            turn,
            record: structuredClone(record),
          }
        : {
            status: 'prepare_blocked',
            reason: 'turn_binding_conflict',
            record: structuredClone(record),
            turn,
          };
    });
  }

  async beginNonAgentTextDeliveryAttempt(
    input: BeginNonAgentTextDeliveryAttemptInput,
  ): Promise<BeginNonAgentTextDeliveryAttemptResult> {
    return this.withConfirmationPauseLock(async () =>
      beginMemoryNonAgentTextDeliveryAttempt(input, {
        sessionControls: this.memoryNonAgentSessionControls(),
        nonAgentTextDeliveries: this.nonAgentTextDeliveries,
        attemptTokens: this.nonAgentTextDeliveryAttemptTokens,
      }));
  }

  async completeNonAgentTextDeliveryAttempt(
    input: CompleteNonAgentTextDeliveryAttemptInput,
  ): Promise<CompleteNonAgentTextDeliveryAttemptResult> {
    return this.withConfirmationPauseLock(async () =>
      completeMemoryNonAgentTextDeliveryAttempt(
        input,
        this.nonAgentTextDeliveries,
      ));
  }

  async reconcileNonAgentTextDelivery(
    input: ReconcileNonAgentTextDeliveryInput,
  ): Promise<ReconcileNonAgentTextDeliveryResult> {
    return this.withConfirmationPauseLock(async () =>
      reconcileMemoryNonAgentTextDelivery(
        input,
        this.nonAgentTextDeliveries,
      ));
  }
}
