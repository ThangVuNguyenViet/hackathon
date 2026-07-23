import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CustomerRunStatus } from '../../src/customerRuns/contracts.js';
import type {
  IssueVerifiedRefInput,
  VerifiedRefRecord,
} from '../../src/domain/verifiedRef.js';
import type {
  AuthenticatedCommerceApprovalPrincipal,
} from '../../src/ordering/types.js';
import type {
  ConversationStore,
  ResolveVerifiedRefInput,
} from '../../src/persistence/contracts.js';
import { D1Store } from '../../src/persistence/d1Store.js';
import type {
  D1PreparedStatement,
  D1Result,
} from '../../src/persistence/d1StoreSupport.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';
import { PostgresStore } from '../../src/persistence/postgresStore.js';
import {
  FakeVerifiedRefD1,
  FakeVerifiedRefPostgres,
  type VerifiedRefFake,
} from '../support/fakeVerifiedRefPersistence.js';

const createdAt = '2026-07-20T00:00:00.000Z';
const activeAt = '2026-07-20T00:05:00.000Z';
const expiresAt = '2026-07-20T00:10:00.000Z';
const verifiedRevision = 'a'.repeat(64);

interface VerifiedRefHarness {
  name: string;
  create(): {
    store: ConversationStore;
    corruptPayload(refId: string): void;
    hasStoredRef(refId: string): boolean;
    beforeIssueInsert(hook: () => Promise<void>): void;
    setCustomerRun(
      runId: string,
      sessionId: string,
      status: CustomerRunStatus,
    ): Promise<void>;
  };
}

class RaceableMemoryStore extends MemoryStore {
  beforeNextPersistenceLock?: () => Promise<void>;

  corruptVerifiedRefPayload(refId: string): void {
    const snapshot = this.verifiedRefs.get(refId);
    if (!snapshot) throw new Error('test_verified_ref_missing');
    Reflect.set(snapshot.record, 'payload', 'malformed');
  }

  hasVerifiedRef(refId: string): boolean {
    return this.verifiedRefs.has(refId);
  }

  protected override async withConfirmationPauseLock<Result>(
    operation: () => Promise<Result>,
  ): Promise<Result> {
    const hook = this.beforeNextPersistenceLock;
    this.beforeNextPersistenceLock = undefined;
    await hook?.();
    return super.withConfirmationPauseLock(operation);
  }
}

class NoopD1ResetStatement implements D1PreparedStatement {
  bind(..._values: unknown[]): D1PreparedStatement {
    return this;
  }

  async run(): Promise<D1Result> {
    return {
      success: true,
      meta: { changes: 0 },
    };
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return null;
  }

  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    return {
      success: true,
      meta: { changes: 0 },
      results: [],
    };
  }
}

class ResetAwareFakeVerifiedRefD1 extends FakeVerifiedRefD1 {
  override prepare(query: string): D1PreparedStatement {
    const sql = normalizeHarnessSql(query);
    if (
      sql.startsWith(
        "UPDATE non_agent_text_deliveries SET status = 'confirmed_not_sent'",
      ) ||
      sql.startsWith(
        "UPDATE non_agent_text_deliveries SET status = 'outcome_unknown'",
      )
    ) {
      return new NoopD1ResetStatement();
    }
    return super.prepare(query);
  }
}

class ResetAwareFakeVerifiedRefPostgres extends FakeVerifiedRefPostgres {
  override async query(
    rawSql: string,
    values: unknown[] = [],
  ): Promise<{ rows: Record<string, unknown>[]; rowCount: number }> {
    const sql = normalizeHarnessSql(rawSql);
    if (
      sql.startsWith(
        "UPDATE non_agent_text_deliveries SET status = 'confirmed_not_sent'",
      ) ||
      sql.startsWith(
        "UPDATE non_agent_text_deliveries SET status = 'outcome_unknown'",
      )
    ) {
      this.queries.push({ sql, values: structuredClone(values) });
      return { rows: [], rowCount: 0 };
    }
    return super.query(rawSql, values);
  }
}

