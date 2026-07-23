import { z } from 'zod';
import type { ChannelTextSendOutcome } from '../clients/interfaces.js';
import type { ConversationTurn } from '../domain/types.js';

export const NON_AGENT_TEXT_DELIVERY_SCHEMA_VERSION =
  'kfc-non-agent-text-delivery-v1' as const;
export const MAXIMUM_NON_AGENT_TEXT_DELIVERY_ATTEMPTS = 3;

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/u);
const identifierSchema = z
  .string()
  .min(1)
  .max(512)
  .refine((value) => value === value.trim(), {
    message: 'identifier_must_be_trimmed',
  });
const instantSchema = z.string().refine(
  (value) => {
    try {
      return new Date(value).toISOString() === value;
    } catch {
      return false;
    }
  },
  {
    message: 'instant_must_be_canonical_utc',
  },
);
const attemptSchema = z
  .number()
  .int()
  .positive()
  .max(MAXIMUM_NON_AGENT_TEXT_DELIVERY_ATTEMPTS);
const outcomeCodeSchema = z
  .string()
  .min(1)
  .max(256)
  .refine((value) => value === value.trim(), {
    message: 'outcome_code_must_be_trimmed',
  });

const baseSchema = z
  .object({
    schemaVersion: z.literal(NON_AGENT_TEXT_DELIVERY_SCHEMA_VERSION),
    requestKey: sha256Schema,
    sessionBindingDigest: sha256Schema,
    reservedSessionAuthorityGeneration: z.number().int().nonnegative(),
    channel: z.enum(['kfc', 'messenger', 'zalo']),
    assistantTurnId: identifierSchema,
    agentBindingDigest: sha256Schema,
    recipientBindingDigest: sha256Schema,
    presentationBindingDigest: sha256Schema,
    deliveryBindingDigest: sha256Schema,
    createdAt: instantSchema,
    updatedAt: instantSchema,
  })
  .strict();

const pendingSchema = baseSchema
  .extend({
    status: z.literal('pending'),
    deliveryAttempt: z.literal(0),
    deliveryAttemptToken: z.null(),
    sendingLeaseExpiresAt: z.null(),
    providerMessageId: z.null(),
    outcomeCode: z.null(),
  })
  .strict();

const sendingSchema = baseSchema
  .extend({
    status: z.literal('sending'),
    deliveryAttempt: attemptSchema,
    deliveryAttemptToken: identifierSchema,
    sendingLeaseExpiresAt: instantSchema,
    providerMessageId: z.null(),
    outcomeCode: z.null(),
  })
  .strict();

const confirmedSentSchema = baseSchema
  .extend({
    status: z.literal('confirmed_sent'),
    deliveryAttempt: attemptSchema,
    deliveryAttemptToken: identifierSchema,
    sendingLeaseExpiresAt: z.null(),
    providerMessageId: identifierSchema.nullable(),
    outcomeCode: z.null(),
  })
  .strict()
  .refine(
    (value) => value.channel === 'kfc' || value.providerMessageId !== null,
    { message: 'provider_message_id_required' },
  );

const confirmedNotSentSchema = baseSchema
  .extend({
    status: z.literal('confirmed_not_sent'),
    deliveryAttempt: attemptSchema,
    deliveryAttemptToken: identifierSchema,
    sendingLeaseExpiresAt: z.null(),
    providerMessageId: z.null(),
    outcomeCode: outcomeCodeSchema,
  })
  .strict();

const resetAbandonedSchema = baseSchema
  .extend({
    status: z.literal('confirmed_not_sent'),
    deliveryAttempt: z.literal(0),
    deliveryAttemptToken: z.null(),
    sendingLeaseExpiresAt: z.null(),
    providerMessageId: z.null(),
    outcomeCode: z.literal('non_agent_delivery_abandoned_by_reset'),
  })
  .strict();

const outcomeUnknownSchema = baseSchema
  .extend({
    status: z.literal('outcome_unknown'),
    deliveryAttempt: attemptSchema,
    deliveryAttemptToken: identifierSchema,
    sendingLeaseExpiresAt: z.null(),
    providerMessageId: z.null(),
    outcomeCode: outcomeCodeSchema,
  })
  .strict();

export const nonAgentTextDeliveryRecordSchema = z.union([
  pendingSchema,
  sendingSchema,
  confirmedSentSchema,
  confirmedNotSentSchema,
  resetAbandonedSchema,
  outcomeUnknownSchema,
]);

export type NonAgentTextDeliveryRecord = z.infer<
  typeof nonAgentTextDeliveryRecordSchema
