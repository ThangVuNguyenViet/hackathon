import { z } from 'zod';
import {
  verifiedRefRecordSchema,
  type VerifiedRefRecord,
} from '../domain/verifiedRef.js';

export interface VerifiedRefStorageRow {
  [key: string]: unknown;
  schema_version: unknown;
  ref_id: unknown;
  kind: unknown;
  session_id: unknown;
  session_generation: unknown;
  customer_id: unknown;
  channel: unknown;
  authenticated_subject: unknown;
  authentication_evidence_ref: unknown;
  verified_revision: unknown;
  lifecycle: unknown;
  payload_json: unknown;
  created_at: unknown;
  expires_at: unknown;
  claimed_use_id: unknown;
  claimed_at: unknown;
}

export interface VerifiedRefStorageSnapshot {
  record: VerifiedRefRecord;
  sessionGeneration: number;
}

const sessionGenerationSchema = z.number().int().nonnegative();

function parseStoredJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new Error('verified_ref_stored_json_malformed');
  }
}

function storedTimestamp(value: unknown): unknown {
  return value instanceof Date ? value.toISOString() : value;
}

export function verifiedRefStorageValues(
  rawRecord: VerifiedRefRecord,
  rawSessionGeneration: number,
): readonly unknown[] {
  const record = verifiedRefRecordSchema.parse(rawRecord);
  const sessionGeneration = sessionGenerationSchema.parse(rawSessionGeneration);
  return [
    record.schemaVersion,
    record.ref.id,
    record.ref.kind,
    record.principal.sessionId,
    sessionGeneration,
    record.principal.customerId,
    record.principal.channel,
    record.principal.authenticatedSubject,
    record.principal.authenticationEvidenceRef,
    record.verifiedRevision,
    record.lifecycle,
    JSON.stringify(record.payload),
    record.createdAt,
    record.expiresAt,
    record.claimedUseId ?? null,
    record.claimedAt ?? null,
  ] as const;
}

export function verifiedRefSnapshotFromStorageRow(
  row: VerifiedRefStorageRow,
): VerifiedRefStorageSnapshot {
  const claimFields =
    row.claimed_use_id === null && row.claimed_at === null
      ? {}
      : {
          claimedUseId: row.claimed_use_id,
          claimedAt: storedTimestamp(row.claimed_at),
        };
  const record = verifiedRefRecordSchema.parse({
    schemaVersion: row.schema_version,
    ref: {
      id: row.ref_id,
      kind: row.kind,
    },
    principal: {
      sessionId: row.session_id,
      customerId: row.customer_id,
      channel: row.channel,
      authenticatedSubject: row.authenticated_subject,
      authenticationEvidenceRef: row.authentication_evidence_ref,
    },
    verifiedRevision: row.verified_revision,
    lifecycle: row.lifecycle,
    payload: parseStoredJson(row.payload_json),
    createdAt: storedTimestamp(row.created_at),
    expiresAt: storedTimestamp(row.expires_at),
    ...claimFields,
  });
  return {
    record,
    sessionGeneration: sessionGenerationSchema.parse(row.session_generation),
  };
}
