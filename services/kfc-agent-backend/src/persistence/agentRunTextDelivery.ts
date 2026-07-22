import { z } from 'zod';
import type {
  ChannelTextSendOutcome,
} from '../clients/interfaces.js';
import {
  MAXIMUM_AGENT_RUN_EXECUTION_ATTEMPTS,
} from './agentRunExecutionLease.js';

const schemaVersion = 'kfc-agent-run-text-delivery-v1' as const;
const sha256Pattern = /^[0-9a-f]{64}$/u;

export const MAXIMUM_AGENT_RUN_TEXT_DELIVERY_ATTEMPTS = 3;

const deliveryAttemptSchema = z
  .number()
  .int()
  .positive()
  .max(MAXIMUM_AGENT_RUN_TEXT_DELIVERY_ATTEMPTS);

const runExecutionAttemptSchema = z
  .number()
  .int()
  .positive()
  .max(MAXIMUM_AGENT_RUN_EXECUTION_ATTEMPTS);

function hasCompleteTokenHistory(value: {
  deliveryAttempt: number;
  deliveryAttemptToken: string | null;
  priorDeliveryAttemptTokens: string[];
  runExecutionOriginAttempt: number;
  runExecutionAttempt: number;
  runExecutionLeaseTokenDigest: string;
  priorRunExecutionLeaseTokenDigests: string[];
}): boolean {
  const deliveryHistoryComplete =
    value.deliveryAttemptToken === null
      ? value.deliveryAttempt === 0 &&
        value.priorDeliveryAttemptTokens.length === 0
      : value.priorDeliveryAttemptTokens.length ===
          value.deliveryAttempt - 1 &&
        !value.priorDeliveryAttemptTokens.includes(
          value.deliveryAttemptToken,
        );
  return (
    deliveryHistoryComplete &&
    value.runExecutionOriginAttempt <=
      value.runExecutionAttempt &&
    value.priorRunExecutionLeaseTokenDigests.length ===
      value.runExecutionAttempt -
        value.runExecutionOriginAttempt &&
    !value.priorRunExecutionLeaseTokenDigests.includes(
      value.runExecutionLeaseTokenDigest,
    )
  );
}

function lastDeliveryMatchesCurrentExecution(value: {
  lastDeliveryRunExecutionAttempt: number | null;
  runExecutionAttempt: number;
}): boolean {
  return value.lastDeliveryRunExecutionAttempt ===
    value.runExecutionAttempt;
}

function confirmedNotSentExecutionIsRetryable(value: {
  lastDeliveryRunExecutionAttempt: number | null;
  runExecutionAttempt: number;
}): boolean {
  return (
    value.lastDeliveryRunExecutionAttempt !== null &&
    (
      value.runExecutionAttempt ===
        value.lastDeliveryRunExecutionAttempt ||
      value.runExecutionAttempt ===
        value.lastDeliveryRunExecutionAttempt + 1
    )
  );
}

const exactIdentifierSchema = z
  .string()
  .min(1)
  .max(512)
  .refine((value) => value === value.trim(), {
    message: 'identifier_must_be_trimmed',
  });

const priorDeliveryAttemptTokensSchema = z
  .array(exactIdentifierSchema)
  .max(MAXIMUM_AGENT_RUN_TEXT_DELIVERY_ATTEMPTS - 1)
  .refine((tokens) => new Set(tokens).size === tokens.length, {
    message: 'prior_delivery_attempt_tokens_must_be_unique',
  });

const priorRunExecutionLeaseTokenDigestsSchema = z
  .array(z.string().regex(sha256Pattern))
  .max(MAXIMUM_AGENT_RUN_EXECUTION_ATTEMPTS - 1)
  .refine((digests) => new Set(digests).size === digests.length, {
    message:
      'prior_run_execution_lease_token_digests_must_be_unique',
  });

const outcomeCodeSchema = z
  .string()
  .min(1)
  .max(256)
  .refine((value) => value === value.trim(), {
    message: 'outcome_code_must_be_trimmed',
  });