>;

export interface ReserveNonAgentTextDeliveryInput {
  requestKey: string;
  sessionId: string;
  expectedSessionAuthorityGeneration: number;
  expectedAgentId: string;
  channel: NonAgentTextDeliveryRecord['channel'];
  assistantTurnId: string;
  /** Used only for its SHA-256 binding; never retained. */
  recipientId: string;
  /** Used only for its SHA-256 binding; never retained. */
  presentationText: string;
  createdAt: string;
}

export type ReserveNonAgentTextDeliveryResult =
  | {
      status: 'reserved' | 'replay';
      record: NonAgentTextDeliveryRecord;
    }
  | { status: 'conflict' | 'stale_authority' };

export interface PrepareNonAgentTextDeliveryTurnInput {
  requestKey: string;
  sessionId: string;
  expectedSessionAuthorityGeneration: number;
  expectedAgentId: string;
  /**
   * `ordinal` is a zero placeholder at this boundary; the store replaces it
   * with its atomic per-session allocation before publication.
   */
  turn: ConversationTurn;
}

export type PrepareNonAgentTextDeliveryTurnResult =
  | {
      status: 'prepared' | 'replay';
      turn: ConversationTurn;
      record: NonAgentTextDeliveryRecord;
    }
  | {
      status: 'prepare_blocked';
      reason:
        | 'not_found'
        | 'stale_authority'
        | 'delivery_not_dispatchable'
        | 'turn_binding_conflict';
      record?: NonAgentTextDeliveryRecord;
      turn?: ConversationTurn;
    };

export interface BeginNonAgentTextDeliveryAttemptInput {
  requestKey: string;
  sessionId: string;
  expectedSessionAuthorityGeneration: number;
  expectedAgentId: string;
  nextDeliveryAttempt: number;
  deliveryAttemptToken: string;
  leaseExpiresAt: string;
  updatedAt: string;
}

export type BeginNonAgentTextDeliveryAttemptResult =
  | {
      status: 'dispatch_authorized';
      record: Extract<NonAgentTextDeliveryRecord, { status: 'sending' }>;
    }
  | {
      status: 'dispatch_blocked';
      reason:
        | 'stale_authority'
        | 'not_found'
        | 'delivery_attempt_not_next'
        | 'delivery_attempt_token_invalid'
        | 'delivery_attempt_token_reused'
        | 'sending_lease_invalid'
        | 'updated_at_invalid'
        | 'sending_in_progress'
        | 'confirmed_sent'
        | 'outcome_unknown'
        | 'attempts_exhausted';
      record?: NonAgentTextDeliveryRecord;
    };

export interface CompleteNonAgentTextDeliveryAttemptInput {
  requestKey: string;
  sessionId: string;
  deliveryAttempt: number;
  deliveryAttemptToken: string;
  outcome: ChannelTextSendOutcome;
  updatedAt: string;
}

export type CompleteNonAgentTextDeliveryAttemptResult =
  | {
      status: 'transitioned';
      record: Exclude<
        NonAgentTextDeliveryRecord,
        { status: 'pending' | 'sending' }
      >;
    }
  | {
      status: 'transition_blocked';
      reason:
        | 'not_found'
        | 'session_mismatch'
        | 'delivery_not_sending'
        | 'delivery_attempt_mismatch'
        | 'provider_message_id_invalid'
        | 'updated_at_invalid';
      record?: NonAgentTextDeliveryRecord;
    };

export interface ReconcileNonAgentTextDeliveryInput {
  requestKey: string;
  sessionId: string;
  deliveryAttempt: number;
  deliveryAttemptToken: string;
  reason:
    | 'sending_lease_expired'
    | 'completion_persistence_failed'
    | 'reset_sending_lease_expired';
  reconciledAt: string;
}

export type ReconcileNonAgentTextDeliveryResult =
  | {
      status: 'reconciled' | 'replay';
      record: Extract<
        NonAgentTextDeliveryRecord,
        { status: 'outcome_unknown' }
      >;
    }
  | {
      status: 'reconciliation_blocked';
      reason:
        | 'not_found'
        | 'session_mismatch'
        | 'delivery_not_sending'
        | 'delivery_attempt_mismatch'
        | 'sending_lease_active'
        | 'updated_at_invalid';
      record?: NonAgentTextDeliveryRecord;
    };