const harnesses: VerifiedRefHarness[] = [
  {
    name: 'MemoryStore',
    create() {
      const store = new RaceableMemoryStore();
      return {
        store,
        corruptPayload(refId) {
          store.corruptVerifiedRefPayload(refId);
        },
        hasStoredRef(refId) {
          return store.hasVerifiedRef(refId);
        },
        beforeIssueInsert(hook) {
          store.beforeNextPersistenceLock = hook;
        },
        async setCustomerRun(runId, sessionId, status) {
          const existing = await store.getCustomerRun(runId);
          if (existing) {
            await store.updateCustomerRun(runId, {
              status,
              terminalAt: isTerminalRunStatus(status) ? activeAt : null,
            });
            return;
          }
          await store.createCustomerRun(customerRun(runId, sessionId, status));
        },
      };
    },
  },
  {
    name: 'D1Store',
    create() {
      const db = new ResetAwareFakeVerifiedRefD1();
      return fakeHarness(new D1Store(db), db);
    },
  },
  {
    name: 'PostgresStore',
    create() {
      const db = new ResetAwareFakeVerifiedRefPostgres();
      return fakeHarness(new PostgresStore(db as never), db);
    },
  },
];

for (const harness of harnesses) {
  describe(`${harness.name} verified references`, () => {
    it('issues an opaque server-generated ref and resolves exact authority', async () => {
      const { store } = harness.create();
      const issued = await store.issueVerifiedRef(input());

      expect(issued.status).toBe('created');
      if (issued.status !== 'created') throw new Error('test_issue_failed');
      expect(Object.keys(issued.record.ref).sort()).toEqual(['id', 'kind']);
      expect(issued.record.ref).not.toHaveProperty('payload');
      expect(issued.record.ref.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
      );

      await expect(
        store.resolveVerifiedRef(resolveInput(issued.record)),
      ).resolves.toMatchObject({
        payload: {
          line1: '12 Example Street',
          district: 'District 1',
        },
      });
    });

    it('rejects caller-selected identifiers before touching storage', async () => {
      const { store } = harness.create();
      const forged = input();
      Reflect.set(
        forged,
        'id',
        '00000000-0000-4000-8000-000000000001',
      );
      await expect(
        store.issueVerifiedRef(forged),
      ).rejects.toThrow();
    });

    it('collapses wrong kind, principal fields, and revision to unavailable', async () => {
      const { store } = harness.create();
      const record = await issueRecord(store);
      for (const attempt of mismatchedResolveInputs(record)) {
        await expect(store.resolveVerifiedRef(attempt)).resolves.toBeUndefined();
      }
    });

    it('treats the exact expiry boundary as unavailable', async () => {
      const { store } = harness.create();
      const record = await issueRecord(store);
      await expect(
        store.resolveVerifiedRef({
          ...resolveInput(record),
          now: expiresAt,
        }),
      ).resolves.toBeUndefined();
    });

    it('hides malformed replayable payloads from mismatches and fails exact authority closed', async () => {
      const harnessInstance = harness.create();
      const record = await issueRecord(harnessInstance.store);
      harnessInstance.corruptPayload(record.ref.id);
      for (const attempt of mismatchedResolveInputs(record)) {
        await expect(
          harnessInstance.store.resolveVerifiedRef(attempt),
        ).resolves.toBeUndefined();
      }
      await expect(
        harnessInstance.store.resolveVerifiedRef(resolveInput(record)),
      ).rejects.toThrow();
    });

    it('hides malformed one-shot payloads from claim mismatches and fails exact authority closed', async () => {
      const harnessInstance = harness.create();
      await seedClaimOwner(harnessInstance);
      const record = await issueRecord(harnessInstance.store, {
        lifecycle: 'one_shot',
      });
      harnessInstance.corruptPayload(record.ref.id);
      for (const attempt of mismatchedResolveInputs(record)) {
        await expect(
          harnessInstance.store.claimVerifiedRef({
            ...attempt,
            useId: 'effect:malformed-mismatch',
            runFence: runFence(attempt.principal.sessionId),
          }),
        ).resolves.toEqual({ status: 'unavailable' });
      }
      await expect(
        harnessInstance.store.claimVerifiedRef({
          ...resolveInput(record),
          useId: 'effect:malformed-exact',
          runFence: runFence(record.principal.sessionId),
        }),
      ).rejects.toThrow();
    });

    it('permits exactly one distinct one-shot claim', async () => {
      const instance = harness.create();
      await seedClaimOwner(instance);
      const { store } = instance;
      const record = await issueRecord(store, {
        lifecycle: 'one_shot',
      });
      const authority = resolveInput(record);
      const claims = await Promise.all([
        store.claimVerifiedRef({
          ...authority,
          useId: 'effect:first',
          runFence: runFence(authority.principal.sessionId),
        }),
        store.claimVerifiedRef({
          ...authority,
          useId: 'effect:second',
          runFence: runFence(authority.principal.sessionId),
        }),
      ]);
      expect(claims.map((claim) => claim.status).sort()).toEqual([
        'claimed',
        'unavailable',
      ]);
    });

    it('replays only the same one-shot use id', async () => {
      const instance = harness.create();
      await seedClaimOwner(instance);
      const { store } = instance;
      const record = await issueRecord(store, {
        lifecycle: 'one_shot',
      });
      const authority = resolveInput(record);
      await expect(
        store.resolveVerifiedRef(authority),
      ).resolves.toBeUndefined();
      await expect(
        store.claimVerifiedRef({
          ...authority,
          useId: 'effect:stable',
          runFence: runFence(authority.principal.sessionId),
        }),
      ).resolves.toMatchObject({ status: 'claimed' });
      await expect(
        store.claimVerifiedRef({
          ...authority,
          useId: 'effect:stable',
          runFence: runFence(authority.principal.sessionId),
        }),
      ).resolves.toMatchObject({ status: 'replay' });
      await expect(
        store.resolveVerifiedRef(authority),
      ).resolves.toBeUndefined();
      await expect(
        store.claimVerifiedRef({
          ...authority,
          useId: 'effect:forged',
          runFence: runFence(authority.principal.sessionId),
        }),
      ).resolves.toEqual({ status: 'unavailable' });
    });

    it('does not claim replayable references', async () => {
      const instance = harness.create();
      await seedClaimOwner(instance);
      const { store } = instance;
      const record = await issueRecord(store, { lifecycle: 'replayable' });
      await expect(
        store.claimVerifiedRef({
          ...resolveInput(record),
          useId: 'effect:not-applicable',
          runFence: runFence(record.principal.sessionId),
        }),
      ).resolves.toEqual({ status: 'unavailable' });
    });

    it('physically deletes reset-session refs and preserves other sessions', async () => {
      const instance = harness.create();
      const first = await issueRecord(instance.store);
      const other = await issueRecord(instance.store, {
        principal: principal({
          sessionId: 'kfc:other-session',
          customerId: 'other-customer',
          authenticatedSubject: 'customer:other-customer',
          authenticationEvidenceRef: 'auth:other-session',
        }),
      });

      await instance.store.resetSession(first.principal.sessionId);

      expect(instance.hasStoredRef(first.ref.id)).toBe(false);
      expect(instance.hasStoredRef(other.ref.id)).toBe(true);
      await expect(
        instance.store.resolveVerifiedRef(resolveInput(first)),
      ).resolves.toBeUndefined();
      await expect(
        instance.store.resolveVerifiedRef(resolveInput(other)),
      ).resolves.toMatchObject({ ref: other.ref });
    });

    it('resets malformed stored authority without parsing it', async () => {
      const instance = harness.create();
      const record = await issueRecord(instance.store);
      instance.corruptPayload(record.ref.id);

      await expect(
        instance.store.resetSession(record.principal.sessionId),
      ).resolves.toMatchObject({
        sessionId: record.principal.sessionId,
        agentMode: 'ai_active',
        assignedAgentId: null,
        sessionAuthorityGeneration: 1,
      });
      expect(instance.hasStoredRef(record.ref.id)).toBe(false);
    });

    it('rejects issue/reset ABA instead of minting stale authority', async () => {
      const instance = harness.create();
      const issueInput = input();
      instance.beforeIssueInsert(async () => {
        await instance.store.resetSession(issueInput.principal.sessionId);
      });

      await expect(
        instance.store.issueVerifiedRef(issueInput),
      ).resolves.toEqual({ status: 'generation_conflict' });
    });
  });
}

