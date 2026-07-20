import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  issueVerifiedRefRecord,
} from '../../src/domain/verifiedRef.js';
import {
  buildCommerceApprovalBinding,
  digestCommerceAction,
} from '../../src/ordering/approvalReceipt.js';
import type {
  CommerceApprovalPrincipal,
} from '../../src/ordering/types.js';
import type {
  AppendEventIfRunCurrentInput,
  CommitAssistantTurnIfRunCurrentInput,
  CommitConfirmationPauseIfRunCurrentInput,
  ConversationStore,
  CreateConfirmationPauseInput,
  IrreversibleOperationInput,
} from '../../src/persistence/contracts.js';
import {
  D1Store,
  type D1DatabaseLike,
} from '../../src/persistence/d1Store.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';
import { PostgresStore } from '../../src/persistence/postgresStore.js';

const sessionId = 'run-commit-fence-session';
const customerRunId = 'run-commit-fence-customer-run';
const agentRunId = 'run-commit-fence-agent-run';
const agentExecutionLeaseToken =
  '00000000-0000-4000-8000-000000000001';
const operationInput: IrreversibleOperationInput = {
  requestId: 'run-commit-fence-operation',
  sessionId,
  operation: 'kfc_synchronous_request',
  bindingFingerprint: 'run-commit-fence-operation-binding',
};

function customerFenceInput(
  sessionAuthorityGeneration = 0,
): AppendEventIfRunCurrentInput {
  return {
    sessionId,
    sourceType: 'graph:verified_state',
    payload: { verifiedState: { toolTrace: [] } },
    fence: {
      kind: 'customer_run',
      runId: customerRunId,
      sessionAuthorityGeneration,
    },
    notAfter: '2099-01-01T00:00:00.000Z',
  };
}

function agentFenceInput(
  sessionAuthorityGeneration = 0,
): AppendEventIfRunCurrentInput {
  return {
    ...customerFenceInput(sessionAuthorityGeneration),
    fence: {
      kind: 'agent_run',
      runId: agentRunId,
      generation: 7,
      sessionAuthorityGeneration,
      executionAttempt: 1,
      executionLeaseToken: agentExecutionLeaseToken,
    },
  };
}

function assistantCommitInput(
  fence: CommitAssistantTurnIfRunCurrentInput['fence'],
): CommitAssistantTurnIfRunCurrentInput {
  return {
    fence,
    notAfter: '2099-01-01T00:00:00.000Z',
    stateEvent: {
      sessionId,
      sourceType: 'graph:verified_state',
      payload: {
        verifiedState: {
          toolTrace: [],
          nested: { value: 'committed' },
        },
      },
    },
    assistantTurn: {
      sessionId,
      channel: 'kfc',
      role: 'assistant',
      text: 'Grounded response',
      externalMessageId: null,
      externalUserId: 'run-commit-customer',
      deliveryStatus: 'pending',
      metadata: null,
    },
  };
}

function stagedRef() {
  return issueVerifiedRefRecord({
    kind: 'saved_address',
    principal: {
      sessionId,
      customerId: 'run-commit-customer',
      channel: 'kfc',
      authenticatedSubject: 'subject-1',
      authenticationEvidenceRef: 'auth-evidence-1',
    },
    verifiedRevision: 'a'.repeat(64),
    payload: { label: 'Home' },
    lifecycle: 'replayable',
    createdAt: '2026-07-20T00:00:00.000Z',
    expiresAt: '2099-01-01T00:00:00.000Z',
  });
}

function expectD1BindingsMatch(
  calls: readonly CapturedConditionalInsert[],
): void {
  for (const call of calls) {
    expect(call.bindings).toHaveLength(
      call.query.match(/\?/gu)?.length ?? 0,
    );
  }
}

