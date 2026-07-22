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
import { PostgresStoreAgentOperations } from './postgresStoreAgentOperations.js';
import {
  isConnectablePostgres,
  lockPostgresRunCommitOwner,
} from './postgresStoreRunOwner.js';
import type { Queryable } from './postgresStoreSupport.js';
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

export class PostgresStoreVerifiedRefOperations extends PostgresStoreAgentOperations {
  override async initialize(): Promise<void> {
    await super.initialize();
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS verified_refs (
        schema_version text NOT NULL CHECK (
          schema_version = 'kfc-verified-ref-v1'
        ),
        ref_id uuid PRIMARY KEY,
        kind text NOT NULL CHECK (
          kind IN (
            'fulfillment_address',
            'saved_address',
            'payment_method',
            'selected_action_effect'
          )
        ),
        session_id text NOT NULL CHECK (length(session_id) > 0),
        session_generation integer NOT NULL CHECK (session_generation >= 0),
        customer_id text NOT NULL CHECK (length(customer_id) > 0),
        channel text NOT NULL CHECK (
          channel IN (
            'messenger',
            'zalo',
            'kfc',
            'messenger_mock',
            'zalo_mock'
          )
        ),
        authenticated_subject text NOT NULL CHECK (
          length(authenticated_subject) > 0
        ),
        authentication_evidence_ref text NOT NULL CHECK (
          length(authentication_evidence_ref) > 0
        ),
        verified_revision text NOT NULL CHECK (
          verified_revision ~ '^[a-f0-9]{64}$'
        ),
        lifecycle text NOT NULL CHECK (
          lifecycle IN ('replayable', 'one_shot')
        ),
        payload_json jsonb NOT NULL CHECK (
          jsonb_typeof(payload_json) = 'object'
        ),
        created_at timestamptz NOT NULL,
        expires_at timestamptz NOT NULL,
        claimed_use_id text,
        claimed_at timestamptz,
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
      )
    `);
    await this.db.query(`
      CREATE INDEX IF NOT EXISTS verified_refs_session_idx
      ON verified_refs (session_id, session_generation)
    `);
    await this.db.query(`
      CREATE INDEX IF NOT EXISTS verified_refs_expiry_idx
      ON verified_refs (expires_at)
    `);
  }

  async issueVerifiedRef(
    rawInput: IssueVerifiedRefInput,
  ): Promise<IssueVerifiedRefResult> {
    const record = issueVerifiedRefRecord(rawInput);
    const sessionId = record.principal.sessionId;
    await this.db.query(
      `INSERT INTO session_generations (session_id, generation)
       VALUES ($1, 0)
       ON CONFLICT (session_id) DO NOTHING`,
      [sessionId],
    );
    const generation = await this.db.query<{ generation: number }>(
      `SELECT generation
       FROM session_generations
       WHERE session_id = $1`,
      [sessionId],
    );
    const capturedGeneration = generation.rows[0]?.generation;
    if (capturedGeneration === undefined) {
      throw new Error('verified_ref_session_generation_missing');
    }
    const values = [
      ...verifiedRefStorageValues(record, capturedGeneration),
      sessionId,
      capturedGeneration,
    ];
    const inserted = await this.db.query<VerifiedRefStorageRow>(
      `INSERT INTO verified_refs (${verifiedRefColumns})
       SELECT
         $1, $2, $3, $4, $5, $6, $7, $8,
         $9, $10, $11, $12, $13, $14, $15, $16
       FROM (
         SELECT session_id
         FROM session_generations
         WHERE session_id = $17
           AND generation = $18
         FOR SHARE
       ) AS locked_session_generation
       ON CONFLICT (ref_id) DO NOTHING
       RETURNING ${verifiedRefColumns}`,
      values,
    );
    if (inserted.rows[0]) {
      return {
        status: 'created',
        record: cloneVerifiedRefRecord(record),
      };
    }
    const current = await this.db.query<{ generation: number }>(
      `SELECT generation
       FROM session_generations
       WHERE session_id = $1`,
      [sessionId],
    );
    if (current.rows[0]?.generation !== capturedGeneration) {
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
    if (!isConnectablePostgres(this.db)) {
      throw new Error('postgres_atomic_verified_ref_claim_unavailable');
    }
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      if (!(await lockPostgresRunCommitOwner(client, input.runFence))) {
        await client.query('ROLLBACK');
        return { status: 'unavailable' };
      }
      const result = await this.claimLockedVerifiedRef(client, input);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Preserve the original failure; uncertain claims fail closed.
      }
      throw error;
    } finally {
      client.release();
    }
  }

  private async claimLockedVerifiedRef(
    db: Queryable,
    input: ClaimVerifiedRefInput,
  ): Promise<ClaimVerifiedRefResult> {
    const updated = await db.query<VerifiedRefStorageRow>(
      `UPDATE verified_refs
       SET claimed_use_id = $1,
           claimed_at = $2
       WHERE ref_id = $3
         AND kind = $4
         AND session_id = $5
         AND customer_id = $6
         AND channel = $7
         AND authenticated_subject = $8
         AND authentication_evidence_ref = $9
         AND verified_revision = $10
         AND lifecycle = 'one_shot'
         AND claimed_use_id IS NULL
         AND claimed_at IS NULL
         AND created_at <= $11
         AND expires_at > $11
         AND session_generation = (
           SELECT generation
           FROM session_generations
           WHERE session_id = $5
         )
       RETURNING ${verifiedRefColumns}`,
      [
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
      ],
    );
    if (updated.rows[0]) {
      const snapshot = verifiedRefSnapshotFromStorageRow(updated.rows[0]);
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
    const existing = await this.findAvailableVerifiedRef(input, 'one_shot', db);
    if (!existing) return { status: 'unavailable' };
    const snapshot = verifiedRefSnapshotFromStorageRow(existing);
    return verifiedRefSnapshotMatches(
      snapshot,
      snapshot.sessionGeneration,
      input,
    ) && snapshot.record.claimedUseId === input.useId
      ? {
          status: 'replay',
          record: cloneVerifiedRefRecord(snapshot.record),
        }
      : { status: 'unavailable' };
  }

  private async findAvailableVerifiedRef(
    input: ResolveVerifiedRefInput,
    lifecycle: 'replayable' | 'one_shot',
    db: Queryable = this.db,
  ): Promise<VerifiedRefStorageRow | undefined> {
    const values = [
      input.ref.id,
      input.ref.kind,
      input.principal.sessionId,
      input.principal.customerId,
      input.principal.channel,
      input.principal.authenticatedSubject,
      input.principal.authenticationEvidenceRef,
      input.expectedVerifiedRevision,
      input.now,
      lifecycle,
    ];
    const result = await db.query<VerifiedRefStorageRow>(
      `SELECT ${verifiedRefSelectColumns}
       FROM verified_refs
       INNER JOIN session_generations
         ON session_generations.session_id = verified_refs.session_id
        AND session_generations.generation =
              verified_refs.session_generation
       WHERE verified_refs.ref_id = $1
         AND verified_refs.kind = $2
         AND verified_refs.session_id = $3
         AND verified_refs.customer_id = $4
         AND verified_refs.channel = $5
         AND verified_refs.authenticated_subject = $6
         AND verified_refs.authentication_evidence_ref = $7
         AND verified_refs.verified_revision = $8
         AND verified_refs.created_at <= $9
         AND verified_refs.expires_at > $9
         AND verified_refs.lifecycle = $10
       LIMIT 1`,
      values,
    );
    return result.rows[0];
  }
}