const canonicalInstantSchema = z
  .string()
  .refine((value) => {
    try {
      return new Date(value).toISOString() === value;
    } catch {
      return false;
    }
  }, {
    message: 'instant_must_be_canonical_utc',
  });

const executionBindingSchema = z
  .object({
    runId: exactIdentifierSchema,
    executionAttempt: runExecutionAttemptSchema,
    executionLeaseToken: exactIdentifierSchema,
  })
  .strict();

const deliveryBaseSchema = z
  .object({
    schemaVersion: z.literal(schemaVersion),
    runId: exactIdentifierSchema,
    runExecutionOriginAttempt: runExecutionAttemptSchema,
    runExecutionAttempt: runExecutionAttemptSchema,
    runExecutionLeaseToken: exactIdentifierSchema,
    runExecutionLeaseTokenDigest: z.string().regex(sha256Pattern),
    priorRunExecutionLeaseTokenDigests:
      priorRunExecutionLeaseTokenDigestsSchema,
    lastDeliveryRunExecutionAttempt:
      runExecutionAttemptSchema.nullable(),
    channel: z.enum(['messenger', 'zalo']),
    assistantTurnId: exactIdentifierSchema,
    recipientBindingDigest: z.string().regex(sha256Pattern),
    presentationBindingDigest: z.string().regex(sha256Pattern),
    deliveryBindingDigest: z.string().regex(sha256Pattern),
    createdAt: canonicalInstantSchema,
    updatedAt: canonicalInstantSchema,
  })
  .strict();

const pendingDeliverySchema = deliveryBaseSchema
  .extend({
    status: z.literal('pending'),
    deliveryAttempt: z.literal(0),
    deliveryAttemptToken: z.null(),
    priorDeliveryAttemptTokens: z.tuple([]),
    lastDeliveryRunExecutionAttempt: z.null(),
    providerMessageId: z.null(),
    outcomeCode: z.null(),
  })
  .strict()
  .refine(hasCompleteTokenHistory, {
    message: 'delivery_or_execution_token_history_incomplete',
  });

const sendingDeliverySchema = deliveryBaseSchema
  .extend({
    status: z.literal('sending'),
    deliveryAttempt: deliveryAttemptSchema,
    deliveryAttemptToken: exactIdentifierSchema,
    priorDeliveryAttemptTokens: priorDeliveryAttemptTokensSchema,
    lastDeliveryRunExecutionAttempt: runExecutionAttemptSchema,
    providerMessageId: z.null(),
    outcomeCode: z.null(),
  })
  .strict()
  .refine((value) => (
    hasCompleteTokenHistory(value) &&
    lastDeliveryMatchesCurrentExecution(value)
  ), {
    message: 'delivery_or_execution_token_history_incomplete',
  });

const confirmedNotSentDeliverySchema = deliveryBaseSchema
  .extend({
    status: z.literal('confirmed_not_sent'),
    deliveryAttempt: deliveryAttemptSchema,
    deliveryAttemptToken: exactIdentifierSchema,
    priorDeliveryAttemptTokens: priorDeliveryAttemptTokensSchema,
    lastDeliveryRunExecutionAttempt: runExecutionAttemptSchema,
    providerMessageId: z.null(),
    outcomeCode: outcomeCodeSchema,
  })
  .strict()
  .refine((value) => (
    hasCompleteTokenHistory(value) &&
    confirmedNotSentExecutionIsRetryable(value)
  ), {
    message: 'delivery_or_execution_token_history_incomplete',
  });

const confirmedSentDeliverySchema = deliveryBaseSchema
  .extend({
    status: z.literal('confirmed_sent'),
    deliveryAttempt: deliveryAttemptSchema,
    deliveryAttemptToken: exactIdentifierSchema,
    priorDeliveryAttemptTokens: priorDeliveryAttemptTokensSchema,
    lastDeliveryRunExecutionAttempt: runExecutionAttemptSchema,
    providerMessageId: exactIdentifierSchema,
    outcomeCode: z.null(),
  })
  .strict()
  .refine((value) => (
    hasCompleteTokenHistory(value) &&
    lastDeliveryMatchesCurrentExecution(value)
  ), {
    message: 'delivery_or_execution_token_history_incomplete',
  });