export async function createPendingNonAgentTextDelivery(
  input: ReserveNonAgentTextDeliveryInput,
): Promise<Extract<NonAgentTextDeliveryRecord, { status: 'pending' }>> {
  const requestKey = sha256Schema.parse(input.requestKey);
  const sessionId = identifierSchema.parse(input.sessionId);
  const channel = z.enum(['kfc', 'messenger', 'zalo']).parse(input.channel);
  const assistantTurnId = identifierSchema.parse(input.assistantTurnId);
  const agentId = identifierSchema.parse(input.expectedAgentId);
  const recipientId = identifierSchema.parse(input.recipientId);
  if (input.presentationText.trim().length === 0) {
    throw new Error('non_agent_text_delivery_presentation_empty');
  }
  const createdAt = instantSchema.parse(input.createdAt);
  const agentBindingDigest =
    await nonAgentTextDeliveryAgentBindingDigest(agentId);
  const sessionBindingDigest =
    await nonAgentTextDeliverySessionBindingDigest(sessionId);
  const recipientBindingDigest = await sha256Binding([
    'kfc-non-agent-text-delivery-recipient-v1',
    channel,
    recipientId,
  ]);
  const presentationBindingDigest = await sha256Binding([
    'kfc-non-agent-text-delivery-presentation-v1',
    channel,
    input.presentationText,
  ]);
  const deliveryBindingDigest = await sha256Binding([
    NON_AGENT_TEXT_DELIVERY_SCHEMA_VERSION,
    requestKey,
    sessionBindingDigest,
    input.expectedSessionAuthorityGeneration,
    channel,
    assistantTurnId,
    agentBindingDigest,
    recipientBindingDigest,
    presentationBindingDigest,
  ]);
  return pendingSchema.parse({
    schemaVersion: NON_AGENT_TEXT_DELIVERY_SCHEMA_VERSION,
    requestKey,
    sessionBindingDigest,
    reservedSessionAuthorityGeneration:
      input.expectedSessionAuthorityGeneration,
    channel,
    assistantTurnId,
    agentBindingDigest,
    recipientBindingDigest,
    presentationBindingDigest,
    deliveryBindingDigest,
    status: 'pending',
    deliveryAttempt: 0,
    deliveryAttemptToken: null,
    sendingLeaseExpiresAt: null,
    providerMessageId: null,
    outcomeCode: null,
    createdAt,
    updatedAt: createdAt,
  });
}

export function beginNonAgentTextDeliveryAttempt(
  rawRecord: NonAgentTextDeliveryRecord,
  input: Pick<
    BeginNonAgentTextDeliveryAttemptInput,
    | 'nextDeliveryAttempt'
    | 'deliveryAttemptToken'
    | 'leaseExpiresAt'
    | 'updatedAt'
  >,
): BeginNonAgentTextDeliveryAttemptResult {
  const record = nonAgentTextDeliveryRecordSchema.parse(rawRecord);
  if (record.status === 'sending') {
    return blockedBegin('sending_in_progress', record);
  }
  if (record.status === 'confirmed_sent') {
    return blockedBegin('confirmed_sent', record);
  }
  if (record.status === 'outcome_unknown') {
    return blockedBegin('outcome_unknown', record);
  }
  if (record.deliveryAttempt >= MAXIMUM_NON_AGENT_TEXT_DELIVERY_ATTEMPTS) {
    return blockedBegin('attempts_exhausted', record);
  }
  if (input.nextDeliveryAttempt !== record.deliveryAttempt + 1) {
    return blockedBegin('delivery_attempt_not_next', record);
  }
  if (!identifierSchema.safeParse(input.deliveryAttemptToken).success) {
    return blockedBegin('delivery_attempt_token_invalid', record);
  }
  const updatedAt = nextInstant(record.updatedAt, input.updatedAt);
  if (!updatedAt) return blockedBegin('updated_at_invalid', record);
  const leaseExpiresAt = instantSchema.safeParse(input.leaseExpiresAt);
  if (!leaseExpiresAt.success || leaseExpiresAt.data <= updatedAt) {
    return blockedBegin('sending_lease_invalid', record);
  }
  return {
    status: 'dispatch_authorized',
    record: sendingSchema.parse({
      ...record,
      status: 'sending',
      deliveryAttempt: input.nextDeliveryAttempt,
      deliveryAttemptToken: input.deliveryAttemptToken,
      sendingLeaseExpiresAt: leaseExpiresAt.data,
      providerMessageId: null,
      outcomeCode: null,
      updatedAt,
    }),
  };
}

