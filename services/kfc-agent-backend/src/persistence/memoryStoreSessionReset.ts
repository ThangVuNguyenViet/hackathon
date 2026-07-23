import type {
  AgentRun,
  AgentRunTurn,
  ConversationTurn,
  PendingCustomerTurn,
  SessionAgentState,
} from '../domain/types.js';
import type {
  CustomerRun,
  CustomerRunEvent,
} from '../customerRuns/contracts.js';
import {
  SessionResetConflictError,
  type NonAgentTextDeliveryRecord,
  type SessionControl,
  type SessionResetHook,
  type StoredEvent,
  type WebhookDelivery,
  type ConversationSummary,
} from './contracts.js';
import type { PackStateEnvelope } from '../runtime/businessPack.js';
import {
  abandonPendingNonAgentTextDelivery,
  nonAgentTextDeliverySessionBindingDigest,
  reconcileNonAgentTextDelivery,
} from './nonAgentTextDelivery.js';
import { effectiveMemorySessionControl } from './memoryStoreSessionAuthority.js';
import type { MemoryIrreversibleOperationRecord } from './memoryStoreIrreversibleOperations.js';
import type { MemoryVerifiedRefStorageSnapshot } from './memoryStoreVerifiedRefOperations.js';

export interface MemorySessionResetState {
  sessionGenerations: Map<string, number>;
  verifiedRefs: Map<string, MemoryVerifiedRefStorageSnapshot>;
  customerRuns: Map<string, CustomerRun>;
  customerRunRequestIndex: Map<string, string>;
  customerRunEvents: CustomerRunEvent[];
  agentRuns: Map<string, AgentRun>;
  agentRunTurns: AgentRunTurn[];
  pendingCustomerTurns: PendingCustomerTurn[];
  turns: ConversationTurn[];
  conversationSummaries: Map<string, ConversationSummary>;
  packStates: Map<string, PackStateEnvelope>;
  events: StoredEvent[];
  webhookDeliveries: Map<string, WebhookDelivery>;
  nonAgentTextDeliveries: Map<string, NonAgentTextDeliveryRecord>;
  irreversibleOperations: Map<string, MemoryIrreversibleOperationRecord>;
  sessionControls: Map<string, SessionControl>;
  sessionAgentStates: Map<string, SessionAgentState>;
  sessionResetHook?: SessionResetHook;
}

export async function resetMemorySession(
  sessionId: string,
  state: MemorySessionResetState,
): Promise<SessionControl> {
  const resetAt = new Date().toISOString();
  const sessionBindingDigest =
    await nonAgentTextDeliverySessionBindingDigest(sessionId);
  const nonAgentDeliveries = [...state.nonAgentTextDeliveries.entries()].filter(
    ([, delivery]) => delivery.sessionBindingDigest === sessionBindingDigest,
  );
  const activeNonAgentSend = nonAgentDeliveries.some(
    ([, delivery]) =>
      (delivery.status === 'sending' &&
        delivery.sendingLeaseExpiresAt > resetAt) ||
      (delivery.status === 'pending' && delivery.updatedAt > resetAt),
  );
  if (activeNonAgentSend) throw new SessionResetConflictError();
  for (const [requestKey, delivery] of nonAgentDeliveries) {
    if (delivery.status === 'pending') {
      state.nonAgentTextDeliveries.set(
        requestKey,
        abandonPendingNonAgentTextDelivery(delivery, resetAt),
      );
      continue;
    }
    if (delivery.status === 'sending') {
      const reconciled = reconcileNonAgentTextDelivery(delivery, {
        deliveryAttempt: delivery.deliveryAttempt,
        deliveryAttemptToken: delivery.deliveryAttemptToken,
        reason: 'reset_sending_lease_expired',
        reconciledAt: resetAt,
      });
      if (reconciled.status !== 'reconciled') {
        throw new SessionResetConflictError();
      }
      state.nonAgentTextDeliveries.set(requestKey, reconciled.record);
    }
  }

  state.sessionGenerations.set(
    sessionId,
    (state.sessionGenerations.get(sessionId) ?? 0) + 1,
  );
  for (const [refId, snapshot] of state.verifiedRefs) {
    if (snapshot.sessionId === sessionId) {
      state.verifiedRefs.delete(refId);
    }
  }
  const customerRunIds = new Set(
    [...state.customerRuns.values()]
      .filter((run) => run.sessionId === sessionId)
      .map((run) => run.id),
  );
  const agentRunIds = new Set(
    [...state.agentRuns.values()]
      .filter((run) => run.sessionId === sessionId)
      .map((run) => run.id),
  );

  removeWhere(state.customerRunEvents, (event) =>
    customerRunIds.has(event.runId),
  );
  removeWhere(state.agentRunTurns, (link) => agentRunIds.has(link.runId));
  removeWhere(
    state.pendingCustomerTurns,
    (turn) => turn.sessionId === sessionId,
  );
  removeWhere(state.turns, (turn) => turn.sessionId === sessionId);
  state.conversationSummaries.delete(sessionId);
  for (const key of state.packStates.keys()) {
    if (key.startsWith(`${sessionId}\u0000`)) state.packStates.delete(key);
  }
  removeWhere(state.events, (event) => event.sessionId === sessionId);
  for (const runId of customerRunIds) state.customerRuns.delete(runId);
  for (const [key, runId] of state.customerRunRequestIndex) {
    if (customerRunIds.has(runId)) {
      state.customerRunRequestIndex.delete(key);
    }
  }
  for (const runId of agentRunIds) state.agentRuns.delete(runId);
  for (const [key, delivery] of state.webhookDeliveries) {
    if (delivery.sessionId === sessionId) {
      state.webhookDeliveries.delete(key);
    }
  }
  for (const [requestId, reservation] of state.irreversibleOperations) {
    if (reservation.input.sessionId === sessionId) {
      state.irreversibleOperations.delete(requestId);
    }
  }
  const currentControl = effectiveMemorySessionControl(
    state.sessionControls,
    sessionId,
  );
  const control: SessionControl = {
    sessionId,
    agentMode: 'ai_active',
    assignedAgentId: null,
    sessionAuthorityGeneration: currentControl.sessionAuthorityGeneration + 1,
    updatedAt: new Date('2026-07-07T00:00:00.000Z').toISOString(),
  };
  state.sessionControls.set(sessionId, control);
  state.sessionAgentStates.delete(sessionId);
  await state.sessionResetHook?.(sessionId);
  return control;
}

function removeWhere<Value>(
  values: Value[],
  predicate: (value: Value) => boolean,
): void {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    if (predicate(values[index]!)) values.splice(index, 1);
  }
}