const unknownDeliverySchema = deliveryBaseSchema
  .extend({
    status: z.literal('delivery_outcome_unknown'),
    deliveryAttempt: deliveryAttemptSchema,
    deliveryAttemptToken: exactIdentifierSchema,
    priorDeliveryAttemptTokens: priorDeliveryAttemptTokensSchema,
    lastDeliveryRunExecutionAttempt: runExecutionAttemptSchema,
    providerMessageId: z.null(),
    outcomeCode: outcomeCodeSchema,
  })
  .strict()
  .refine((value) => (
    hasCompleteTokenHistory(value) &&
    lastDeliveryMatchesCurrentExecution(value)
  ), {
    message: 'delivery_or_execution_token_history_incomplete',
  });

export const agentRunTextDeliveryRecordSchema = z.union(
  [
    pendingDeliverySchema,
    sendingDeliverySchema,
    confirmedNotSentDeliverySchema,
    confirmedSentDeliverySchema,
    unknownDeliverySchema,
  ],
);

export type AgentRunTextDeliveryRecord = z.infer<
  typeof agentRunTextDeliveryRecordSchema
>;

export interface AgentRunTextDeliveryExecutionBinding {
  runId: string;
  executionAttempt: number;
  executionLeaseToken: string;
}

export interface CreatePendingAgentRunTextDeliveryInput {
  execution: AgentRunTextDeliveryExecutionBinding;
  channel: 'messenger' | 'zalo';
  assistantTurnId: string;
  /** Used only to derive recipientBindingDigest; never retained. */
  recipientId: string;
  /** Used only to derive presentationBindingDigest; never retained. */
  presentationText: string;
  createdAt: string;
}

export interface BeginAgentRunTextDeliveryAttemptInput {
  execution: AgentRunTextDeliveryExecutionBinding;
  nextDeliveryAttempt: number;
  /** Opaque server-issued token, independent of the run execution lease. */
  deliveryAttemptToken: string;
  updatedAt: string;
}

export interface RebindRetryableAgentRunTextDeliveryInput {
  execution: AgentRunTextDeliveryExecutionBinding;
  channel: 'messenger' | 'zalo';
  assistantTurnId: string;
  /** Re-attests recipientBindingDigest; never retained. */
  recipientId: string;
  /** Re-attests presentationBindingDigest; never retained. */
  presentationText: string;
  updatedAt: string;
}

export type RebindRetryableAgentRunTextDeliveryResult =
  | {
      status: 'rebound';
      record: Extract<
        AgentRunTextDeliveryRecord,
        { status: 'pending' | 'confirmed_not_sent' }
      >;
    }
  | {
      status: 'rebind_blocked';
      reason:
        | 'delivery_not_retryable'
        | 'binding_input_invalid'
        | 'delivery_identity_mismatch'
        | 'execution_attempt_not_newer'
        | 'execution_attempt_not_next'
        | 'execution_lease_token_reused'
        | 'execution_lease_token_attestation_invalid'
        | 'execution_already_rebound'
        | 'updated_at_invalid';
    };

export type BeginAgentRunTextDeliveryAttemptResult =
  | {
      status: 'dispatch_authorized';
      record: Extract<AgentRunTextDeliveryRecord, { status: 'sending' }>;
    }
  | {
      status: 'dispatch_blocked';
      reason:
        | 'execution_binding_mismatch'
        | 'delivery_attempt_not_next'
        | 'delivery_attempt_token_invalid'
        | 'delivery_attempt_token_reused'
        | 'sending_in_progress'
        | 'confirmed_sent'
        | 'delivery_outcome_unknown'
        | 'attempts_exhausted'
        | 'execution_rebind_required'
        | 'updated_at_invalid';
    };

export interface CompleteAgentRunTextDeliveryAttemptInput {
  execution: AgentRunTextDeliveryExecutionBinding;
  deliveryAttempt: number;
  deliveryAttemptToken: string;
  outcome: ChannelTextSendOutcome;
  updatedAt: string;
}