async function pauseCommitInput(
  fence: CommitConfirmationPauseIfRunCurrentInput['fence'],
): Promise<CommitConfirmationPauseIfRunCurrentInput> {
  const principal: CommerceApprovalPrincipal = {
    sessionId,
    customerId: 'run-commit-customer',
    channel: 'kfc',
    authenticatedSubject: 'subject-1',
    authenticationEvidenceRef: 'auth-evidence-1',
  };
  const action = { toolName: 'placeOrder' as const, arguments: {} };
  const approvalBinding = await buildCommerceApprovalBinding({
    capability: action.toolName,
    principal,
    action,
    revisions: {
      cartRevision: 'cart-r1',
      fulfillmentRevision: 'fulfillment-r1',
      paymentRevision: 'payment-r1',
      collectionRevision: 'collection-r1',
      providerRevision: 'provider-r1',
    },
  });
  const pause: CreateConfirmationPauseInput = {
    schemaVersion: 'kfc-confirmation-pause-v1',
    requestId: '00000000-0000-4000-8000-000000000041',
    checkpointThreadId:
      `agent:${JSON.stringify([sessionId, 'run:pause:message-1'])}`,
    checkpointNamespace: '',
    checkpointId: 'checkpoint-pause-1',
    sessionId,
    customerId: principal.customerId,
    channel: principal.channel,
    action,
    actionDigest: await digestCommerceAction(action),
    approvalBinding,
    approvalBindingDigest:
      await digestCommerceAction(approvalBinding),
    principal,
    createdAt: '2026-07-20T00:00:00.000Z',
    expiresAt: '2099-01-01T00:00:00.000Z',
  };
  return {
    fence,
    notAfter: '2099-01-01T00:00:00.000Z',
    stateEvent: {
      sessionId,
      sourceType: 'graph:verified_state',
      payload: { verifiedState: { pendingApproval: true } },
    },
    pause,
  };
}

async function operationFence(
  store: ConversationStore,
): Promise<Extract<
  CommitAssistantTurnIfRunCurrentInput['fence'],
  { kind: 'operation_lease' }
>> {
  const reserved = await store.reserveIrreversibleOperation!(
    operationInput,
  );
  if (reserved.status !== 'reserved') {
    throw new Error('test operation lease was not reserved');
  }
  return {
    kind: 'operation_lease',
    ...operationInput,
    attempt: reserved.attempt,
    leaseToken: reserved.leaseToken,
    sessionAuthorityGeneration:
      reserved.sessionAuthorityGeneration,
  };
}

async function seedCustomerRun(store: ConversationStore) {
  return store.createCustomerRun({
    id: customerRunId,
    schemaVersion: 1,
    sessionId,
    customerId: 'run-commit-customer',
    clientMessageId: 'run-commit-message',
    requestFingerprint: 'run-commit-fingerprint',
    generation: 1,
    status: 'running',
    phase: 'read_only_tool',
    nextEventSequence: 1,
    clientSchemaVersion: 1,
    acceptedAt: '2026-07-20T00:00:00.000Z',
    startedAt: '2026-07-20T00:00:00.000Z',
    terminalAt: null,
    updatedAt: '2026-07-20T00:00:00.000Z',
  });
}

async function seedAgentRun(store: ConversationStore) {
  const run = await store.createAgentRun({
    id: agentRunId,
    sessionId,
    generation: 7,
    channel: 'messenger',
    externalUserId: 'run-commit-customer',
    status: 'scheduled',
    coalescedInputText: 'current customer input',
    deliveryStatus: 'pending',
    scheduledAt: '2026-07-20T00:00:00.000Z',
  });
  await store.setSessionAgentState({
    sessionId,
    currentRunId: agentRunId,
    generation: 7,
    debounceDeadlineAt: null,
  });
  const claimedAt = new Date();
  const execution = await store.claimAgentRunExecution({
    runId: run.id,
    sessionId: run.sessionId,
    generation: run.generation,
    sessionAuthorityGeneration: run.sessionAuthorityGeneration,
    claimedAt: claimedAt.toISOString(),
    executionLeaseToken: agentExecutionLeaseToken,
    executionLeaseExpiresAt: new Date(
      claimedAt.getTime() + 60_000,
    ).toISOString(),
  });
  if (execution.status !== 'claimed') {
    throw new Error('test_agent_run_execution_claim_failed');
  }
  return execution.run;
}