describe('MemoryStore verified-ref run ownership', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not consume for a stale owner and lets the new current run claim', async () => {
    const store = new MemoryStore();
    await store.createCustomerRun(
      customerRun(claimRunId, principal().sessionId, 'running'),
    );
    const record = await issueRecord(store, { lifecycle: 'one_shot' });
    await store.updateCustomerRun(claimRunId, {
      status: 'superseded',
      terminalAt: activeAt,
    });

    await expect(
      store.claimVerifiedRef(claimInput(record, 'effect:stale')),
    ).resolves.toEqual({ status: 'unavailable' });

    const newRunId = `${claimRunId}:replacement`;
    await store.createCustomerRun(
      customerRun(newRunId, principal().sessionId, 'running'),
    );
    await expect(
      store.claimVerifiedRef({
        ...claimInput(record, 'effect:current'),
        runFence: runFence(record.principal.sessionId, newRunId),
      }),
    ).resolves.toMatchObject({ status: 'claimed' });
  });

  it('treats the authorization notAfter instant as stale without consuming', async () => {
    const boundary = new Date('2026-07-20T00:06:00.000Z');
    vi.useFakeTimers();
    vi.setSystemTime(boundary);
    const store = new MemoryStore();
    await store.createCustomerRun(
      customerRun(claimRunId, principal().sessionId, 'running'),
    );
    const record = await issueRecord(store, { lifecycle: 'one_shot' });

    await expect(
      store.claimVerifiedRef({
        ...claimInput(record, 'effect:boundary'),
        runFence: {
          ...runFence(record.principal.sessionId),
          notAfter: boundary.toISOString(),
        },
      }),
    ).resolves.toEqual({ status: 'unavailable' });
    await expect(
      store.claimVerifiedRef(claimInput(record, 'effect:after-boundary')),
    ).resolves.toMatchObject({ status: 'claimed' });
  });

  it('rejects a missing or cross-session run fence before storage access', async () => {
    const store = new MemoryStore();
    const record = await issueRecord(store, { lifecycle: 'one_shot' });
    const valid = claimInput(record, 'effect:invalid-guard');
    const missing = { ...valid } as Record<string, unknown>;
    delete missing.runFence;

    await expect(
      store.claimVerifiedRef(missing as never),
    ).rejects.toThrow();
    await expect(
      store.claimVerifiedRef({
        ...valid,
        runFence: runFence('kfc:other-session'),
      }),
    ).rejects.toThrow();
  });
});