export type CompleteAgentRunTextDeliveryAttemptResult =
  | {
      status: 'transitioned';
      record: Exclude<
        AgentRunTextDeliveryRecord,
        { status: 'pending' | 'sending' }
      >;
    }
  | {
      status: 'transition_blocked';
      reason:
        | 'execution_binding_mismatch'
        | 'delivery_not_sending'
        | 'delivery_attempt_mismatch'
        | 'provider_message_id_invalid'
        | 'outcome_code_invalid'
        | 'updated_at_invalid';
    };

export interface ReconcileAgentRunTextDeliveryInput {
  execution: AgentRunTextDeliveryExecutionBinding;
  outcomeCode: string;
  updatedAt: string;
}

export type ReconcileAgentRunTextDeliveryResult =
  | {
      status: 'reconciled' | 'replay';
      record: Extract<
        AgentRunTextDeliveryRecord,
        { status: 'delivery_outcome_unknown' }
      >;
    }
  | {
      status: 'reconciliation_blocked';
      reason:
        | 'execution_binding_mismatch'
        | 'delivery_not_sending'
        | 'outcome_code_invalid'
        | 'updated_at_invalid';
      record?: AgentRunTextDeliveryRecord;
    };

export async function createPendingAgentRunTextDelivery(
  input: CreatePendingAgentRunTextDeliveryInput,
): Promise<Extract<AgentRunTextDeliveryRecord, { status: 'pending' }>> {
  const execution = executionBindingSchema.parse(input.execution);
  const channel = z.enum(['messenger', 'zalo']).parse(input.channel);
  const assistantTurnId = exactIdentifierSchema.parse(
    input.assistantTurnId,
  );
  const recipientId = exactIdentifierSchema.parse(input.recipientId);
  if (input.presentationText.trim().length === 0) {
    throw new Error('agent_run_text_delivery_presentation_empty');
  }
  const createdAt = canonicalInstantSchema.parse(input.createdAt);
  const recipientBindingDigest = await sha256Binding([
    'kfc-agent-run-text-delivery-recipient-v1',
    channel,
    recipientId,
  ]);
  const presentationBindingDigest = await sha256Binding([
    'kfc-agent-run-text-delivery-presentation-v1',
    channel,
    input.presentationText,
  ]);
  const deliveryBindingDigest = await sha256Binding([
    schemaVersion,
    execution.runId,
    execution.executionAttempt,
    execution.executionLeaseToken,
    channel,
    assistantTurnId,
    recipientBindingDigest,
    presentationBindingDigest,
  ]);
  const runExecutionLeaseTokenDigest = await sha256Binding([
    'kfc-agent-run-execution-lease-token-v1',
    execution.executionLeaseToken,
  ]);

  return pendingDeliverySchema.parse({
    schemaVersion,
    runId: execution.runId,
    runExecutionOriginAttempt: execution.executionAttempt,
    runExecutionAttempt: execution.executionAttempt,
    runExecutionLeaseToken: execution.executionLeaseToken,
    runExecutionLeaseTokenDigest,
    priorRunExecutionLeaseTokenDigests: [],
    lastDeliveryRunExecutionAttempt: null,
    channel,
    assistantTurnId,
    recipientBindingDigest,
    presentationBindingDigest,
    deliveryBindingDigest,
    status: 'pending',
    deliveryAttempt: 0,
    deliveryAttemptToken: null,
    priorDeliveryAttemptTokens: [],
    providerMessageId: null,
    outcomeCode: null,
    createdAt,
    updatedAt: createdAt,
  });
}