describe('MemoryStore current-run conditional event commit', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('commits only while the exact customer run remains active', async () => {
    const store = new MemoryStore();
    const run = await seedCustomerRun(store);

    await expect(
      store.appendEventIfRunCurrent(
        customerFenceInput(run.sessionAuthorityGeneration),
      ),
    ).resolves.toMatchObject({ status: 'committed' });
    await store.updateCustomerRun(customerRunId, {
      status: 'superseded',
      terminalAt: '2026-07-20T00:00:01.000Z',
    });
    await expect(
      store.appendEventIfRunCurrent(
        customerFenceInput(run.sessionAuthorityGeneration),
      ),
    ).resolves.toEqual({ status: 'stale' });
    expect(await store.listEvents(sessionId)).toHaveLength(1);
  });

  it('keeps an old customer-run fence stale after human pause and AI resume', async () => {
    const store = new MemoryStore();
    const run = await seedCustomerRun(store);
    const fenceInput = customerFenceInput(
      run.sessionAuthorityGeneration,
    );

    const paused = await store.transitionSessionAuthority({
      sessionId,
      expectedGeneration: run.sessionAuthorityGeneration,
      agentMode: 'human_paused',
      assignedAgentId: 'agent-1',
    });
    expect(paused).toMatchObject({
      status: 'transitioned',
      control: {
        agentMode: 'human_paused',
        sessionAuthorityGeneration:
          run.sessionAuthorityGeneration + 1,
      },
    });
    await expect(
      store.appendEventIfRunCurrent(fenceInput),
    ).resolves.toEqual({ status: 'stale' });

    const resumed = await store.transitionSessionAuthority({
      sessionId,
      expectedGeneration:
        paused.control.sessionAuthorityGeneration,
      agentMode: 'ai_active',
      assignedAgentId: null,
    });
    expect(resumed).toMatchObject({
      status: 'transitioned',
      control: {
        agentMode: 'ai_active',
        sessionAuthorityGeneration:
          run.sessionAuthorityGeneration + 2,
      },
    });
    await expect(
      store.appendEventIfRunCurrent(fenceInput),
    ).resolves.toEqual({ status: 'stale' });
  });

  it('binds an agent-run commit to current id, generation, status, and store clock expiry', async () => {
    const store = new MemoryStore();
    const run = await seedAgentRun(store);

    await expect(
      store.appendEventIfRunCurrent(
        agentFenceInput(run.sessionAuthorityGeneration),
      ),
    ).resolves.toMatchObject({ status: 'committed' });
    await expect(
      store.appendEventIfRunCurrent({
        ...agentFenceInput(run.sessionAuthorityGeneration),
        notAfter: '2020-01-01T00:00:00.000Z',
      }),
    ).resolves.toEqual({ status: 'stale' });
    await store.setSessionAgentState({
      sessionId,
      currentRunId: agentRunId,
      generation: 8,
      debounceDeadlineAt: null,
    });
    await expect(
      store.appendEventIfRunCurrent(
        agentFenceInput(run.sessionAuthorityGeneration),
      ),
    ).resolves.toEqual({ status: 'stale' });
    expect(await store.listEvents(sessionId)).toHaveLength(1);
  });

  it('binds an operation commit to the exact unexpired attempt and lease token', async () => {
    vi.useFakeTimers();
    vi.setSystemTime('2026-07-20T00:00:00.000Z');
    const store = new MemoryStore();
    const fence = await operationFence(store);

    await expect(
      store.appendEventIfRunCurrent({
        ...customerFenceInput(),
        fence,
      }),
    ).resolves.toMatchObject({ status: 'committed' });
    await expect(
      store.appendEventIfRunCurrent({
        ...customerFenceInput(),
        fence: { ...fence, leaseToken: 'wrong-token' },
      }),
    ).resolves.toEqual({ status: 'stale' });
    vi.advanceTimersByTime(30_001);
    await expect(
      store.appendEventIfRunCurrent({
        ...customerFenceInput(),
        fence,
      }),
    ).resolves.toEqual({ status: 'stale' });
    expect(await store.listEvents(sessionId)).toHaveLength(1);
  });

  it('reads the exact operation owner with the store clock before dispatch', async () => {
    vi.useFakeTimers();
    vi.setSystemTime('2026-07-20T00:00:00.000Z');
    const store = new MemoryStore();
    const fence = await operationFence(store);

    await expect(store.isRunCommitFenceCurrent({
      sessionId,
      fence,
    })).resolves.toBe(true);
    await expect(store.isRunCommitFenceCurrent({
      sessionId,
      fence: { ...fence, attempt: fence.attempt + 1 },
    })).resolves.toBe(false);
    await expect(store.isRunCommitFenceCurrent({
      sessionId,
      fence,
      notAfter: '2020-01-01T00:00:00.000Z',
    })).resolves.toBe(false);
    vi.advanceTimersByTime(30_001);
    await expect(store.isRunCommitFenceCurrent({
      sessionId,
      fence,
    })).resolves.toBe(false);
  });

  it('atomically commits state, staged refs, assistant turn, and turn audit', async () => {
    const store = new MemoryStore();
    const run = await seedCustomerRun(store);
    const input = assistantCommitInput({
      kind: 'customer_run',
      runId: customerRunId,
      sessionAuthorityGeneration:
        run.sessionAuthorityGeneration,
    });
    const ref = stagedRef();
    input.verifiedRefs = [ref];

    await expect(
      store.commitAssistantTurnIfRunCurrent(input),
    ).resolves.toMatchObject({
      status: 'committed',
      turn: { role: 'assistant', text: 'Grounded response' },
    });
    (input.stateEvent.payload.verifiedState as {
      nested: { value: string };
    }).nested.value = 'mutated-after-commit';

    const events = await store.listEvents(sessionId);
    expect(events).toHaveLength(2);
    expect(events[0]?.payload).toMatchObject({
      verifiedState: { nested: { value: 'committed' } },
    });
    expect(await store.listTurns(sessionId)).toHaveLength(1);
    await expect(
      store.resolveVerifiedRef({
        ref: ref.ref,
        principal: ref.principal,
        expectedVerifiedRevision: ref.verifiedRevision,
        now: '2026-07-20T00:00:01.000Z',
      }),
    ).resolves.toMatchObject({ ref: ref.ref });
  });

  it('leaves every assistant artifact absent when the owner is stale', async () => {
    const store = new MemoryStore();
    const run = await seedCustomerRun(store);
    await store.updateCustomerRun(customerRunId, {
      status: 'superseded',
      terminalAt: '2026-07-20T00:00:01.000Z',
    });

    const ref = stagedRef();
    const input = assistantCommitInput({
      kind: 'customer_run',
      runId: customerRunId,
      sessionAuthorityGeneration:
        run.sessionAuthorityGeneration,
    });
    input.verifiedRefs = [ref];
    await expect(
      store.commitAssistantTurnIfRunCurrent(input),
    ).resolves.toEqual({ status: 'stale' });
    expect(await store.listEvents(sessionId)).toEqual([]);
    expect(await store.listTurns(sessionId)).toEqual([]);
    await expect(
      store.resolveVerifiedRef({
        ref: ref.ref,
        principal: ref.principal,
        expectedVerifiedRevision: ref.verifiedRevision,
        now: '2026-07-20T00:00:01.000Z',
      }),
    ).resolves.toBeUndefined();
  });

  it('atomically commits and replays a canonical pause with its state and audit', async () => {
    const store = new MemoryStore();
    const run = await seedCustomerRun(store);
    const input = await pauseCommitInput({
      kind: 'customer_run',
      runId: customerRunId,
      sessionAuthorityGeneration:
        run.sessionAuthorityGeneration,
    });

    await expect(
      store.commitConfirmationPauseIfRunCurrent(input),
    ).resolves.toMatchObject({
      status: 'created',
      record: { requestId: input.pause.requestId },
    });
    await expect(
      store.commitConfirmationPauseIfRunCurrent(input),
    ).resolves.toMatchObject({ status: 'replay' });
    expect(await store.listEvents(sessionId)).toHaveLength(2);
    await expect(
      store.getConfirmationPause(input.pause.requestId),
    ).resolves.toMatchObject({ status: 'pending' });
  });

  it('commits no pause artifact after durable supersession', async () => {
    const store = new MemoryStore();
    const run = await seedCustomerRun(store);
    await store.updateCustomerRun(customerRunId, {
      status: 'superseded',
      terminalAt: '2026-07-20T00:00:01.000Z',
    });
    const input = await pauseCommitInput({
      kind: 'customer_run',
      runId: customerRunId,
      sessionAuthorityGeneration:
        run.sessionAuthorityGeneration,
    });

    await expect(
      store.commitConfirmationPauseIfRunCurrent(input),
    ).resolves.toEqual({ status: 'stale' });
    expect(await store.listEvents(sessionId)).toEqual([]);
    await expect(
      store.getConfirmationPause(input.pause.requestId),
    ).resolves.toBeUndefined();
  });
});

