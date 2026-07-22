import type {
  BeginNonAgentTextDeliveryAttemptInput,
  BeginNonAgentTextDeliveryAttemptResult,
  CompleteNonAgentTextDeliveryAttemptInput,
  CompleteNonAgentTextDeliveryAttemptResult,
  NonAgentTextDeliveryRecord,
  ReconcileNonAgentTextDeliveryInput,
  ReconcileNonAgentTextDeliveryResult,
  ReserveNonAgentTextDeliveryInput,
  ReserveNonAgentTextDeliveryResult,
  ReserveWebhookDeliveryInput,
  ReserveWebhookDeliveryResult,
  SessionControl,
  WebhookDelivery,
} from './contracts.js';
import {
  beginNonAgentTextDeliveryAttempt,
  completeNonAgentTextDeliveryAttempt,
  createPendingNonAgentTextDelivery,
  nonAgentTextDeliveryAgentBindingDigest,
  nonAgentTextDeliverySessionBindingDigest,
  reconcileNonAgentTextDelivery,
  sameNonAgentTextDeliveryBinding,
} from './nonAgentTextDelivery.js';
import { effectiveMemorySessionControl } from './memoryStoreSessionAuthority.js';

function clone<Record>(record: Record): Record {
  return structuredClone(record);
}

function authorityMatches(
  input: {
    sessionId: string;
    expectedSessionAuthorityGeneration: number;
    expectedAgentId: string;
  },
  sessionControls: ReadonlyMap<string, SessionControl>,
): boolean {
  const control = effectiveMemorySessionControl(
    sessionControls,
    input.sessionId,
  );
  return (
    control.sessionAuthorityGeneration ===
      input.expectedSessionAuthorityGeneration &&
    control.agentMode === 'human_paused' &&
    control.assignedAgentId === input.expectedAgentId
  );
}

export function reserveMemoryWebhookDelivery(
  input: ReserveWebhookDeliveryInput,
  deliveries: Map<string, WebhookDelivery>,
): ReserveWebhookDeliveryResult {
  const key = `${input.channel}:${input.externalEventId}`;
  const existing = deliveries.get(key);
  if (existing) return { delivery: existing, reserved: false };
  const now = new Date('2026-07-07T00:00:00.000Z').toISOString();
  const delivery: WebhookDelivery = {
    ...input,
    status: 'received',
    processedAt: null,
    failedAt: null,
    lastError: null,
    createdAt: now,
    updatedAt: now,
  };
  deliveries.set(key, delivery);
  return { delivery, reserved: true };
}

export async function reserveMemoryNonAgentTextDelivery(
  input: ReserveNonAgentTextDeliveryInput,
  storage: {
    sessionControls: ReadonlyMap<string, SessionControl>;
    nonAgentTextDeliveries: Map<string, NonAgentTextDeliveryRecord>;
  },
): Promise<ReserveNonAgentTextDeliveryResult> {
  const candidate = await createPendingNonAgentTextDelivery(input);
  const existing = storage.nonAgentTextDeliveries.get(input.requestKey);
  if (existing) {
    return sameNonAgentTextDeliveryBinding(existing, candidate)
      ? { status: 'replay', record: clone(existing) }
      : { status: 'conflict' };
  }
  if (!authorityMatches(input, storage.sessionControls)) {
    return { status: 'stale_authority' };
  }
  storage.nonAgentTextDeliveries.set(input.requestKey, candidate);
  return { status: 'reserved', record: clone(candidate) };
}

export async function beginMemoryNonAgentTextDeliveryAttempt(
  input: BeginNonAgentTextDeliveryAttemptInput,
  storage: {
    sessionControls: ReadonlyMap<string, SessionControl>;
    nonAgentTextDeliveries: Map<string, NonAgentTextDeliveryRecord>;
    attemptTokens: Set<string>;
  },
): Promise<BeginNonAgentTextDeliveryAttemptResult> {
  const existing = storage.nonAgentTextDeliveries.get(input.requestKey);
  const expectedSessionBindingDigest =
    await nonAgentTextDeliverySessionBindingDigest(input.sessionId);
  if (
    !existing ||
    existing.sessionBindingDigest !== expectedSessionBindingDigest
  ) {
    return { status: 'dispatch_blocked', reason: 'not_found' };
  }
  const expectedAgentBindingDigest =
    await nonAgentTextDeliveryAgentBindingDigest(input.expectedAgentId);
  if (
    existing.reservedSessionAuthorityGeneration !==
      input.expectedSessionAuthorityGeneration ||
    existing.agentBindingDigest !== expectedAgentBindingDigest ||
    !authorityMatches(input, storage.sessionControls)
  ) {
    return {
      status: 'dispatch_blocked',
      reason: 'stale_authority',
      record: clone(existing),
    };
  }
  if (storage.attemptTokens.has(input.deliveryAttemptToken)) {
    return {
      status: 'dispatch_blocked',
      reason: 'delivery_attempt_token_reused',
      record: clone(existing),
    };
  }
  const result = beginNonAgentTextDeliveryAttempt(existing, input);
  if (result.status === 'dispatch_authorized') {
    storage.nonAgentTextDeliveries.set(input.requestKey, result.record);
    storage.attemptTokens.add(input.deliveryAttemptToken);
  }
  return clone(result);
}

export async function completeMemoryNonAgentTextDeliveryAttempt(
  input: CompleteNonAgentTextDeliveryAttemptInput,
  deliveries: Map<string, NonAgentTextDeliveryRecord>,
): Promise<CompleteNonAgentTextDeliveryAttemptResult> {
  const existing = deliveries.get(input.requestKey);
  if (!existing) {
    return { status: 'transition_blocked', reason: 'not_found' };
  }
  if (
    existing.sessionBindingDigest !==
    (await nonAgentTextDeliverySessionBindingDigest(input.sessionId))
  ) {
    return {
      status: 'transition_blocked',
      reason: 'session_mismatch',
      record: clone(existing),
    };
  }
  const result = completeNonAgentTextDeliveryAttempt(existing, input);
  if (result.status === 'transitioned') {
    deliveries.set(input.requestKey, result.record);
  }
  return clone(result);
}

export async function reconcileMemoryNonAgentTextDelivery(
  input: ReconcileNonAgentTextDeliveryInput,
  deliveries: Map<string, NonAgentTextDeliveryRecord>,
): Promise<ReconcileNonAgentTextDeliveryResult> {
  const existing = deliveries.get(input.requestKey);
  if (!existing) {
    return { status: 'reconciliation_blocked', reason: 'not_found' };
  }
  if (
    existing.sessionBindingDigest !==
    (await nonAgentTextDeliverySessionBindingDigest(input.sessionId))
  ) {
    return {
      status: 'reconciliation_blocked',
      reason: 'session_mismatch',
      record: clone(existing),
    };
  }
  const result = reconcileNonAgentTextDelivery(existing, input);
  if (result.status === 'reconciled') {
    deliveries.set(input.requestKey, result.record);
  }
  return clone(result);
}