export async function rebindRetryableAgentRunTextDelivery(
  rawRecord: AgentRunTextDeliveryRecord,
  input: RebindRetryableAgentRunTextDeliveryInput,
): Promise<RebindRetryableAgentRunTextDeliveryResult> {
  const record = agentRunTextDeliveryRecordSchema.parse(rawRecord);
  if (
    record.status !== 'pending' &&
    record.status !== 'confirmed_not_sent'
  ) {
    return {
      status: 'rebind_blocked',
      reason: 'delivery_not_retryable',
    };
  }
  if (
    record.status === 'confirmed_not_sent' &&
    record.lastDeliveryRunExecutionAttempt !==
      record.runExecutionAttempt
  ) {
    return {
      status: 'rebind_blocked',
      reason: 'execution_already_rebound',
    };
  }
  const execution = executionBindingSchema.safeParse(input.execution);
  const channel = z.enum(['messenger', 'zalo']).safeParse(
    input.channel,
  );
  const assistantTurnId = exactIdentifierSchema.safeParse(
    input.assistantTurnId,
  );
  const recipientId = exactIdentifierSchema.safeParse(
    input.recipientId,
  );
  const updatedAt = nextUpdatedAt(record.updatedAt, input.updatedAt);
  if (
    !execution.success ||
    !channel.success ||
    !assistantTurnId.success ||
    !recipientId.success ||
    input.presentationText.trim().length === 0
  ) {
    return {
      status: 'rebind_blocked',
      reason: 'binding_input_invalid',
    };
  }
  if (!updatedAt) {
    return {
      status: 'rebind_blocked',
      reason: 'updated_at_invalid',
    };
  }
  if (
    execution.data.executionAttempt <= record.runExecutionAttempt
  ) {
    return {
      status: 'rebind_blocked',
      reason: 'execution_attempt_not_newer',
    };
  }
  if (
    execution.data.executionAttempt !==
    record.runExecutionAttempt + 1
  ) {
    return {
      status: 'rebind_blocked',
      reason: 'execution_attempt_not_next',
    };
  }
  if (
    execution.data.executionLeaseToken ===
    record.runExecutionLeaseToken
  ) {
    return {
      status: 'rebind_blocked',
      reason: 'execution_lease_token_reused',
    };
  }
  const nextExecutionLeaseTokenDigest = await sha256Binding([
    'kfc-agent-run-execution-lease-token-v1',
    execution.data.executionLeaseToken,
  ]);
  const currentExecutionLeaseTokenDigest = await sha256Binding([
    'kfc-agent-run-execution-lease-token-v1',
    record.runExecutionLeaseToken,
  ]);
  if (
    currentExecutionLeaseTokenDigest !==
    record.runExecutionLeaseTokenDigest
  ) {
    return {
      status: 'rebind_blocked',
      reason: 'execution_lease_token_attestation_invalid',
    };
  }
  if (
    record.priorRunExecutionLeaseTokenDigests.includes(
      nextExecutionLeaseTokenDigest,
    )
  ) {
    return {
      status: 'rebind_blocked',
      reason: 'execution_lease_token_reused',
    };
  }
  const priorRunExecutionLeaseTokenDigests = [
    ...record.priorRunExecutionLeaseTokenDigests,
    currentExecutionLeaseTokenDigest,
  ];

  const pendingForNewExecution =
    await createPendingAgentRunTextDelivery({
      execution: execution.data,
      channel: channel.data,
      assistantTurnId: assistantTurnId.data,
      recipientId: recipientId.data,
      presentationText: input.presentationText,
      createdAt: updatedAt,
    });
  if (
    pendingForNewExecution.runId !== record.runId ||
    pendingForNewExecution.channel !== record.channel ||
    pendingForNewExecution.assistantTurnId !==
      record.assistantTurnId ||
    pendingForNewExecution.recipientBindingDigest !==
      record.recipientBindingDigest ||
    pendingForNewExecution.presentationBindingDigest !==
      record.presentationBindingDigest
  ) {
    return {
      status: 'rebind_blocked',
      reason: 'delivery_identity_mismatch',
    };
  }

  const rebound = {
      ...record,
      runExecutionAttempt:
        pendingForNewExecution.runExecutionAttempt,
      runExecutionLeaseToken:
        pendingForNewExecution.runExecutionLeaseToken,
      runExecutionLeaseTokenDigest:
        nextExecutionLeaseTokenDigest,
      priorRunExecutionLeaseTokenDigests,
      deliveryBindingDigest:
        pendingForNewExecution.deliveryBindingDigest,
      updatedAt,
    };
  return {
    status: 'rebound',
    record: record.status === 'pending'
      ? pendingDeliverySchema.parse(rebound)
      : confirmedNotSentDeliverySchema.parse(rebound),
  };
}