export function completeNonAgentTextDeliveryAttempt(
  rawRecord: NonAgentTextDeliveryRecord,
  input: Pick<
    CompleteNonAgentTextDeliveryAttemptInput,
    'deliveryAttempt' | 'deliveryAttemptToken' | 'outcome' | 'updatedAt'
  >,
): CompleteNonAgentTextDeliveryAttemptResult {
  const record = nonAgentTextDeliveryRecordSchema.parse(rawRecord);
  if (record.status !== 'sending') {
    return blockedComplete('delivery_not_sending', record);
  }
  if (
    record.deliveryAttempt !== input.deliveryAttempt ||
    record.deliveryAttemptToken !== input.deliveryAttemptToken
  ) {
    return blockedComplete('delivery_attempt_mismatch', record);
  }
  const updatedAt = nextInstant(record.updatedAt, input.updatedAt);
  if (!updatedAt) return blockedComplete('updated_at_invalid', record);
  if (input.outcome.status === 'confirmed_sent') {
    const messageId =
      record.channel === 'kfc' && input.outcome.messageId.length === 0
        ? null
        : input.outcome.messageId;
    const parsedMessageId = identifierSchema.nullable().safeParse(messageId);
    if (
      !parsedMessageId.success ||
      (record.channel !== 'kfc' && parsedMessageId.data === null)
    ) {
      return blockedComplete('provider_message_id_invalid', record);
    }
    return {
      status: 'transitioned',
      record: confirmedSentSchema.parse({
        ...record,
        status: 'confirmed_sent',
        sendingLeaseExpiresAt: null,
        providerMessageId: parsedMessageId.data,
        outcomeCode: null,
        updatedAt,
      }),
    };
  }
  const status =
    input.outcome.status === 'delivery_outcome_unknown'
      ? 'outcome_unknown'
      : 'confirmed_not_sent';
  const outcomeCode =
    status === 'outcome_unknown'
      ? 'non_agent_delivery_outcome_unknown'
      : 'non_agent_delivery_confirmed_not_sent';
  const terminal = {
    ...record,
    status,
    sendingLeaseExpiresAt: null,
    providerMessageId: null,
    outcomeCode,
    updatedAt,
  };
  return status === 'outcome_unknown'
    ? { status: 'transitioned', record: outcomeUnknownSchema.parse(terminal) }
    : {
        status: 'transitioned',
        record: confirmedNotSentSchema.parse(terminal),
      };
}

export function reconcileNonAgentTextDelivery(
  rawRecord: NonAgentTextDeliveryRecord,
  input: Pick<
    ReconcileNonAgentTextDeliveryInput,
    'deliveryAttempt' | 'deliveryAttemptToken' | 'reason' | 'reconciledAt'
  >,
): ReconcileNonAgentTextDeliveryResult {
  const record = nonAgentTextDeliveryRecordSchema.parse(rawRecord);
  if (record.status === 'outcome_unknown') {
    return { status: 'replay', record };
  }
  if (record.status !== 'sending') {
    return blockedReconcile('delivery_not_sending', record);
  }
  if (
    record.deliveryAttempt !== input.deliveryAttempt ||
    record.deliveryAttemptToken !== input.deliveryAttemptToken
  ) {
    return blockedReconcile('delivery_attempt_mismatch', record);
  }
  const reconciledAt = nextInstant(record.updatedAt, input.reconciledAt);
  if (!reconciledAt) {
    return blockedReconcile('updated_at_invalid', record);
  }
  if (
    input.reason !== 'completion_persistence_failed' &&
    reconciledAt < record.sendingLeaseExpiresAt
  ) {
    return blockedReconcile('sending_lease_active', record);
  }
  const outcomeCode = `non_agent_delivery_${input.reason}`;
  return {
    status: 'reconciled',
    record: outcomeUnknownSchema.parse({
      ...record,
      status: 'outcome_unknown',
      sendingLeaseExpiresAt: null,
      providerMessageId: null,
      outcomeCode,
      updatedAt: reconciledAt,
    }),
  };
}

export function abandonPendingNonAgentTextDelivery(
  rawRecord: NonAgentTextDeliveryRecord,
  updatedAt: string,
): NonAgentTextDeliveryRecord {
  const record = nonAgentTextDeliveryRecordSchema.parse(rawRecord);
  if (record.status !== 'pending') return record;
  const nextUpdatedAt = nextInstant(record.updatedAt, updatedAt);
  if (!nextUpdatedAt) {
    throw new Error('non_agent_text_delivery_reset_time_invalid');
  }
  return resetAbandonedSchema.parse({
    ...record,
    status: 'confirmed_not_sent',
    outcomeCode: 'non_agent_delivery_abandoned_by_reset',
    updatedAt: nextUpdatedAt,
  });
}

