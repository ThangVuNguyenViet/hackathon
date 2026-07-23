import {
  issueVerifiedRefRecord,
  type IssueVerifiedRefInput,
  type VerifiedRefRecord,
} from '../domain/verifiedRef.js';
import type {
  ClaimVerifiedRefInput,
  ClaimVerifiedRefResult,
  IssueVerifiedRefResult,
  ResolveVerifiedRefInput,
} from './contracts.js';
import { D1StoreAgentOperations } from './d1StoreAgentOperations.js';
import {
  d1RunCommitEligibility,
  type D1RunCommitPredicate,
} from './d1StoreTurnCommit.js';
import {
  verifiedRefSnapshotFromStorageRow,
  verifiedRefStorageValues,
  type VerifiedRefStorageRow,
} from './verifiedRef.js';
import {
  cloneVerifiedRefRecord,
  parseClaimVerifiedRefInput,
  parseResolveVerifiedRefInput,
  verifiedRefSnapshotMatches,
} from './verifiedRefOperations.js';

const verifiedRefColumns = `
  schema_version,
  ref_id,
  kind,
  session_id,
  session_generation,
  customer_id,
  channel,
  authenticated_subject,
  authentication_evidence_ref,
  verified_revision,
  lifecycle,
  payload_json,
  created_at,
  expires_at,
  claimed_use_id,
  claimed_at
`;

const verifiedRefSelectColumns = verifiedRefColumns
  .split(',')
  .map((column) => column.trim())
  .filter(Boolean)
  .map((column) => `verified_refs.${column}`)
  .join(', ');

export class D1StoreVerifiedRefOperations extends D1StoreAgentOperations {
  override async initialize(): Promise<void> {
    await super.initialize();
    const statements = [
      `CREATE TABLE IF NOT EXISTS verified_refs (
        schema_version TEXT NOT NULL
          CHECK (schema_version = 'kfc-verified-ref-v1'),
        ref_id TEXT PRIMARY KEY
          CHECK (length(ref_id) = 36),
        kind TEXT NOT NULL CHECK (
          kind IN (
            'fulfillment_address',
            'saved_address',
            'payment_method',
            'selected_action_effect'
          )
        ),
        session_id TEXT NOT NULL
          CHECK (length(session_id) > 0),
        session_generation INTEGER NOT NULL CHECK (session_generation >= 0),
        customer_id TEXT NOT NULL
          CHECK (length(customer_id) > 0),
        channel TEXT NOT NULL
          CHECK (
            channel IN (
              'messenger',
              'zalo',
              'kfc',
              'messenger_mock',
              'zalo_mock'
            )
          ),
        authenticated_subject TEXT NOT NULL
          CHECK (length(authenticated_subject) > 0),
        authentication_evidence_ref TEXT NOT NULL
          CHECK (length(authentication_evidence_ref) > 0),
        verified_revision TEXT NOT NULL CHECK (
          length(verified_revision) = 64
          AND verified_revision NOT GLOB '*[^a-f0-9]*'
        ),
        lifecycle TEXT NOT NULL CHECK (
          lifecycle IN ('replayable', 'one_shot')
        ),
        payload_json TEXT NOT NULL
          CHECK (
            json_valid(payload_json)
            AND json_type(payload_json) = 'object'
          ),
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        claimed_use_id TEXT,
        claimed_at TEXT,
        CHECK (expires_at > created_at),
        CHECK (
          (claimed_use_id IS NULL AND claimed_at IS NULL)
          OR (
            lifecycle = 'one_shot'
            AND claimed_use_id IS NOT NULL
            AND length(claimed_use_id) > 0
            AND claimed_at IS NOT NULL
            AND claimed_at >= created_at
            AND claimed_at < expires_at
          )
        )
      )`,
      `CREATE INDEX IF NOT EXISTS verified_refs_session_idx
       ON verified_refs (session_id, session_generation)`,
      `CREATE INDEX IF NOT EXISTS verified_refs_expiry_idx
       ON verified_refs (expires_at)`,
    ];
    if (this.db.batch) {
      await this.db.batch(
        statements.map((statement) => this.db.prepare(statement)),
      );
      return;
    }
    for (const statement of statements) {
      await this.db.prepare(statement).run();
    }
  }

  async issueVerifiedRef(
    rawInput: IssueVerifiedRefInput,
  ): Promise<IssueVerifiedRefResult> {
    const record = issueVerifiedRefRecord(rawInput);
    const sessionId = record.principal.sessionId;
    await this.db
      .prepare(
        `INSERT OR IGNORE INTO confirmation_pause_sessions (
           session_id, generation
         ) VALUES (?, 0)`,
      )
      .bind(sessionId)
      .run();
    const captured = await this.db
      .prepare(
        `SELECT generation
         FROM confirmation_pause_sessions
         WHERE session_id = ?
         LIMIT 1`,
      )
      .bind(sessionId)
      .first<{ generation: number }>();
    if (!captured) throw new Error('verified_ref_session_generation_missing');

    const values = verifiedRefStorageValues(record, captured.generation);
    const inserted = await this.db
      .prepare(
        `INSERT OR IGNORE INTO verified_refs (${verifiedRefColumns})
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
         FROM confirmation_pause_sessions
         WHERE session_id = ?
           AND generation = ?`,
      )
      .bind(...values, sessionId, captured.generation)
      .run();
    if (Number(inserted.meta.changes ?? 0) === 1) {
      return {
        status: 'created',
        record: cloneVerifiedRefRecord(record),
      };
    }
    const current = await this.db
      .prepare(
        `SELECT generation
         FROM confirmation_pause_sessions
         WHERE session_id = ?
         LIMIT 1`,
      )
      .bind(sessionId)
      .first<{ generation: number }>();
    if (!current || current.generation !== captured.generation) {
      return { status: 'generation_conflict' };
    }
    throw new Error('verified_ref_id_collision');
  }