export function beginAgentRunTextDeliveryAttempt(
  rawRecord: AgentRunTextDeliveryRecord,
  input: BeginAgentRunTextDeliveryAttemptInput,
): BeginAgentRunTextDeliveryAttemptResult {
  const record = agentRunTextDeliveryRecordSchema.parse(rawRecord);
  const execution = executionBindingSchema.safeParse(input.execution);
  if (
    !execution.success ||
    !isExactExecutionBinding(record, execution.data)
  ) {
    return blockedBegin('execution_binding_mismatch');
  }
  if (record.status === 'sending') {
    return blockedBegin('sending_in_progress');
  }
  if (record.status === 'confirmed_sent') {
    return blockedBegin('confirmed_sent');
  }
  if (record.status === 'delivery_outcome_unknown') {
    return blockedBegin('delivery_outcome_unknown');
  }
  if (
    record.deliveryAttempt >= MAXIMUM_AGENT_RUN_TEXT_DELIVERY_ATTEMPTS
  ) {
    return blockedBegin('attempts_exhausted');
  }
  if (
    record.status === 'confirmed_not_sent' &&
    (
      record.lastDeliveryRunExecutionAttempt === null ||
      record.runExecutionAttempt !==
        record.lastDeliveryRunExecutionAttempt + 1
    )
  ) {
    return blockedBegin('execution_rebind_required');
  }
  if (input.nextDeliveryAttempt !== record.deliveryAttempt + 1) {
    return blockedBegin('delivery_attempt_not_next');
  }
  const token = exactIdentifierSchema.safeParse(
    input.deliveryAttemptToken,
  );
  if (!token.success || token.data === record.runExecutionLeaseToken) {
    return blockedBegin('delivery_attempt_token_invalid');
  }
  if (token.data === record.deliveryAttemptToken) {
    return blockedBegin('delivery_attempt_token_reused');
  }
  if (
    record.priorDeliveryAttemptTokens.some(
      (priorToken) => priorToken === token.data,
    )
  ) {
    return blockedBegin('delivery_attempt_token_reused');
  }
  const updatedAt = nextUpdatedAt(record.updatedAt, input.updatedAt);
  if (!updatedAt) return blockedBegin('updated_at_invalid');
  const priorDeliveryAttemptTokens = [
    ...record.priorDeliveryAttemptTokens,
  ];
  if (record.deliveryAttemptToken !== null) {
    priorDeliveryAttemptTokens.push(record.deliveryAttemptToken);
  }

  return {
    status: 'dispatch_authorized',
    record: sendingDeliverySchema.parse({
      ...record,
      status: 'sending',
      deliveryAttempt: input.nextDeliveryAttempt,
      deliveryAttemptToken: token.data,
      lastDeliveryRunExecutionAttempt: record.runExecutionAttempt,
      priorDeliveryAttemptTokens,
      providerMessageId: null,
      outcomeCode: null,
      updatedAt,
    }),
  };
}