interface CapturedConditionalInsert {
  query: string;
  bindings: unknown[];
}

class ConditionalInsertD1 implements D1DatabaseLike {
  current = true;
  readonly calls: CapturedConditionalInsert[] = [];

  prepare(query: string) {
    const captured: CapturedConditionalInsert = {
      query,
      bindings: [],
    };
    this.calls.push(captured);
    const statement = {
      bind: (...values: unknown[]) => {
        captured.bindings = values;
        return statement;
      },
      run: async () => ({
        success: true,
        meta: { changes: this.current ? 1 : 0 },
      }),
      first: async <Value>() => (
        /SELECT 1 AS current/u.test(query) && this.current
          ? { current: 1 } as Value
          : null
      ),
      all: async <Value>() => ({
        success: true,
        meta: {},
        results: [] as Value[],
      }),
    };
    return statement;
  }
}

class AtomicCommitD1 extends ConditionalInsertD1 {
  async batch(statements: ReturnType<AtomicCommitD1['prepare']>[]) {
    return Promise.all(statements.map((statement) => statement.run()));
  }
}

class ConditionalInsertPostgres {
  current = true;
  readonly calls: CapturedConditionalInsert[] = [];

  async query(query: string, bindings: unknown[] = []) {
    this.calls.push({ query, bindings });
    if (/SELECT EXISTS/u.test(query)) {
      return {
        rowCount: 1,
        rows: [{ current: this.current }],
      };
    }
    return {
      rowCount: this.current ? 1 : 0,
      rows: this.current ? [{ id: bindings[0] }] : [],
    };
  }
}