  async resolveVerifiedRef(
    rawInput: ResolveVerifiedRefInput,
  ): Promise<VerifiedRefRecord | undefined> {
    const input = parseResolveVerifiedRefInput(rawInput);
    const row = await this.findAvailableVerifiedRef(input, 'replayable');
    if (!row) return undefined;
    const snapshot = verifiedRefSnapshotFromStorageRow(row);
    return verifiedRefSnapshotMatches(
      snapshot,
      snapshot.sessionGeneration,
      input,
    )
      ? cloneVerifiedRefRecord(snapshot.record)
      : undefined;
  }

  async claimVerifiedRef(
    rawInput: ClaimVerifiedRefInput,
  ): Promise<ClaimVerifiedRefResult> {
    const input = parseClaimVerifiedRefInput(rawInput);
    const eligibility = d1RunCommitEligibility(input.runFence);
    const updated = await this.db
      .prepare(
        `UPDATE verified_refs
         SET claimed_use_id = ?,
             claimed_at = ?
         WHERE ref_id = ?
           AND kind = ?
           AND session_id = ?
           AND customer_id = ?
           AND channel = ?
           AND authenticated_subject = ?
           AND authentication_evidence_ref = ?
           AND verified_revision = ?
           AND lifecycle = 'one_shot'
           AND claimed_use_id IS NULL
           AND claimed_at IS NULL
           AND created_at <= ?
           AND expires_at > ?
           AND session_generation = (
             SELECT generation
             FROM confirmation_pause_sessions
             WHERE session_id = ?
           )
           AND ${eligibility.sql}
         RETURNING ${verifiedRefColumns}`,
      )
      .bind(
        input.useId,
        input.now,
        input.ref.id,
        input.ref.kind,
        input.principal.sessionId,
        input.principal.customerId,
        input.principal.channel,
        input.principal.authenticatedSubject,
        input.principal.authenticationEvidenceRef,
        input.expectedVerifiedRevision,
        input.now,
        input.now,
        input.principal.sessionId,
        ...eligibility.bindings,
      )
      .first<VerifiedRefStorageRow>();
    if (updated) {
      const snapshot = verifiedRefSnapshotFromStorageRow(updated);
      if (
        !verifiedRefSnapshotMatches(
          snapshot,
          snapshot.sessionGeneration,
          input,
        ) ||
        snapshot.record.claimedUseId !== input.useId
      ) {
        throw new Error('verified_ref_claim_result_invalid');
      }
      return {
        status: 'claimed',
        record: cloneVerifiedRefRecord(snapshot.record),
      };
    }

    const existing = await this.findAvailableVerifiedRef(
      input,
      'one_shot',
      eligibility,
    );
    if (!existing) return { status: 'unavailable' };
    const snapshot = verifiedRefSnapshotFromStorageRow(existing);
    if (
      !verifiedRefSnapshotMatches(
        snapshot,
        snapshot.sessionGeneration,
        input,
      ) ||
      snapshot.record.claimedUseId !== input.useId
    ) {
      return { status: 'unavailable' };
    }
    return {
      status: 'replay',
      record: cloneVerifiedRefRecord(snapshot.record),
    };
  }

  private async findAvailableVerifiedRef(
    input: ResolveVerifiedRefInput,
    lifecycle: 'replayable' | 'one_shot',
    runEligibility?: D1RunCommitPredicate,
  ): Promise<VerifiedRefStorageRow | null> {
    const bindings = [
      input.ref.id,
      input.ref.kind,
      input.principal.sessionId,
      input.principal.customerId,
      input.principal.channel,
      input.principal.authenticatedSubject,
      input.principal.authenticationEvidenceRef,
      input.expectedVerifiedRevision,
      input.now,
      input.now,
      lifecycle,
      ...(runEligibility?.bindings ?? []),
    ];
    return this.db
      .prepare(
        `SELECT ${verifiedRefSelectColumns}
         FROM verified_refs
         INNER JOIN confirmation_pause_sessions
           ON confirmation_pause_sessions.session_id =
                verified_refs.session_id
          AND confirmation_pause_sessions.generation =
                verified_refs.session_generation
         WHERE verified_refs.ref_id = ?
           AND verified_refs.kind = ?
           AND verified_refs.session_id = ?
           AND verified_refs.customer_id = ?
           AND verified_refs.channel = ?
           AND verified_refs.authenticated_subject = ?
           AND verified_refs.authentication_evidence_ref = ?
           AND verified_refs.verified_revision = ?
           AND verified_refs.created_at <= ?
           AND verified_refs.expires_at > ?
           AND verified_refs.lifecycle = ?
           ${runEligibility ? `AND ${runEligibility.sql}` : ''}
         LIMIT 1`,
      )
      .bind(...bindings)
      .first<VerifiedRefStorageRow>();
  }
}
