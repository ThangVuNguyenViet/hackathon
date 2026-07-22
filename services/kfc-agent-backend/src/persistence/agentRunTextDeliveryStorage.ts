import {
  agentRunTextDeliveryRecordSchema,
  type AgentRunTextDeliveryRecord,
} from './agentRunTextDelivery.js';

export interface AgentRunTextDeliveryStorageRow {
  schema_version: string;
  run_id: string;
  run_execution_attempt: number;
  run_execution_origin_attempt: number;
  run_execution_lease_token: string;
  run_execution_lease_token_digest: string;
  prior_run_execution_lease_token_digests: string | readonly string[];
  channel: AgentRunTextDeliveryRecord['channel'];
  assistant_turn_id: string;
  recipient_binding_digest: string;
  presentation_binding_digest: string;
  delivery_binding_digest: string;
  status: AgentRunTextDeliveryRecord['status'];
  delivery_attempt: number;
  last_delivery_run_execution_attempt: number | null;
  delivery_attempt_token: string | null;
  provider_message_id: string | null;
  outcome_code: string | null;
  created_at: string | Date;
  updated_at: string | Date;
}

export function agentRunTextDeliveryFromStorageRow(
  row: AgentRunTextDeliveryStorageRow,
  priorDeliveryAttemptTokens: readonly string[] = [],
): AgentRunTextDeliveryRecord {
  return agentRunTextDeliveryRecordSchema.parse({
    schemaVersion: row.schema_version,
    runId: row.run_id,
    runExecutionAttempt: Number(row.run_execution_attempt),
    runExecutionOriginAttempt: Number(row.run_execution_origin_attempt),
    runExecutionLeaseToken: row.run_execution_lease_token,
    runExecutionLeaseTokenDigest: row.run_execution_lease_token_digest,
    priorRunExecutionLeaseTokenDigests: stringArray(
      row.prior_run_execution_lease_token_digests,
    ),
    channel: row.channel,
    assistantTurnId: row.assistant_turn_id,
    recipientBindingDigest: row.recipient_binding_digest,
    presentationBindingDigest: row.presentation_binding_digest,
    deliveryBindingDigest: row.delivery_binding_digest,
    status: row.status,
    deliveryAttempt: Number(row.delivery_attempt),
    lastDeliveryRunExecutionAttempt:
      row.last_delivery_run_execution_attempt === null
        ? null
        : Number(row.last_delivery_run_execution_attempt),
    deliveryAttemptToken: row.delivery_attempt_token,
    priorDeliveryAttemptTokens: [...priorDeliveryAttemptTokens],
    providerMessageId: row.provider_message_id,
    outcomeCode: row.outcome_code,
    createdAt: canonicalInstant(row.created_at),
    updatedAt: canonicalInstant(row.updated_at),
  });
}

export function agentRunTextDeliveryStorageValues(
  record: AgentRunTextDeliveryRecord,
): readonly unknown[] {
  return [
    record.schemaVersion,
    record.runId,
    record.runExecutionAttempt,
    record.runExecutionOriginAttempt,
    record.runExecutionLeaseToken,
    record.runExecutionLeaseTokenDigest,
    JSON.stringify(record.priorRunExecutionLeaseTokenDigests),
    record.channel,
    record.assistantTurnId,
    record.recipientBindingDigest,
    record.presentationBindingDigest,
    record.deliveryBindingDigest,
    record.status,
    record.deliveryAttempt,
    record.lastDeliveryRunExecutionAttempt,
    record.deliveryAttemptToken,
    record.providerMessageId,
    record.outcomeCode,
    record.createdAt,
    record.updatedAt,
  ];
}

export function sameAgentRunTextDeliveryBinding(
  left: AgentRunTextDeliveryRecord,
  right: AgentRunTextDeliveryRecord,
): boolean {
  return left.deliveryBindingDigest === right.deliveryBindingDigest;
}

function canonicalInstant(value: string | Date): string {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

function stringArray(value: string | readonly string[]): string[] {
  const parsed: unknown = typeof value === 'string' ? JSON.parse(value) : value;
  if (
    !Array.isArray(parsed) ||
    !parsed.every((entry) => typeof entry === 'string')
  ) {
    throw new Error('agent_run_text_delivery_string_array_invalid');
  }
  return [...parsed];
}