class AtomicCommitPostgresClient {
  current = true;
  failOnTurnInsert = false;
  readonly calls: CapturedConditionalInsert[] = [];

  async query(query: string, bindings: unknown[] = []) {
    this.calls.push({ query, bindings });
    if (
      this.failOnTurnInsert &&
      /INSERT INTO conversation_turns/u.test(query)
    ) {
      throw new Error('injected turn insert failure');
    }
    if (
      /SELECT id[\s\S]+FROM customer_runs/u.test(query)
    ) {
      return {
        rowCount: this.current ? 1 : 0,
        rows: this.current ? [{ id: customerRunId }] : [],
      };
    }
    if (
      /SELECT (?:id|request_id|session_id)[\s\S]+FROM (?:agent_runs|irreversible_operations|session_agent_state)[\s\S]+FOR UPDATE/u
        .test(query)
    ) {
      return {
        rowCount: this.current ? 1 : 0,
        rows: this.current ? [{ id: bindings[0] }] : [],
      };
    }
    if (
      /INSERT INTO confirmation_pause_sessions/u.test(query) &&
      /RETURNING generation/u.test(query)
    ) {
      return { rowCount: 1, rows: [{ generation: 0 }] };
    }
    return { rowCount: 1, rows: [] };
  }

  release() {}
}

class AtomicCommitPostgres {
  readonly client = new AtomicCommitPostgresClient();

  async connect() {
    return this.client;
  }
}