export function completeAgentRunTextDeliveryAttempt(
  rawRecord: AgentRunTextDeliveryRecord,
  input: CompleteAgentRunTextDeliveryAttemptInput,
): CompleteAgentRunTextDeliveryAttemptResult {
  const record = agentRunTextDeliveryRecordSchema.parse(rawRecord);
  const execution = executionBindingSchema.safeParse(input.execution);
  if (
    !execution.success ||
    !isExactExecutionBinding(record, execution.data)
  ) {
    return blockedCompletion('execution_binding_mismatch');
  }
  if (record.status !== 'sending') {
    return blockedCompletion('delivery_not_sending');
  }
  if (
    input.deliveryAttempt !== record.deliveryAttempt ||
    input.deliveryAttemptToken !== record.deliveryAttemptToken
  ) {
    return blockedCompletion('delivery_attempt_mismatch');
  }
  const updatedAt = nextUpdatedAt(record.updatedAt, input.updatedAt);
  if (!updatedAt) return blockedCompletion('updated_at_invalid');

  if (input.outcome.status === 'confirmed_sent') {
    const messageId = exactIdentifierSchema.safeParse(
      input.outcome.messageId,
    );
    if (!messageId.success) {
      return blockedCompletion('provider_message_id_invalid');
    }
    return {
      status: 'transitioned',
      record: confirmedSentDeliverySchema.parse({
        ...record,
        status: 'confirmed_sent',
        providerMessageId: messageId.data,
        outcomeCode: null,
        updatedAt,
      }),
    };
  }

  const outcomeCode = outcomeCodeSchema.safeParse(
    input.outcome.errorCode,
  );
  if (!outcomeCode.success) {
    return blockedCompletion('outcome_code_invalid');
  }
  if (input.outcome.status === 'delivery_outcome_unknown') {
    return {
      status: 'transitioned',
      record: unknownDeliverySchema.parse({
        ...record,
        status: 'delivery_outcome_unknown',
        providerMessageId: null,
        outcomeCode: outcomeCode.data,
        updatedAt,
      }),
    };
  }
  return {
    status: 'transitioned',
    record: confirmedNotSentDeliverySchema.parse({
      ...record,
      status: 'confirmed_not_sent',
      providerMessageId: null,
      outcomeCode: outcomeCode.data,
      updatedAt,
    }),
  };
}

export function reconcileAgentRunTextDelivery(
  rawRecord: AgentRunTextDeliveryRecord,
  input: ReconcileAgentRunTextDeliveryInput,
): ReconcileAgentRunTextDeliveryResult {
  const record = agentRunTextDeliveryRecordSchema.parse(rawRecord);
  const execution = executionBindingSchema.safeParse(input.execution);
  if (
    !execution.success ||
    !isExactExecutionBinding(record, execution.data)
  ) {
    return {
      status: 'reconciliation_blocked',
      reason: 'execution_binding_mismatch',
      record,
    };
  }
  if (record.status === 'delivery_outcome_unknown') {
    return { status: 'replay', record };
  }
  if (record.status !== 'sending') {
    return {
      status: 'reconciliation_blocked',
      reason: 'delivery_not_sending',
      record,
    };
  }
  const outcomeCode = outcomeCodeSchema.safeParse(input.outcomeCode);
  if (!outcomeCode.success) {
    return {
      status: 'reconciliation_blocked',
      reason: 'outcome_code_invalid',
      record,
    };
  }
  const updatedAt = nextUpdatedAt(record.updatedAt, input.updatedAt);
  if (!updatedAt) {
    return {
      status: 'reconciliation_blocked',
      reason: 'updated_at_invalid',
      record,
    };
  }
  return {
    status: 'reconciled',
    record: unknownDeliverySchema.parse({
      ...record,
      status: 'delivery_outcome_unknown',
      providerMessageId: null,
      outcomeCode: outcomeCode.data,
      updatedAt,
    }),
  };
}

function isExactExecutionBinding(
  record: AgentRunTextDeliveryRecord,
  execution: AgentRunTextDeliveryExecutionBinding,
): boolean {
  return (
    execution.runId === record.runId &&
    execution.executionAttempt === record.runExecutionAttempt &&
    execution.executionLeaseToken === record.runExecutionLeaseToken
  );
}

function nextUpdatedAt(
  current: string,
  candidate: string,
): string | undefined {
  const parsed = canonicalInstantSchema.safeParse(candidate);
  return parsed.success &&
    Date.parse(parsed.data) >= Date.parse(current)
    ? parsed.data
    : undefined;
}

function blockedBegin(
  reason: Extract<
    BeginAgentRunTextDeliveryAttemptResult,
    { status: 'dispatch_blocked' }
  >['reason'],
): BeginAgentRunTextDeliveryAttemptResult {
  return { status: 'dispatch_blocked', reason };
}

function blockedCompletion(
  reason: Extract<
    CompleteAgentRunTextDeliveryAttemptResult,
    { status: 'transition_blocked' }
  >['reason'],
): CompleteAgentRunTextDeliveryAttemptResult {
  return { status: 'transition_blocked', reason };
}

async function sha256Binding(parts: readonly unknown[]): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(parts));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