describe('verified-ref run-fence persistence shape', () => {
  it('embeds the D1 owner predicate in both atomic claim and replay reads', async () => {
    const db = new FakeVerifiedRefD1();
    const store = new D1Store(db);
    db.setCustomerRun(claimRunId, principal().sessionId, 'running');
    const record = await issueRecord(store, { lifecycle: 'one_shot' });
    const claim = claimInput(record, 'effect:d1-shape');

    await expect(store.claimVerifiedRef(claim)).resolves.toMatchObject({
      status: 'claimed',
    });
    await expect(store.claimVerifiedRef(claim)).resolves.toMatchObject({
      status: 'replay',
    });

    const update = db.queries.find((query) =>
      query.sql.startsWith('UPDATE verified_refs'),
    );
    const replay = db.queries.find((query) =>
      query.sql.startsWith('SELECT') &&
      query.sql.includes('FROM verified_refs') &&
      query.sql.includes('FROM customer_runs AS run'),
    );
    expect(update?.sql).toContain(
      "AND (? IS NULL OR unixepoch('now') < unixepoch(?))",
    );
    expect(update?.sql).toContain('FROM customer_runs AS run');
    expect(update?.values.slice(-9)).toEqual([
      claim.runFence.notAfter,
      claim.runFence.notAfter,
      claimRunId,
      record.principal.sessionId,
      claim.runFence.fence.sessionAuthorityGeneration,
      record.principal.sessionId,
      claim.runFence.fence.sessionAuthorityGeneration,
      claim.runFence.fence.sessionAuthorityGeneration,
      record.principal.sessionId,
    ]);
    expect(replay?.sql).toContain('FROM customer_runs AS run');
  });

  it('locks the Postgres owner in the claim transaction and rolls back stale owners', async () => {
    const db = new FakeVerifiedRefPostgres();
    const store = new PostgresStore(db as never);
    db.setCustomerRun(claimRunId, principal().sessionId, 'running');
    const current = await issueRecord(store, { lifecycle: 'one_shot' });

    await expect(
      store.claimVerifiedRef(claimInput(current, 'effect:pg-current')),
    ).resolves.toMatchObject({ status: 'claimed' });
    expect(db.transactionEvents).toEqual(['BEGIN', 'COMMIT']);
    const ownerLock = db.queries.find((query) =>
      query.sql.startsWith('SELECT id FROM customer_runs'),
    );
    expect(ownerLock?.sql).toContain("status IN ('accepted', 'running')");
    expect(ownerLock?.sql).toContain(
      'session_authority_generation = $3',
    );
    expect(ownerLock?.values).toEqual([
      claimRunId,
      current.principal.sessionId,
      0,
      '2099-01-01T00:00:00.000Z',
    ]);
    expect(ownerLock?.sql).toContain('clock_timestamp() < $4');
    expect(ownerLock?.sql).toContain('FOR UPDATE');

    db.transactionEvents.length = 0;
    db.queries.length = 0;
    const stale = await issueRecord(store, { lifecycle: 'one_shot' });
    db.setCustomerRun(claimRunId, principal().sessionId, 'superseded');
    await expect(
      store.claimVerifiedRef(claimInput(stale, 'effect:pg-stale')),
    ).resolves.toEqual({ status: 'unavailable' });
    expect(db.transactionEvents).toEqual(['BEGIN', 'ROLLBACK']);
    expect(
      db.queries.some((query) =>
        query.sql.startsWith('UPDATE verified_refs'),
      ),
    ).toBe(false);
  });
});