export function sameNonAgentTextDeliveryBinding(
  left: NonAgentTextDeliveryRecord,
  right: NonAgentTextDeliveryRecord,
): boolean {
  return (
    left.requestKey === right.requestKey &&
    left.sessionBindingDigest === right.sessionBindingDigest &&
    left.reservedSessionAuthorityGeneration ===
      right.reservedSessionAuthorityGeneration &&
    left.channel === right.channel &&
    left.assistantTurnId === right.assistantTurnId &&
    left.agentBindingDigest === right.agentBindingDigest &&
    left.recipientBindingDigest === right.recipientBindingDigest &&
    left.presentationBindingDigest === right.presentationBindingDigest &&
    left.deliveryBindingDigest === right.deliveryBindingDigest
  );
}

export async function nonAgentTextDeliveryAgentBindingDigest(
  agentId: string,
): Promise<string> {
  return sha256Binding([
    'kfc-non-agent-text-delivery-agent-v1',
    identifierSchema.parse(agentId),
  ]);
}

export async function nonAgentTextDeliveryTurnBindingMatches(
  record: NonAgentTextDeliveryRecord,
  input: PrepareNonAgentTextDeliveryTurnInput,
): Promise<boolean> {
  const turn = input.turn;
  if (
    turn.id !== record.assistantTurnId ||
    turn.sessionId !== input.sessionId ||
    turn.channel !== record.channel ||
    turn.role !== 'assistant' ||
    turn.externalMessageId !== null ||
    typeof turn.externalUserId !== 'string' ||
    turn.deliveryStatus !== 'pending' ||
    turn.metadata?.authorType !== 'human_agent' ||
    turn.metadata.agentId !== input.expectedAgentId
  ) {
    return false;
  }
  const candidate = await createPendingNonAgentTextDelivery({
    requestKey: input.requestKey,
    sessionId: input.sessionId,
    expectedSessionAuthorityGeneration:
      input.expectedSessionAuthorityGeneration,
    expectedAgentId: input.expectedAgentId,
    channel: record.channel,
    assistantTurnId: turn.id,
    recipientId: turn.externalUserId,
    presentationText: turn.text,
    createdAt: record.createdAt,
  });
  return sameNonAgentTextDeliveryBinding(record, candidate);
}

export function samePreparedNonAgentTextDeliveryTurn(
  existing: ConversationTurn,
  expected: ConversationTurn,
): boolean {
  return (
    existing.id === expected.id &&
    existing.sessionId === expected.sessionId &&
    existing.channel === expected.channel &&
    existing.role === expected.role &&
    existing.text === expected.text &&
    existing.externalMessageId === expected.externalMessageId &&
    existing.externalUserId === expected.externalUserId &&
    existing.metadata?.authorType === expected.metadata?.authorType &&
    existing.metadata?.agentId === expected.metadata?.agentId
  );
}

export async function nonAgentTextDeliverySessionBindingDigest(
  sessionId: string,
): Promise<string> {
  return sha256Binding([
    'kfc-non-agent-text-delivery-session-v1',
    identifierSchema.parse(sessionId),
  ]);
}

function nextInstant(current: string, candidate: string): string | undefined {
  const parsed = instantSchema.safeParse(candidate);
  return parsed.success && parsed.data >= current ? parsed.data : undefined;
}

function blockedBegin(
  reason: Extract<
    BeginNonAgentTextDeliveryAttemptResult,
    { status: 'dispatch_blocked' }
  >['reason'],
  record: NonAgentTextDeliveryRecord,
): BeginNonAgentTextDeliveryAttemptResult {
  return { status: 'dispatch_blocked', reason, record };
}

function blockedComplete(
  reason: Extract<
    CompleteNonAgentTextDeliveryAttemptResult,
    { status: 'transition_blocked' }
  >['reason'],
  record: NonAgentTextDeliveryRecord,
): CompleteNonAgentTextDeliveryAttemptResult {
  return { status: 'transition_blocked', reason, record };
}

function blockedReconcile(
  reason: Extract<
    ReconcileNonAgentTextDeliveryResult,
    { status: 'reconciliation_blocked' }
  >['reason'],
  record: NonAgentTextDeliveryRecord,
): ReconcileNonAgentTextDeliveryResult {
  return { status: 'reconciliation_blocked', reason, record };
}

async function sha256Binding(values: readonly unknown[]): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(values));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