describe('durable store current-run conditional INSERT contracts', () => {
  it('uses store-clock exact-owner reads for D1 and PostgreSQL', async () => {
    const d1 = new ConditionalInsertD1();
    const d1Store = new D1Store(d1);
    const postgres = new ConditionalInsertPostgres();
    const postgresStore = new PostgresStore(postgres as never);
    const fence = {
      kind: 'operation_lease',
      ...operationInput,
      attempt: 2,
      leaseToken: 'lease-token-2',
      sessionAuthorityGeneration: 0,
    } as const;

    await expect(d1Store.isRunCommitFenceCurrent({
      sessionId,
      fence,
    })).resolves.toBe(true);
    await expect(postgresStore.isRunCommitFenceCurrent({
      sessionId,
      fence,
    })).resolves.toBe(true);
    await expect(d1Store.isRunCommitFenceCurrent({
      sessionId,
      fence,
      notAfter: 'not-a-date',
    })).resolves.toBe(false);
    await expect(postgresStore.isRunCommitFenceCurrent({
      sessionId,
      fence,
      notAfter: 'not-a-date',
    })).resolves.toBe(false);

    expect(d1.calls[0]?.query).toMatch(
      /SELECT 1 AS current[\s\S]+FROM irreversible_operations[\s\S]+attempt_count[\s\S]+lease_token[\s\S]+unixepoch\('now'\)/u,
    );
    expect(postgres.calls[0]?.query).toMatch(
      /SELECT EXISTS[\s\S]+FROM irreversible_operations[\s\S]+attempt_count[\s\S]+lease_token[\s\S]+clock_timestamp\(\)/u,
    );
    expect(d1.calls).toHaveLength(1);
    expect(postgres.calls).toHaveLength(1);
    expectD1BindingsMatch(d1.calls);
  });

  it('uses one D1 INSERT predicate for customer and agent ownership', async () => {
    const db = new ConditionalInsertD1();
    const store = new D1Store(db);

    await expect(
      store.appendEventIfRunCurrent(customerFenceInput()),
    ).resolves.toMatchObject({ status: 'committed' });
    await expect(
      store.appendEventIfRunCurrent(agentFenceInput()),
    ).resolves.toMatchObject({ status: 'committed' });
    await expect(
      store.appendEventIfRunCurrent({
        ...customerFenceInput(),
        fence: {
          kind: 'operation_lease',
          ...operationInput,
          attempt: 2,
          leaseToken: 'lease-token-2',
          sessionAuthorityGeneration: 0,
        },
      }),
    ).resolves.toMatchObject({ status: 'committed' });
    db.current = false;
    await expect(
      store.appendEventIfRunCurrent(agentFenceInput()),
    ).resolves.toEqual({ status: 'stale' });

    expect(db.calls).toHaveLength(4);
    expect(db.calls[0]?.query).toMatch(
      /INSERT INTO conversation_events[\s\S]+WHERE .*unixepoch[\s\S]+EXISTS[\s\S]+FROM customer_runs/u,
    );
    expect(db.calls[1]?.query).toMatch(
      /INSERT INTO conversation_events[\s\S]+WHERE .*unixepoch[\s\S]+EXISTS[\s\S]+session_agent_state[\s\S]+INNER JOIN agent_runs/u,
    );
    expect(db.calls[1]?.query).toContain(
      "run.status = 'running'",
    );
    expect(db.calls[2]?.query).toMatch(
      /FROM irreversible_operations[\s\S]+attempt_count[\s\S]+lease_token[\s\S]+lease_expires_at/u,
    );
  });

  it('locks PostgreSQL customer, agent, and operation owners in the event transaction', async () => {
    const db = new AtomicCommitPostgres();
    const store = new PostgresStore(db as never);

    await expect(
      store.appendEventIfRunCurrent(customerFenceInput()),
    ).resolves.toMatchObject({ status: 'committed' });
    await expect(
      store.appendEventIfRunCurrent(agentFenceInput()),
    ).resolves.toMatchObject({ status: 'committed' });
    await expect(
      store.appendEventIfRunCurrent({
        ...customerFenceInput(),
        fence: {
          kind: 'operation_lease',
          ...operationInput,
          attempt: 2,
          leaseToken: 'lease-token-2',
          sessionAuthorityGeneration: 0,
        },
      }),
    ).resolves.toMatchObject({ status: 'committed' });
    db.client.current = false;
    await expect(
      store.appendEventIfRunCurrent(agentFenceInput()),
    ).resolves.toEqual({ status: 'stale' });

    const queries = db.client.calls.map(({ query }) => query);
    expect(queries.filter((query) =>
      /pg_advisory_xact_lock/u.test(query))).toHaveLength(4);
    expect(queries).toEqual(expect.arrayContaining([
      expect.stringMatching(
        /SELECT id[\s\S]+FROM customer_runs[\s\S]+session_authority_generation = \$3[\s\S]+clock_timestamp\(\)[\s\S]+FOR UPDATE/u,
      ),
      expect.stringMatching(
        /SELECT id[\s\S]+FROM agent_runs[\s\S]+session_authority_generation = \$4[\s\S]+clock_timestamp\(\)[\s\S]+FOR UPDATE/u,
      ),
      expect.stringMatching(
        /FROM irreversible_operations[\s\S]+session_authority_generation = \$5[\s\S]+attempt_count = \$6[\s\S]+lease_token = \$7[\s\S]+clock_timestamp\(\)[\s\S]+FOR UPDATE/u,
      ),
    ]));
    expect(queries.filter((query) =>
      /INSERT INTO conversation_events/u.test(query))).toHaveLength(3);
    expect(queries).not.toEqual(
      expect.arrayContaining([
        expect.stringContaining('CURRENT_TIMESTAMP'),
      ]),
    );
  });

  it('uses one transactional D1 batch for every assistant artifact', async () => {
    const db = new AtomicCommitD1();
    const store = new D1Store(db);

    await expect(
      store.commitAssistantTurnIfRunCurrent(
        assistantCommitInput({
          kind: 'customer_run',
          runId: customerRunId,
          sessionAuthorityGeneration: 0,
        }),
      ),
    ).resolves.toMatchObject({ status: 'committed' });

    expect(db.calls).toHaveLength(3);
    expect(db.calls[0]?.query).toMatch(
      /INSERT INTO conversation_events[\s\S]+FROM customer_runs/u,
    );
    expect(db.calls[1]?.query).toMatch(
      /INSERT INTO conversation_turns[\s\S]+FROM customer_runs/u,
    );
    expect(db.calls[2]?.query).toMatch(
      /conversation_turn:assistant|INSERT INTO conversation_events/u,
    );
    expectD1BindingsMatch(db.calls);
  });

  it('uses a PostgreSQL transaction and rolls back an incomplete publication', async () => {
    const db = new AtomicCommitPostgres();
    const store = new PostgresStore(db as never);

    await expect(
      store.commitAssistantTurnIfRunCurrent(
        assistantCommitInput({
          kind: 'customer_run',
          runId: customerRunId,
          sessionAuthorityGeneration: 0,
        }),
      ),
    ).resolves.toMatchObject({ status: 'committed' });
    expect(db.client.calls.map(({ query }) => query.trim())).toEqual(
      expect.arrayContaining(['BEGIN', 'COMMIT']),
    );
    expect(db.client.calls.some(({ query }) =>
      /FROM customer_runs[\s\S]+FOR UPDATE/u.test(query)
    )).toBe(true);

    const failing = new AtomicCommitPostgres();
    failing.client.failOnTurnInsert = true;
    const failingStore = new PostgresStore(failing as never);
    await expect(
      failingStore.commitAssistantTurnIfRunCurrent(
        assistantCommitInput({
          kind: 'customer_run',
          runId: customerRunId,
          sessionAuthorityGeneration: 0,
        }),
      ),
    ).rejects.toThrow('injected turn insert failure');
    expect(
      failing.client.calls.map(({ query }) => query.trim()),
    ).toContain('ROLLBACK');
    expect(
      failing.client.calls.map(({ query }) => query.trim()),
    ).not.toContain('COMMIT');
  });

  it('fails stale D1 and PostgreSQL pause commits before any pause artifact', async () => {
    const d1 = new AtomicCommitD1();
    d1.current = false;
    const d1Store = new D1Store(d1);
    await expect(
      d1Store.commitConfirmationPauseIfRunCurrent(
        await pauseCommitInput({
          kind: 'customer_run',
          runId: customerRunId,
          sessionAuthorityGeneration: 0,
        }),
      ),
    ).resolves.toEqual({ status: 'stale' });
    expect(d1.calls[0]?.query).toMatch(
      /confirmation_pause_sessions[\s\S]+FROM customer_runs/u,
    );
    expectD1BindingsMatch(d1.calls);

    const postgres = new AtomicCommitPostgres();
    postgres.client.current = false;
    const postgresStore = new PostgresStore(postgres as never);
    await expect(
      postgresStore.commitConfirmationPauseIfRunCurrent(
        await pauseCommitInput({
          kind: 'customer_run',
          runId: customerRunId,
          sessionAuthorityGeneration: 0,
        }),
      ),
    ).resolves.toEqual({ status: 'stale' });
    expect(
      postgres.client.calls.map(({ query }) => query.trim()),
    ).toContain('ROLLBACK');
    expect(postgres.client.calls.some(({ query }) =>
      /INSERT INTO confirmation_pauses/u.test(query)
    )).toBe(false);
  });
});