describe('PostgresStore verified-ref issue/reset lock ordering', () => {
  it('holds the generation share lock until the created row is visible, then reset deletes it', async () => {
    const db = new ResetAwareFakeVerifiedRefPostgres();
    const store = new PostgresStore(db as never);
    const issueInput = input();
    let reset: ReturnType<ConversationStore['resetSession']> | undefined;
    db.afterVerifiedRefShareLock = async () => {
      reset = store.resetSession(issueInput.principal.sessionId);
      await new Promise<void>((resolve) => queueMicrotask(resolve));
      expect(db.lockEvents).not.toContain('reset_exclusive_lock');
      expect(db.lockEvents).not.toContain('reset_generation_advanced');
    };

    const issued = await store.issueVerifiedRef(issueInput);
    expect(issued.status).toBe('created');
    if (issued.status !== 'created') throw new Error('test_issue_failed');
    if (!reset) throw new Error('test_reset_not_started');
    await reset;

    expect(db.lockEvents).toEqual([
      'issue_share_lock',
      'issue_insert_visible',
      'issue_share_unlock',
      'reset_exclusive_lock',
      'reset_generation_advanced',
      'reset_refs_deleted',
    ]);
    expect(db.rows.has(issued.record.ref.id)).toBe(false);
    await expect(
      store.resolveVerifiedRef(resolveInput(issued.record)),
    ).resolves.toBeUndefined();
  });
});

function normalizeHarnessSql(sql: string): string {
  return sql.replace(/\s+/gu, ' ').trim();
}

function fakeHarness(
  store: ConversationStore,
  db: VerifiedRefFake,
): ReturnType<VerifiedRefHarness['create']> {
  return {
    store,
    corruptPayload(refId) {
      const row = db.rows.get(refId);
      if (!row) throw new Error('test_verified_ref_missing');
      row.payload_json = '{';
    },
    hasStoredRef(refId) {
      return db.rows.has(refId);
    },
    beforeIssueInsert(hook) {
      db.beforeVerifiedRefInsert = hook;
    },
    async setCustomerRun(runId, sessionId, status) {
      db.setCustomerRun(runId, sessionId, status);
    },
  };
}

async function seedClaimOwner(
  instance: ReturnType<VerifiedRefHarness['create']>,
): Promise<void> {
  await instance.setCustomerRun(
    claimRunId,
    principal().sessionId,
    'running',
  );
}

const claimRunId = 'verified-ref-current-customer-run';

function runFence(
  sessionId: string,
  runId = claimRunId,
) {
  return {
    sessionId,
    fence: {
      kind: 'customer_run' as const,
      runId,
      sessionAuthorityGeneration: 0,
    },
    notAfter: '2099-01-01T00:00:00.000Z',
  };
}

function claimInput(
  record: VerifiedRefRecord,
  useId: string,
) {
  return {
    ...resolveInput(record),
    useId,
    runFence: runFence(record.principal.sessionId),
  };
}

function customerRun(
  runId: string,
  sessionId: string,
  status: CustomerRunStatus,
) {
  const customerId = sessionId.replace(/^kfc:/u, '');
  return {
    id: runId,
    schemaVersion: 1 as const,
    sessionId,
    customerId,
    clientMessageId: `message:${runId}`,
    requestFingerprint: `fingerprint:${runId}`,
    generation: 1,
    status,
    phase: status === 'running' ? 'read_only_tool' as const : null,
    nextEventSequence: 1,
    clientSchemaVersion: 1,
    acceptedAt: createdAt,
    startedAt: status === 'running' ? createdAt : null,
    terminalAt: isTerminalRunStatus(status) ? activeAt : null,
    updatedAt: activeAt,
  };
}

function isTerminalRunStatus(status: CustomerRunStatus): boolean {
  return ['completed', 'failed', 'cancelled', 'superseded'].includes(status);
}

async function issueRecord(
  store: ConversationStore,
  overrides: Partial<IssueVerifiedRefInput> = {},
): Promise<VerifiedRefRecord> {
  const issued = await store.issueVerifiedRef(input(overrides));
  if (issued.status !== 'created') throw new Error('test_issue_failed');
  return issued.record;
}

function input(
  overrides: Partial<IssueVerifiedRefInput> = {},
): IssueVerifiedRefInput {
  return {
    kind: 'fulfillment_address',
    principal: principal(),
    verifiedRevision,
    payload: {
      line1: '12 Example Street',
      district: 'District 1',
    },
    lifecycle: 'replayable',
    createdAt,
    expiresAt,
    ...overrides,
  };
}

function principal(
  overrides: Partial<AuthenticatedCommerceApprovalPrincipal> = {},
): AuthenticatedCommerceApprovalPrincipal {
  return {
    principalKind: 'authenticated_customer',
    sessionId: 'kfc:customer-1',
    customerId: 'customer-1',
    channel: 'kfc',
    authenticatedSubject: 'customer:customer-1',
    authenticationEvidenceRef: 'auth:customer-1',
    ...overrides,
  };
}

function resolveInput(record: VerifiedRefRecord) {
  return {
    ref: record.ref,
    principal: record.principal,
    expectedVerifiedRevision: record.verifiedRevision,
    now: activeAt,
  };
}

function mismatchedResolveInputs(
  record: VerifiedRefRecord,
): ResolveVerifiedRefInput[] {
  const exact = resolveInput(record);
  return [
    {
      ...exact,
      ref: { ...exact.ref, kind: 'payment_method' },
    },
    {
      ...exact,
      principal: { ...exact.principal, sessionId: 'kfc:other-session' },
    },
    {
      ...exact,
      principal: { ...exact.principal, customerId: 'other-customer' },
    },
    {
      ...exact,
      principal: { ...exact.principal, channel: 'zalo' },
    },
    {
      ...exact,
      principal: {
        ...exact.principal,
        authenticatedSubject: 'customer:other',
      },
    },
    {
      ...exact,
      principal: {
        ...exact.principal,
        authenticationEvidenceRef: 'auth:other',
      },
    },
    {
      ...exact,
      expectedVerifiedRevision: 'b'.repeat(64),
    },
  ];
}
