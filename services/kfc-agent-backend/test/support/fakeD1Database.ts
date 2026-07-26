type Row = Record<string, unknown>;
type TableName =
  | 'agent_session_items'
  | 'conversation_turns'
  | 'conversation_profiles'
  | 'conversation_events'
  | 'dashboard_events'
  | 'webhook_deliveries'
  | 'non_agent_text_deliveries'
  | 'non_agent_text_delivery_attempts'
  | 'session_controls'
  | 'pending_customer_turns'
  | 'agent_runs'
  | 'agent_run_turns'
  | 'agent_run_text_deliveries'
  | 'agent_run_text_delivery_attempts'
  | 'session_agent_state'
  | 'customer_runs'
  | 'customer_run_events'
  | 'langgraph_checkpoints'
  | 'langgraph_checkpoint_writes'
  | 'confirmation_pause_sessions'
  | 'confirmation_pauses'
  | 'verified_refs'
  | 'irreversible_operations';

interface QueryResult<T = Row> {
  results?: T[];
  success: boolean;
  meta: Record<string, unknown>;
}

export class FakeD1Database {
  readonly calls = { batch: 0, run: 0, first: 0, all: 0 };
  readonly tables = {
    agent_session_items: [] as Row[],
    conversation_turns: [] as Row[],
    conversation_profiles: [] as Row[],
    conversation_events: [] as Row[],
    dashboard_events: [] as Row[],
    webhook_deliveries: [] as Row[],
    non_agent_text_deliveries: [] as Row[],
    non_agent_text_delivery_attempts: [] as Row[],
    session_controls: [] as Row[],
    pending_customer_turns: [] as Row[],
    agent_runs: [] as Row[],
    agent_run_turns: [] as Row[],
    agent_run_text_deliveries: [] as Row[],
    agent_run_text_delivery_attempts: [] as Row[],
    session_agent_state: [] as Row[],
    customer_runs: [] as Row[],
    customer_run_events: [] as Row[],
    langgraph_checkpoints: [] as Row[],
    langgraph_checkpoint_writes: [] as Row[],
    confirmation_pause_sessions: [] as Row[],
    confirmation_pauses: [] as Row[],
    verified_refs: [] as Row[],
    irreversible_operations: [] as Row[],
  };
  private batchTail: Promise<void> = Promise.resolve();
  private readonly schemas = new Map<TableName, Set<string>>();
  beforeConfirmationPauseUpdate?: (
    kind: 'expire' | 'reject' | 'complete',
  ) => void | Promise<void>;
  afterConfirmationPauseUpdate?: (
    kind: 'expire' | 'reject' | 'complete',
  ) => void | Promise<void>;

  prepare(query: string): FakeD1PreparedStatement {
    return new FakeD1PreparedStatement(this, query);
  }

  async batch(statements: FakeD1PreparedStatement[]): Promise<QueryResult[]> {
    this.calls.batch += 1;
    let releaseBatch!: () => void;
    const previousBatch = this.batchTail;
    this.batchTail = new Promise<void>((resolve) => {
      releaseBatch = resolve;
    });
    await previousBatch;
    const snapshot = Object.fromEntries(
      Object.entries(this.tables).map(([name, rows]) => [
        name,
        structuredClone(rows),
      ]),
    ) as Record<TableName, Row[]>;
    try {
      const results: QueryResult[] = [];
      for (const statement of statements) {
        results.push(await statement.run());
      }
      return results;
    } catch (error) {
      for (const name of Object.keys(this.tables) as TableName[]) {
        this.tables[name].splice(
          0,
          this.tables[name].length,
          ...snapshot[name],
        );
      }
      throw error;
    } finally {
      releaseBatch();
    }
  }

  resetCallCounts(): void {
    this.calls.batch = 0;
    this.calls.run = 0;
    this.calls.first = 0;
    this.calls.all = 0;
  }

  recordCall(kind: keyof FakeD1Database['calls']): void {
    this.calls[kind] += 1;
  }

  defineTable(name: TableName, columns: string[]): void {
    this.schemas.set(name, new Set(columns));
  }

  hasColumn(name: TableName, column: string): boolean {
    return this.schemas.get(name)?.has(column) ?? false;
  }

  listColumns(name: TableName): string[] {
    return [...(this.schemas.get(name) ?? new Set<string>())];
  }

  hasTable(name: TableName): boolean {
    return this.schemas.has(name);
  }

  ensureTable(name: TableName, columns: string[]): void {
    if (!this.schemas.has(name)) {
      this.schemas.set(name, new Set(columns));
    }
  }

  addColumn(name: TableName, column: string): void {
    const columns = this.schemas.get(name);
    if (!columns) throw new Error(`Table does not exist: ${name}`);
    if (columns.has(column)) throw new Error(`duplicate column name: ${column}`);
    columns.add(column);
  }

  assertColumns(name: TableName, columns: string[]): void {
    const existing = this.schemas.get(name);
    if (!existing) throw new Error(`no such table: ${name}`);
    for (const column of columns) {
      if (!existing.has(column)) throw new Error(`no such column: ${name}.${column}`);
    }
  }
}

class FakeD1PreparedStatement {
  private values: unknown[] = [];

  constructor(
    private readonly db: FakeD1Database,
    private readonly query: string,
  ) {}

  bind(...values: unknown[]): FakeD1PreparedStatement {
    this.values = values;
    return this;
  }

  async run(): Promise<QueryResult> {
    this.db.recordCall('run');
    const normalized = normalizeSql(this.query);
    if (normalized.startsWith('SELECT ') || normalized.startsWith('PRAGMA ')) {
      return { ...ok(), results: await this.selectRows() };
    }
    if (normalized.startsWith('CREATE TABLE')) {
      this.handleCreateTable(normalized);
      return ok();
    }
    if (normalized.startsWith('CREATE INDEX') || normalized.startsWith('CREATE UNIQUE INDEX')) {
      return ok();
    }
    if (normalized.startsWith('ALTER TABLE')) {
      this.handleAlterTable(normalized);
      return ok();
    }
    if (normalized.startsWith('INSERT INTO agent_session_items')) {
      if (
        normalized.includes(' WHERE ') &&
        !this.runCommitEligibilityIsCurrent(normalized, 2)
      ) {
        return ok(0);
      }
      const id = this.db.tables.agent_session_items.reduce(
        (highest, row) => Math.max(highest, Number(row.id)),
        0,
      ) + 1;
      this.db.tables.agent_session_items.push({
        id,
        session_id: this.values[0],
        item_json: this.values[1],
      });
      return ok(1);
    }
    if (
      normalized.startsWith(
        'INSERT OR IGNORE INTO conversation_turns',
      ) &&
      normalized.includes("control.agent_mode = 'human_paused'")
    ) {
      this.db.assertColumns('conversation_turns', [
        'id',
        'session_id',
        'channel',
        'role',
        'text',
        'external_message_id',
        'external_user_id',
        'delivery_status',
        'metadata',
        'created_at',
      ]);
      const authorityCurrent = this.pausedSessionAuthorityMatches(
        this.values[8],
        this.values[9],
      );
      const runExists = this.db.tables.customer_runs.some(
        (row) =>
          row.id === this.values[10] ||
          (
            row.session_id === this.values[11] &&
            row.client_message_id === this.values[12]
          ),
      );
      const eventExists = this.db.tables.customer_run_events.some(
        (row) => row.event_id === this.values[13],
      );
      const turnExists = this.db.tables.conversation_turns.some(
        (row) =>
          row.id === this.values[0] ||
          (
            row.session_id === this.values[1] &&
            row.external_message_id === this.values[4]
          ),
      );
      if (
        !authorityCurrent ||
        runExists ||
        eventExists ||
        turnExists
      ) {
        return ok(0);
      }
      this.db.tables.conversation_turns.push({
        id: this.values[0],
        session_id: this.values[1],
        channel: this.values[2],
        role: 'user',
        text: this.values[3],
        external_message_id: this.values[4],
        external_user_id: this.values[5],
        delivery_status: 'received',
        metadata: this.values[6],
        created_at: this.values[7],
      });
      return ok(1);
    }
    if (
      normalized.startsWith('INSERT INTO conversation_turns') &&
      normalized.includes('FROM non_agent_text_deliveries')
    ) {
      const delivery = this.db.tables.non_agent_text_deliveries.find(
        (row) =>
          row.request_key === this.values[10] &&
          row.session_binding_digest === this.values[11] &&
          Number(row.reserved_session_authority_generation) ===
            Number(this.values[12]) &&
          row.agent_binding_digest === this.values[13] &&
          (
            row.status === 'pending' ||
            row.status === 'confirmed_not_sent'
          ),
      );
      const authorized = this.pausedSessionAuthorityMatches(
        this.values[14],
        this.values[15],
      ) && this.db.tables.session_controls.some(
        (row) =>
          row.session_id === this.values[14] &&
          row.assigned_agent_id === this.values[16],
      );
      const existing = this.db.tables.conversation_turns.find(
        (row) => row.id === this.values[0],
      );
      if (!delivery || !authorized || existing) return ok(0);
      const row = {
        id: this.values[0],
        session_id: this.values[1],
        channel: this.values[2],
        role: this.values[3],
        text: this.values[4],
        external_message_id: this.values[5],
        external_user_id: this.values[6],
        delivery_status: this.values[7],
        metadata: this.values[8],
        created_at: this.values[9],
      };
      this.db.tables.conversation_turns.push(row);
      return { ...ok(1), results: [{ ...row }] };
    }
    if (normalized.startsWith('INSERT INTO conversation_turns')) {
      this.db.assertColumns('conversation_turns', [
        'id',
        'session_id',
        'channel',
        'role',
        'text',
        'external_message_id',
        'external_user_id',
        'delivery_status',
        'metadata',
        'created_at',
      ]);
      if (!this.runCommitEligibilityIsCurrent(normalized, 10)) {
        return ok(0);
      }
      this.upsert('conversation_turns', {
        id: this.values[0],
        session_id: this.values[1],
        channel: this.values[2],
        role: this.values[3],
        text: this.values[4],
        external_message_id: this.values[5],
        external_user_id: this.values[6],
        delivery_status: this.values[7],
        metadata: this.values[8],
        created_at: this.values[9],
      });
      return ok(1);
    }
    if (normalized.startsWith('INSERT OR REPLACE INTO langgraph_checkpoints')) {
      this.upsert('langgraph_checkpoints', {
        thread_id: this.values[0], checkpoint_ns: this.values[1], checkpoint_id: this.values[2],
        parent_checkpoint_id: this.values[3], checkpoint_type: this.values[4], checkpoint_blob: this.values[5],
        metadata_type: this.values[6], metadata_blob: this.values[7], created_at: this.values[8],
      }, ['thread_id', 'checkpoint_ns', 'checkpoint_id']);
      return ok();
    }
    if (
      normalized.startsWith('INSERT OR IGNORE INTO langgraph_checkpoint_writes') ||
      normalized.startsWith('INSERT OR REPLACE INTO langgraph_checkpoint_writes')
    ) {
      const row = {
        thread_id: this.values[0], checkpoint_ns: this.values[1], checkpoint_id: this.values[2],
        task_id: this.values[3], write_index: this.values[4], channel: this.values[5],
        value_type: this.values[6], value_blob: this.values[7],
      };
      const existing = this.db.tables.langgraph_checkpoint_writes.find((entry) =>
        entry.thread_id === row.thread_id && entry.checkpoint_ns === row.checkpoint_ns &&
        entry.checkpoint_id === row.checkpoint_id && entry.task_id === row.task_id &&
        entry.write_index === row.write_index,
      );
      if (!existing) this.db.tables.langgraph_checkpoint_writes.push(row);
      else if (normalized.startsWith('INSERT OR REPLACE')) Object.assign(existing, row);
      return ok();
    }
    if (normalized.startsWith('INSERT OR IGNORE INTO irreversible_operations')) {
      this.db.assertColumns('irreversible_operations', [
        'request_id',
        'session_id',
        'operation',
        'binding_fingerprint',
        'session_authority_generation',
        'result_json',
        'status',
        'attempt_count',
        'lease_expires_at',
        'lease_token',
        'last_error',
        'created_at',
        'completed_at',
      ]);
      const exists = this.db.tables.irreversible_operations.some((row) => row.request_id === this.values[0]);
      const sessionAuthorityGeneration =
        this.activeSessionAuthorityGeneration(this.values[7]);
      if (!exists && sessionAuthorityGeneration !== undefined) {
        this.db.tables.irreversible_operations.push({
          request_id: this.values[0],
          session_id: this.values[1],
          operation: this.values[2],
          binding_fingerprint: this.values[3],
          session_authority_generation: sessionAuthorityGeneration,
          result_json: null,
          status: 'attempting',
          attempt_count: 1,
          lease_expires_at: this.values[4],
          lease_token: this.values[5],
          last_error: null,
          created_at: this.values[6],
          completed_at: null,
        });
      }
      return ok(
        exists || sessionAuthorityGeneration === undefined ? 0 : 1,
      );
    }
    if (normalized.startsWith('INSERT INTO confirmation_pause_sessions')) {
      if (
        normalized.includes("unixepoch('now') < unixepoch(?)") &&
        !this.runCommitEligibilityIsCurrent(normalized, 1)
      ) {
        return ok(0);
      }
      let row = this.db.tables.confirmation_pause_sessions.find(
        (candidate) => candidate.session_id === this.values[0],
      );
      if (!row) {
        row = {
          session_id: this.values[0],
          generation: normalized.includes('VALUES (?, 1)') ? 1 : 0,
        };
        this.db.tables.confirmation_pause_sessions.push(row);
      } else if (normalized.includes('generation + 1')) {
        row.generation = Number(row.generation) + 1;
      }
      return { ...ok(row ? 1 : 0), results: [{ ...row }] };
    }
    if (normalized.startsWith('UPDATE confirmation_pause_sessions')) {
      const row = this.db.tables.confirmation_pause_sessions.find(
        (candidate) =>
          candidate.session_id === this.values[0] &&
          candidate.generation === this.values[1],
      );
      const unresolved = this.db.tables.irreversible_operations.some(
        (operation) =>
          operation.session_id === this.values[2] &&
          operation.operation === 'confirmation_resume' &&
          !(
            operation.status === 'completed' &&
            operation.result_json !== null &&
            operation.result_json !== undefined &&
            operation.completed_at !== null &&
            operation.completed_at !== undefined
          ),
      );
      const unresolvedNonAgentDelivery =
        this.db.tables.non_agent_text_deliveries.some(
          (delivery) =>
            delivery.session_binding_digest === this.values[3] &&
            delivery.status === 'sending' &&
            String(delivery.sending_lease_expires_at) >
              String(this.values[4]),
        );
      if (!row || unresolved || unresolvedNonAgentDelivery) return ok(0);
      row.generation = Number(row.generation) + 1;
      return ok(1);
    }
    if (normalized.startsWith('INSERT OR IGNORE INTO confirmation_pauses')) {
      const exists = this.db.tables.confirmation_pauses.some(
        (row) => row.request_id === this.values[1],
      );
      const conditionallyFenced = normalized.includes(
        "unixepoch('now') < unixepoch(?)",
      );
      const session = conditionallyFenced
        ? this.db.tables.confirmation_pause_sessions.find(
            (row) => row.session_id === this.values[27],
          )
        : this.db.tables.confirmation_pause_sessions.find(
            (row) =>
              row.session_id === this.values[28] &&
              row.generation === this.values[29],
          );
      const eligible = !conditionallyFenced ||
        this.runCommitEligibilityIsCurrent(normalized, 28);
      const activeAuthority = this.sessionControl(
        conditionallyFenced
          ? this.values[5]
          : this.values[27],
      );
      const authorityEligible =
        activeAuthority.agent_mode === 'ai_active' &&
        (
          conditionallyFenced
            ? activeAuthority.session_authority_generation ===
                Number(this.values[6])
            : activeAuthority.session_authority_generation ===
                Number(this.values[30])
        );
      if (!exists && session && eligible) {
        const columns = [
          'schema_version',
          'request_id',
          'checkpoint_thread_id',
          'checkpoint_namespace',
          'checkpoint_id',
          'session_id',
          'session_generation',
          'session_authority_generation',
          'pause_identity_digest',
          'customer_id',
          'channel',
          'action_json',
          'action_digest',
          'approval_binding_json',
          'approval_binding_digest',
          'principal_json',
          'authenticated_subject',
          'authentication_evidence_ref',
          'created_at',
          'expires_at',
          'status',
          'rejection_receipt_id',
          'rejection_receipt_json',
          'rejected_at',
          'completion_status',
          'result_json',
          'completion_error',
          'completed_at',
        ];
        const values = conditionallyFenced
          ? [
              ...this.values.slice(0, 6),
              session.generation,
              ...this.values.slice(6, 27),
            ]
          : [
              ...this.values.slice(0, 7),
              activeAuthority.session_authority_generation,
              ...this.values.slice(7, 27),
            ];
        this.db.tables.confirmation_pauses.push(
          Object.fromEntries(
            columns.map((column, index) => [column, values[index]]),
          ),
        );
      }
      return ok(
        exists || !session || !eligible || !authorityEligible ? 0 : 1,
      );
    }
    if (normalized.startsWith('INSERT INTO conversation_profiles')) {
      this.db.assertColumns('conversation_profiles', [
        'channel',
        'external_user_id',
        'display_name',
        'avatar_url',
        'profile_source',
        'profile_updated_at',
      ]);
      this.upsert('conversation_profiles', {
        channel: this.values[0],
        external_user_id: this.values[1],
        display_name: this.values[2],
        avatar_url: this.values[3],
        profile_source: this.values[4],
        profile_updated_at: this.values[5],
      });
      return ok();
    }
    if (
      normalized.startsWith('INSERT INTO conversation_events') &&
      normalized.includes('FROM non_agent_text_deliveries')
    ) {
      const delivery = this.db.tables.non_agent_text_deliveries.find(
        (row) =>
          row.request_key === this.values[5] &&
          row.session_binding_digest === this.values[6] &&
          Number(row.reserved_session_authority_generation) ===
            Number(this.values[7]) &&
          row.agent_binding_digest === this.values[8] &&
          (
            row.status === 'pending' ||
            row.status === 'confirmed_not_sent'
          ),
      );
      const authorized = this.pausedSessionAuthorityMatches(
        this.values[9],
        this.values[10],
      ) && this.db.tables.session_controls.some(
        (row) =>
          row.session_id === this.values[9] &&
          row.assigned_agent_id === this.values[11],
      );
      const exactTurn = this.db.tables.conversation_turns.some(
        (row) =>
          row.id === this.values[12] &&
          row.session_id === this.values[13] &&
          row.channel === this.values[14] &&
          row.role === this.values[15] &&
          row.text === this.values[16] &&
          row.external_message_id === this.values[17] &&
          row.external_user_id === this.values[18] &&
          row.delivery_status === this.values[19] &&
          row.metadata === this.values[20] &&
          row.created_at === this.values[21],
      );
      const exists = this.db.tables.conversation_events.some(
        (row) => row.id === this.values[0],
      );
      if (!delivery || !authorized || !exactTurn || exists) return ok(0);
      this.db.tables.conversation_events.push({
        id: this.values[0],
        session_id: this.values[1],
        source_type: this.values[2],
        payload: this.values[3],
        created_at: this.values[4],
      });
      return ok(1);
    }
    if (
      normalized.startsWith('INSERT INTO conversation_events') ||
      normalized.startsWith('INSERT OR IGNORE INTO conversation_events')
    ) {
      this.db.assertColumns('conversation_events', ['id', 'session_id', 'source_type', 'payload', 'created_at']);
      if (!this.runCommitEligibilityIsCurrent(normalized, 5)) {
        return ok(0);
      }
      const exists = this.db.tables.conversation_events.some(
        (row) => row.id === this.values[0],
      );
      if (exists && normalized.startsWith('INSERT OR IGNORE')) {
        return ok(0);
      }
      this.db.tables.conversation_events.push({
        id: this.values[0],
        session_id: this.values[1],
        source_type: this.values[2],
        payload: this.values[3],
        created_at: this.values[4],
      });
      return ok(1);
    }
    if (normalized.startsWith('INSERT INTO dashboard_events') || normalized.startsWith('INSERT OR IGNORE INTO dashboard_events')) {
      this.db.assertColumns('dashboard_events', ['id', 'session_id', 'type', 'payload', 'created_at']);
      this.upsert('dashboard_events', {
        id: this.values[0],
        session_id: this.values[1],
        type: this.values[2],
        payload: this.values[3],
        created_at: this.values[4],
      });
      return ok();
    }
    if (
      normalized.startsWith(
        'INSERT INTO non_agent_text_delivery_attempts',
      )
    ) {
      this.db.assertColumns('non_agent_text_delivery_attempts', [
        'request_key',
        'delivery_attempt',
        'delivery_attempt_token',
        'created_at',
      ]);
      const head = this.db.tables.non_agent_text_deliveries.find(
        (row) =>
          row.request_key === this.values[0] &&
          row.session_binding_digest === this.values[1] &&
          row.status === 'sending' &&
          Number(row.delivery_attempt) === Number(this.values[2]) &&
          row.delivery_attempt_token === this.values[3] &&
          row.updated_at === this.values[4],
      );
      if (!head) return ok(0);
      if (
        this.db.tables.non_agent_text_delivery_attempts.some(
          (row) =>
            row.delivery_attempt_token === this.values[3] ||
            (
              row.request_key === this.values[0] &&
              Number(row.delivery_attempt) === Number(this.values[2])
            ),
        )
      ) {
        throw new Error(
          'UNIQUE constraint failed: non_agent_text_delivery_attempts',
        );
      }
      this.db.tables.non_agent_text_delivery_attempts.push({
        request_key: this.values[0],
        delivery_attempt: this.values[2],
        delivery_attempt_token: this.values[3],
        created_at: this.values[4],
      });
      return ok(1);
    }
    if (normalized.startsWith('INSERT INTO non_agent_text_deliveries')) {
      this.db.assertColumns('non_agent_text_deliveries', [
        'schema_version',
        'request_key',
        'session_binding_digest',
        'reserved_session_authority_generation',
        'channel',
        'assistant_turn_id',
        'agent_binding_digest',
        'recipient_binding_digest',
        'presentation_binding_digest',
        'delivery_binding_digest',
        'status',
        'delivery_attempt',
        'delivery_attempt_token',
        'sending_lease_expires_at',
        'provider_message_id',
        'outcome_code',
        'created_at',
        'updated_at',
      ]);
      const authorityCurrent = this.pausedSessionAuthorityMatches(
        this.values[18],
        this.values[19],
      ) && this.db.tables.session_controls.some(
        (row) =>
          row.session_id === this.values[18] &&
          row.assigned_agent_id === this.values[20],
      );
      const existing = this.findNonAgentTextDelivery(this.values[1]);
      if (!authorityCurrent || existing) return ok(0);
      const row = {
        schema_version: this.values[0],
        request_key: this.values[1],
        session_binding_digest: this.values[2],
        reserved_session_authority_generation: this.values[3],
        channel: this.values[4],
        assistant_turn_id: this.values[5],
        agent_binding_digest: this.values[6],
        recipient_binding_digest: this.values[7],
        presentation_binding_digest: this.values[8],
        delivery_binding_digest: this.values[9],
        status: this.values[10],
        delivery_attempt: this.values[11],
        delivery_attempt_token: this.values[12],
        sending_lease_expires_at: this.values[13],
        provider_message_id: this.values[14],
        outcome_code: this.values[15],
        created_at: this.values[16],
        updated_at: this.values[17],
      };
      this.db.tables.non_agent_text_deliveries.push(row);
      return { ...ok(1), results: [{ ...row }] };
    }
    if (
      normalized.startsWith('INSERT INTO webhook_deliveries') ||
      normalized.startsWith('INSERT OR IGNORE INTO webhook_deliveries')
    ) {
      this.db.assertColumns('webhook_deliveries', [
        'channel',
        'external_event_id',
        'external_thread_id',
        'external_user_id',
        'session_id',
        'status',
        'payload',
        'received_at',
        'processed_at',
        'failed_at',
        'last_error',
        'created_at',
        'updated_at',
      ]);
      if (normalized.includes('FROM session_controls')) {
        const control = this.db.tables.session_controls.find(
          (row) =>
            row.session_id === this.values[9] &&
            Number(row.session_authority_generation) ===
              Number(this.values[10]) &&
            row.agent_mode === 'human_paused' &&
            row.assigned_agent_id === this.values[11],
        );
        if (!control) return ok(0);
      }
      const existing = this.findWebhookDelivery();
      if (!existing) {
        const now = this.values[7];
        this.db.tables.webhook_deliveries.push({
          channel: this.values[0],
          external_event_id: this.values[1],
          external_thread_id: this.values[2],
          external_user_id: this.values[3],
          session_id: this.values[4],
          status: 'received',
          payload: this.values[5],
          received_at: this.values[6],
          processed_at: null,
          failed_at: null,
          last_error: null,
          created_at: now,
          updated_at: now,
        });
      }
      return ok(existing ? 0 : 1);
    }
    if (normalized.startsWith('INSERT INTO session_controls')) {
      this.db.assertColumns('session_controls', [
        'session_id',
        'agent_mode',
        'assigned_agent_id',
        'session_authority_generation',
        'updated_at',
      ]);
      if (normalized.includes('RETURNING *')) {
        const current = this.sessionControl(this.values[0]);
        const targetMode = this.values[1];
        const targetAssignee = this.values[2];
        const expectedGeneration = Number(this.values[4]);
        const unchanged =
          current.agent_mode === targetMode &&
          current.assigned_agent_id === targetAssignee;
        if (unchanged) return ok(0);
        if (
          current.session_authority_generation !== expectedGeneration ||
          (
            current.persisted === false &&
            (
              expectedGeneration !== 0 ||
              (
                targetMode === 'ai_active' &&
                targetAssignee === null
              )
            )
          )
        ) {
          return ok(0);
        }
        const row = {
          session_id: this.values[0],
          agent_mode: targetMode,
          assigned_agent_id: targetAssignee,
          session_authority_generation:
            current.session_authority_generation + 1,
          updated_at: this.values[3],
        };
        this.upsert('session_controls', row);
        return { ...ok(1), results: [{ ...row }] };
      }
      if (normalized.includes('COALESCE((')) {
        const fenceCurrent = this.confirmationPauseFenceIsCurrent(
          this.values[3],
          this.values[4],
        ) && this.confirmationPauseFenceIsCurrent(
          this.values[5],
          this.values[6],
        );
        if (!fenceCurrent) return ok(0);
        const current = this.sessionControl(this.values[0]);
        this.upsert('session_controls', {
          session_id: this.values[0],
          agent_mode: 'ai_active',
          assigned_agent_id: null,
          session_authority_generation:
            current.session_authority_generation + 1,
          updated_at: this.values[2],
        });
        return ok(1);
      }
      this.upsert('session_controls', {
        session_id: this.values[0],
        agent_mode: this.values[1],
        assigned_agent_id: this.values[2],
        session_authority_generation: Number(this.values[3] ?? 0),
        updated_at: this.values[4] ?? this.values[3],
      });
      return ok(1);
    }
    if (normalized.startsWith('INSERT INTO pending_customer_turns')) {
      this.db.assertColumns('pending_customer_turns', [
        'turn_id',
        'session_id',
        'channel',
        'external_message_id',
        'external_user_id',
        'text',
        'steer_mode',
        'status',
        'claimed_run_id',
        'received_at',
        'updated_at',
      ]);
      this.upsert('pending_customer_turns', {
        turn_id: this.values[0],
        session_id: this.values[1],
        channel: this.values[2],
        external_message_id: this.values[3],
        external_user_id: this.values[4],
        text: this.values[5],
        steer_mode: this.values[6],
        status: this.values[7],
        claimed_run_id: this.values[8],
        received_at: this.values[9],
        updated_at: this.values[10],
      });
      return ok();
    }
    if (normalized.startsWith('INSERT OR IGNORE INTO customer_runs')) {
      this.db.assertColumns('customer_runs', [
        'id',
        'schema_version',
        'session_id',
        'customer_id',
        'client_message_id',
        'request_fingerprint',
        'generation',
        'session_authority_generation',
        'status',
        'phase',
        'next_event_sequence',
        'client_schema_version',
        'accepted_at',
        'started_at',
        'terminal_at',
        'updated_at',
      ]);
      const existing = this.db.tables.customer_runs.find(
        (row) =>
          row.id === this.values[0] ||
          (row.session_id === this.values[2] && row.client_message_id === this.values[4]),
      );
      if (
        normalized.includes("control.agent_mode = 'human_paused'")
      ) {
        const authorityCurrent =
          this.pausedSessionAuthorityMatches(
            this.values[16],
            this.values[17],
          ) &&
          Number(this.values[7]) === Number(this.values[17]);
        const eventExists = this.db.tables.customer_run_events.some(
          (row) => row.event_id === this.values[21],
        );
        const exactTurn = this.db.tables.conversation_turns.some(
          (row) =>
            row.session_id === this.values[22] &&
            row.external_message_id === this.values[23] &&
            row.channel === this.values[24] &&
            row.role === 'user' &&
            row.text === this.values[25] &&
            row.external_user_id === this.values[26] &&
            row.delivery_status === 'received' &&
            jsonValuesEquivalent(
              row.metadata,
              this.values[27],
            ) &&
            jsonValuesEquivalent(
              row.metadata,
              this.values[28],
            ),
        );
        if (
          existing ||
          !authorityCurrent ||
          eventExists ||
          !exactTurn
        ) {
          return ok(0);
        }
        this.db.tables.customer_runs.push({
          id: this.values[0],
          schema_version: this.values[1],
          session_id: this.values[2],
          customer_id: this.values[3],
          client_message_id: this.values[4],
          request_fingerprint: this.values[5],
          generation: this.values[6],
          session_authority_generation: Number(this.values[7]),
          status: this.values[8],
          phase: this.values[9],
          next_event_sequence: this.values[10],
          client_schema_version: this.values[11],
          accepted_at: this.values[12],
          started_at: this.values[13],
          terminal_at: this.values[14],
          updated_at: this.values[15],
        });
        return ok(1);
      }
      const sessionAuthorityGeneration =
        this.activeSessionAuthorityGeneration(this.values[15]);
      if (existing || sessionAuthorityGeneration === undefined) return ok(0);
      this.db.tables.customer_runs.push({
        id: this.values[0],
        schema_version: this.values[1],
        session_id: this.values[2],
        customer_id: this.values[3],
        client_message_id: this.values[4],
        request_fingerprint: this.values[5],
        generation: this.values[6],
        session_authority_generation: sessionAuthorityGeneration,
        status: this.values[7],
        phase: this.values[8],
        next_event_sequence: this.values[9],
        client_schema_version: this.values[10],
        accepted_at: this.values[11],
        started_at: this.values[12],
        terminal_at: this.values[13],
        updated_at: this.values[14],
      });
      return ok(1);
    }
    if (
      normalized.startsWith('INSERT INTO customer_run_events') ||
      normalized.startsWith('INSERT OR IGNORE INTO customer_run_events')
    ) {
      this.db.assertColumns('customer_run_events', [
        'event_id',
        'run_id',
        'sequence',
        'schema_version',
        'type',
        'occurred_at',
        'payload',
      ]);
      const conditionallyFenced = normalized.includes(
        "unixepoch('now') < unixepoch(?)",
      );
      const pausedIntake = normalized.includes(
        "AND status = 'superseded'",
      );
      if (
        conditionallyFenced &&
        !this.runCommitEligibilityIsCurrent(normalized, 7)
      ) {
        return ok(0);
      }
      const runIdIndex = conditionallyFenced ? 16 : 7;
      const run = this.db.tables.customer_runs.find(
        (row) => {
          if (row.id !== this.values[runIdIndex]) return false;
          if (pausedIntake) {
            return (
              row.session_id === this.values[8] &&
              Number(row.session_authority_generation ?? 0) ===
                Number(this.values[9]) &&
              row.status === 'superseded' &&
              row.next_event_sequence === this.values[10]
            );
          }
          const sequenceIndex = conditionallyFenced ? 17 : 8;
          return row.next_event_sequence === this.values[sequenceIndex];
        },
      );
      if (!run) return ok(0);
      const existing = this.db.tables.customer_run_events.find(
        (row) =>
          row.event_id === this.values[0] ||
          (row.run_id === this.values[1] && row.sequence === this.values[2]),
      );
      if (existing) return ok(0);
      this.db.tables.customer_run_events.push({
        event_id: this.values[0],
        run_id: this.values[1],
        sequence: this.values[2],
        schema_version: this.values[3],
        type: this.values[4],
        occurred_at: this.values[5],
        payload: this.values[6],
      });
      return ok(1);
    }
    if (normalized.startsWith('INSERT OR IGNORE INTO agent_runs')) {
      this.db.assertColumns('agent_runs', [
        'id', 'session_id', 'generation', 'session_authority_generation',
        'channel', 'external_user_id', 'status',
        'coalesced_input_text', 'superseded_by_run_id', 'irreversible_side_effect_at',
        'irreversible_tool_name', 'assistant_turn_id', 'delivery_status',
        'delivery_external_message_id', 'error_code', 'error_message', 'scheduled_at',
        'started_at', 'completed_at', 'updated_at',
      ]);
      const existing = this.db.tables.agent_runs.find(
        (row) => row.session_id === this.values[1] && row.generation === this.values[2],
      );
      const sessionAuthorityGeneration =
        this.activeSessionAuthorityGeneration(this.values[19]);
      if (existing || sessionAuthorityGeneration === undefined) return ok(0);
      this.upsert('agent_runs', {
        id: this.values[0], session_id: this.values[1], generation: this.values[2],
        session_authority_generation: sessionAuthorityGeneration,
        channel: this.values[3], external_user_id: this.values[4], status: this.values[5],
        execution_attempt: 0, execution_lease_token: null,
        execution_lease_expires_at: null,
        coalesced_input_text: this.values[6], superseded_by_run_id: this.values[7],
        irreversible_side_effect_at: this.values[8], irreversible_tool_name: this.values[9],
        assistant_turn_id: this.values[10], delivery_status: this.values[11],
        delivery_external_message_id: this.values[12], error_code: this.values[13],
        error_message: this.values[14], scheduled_at: this.values[15], started_at: this.values[16],
        completed_at: this.values[17], updated_at: this.values[18],
      });
      return ok(1);
    }
    if (normalized.startsWith('INSERT INTO agent_runs')) {
      this.db.assertColumns('agent_runs', [
        'id',
        'session_id',
        'generation',
        'session_authority_generation',
        'channel',
        'external_user_id',
        'status',
        'coalesced_input_text',
        'superseded_by_run_id',
        'irreversible_side_effect_at',
        'irreversible_tool_name',
        'assistant_turn_id',
        'delivery_status',
        'delivery_external_message_id',
        'error_code',
        'error_message',
        'scheduled_at',
        'started_at',
        'completed_at',
        'updated_at',
      ]);
      const sessionAuthorityGeneration =
        this.activeSessionAuthorityGeneration(this.values[19]);
      if (sessionAuthorityGeneration === undefined) return ok(0);
      this.upsert('agent_runs', {
        id: this.values[0],
        session_id: this.values[1],
        generation: this.values[2],
        session_authority_generation: sessionAuthorityGeneration,
        channel: this.values[3],
        external_user_id: this.values[4],
        status: this.values[5],
        execution_attempt: 0,
        execution_lease_token: null,
        execution_lease_expires_at: null,
        coalesced_input_text: this.values[6],
        superseded_by_run_id: this.values[7],
        irreversible_side_effect_at: this.values[8],
        irreversible_tool_name: this.values[9],
        assistant_turn_id: this.values[10],
        delivery_status: this.values[11],
        delivery_external_message_id: this.values[12],
        error_code: this.values[13],
        error_message: this.values[14],
        scheduled_at: this.values[15],
        started_at: this.values[16],
        completed_at: this.values[17],
        updated_at: this.values[18],
      });
      return ok(1);
    }
    if (normalized.startsWith('INSERT OR IGNORE INTO agent_run_turns')) {
      this.db.assertColumns('agent_run_turns', ['run_id', 'turn_id', 'sequence']);
      const existing = this.db.tables.agent_run_turns.find(
        (row) => row.run_id === this.values[0] && row.turn_id === this.values[1],
      );
      if (!existing) {
        this.db.tables.agent_run_turns.push({
          run_id: this.values[0],
          turn_id: this.values[1],
          sequence: this.values[2],
        });
      }
      return ok();
    }
    if (normalized.startsWith('INSERT INTO agent_run_text_deliveries')) {
      const columnNames = [
        'schema_version',
        'run_id',
        'run_execution_attempt',
        'run_execution_origin_attempt',
        'run_execution_lease_token',
        'run_execution_lease_token_digest',
        'prior_run_execution_lease_token_digests',
        'channel',
        'assistant_turn_id',
        'recipient_binding_digest',
        'presentation_binding_digest',
        'delivery_binding_digest',
        'status',
        'delivery_attempt',
        'last_delivery_run_execution_attempt',
        'delivery_attempt_token',
        'provider_message_id',
        'outcome_code',
        'created_at',
        'updated_at',
      ];
      this.db.assertColumns('agent_run_text_deliveries', columnNames);
      const row = Object.fromEntries(
        columnNames.map((name, index) => [name, this.values[index]]),
      );
      const existing = this.db.tables.agent_run_text_deliveries.some(
        (candidate) => candidate.run_id === row.run_id,
      );
      const eligible = this.agentRunDeliveryExecutionIsCurrent({
        assistantTurnId: this.values[20],
        channel: this.values[21],
        runId: this.values[22],
        executionAttempt: this.values[24],
        executionLeaseToken: this.values[25],
      });
      if (existing || !eligible) return ok(0);
      this.db.tables.agent_run_text_deliveries.push(row);
      return { ...ok(1), results: [{ ...row }] };
    }
    if (
      normalized.startsWith(
        'INSERT INTO agent_run_text_delivery_attempts',
      )
    ) {
      const [
        runId,
        executionAttempt,
        executionLeaseToken,
        deliveryAttempt,
        deliveryAttemptToken,
        updatedAt,
      ] = this.values;
      const source = this.db.tables.agent_run_text_deliveries.find(
        (row) =>
          row.run_id === runId &&
          Number(row.run_execution_attempt) ===
            Number(executionAttempt) &&
          row.run_execution_lease_token === executionLeaseToken &&
          row.status === 'sending' &&
          Number(row.delivery_attempt) === Number(deliveryAttempt) &&
          row.delivery_attempt_token === deliveryAttemptToken &&
          row.updated_at === updatedAt,
      );
      if (!source) return ok(0);
      const duplicate =
        this.db.tables.agent_run_text_delivery_attempts.some(
          (row) =>
            row.delivery_attempt_token === deliveryAttemptToken,
        );
      if (duplicate) {
        throw new Error(
          'UNIQUE constraint failed: agent_run_text_delivery_attempts.delivery_attempt_token',
        );
      }
      this.db.tables.agent_run_text_delivery_attempts.push({
        run_id: runId,
        delivery_attempt: deliveryAttempt,
        delivery_attempt_token: deliveryAttemptToken,
        created_at: updatedAt,
      });
      return ok(1);
    }
    if (normalized.startsWith('INSERT OR IGNORE INTO session_agent_state')) {
      this.db.assertColumns('session_agent_state', [
        'session_id',
        'current_run_id',
        'generation',
        'debounce_deadline_at',
        'updated_at',
      ]);
      const existing = this.db.tables.session_agent_state.find(
        (row) => row.session_id === this.values[0],
      );
      if (existing) return ok(0);
      this.db.tables.session_agent_state.push({
        session_id: this.values[0],
        current_run_id: null,
        generation: 0,
        debounce_deadline_at: null,
        updated_at: this.values[1],
      });
      return ok(1);
    }
    if (normalized.startsWith('INSERT INTO session_agent_state')) {
      this.db.assertColumns('session_agent_state', [
        'session_id',
        'current_run_id',
        'generation',
        'debounce_deadline_at',
        'updated_at',
      ]);
      this.upsert('session_agent_state', {
        session_id: this.values[0],
        current_run_id: this.values[1],
        generation: this.values[2],
        debounce_deadline_at: this.values[3],
        updated_at: this.values[4],
      });
      return ok();
    }
    if (normalized.startsWith('UPDATE conversation_turns')) {
      if (normalized.includes('metadata = ?')) {
        this.db.assertColumns('conversation_turns', ['metadata']);
      }
      const id = normalized.includes('WHERE id = ?') ? this.values[this.values.length - 1] : this.values[0];
      const row = this.db.tables.conversation_turns.find((entry) => entry.id === id);
      if (row) {
        if (normalized.includes('SET delivery_status = ?')) {
          row.delivery_status = this.values[0];
          row.external_message_id = this.values[1];
        } else {
          row.channel = this.values[0];
          row.role = this.values[1];
          row.text = this.values[2];
          row.external_user_id = this.values[3];
          row.delivery_status = this.values[4];
          row.metadata = this.values[5];
          row.created_at = this.values[6];
        }
      }
      return ok();
    }
    if (
      normalized.startsWith('UPDATE non_agent_text_deliveries') &&
      normalized.includes("status = 'confirmed_not_sent'") &&
      normalized.includes("status = 'pending'")
    ) {
      const fenced = this.confirmationPauseFenceIsCurrent(
        this.values[2],
        this.values[3],
      );
      let changes = 0;
      if (fenced) {
        for (const row of this.db.tables.non_agent_text_deliveries) {
          if (
            row.session_binding_digest === this.values[1] &&
            row.status === 'pending'
          ) {
            row.status = 'confirmed_not_sent';
            row.outcome_code =
              'non_agent_delivery_abandoned_by_reset';
            row.updated_at = this.values[0];
            changes += 1;
          }
        }
      }
      return ok(changes);
    }
    if (
      normalized.startsWith('UPDATE non_agent_text_deliveries') &&
      normalized.includes("status = 'outcome_unknown'") &&
      normalized.includes("status = 'sending'")
    ) {
      const fenced = this.confirmationPauseFenceIsCurrent(
        this.values[3],
        this.values[4],
      );
      let changes = 0;
      if (fenced) {
        for (const row of this.db.tables.non_agent_text_deliveries) {
          if (
            row.session_binding_digest === this.values[1] &&
            row.status === 'sending' &&
            String(row.sending_lease_expires_at) <=
              String(this.values[2])
          ) {
            row.status = 'outcome_unknown';
            row.sending_lease_expires_at = null;
            row.outcome_code =
              'non_agent_delivery_reset_sending_lease_expired';
            row.updated_at = this.values[0];
            changes += 1;
          }
        }
      }
      return ok(changes);
    }
    if (normalized.startsWith('UPDATE non_agent_text_deliveries')) {
      const row = this.findNonAgentTextDelivery(this.values[7]);
      const begin = normalized.includes(
        'EXISTS ( SELECT 1 FROM session_controls',
      );
      const reconcile = normalized.includes(
        'AND sending_lease_expires_at = ?',
      );
      const completion = normalized.includes("status = 'sending'");
      const authorityCurrent =
        !begin ||
        (
          this.pausedSessionAuthorityMatches(
            this.values[15],
            this.values[16],
          ) &&
          this.db.tables.session_controls.some(
            (control) =>
              control.session_id === this.values[15] &&
              control.assigned_agent_id === this.values[17],
          )
        );
      const sourceStatus = begin
        ? this.values[11]
        : completion
          ? 'sending'
          : this.values[9];
      const sourceAttempt = begin
        ? this.values[12]
        : completion
          ? this.values[9]
          : this.values[10];
      const sourceToken = begin
        ? this.values[13]
        : completion
          ? this.values[10]
          : this.values[11];
      const sourceUpdatedAt = reconcile
        ? this.values[12]
        : begin
          ? this.values[14]
          : completion
          ? this.values[11]
          : this.values[12];
      const sourceMatches =
        row !== undefined &&
        row.session_binding_digest === this.values[8] &&
        (
          !begin ||
          (
            Number(row.reserved_session_authority_generation) ===
              Number(this.values[9]) &&
            row.agent_binding_digest === this.values[10]
          )
        ) &&
        row.status === sourceStatus &&
        Number(row.delivery_attempt) === Number(sourceAttempt) &&
        row.delivery_attempt_token === sourceToken &&
        row.updated_at === sourceUpdatedAt &&
        (
          !reconcile ||
          row.sending_lease_expires_at === this.values[11]
        );
      if (!row || !authorityCurrent || !sourceMatches) return ok(0);
      row.status = this.values[0];
      row.delivery_attempt = this.values[1];
      row.delivery_attempt_token = this.values[2];
      row.sending_lease_expires_at = this.values[3];
      row.provider_message_id = this.values[4];
      row.outcome_code = this.values[5];
      row.updated_at = this.values[6];
      return { ...ok(1), results: [{ ...row }] };
    }
    if (normalized.startsWith('UPDATE webhook_deliveries')) {
      const row = this.findWebhookDelivery(this.values[7], this.values[8]);
      if (row) {
        row.status = this.values[0];
        row.last_error = this.values[5];
        row.updated_at = this.values[6];
        if (this.values[0] === 'processed') row.processed_at = this.values[2];
        if (this.values[0] === 'failed') row.failed_at = this.values[4];
      }
      return ok();
    }
    if (normalized.startsWith('UPDATE pending_customer_turns')) {
      if (normalized.includes("SET status = 'ignored'")) {
        const [runId, updatedAt, turnId] = this.values;
        const row = this.db.tables.pending_customer_turns.find(
          (entry) => entry.turn_id === turnId,
        );
        const run = this.db.tables.agent_runs.find(
          (entry) => entry.id === runId,
        );
        const linked = this.db.tables.agent_run_turns.some(
          (entry) => entry.run_id === runId && entry.turn_id === turnId,
        );
        const state = this.db.tables.session_agent_state.find(
          (entry) => entry.session_id === row?.session_id,
        );
        if (
          row?.status === 'pending' &&
          row.claimed_run_id === null &&
          linked &&
          run !== undefined &&
          run.session_id === row.session_id &&
          run.status === 'failed' &&
          state !== undefined &&
          state.current_run_id === runId &&
          state.generation === run.generation
        ) {
          row.status = 'ignored';
          row.claimed_run_id = runId;
          row.updated_at = updatedAt;
          return ok(1);
        }
        return ok(0);
      }
      const [status, runId, updatedAt, turnId] = this.values;
      const row = this.db.tables.pending_customer_turns.find(
        (entry) => entry.turn_id === turnId,
      );
      if (row) {
        row.status = status;
        row.claimed_run_id = runId;
        row.updated_at = updatedAt;
      }
      return ok(row ? 1 : 0);
    }
    if (
      normalized.startsWith('DELETE FROM agent_session_items') &&
      normalized.includes('RETURNING item_json')
    ) {
      const sessionId = this.values[0];
      const index = this.db.tables.agent_session_items.reduce(
        (latestIndex, row, currentIndex, rows) => {
          if (row.session_id !== sessionId) return latestIndex;
          if (latestIndex < 0) return currentIndex;
          return Number(row.id) > Number(rows[latestIndex]?.id)
            ? currentIndex
            : latestIndex;
        },
        -1,
      );
      if (index < 0) return { ...ok(0), results: [] };
      const [removed] = this.db.tables.agent_session_items.splice(index, 1);
      return { ...ok(1), results: [{ item_json: removed?.item_json }] };
    }
    if (normalized.startsWith('DELETE FROM ')) {
      this.handleDelete(normalized);
      return ok();
    }
    if (normalized.startsWith('UPDATE session_agent_state')) {
      const generationAdvance = normalized.includes(
        'generation = generation + 1',
      );
      const sessionId = this.values[2];
      const row = this.db.tables.session_agent_state.find(
        (entry) => entry.session_id === sessionId,
      );
      if (!row) return ok(0);
      if (generationAdvance) {
        row.current_run_id = null;
        row.generation = Number(row.generation) + 1;
        row.debounce_deadline_at = this.values[0];
        row.updated_at = this.values[1];
        return { ...ok(1), results: [{ ...row }] };
      }
      const [
        runId,
        updatedAt,
        _boundSessionId,
        expectedGeneration,
        expectedCurrentRunId,
        expectedDeadline,
        expectedRunId,
        expectedRunSessionId,
        expectedRunGeneration,
        authoritySessionId,
      ] = this.values;
      const run = this.db.tables.agent_runs.find(
        (candidate) =>
          candidate.id === expectedRunId &&
          candidate.session_id === expectedRunSessionId &&
          candidate.generation === expectedRunGeneration &&
          candidate.status === 'scheduled' &&
          this.activeSessionAuthorityMatches(
            authoritySessionId,
            candidate.session_authority_generation ?? 0,
          ),
      );
      if (
        row.generation !== expectedGeneration ||
        row.current_run_id !== expectedCurrentRunId ||
        row.debounce_deadline_at !== expectedDeadline ||
        !run
      ) {
        return ok(0);
      }
      row.current_run_id = runId;
      row.debounce_deadline_at = null;
      row.updated_at = updatedAt;
      return { ...ok(1), results: [{ ...row }] };
    }
    if (normalized.startsWith('UPDATE agent_runs')) {
      if (
        normalized.includes("delivery_status = 'sent'") &&
        normalized.includes(
          'FROM agent_run_text_deliveries',
        )
      ) {
        const [
          assistantTurnId,
          providerMessageId,
          completedAt,
          updatedAt,
          runId,
          executionAttempt,
          executionLeaseToken,
          deliveryStatus,
          deliveryAttempt,
          deliveryAttemptToken,
          deliveryUpdatedAt,
        ] = this.values;
        const delivery =
          this.db.tables.agent_run_text_deliveries.find(
            (row) =>
              row.run_id === runId &&
              row.status === deliveryStatus &&
              Number(row.delivery_attempt) ===
                Number(deliveryAttempt) &&
              row.delivery_attempt_token === deliveryAttemptToken &&
              row.updated_at === deliveryUpdatedAt,
          );
        const run = this.db.tables.agent_runs.find(
          (row) =>
            row.id === runId &&
            Number(row.execution_attempt) ===
              Number(executionAttempt) &&
            row.execution_lease_token === executionLeaseToken,
        );
        if (!delivery || !run) return ok(0);
        run.status = 'completed';
        run.assistant_turn_id = assistantTurnId;
        run.delivery_status = 'sent';
        run.delivery_external_message_id = providerMessageId;
        run.error_code = null;
        run.error_message = null;
        run.completed_at ??= completedAt;
        run.updated_at = updatedAt;
        return { ...ok(1), results: [{ ...run }] };
      }
      if (
        normalized.includes("delivery_status = 'outcome_unknown'") &&
        normalized.includes(
          'FROM agent_run_text_deliveries',
        )
      ) {
        const [
          completedAt,
          updatedAt,
          runId,
          executionAttempt,
          executionLeaseToken,
          deliveryStatus,
          deliveryAttempt,
          deliveryAttemptToken,
          deliveryUpdatedAt,
        ] = this.values;
        const delivery =
          this.db.tables.agent_run_text_deliveries.find(
            (row) =>
              row.run_id === runId &&
              row.status === deliveryStatus &&
              Number(row.delivery_attempt) ===
                Number(deliveryAttempt) &&
              row.delivery_attempt_token === deliveryAttemptToken &&
              row.updated_at === deliveryUpdatedAt,
          );
        const run = this.db.tables.agent_runs.find(
          (row) =>
            row.id === runId &&
            Number(row.execution_attempt) ===
              Number(executionAttempt) &&
            row.execution_lease_token === executionLeaseToken,
        );
        if (!delivery || !run) return ok(0);
        run.status = 'reconciliation_required';
        run.delivery_status = 'outcome_unknown';
        run.error_code = 'agent_run_delivery_outcome_unknown';
        run.error_message =
          'Channel delivery outcome requires reconciliation';
        run.completed_at ??= completedAt;
        run.updated_at = updatedAt;
        return { ...ok(1), results: [{ ...run }] };
      }
      if (normalized.includes("SET status = 'running'")) {
        const [
          leaseToken,
          leaseExpiresAt,
          startedAt,
          updatedAt,
          runId,
          sessionId,
          generation,
          expectedAuthority,
          maximumAttempts,
          requestedLeaseExpiresAt,
          authoritySessionId,
          authorityGeneration,
          expectedSessionId,
          expectedRunId,
          expectedGeneration,
        ] = this.values;
        const state = this.db.tables.session_agent_state.find(
          (entry) =>
            entry.session_id === expectedSessionId &&
            entry.current_run_id === expectedRunId &&
            entry.generation === expectedGeneration,
        );
        const run = this.db.tables.agent_runs.find(
          (entry) =>
            entry.id === runId &&
            entry.session_id === sessionId &&
            entry.generation === generation &&
            Number(entry.session_authority_generation ?? 0) ===
              Number(expectedAuthority) &&
            Number(entry.execution_attempt ?? 0) < Number(maximumAttempts) &&
            entry.irreversible_side_effect_at == null &&
            entry.irreversible_tool_name == null &&
            (
              (
                entry.status === 'scheduled' &&
                Number(entry.execution_attempt ?? 0) === 0 &&
                entry.execution_lease_token == null &&
                entry.execution_lease_expires_at == null
              ) ||
              (
                entry.status === 'running' &&
                entry.execution_lease_expires_at != null &&
                Date.parse(String(entry.execution_lease_expires_at)) <=
                  Date.now()
              )
            ) &&
            Date.parse(String(requestedLeaseExpiresAt)) > Date.now() &&
            this.activeSessionAuthorityMatches(
              authoritySessionId,
              authorityGeneration,
            ),
        );
        if (!state || !run) return ok(0);
        run.status = 'running';
        run.execution_attempt = Number(run.execution_attempt ?? 0) + 1;
        run.execution_lease_token = leaseToken;
        run.execution_lease_expires_at = leaseExpiresAt;
        run.started_at ??= startedAt;
        run.updated_at = updatedAt;
        return { ...ok(1), results: [{ ...run }] };
      }
      if (normalized.includes("SET status = 'reconciliation_required'")) {
        const [
          completedAt,
          updatedAt,
          runId,
          sessionId,
          generation,
          expectedAuthority,
          maximumAttempts,
          authoritySessionId,
          authorityGeneration,
          expectedSessionId,
          expectedRunId,
          expectedGeneration,
        ] = this.values;
        const state = this.db.tables.session_agent_state.find(
          (entry) =>
            entry.session_id === expectedSessionId &&
            entry.current_run_id === expectedRunId &&
            entry.generation === expectedGeneration,
        );
        const run = this.db.tables.agent_runs.find(
          (entry) =>
            entry.id === runId &&
            entry.session_id === sessionId &&
            entry.generation === generation &&
            Number(entry.session_authority_generation ?? 0) ===
              Number(expectedAuthority) &&
            entry.status === 'running' &&
            entry.execution_lease_expires_at != null &&
            Date.parse(String(entry.execution_lease_expires_at)) <=
              Date.now() &&
            (
              entry.irreversible_side_effect_at != null ||
              entry.irreversible_tool_name != null ||
              Number(entry.execution_attempt ?? 0) >= Number(maximumAttempts)
            ) &&
            this.activeSessionAuthorityMatches(
              authoritySessionId,
              authorityGeneration,
            ),
        );
        if (!state || !run) return ok(0);
        const outcomeUnknown =
          run.irreversible_side_effect_at != null ||
          run.irreversible_tool_name != null;
        run.status = 'reconciliation_required';
        run.delivery_status = 'not_applicable';
        run.error_code = outcomeUnknown
          ? 'agent_run_outcome_unknown'
          : 'agent_run_execution_attempts_exhausted';
        run.error_message = outcomeUnknown
          ? 'Irreversible provider outcome requires reconciliation'
          : 'Agent run execution attempts exhausted';
        run.completed_at ??= completedAt;
        run.updated_at = updatedAt;
        return { ...ok(1), results: [{ ...run }] };
      }
      const setClause = normalized.match(
        /^UPDATE agent_runs SET (.+?) WHERE id = \?/,
      )?.[1];
      if (!setClause) {
        throw new Error(
          `Unsupported fake D1 agent-run update query: ${this.query}`,
        );
      }
      const assignments = setClause
        .split(',')
        .map((assignment) => assignment.trim())
        .filter((assignment) => assignment.endsWith('= ?'));
      const updatedAtIndex = assignments.length - 1;
      const runIdIndex = assignments.length;
      const row = this.db.tables.agent_runs.find(
        (entry) =>
          entry.id === this.values[runIdIndex] &&
          entry.session_id === this.values[runIdIndex + 1] &&
          Number(entry.generation) ===
            Number(this.values[runIdIndex + 2]) &&
          Number(entry.session_authority_generation ?? 0) ===
            Number(this.values[runIdIndex + 3]) &&
          entry.status === 'running' &&
          Number(entry.execution_attempt) ===
            Number(this.values[runIdIndex + 4]) &&
          entry.execution_lease_token ===
            this.values[runIdIndex + 5] &&
          entry.execution_lease_expires_at != null &&
          Date.parse(String(entry.execution_lease_expires_at)) >
            Date.now() &&
          this.activeSessionAuthorityMatches(
            this.values[runIdIndex + 6],
            this.values[runIdIndex + 7],
          ) &&
          this.db.tables.session_agent_state.some(
            (state) =>
              state.session_id === this.values[runIdIndex + 8] &&
              state.current_run_id ===
                this.values[runIdIndex + 9] &&
              Number(state.generation) ===
                Number(this.values[runIdIndex + 10]),
          ),
      );
      if (!row) return ok(0);
      for (let index = 0; index < assignments.length; index += 1) {
        const column = assignments[index]!.split('=')[0]!.trim();
        row[column] = this.values[index];
      }
      row.updated_at = this.values[updatedAtIndex];
      return { ...ok(1), results: [{ ...row }] };
    }
    if (
      normalized.startsWith(
        'UPDATE agent_run_text_deliveries SET status = \'sending\'',
      )
    ) {
      const [
        deliveryAttempt,
        deliveryAttemptToken,
        lastDeliveryRunExecutionAttempt,
        updatedAt,
        runId,
        executionAttempt,
        executionLeaseToken,
        deliveryBindingDigest,
        status,
        previousDeliveryAttempt,
        previousDeliveryAttemptToken,
        previousUpdatedAt,
        uniquenessToken,
        assistantTurnId,
        channel,
        executionRunId,
        _executionChannel,
        currentExecutionAttempt,
        currentExecutionLeaseToken,
      ] = this.values;
      const reused =
        this.db.tables.agent_run_text_delivery_attempts.some(
          (row) => row.delivery_attempt_token === uniquenessToken,
        );
      const eligible = this.agentRunDeliveryExecutionIsCurrent({
        assistantTurnId,
        channel,
        runId: executionRunId,
        executionAttempt: currentExecutionAttempt,
        executionLeaseToken: currentExecutionLeaseToken,
      });
      const row = this.db.tables.agent_run_text_deliveries.find(
        (candidate) =>
          candidate.run_id === runId &&
          Number(candidate.run_execution_attempt) ===
            Number(executionAttempt) &&
          candidate.run_execution_lease_token === executionLeaseToken &&
          candidate.delivery_binding_digest === deliveryBindingDigest &&
          candidate.status === status &&
          Number(candidate.delivery_attempt) ===
            Number(previousDeliveryAttempt) &&
          candidate.delivery_attempt_token ===
            previousDeliveryAttemptToken &&
          candidate.updated_at === previousUpdatedAt,
      );
      if (reused || !eligible || !row) return ok(0);
      row.status = 'sending';
      row.delivery_attempt = deliveryAttempt;
      row.delivery_attempt_token = deliveryAttemptToken;
      row.last_delivery_run_execution_attempt =
        lastDeliveryRunExecutionAttempt;
      row.provider_message_id = null;
      row.outcome_code = null;
      row.updated_at = updatedAt;
      return { ...ok(1), results: [{ ...row }] };
    }
    if (
      normalized.startsWith(
        'UPDATE agent_run_text_deliveries SET status = ?',
      )
    ) {
      const [
        status,
        providerMessageId,
        outcomeCode,
        updatedAt,
        runId,
        executionAttempt,
        executionLeaseToken,
        expectedStatus,
        deliveryAttempt,
        deliveryAttemptToken,
        expectedUpdatedAt,
      ] = this.values;
      const run = this.db.tables.agent_runs.find(
        (candidate) =>
          candidate.id === runId &&
          Number(candidate.execution_attempt) ===
            Number(executionAttempt) &&
          candidate.execution_lease_token === executionLeaseToken,
      );
      const row = this.db.tables.agent_run_text_deliveries.find(
        (candidate) =>
          candidate.run_id === runId &&
          Number(candidate.run_execution_attempt) ===
            Number(executionAttempt) &&
          candidate.run_execution_lease_token === executionLeaseToken &&
          candidate.status === expectedStatus &&
          Number(candidate.delivery_attempt) ===
            Number(deliveryAttempt) &&
          candidate.delivery_attempt_token === deliveryAttemptToken &&
          candidate.updated_at === expectedUpdatedAt,
      );
      if (!run || !row) return ok(0);
      row.status = status;
      row.provider_message_id = providerMessageId;
      row.outcome_code = outcomeCode;
      row.updated_at = updatedAt;
      return { ...ok(1), results: [{ ...row }] };
    }
    if (normalized.startsWith('UPDATE customer_runs')) {
      if (
        normalized.includes(
          'SET next_event_sequence = next_event_sequence + ?',
        )
      ) {
        if (!this.runCommitEligibilityIsCurrent(normalized, 4)) {
          return ok(0);
        }
        const row = this.db.tables.customer_runs.find(
          (entry) =>
            entry.id === this.values[2] &&
            entry.next_event_sequence === this.values[3],
        );
        if (!row) return ok(0);
        row.next_event_sequence =
          Number(row.next_event_sequence) + Number(this.values[0]);
        row.updated_at = this.values[1];
        return ok(1);
      }
      if (!normalized.includes('SET next_event_sequence = ?')) {
        const row = this.db.tables.customer_runs.find(
          (entry) => entry.id === this.values.at(-1),
        );
        if (!row) return ok(0);
        let valueIndex = 0;
        for (const [column, rowKey] of [
          ['status', 'status'],
          ['phase', 'phase'],
          ['started_at', 'started_at'],
          ['terminal_at', 'terminal_at'],
          ['updated_at', 'updated_at'],
        ] as const) {
          if (normalized.includes(`${column} = ?`)) {
            row[rowKey] = this.values[valueIndex];
            valueIndex += 1;
          }
        }
        return ok(1);
      }
      const row = this.db.tables.customer_runs.find(
        (entry) => entry.id === this.values[2] && entry.next_event_sequence === this.values[3],
      );
      if (!row) return ok(0);
      row.next_event_sequence = this.values[0];
      row.updated_at = this.values[1];
      return ok(1);
    }
    if (normalized.startsWith('UPDATE irreversible_operations')) {
      const claim = normalized.includes('attempt_count = attempt_count + 1');
      const expiredOutcome = normalized.includes(
        "unixepoch('now') >= unixepoch(lease_expires_at)",
      );
      const failure = normalized.includes("status = 'unknown'");
      const offset = claim ? 2 : failure ? 1 : 2;
      const row = this.db.tables.irreversible_operations.find((candidate) =>
        candidate.request_id === this.values[offset] &&
        candidate.session_id === this.values[offset + 1] &&
        candidate.operation === this.values[offset + 2] &&
        candidate.binding_fingerprint === this.values[offset + 3],
      );
      if (!row) return ok(0);
      if (expiredOutcome) {
        if (
          row.status !== 'attempting' ||
          row.lease_expires_at === null ||
          Date.now() < Date.parse(String(row.lease_expires_at)) ||
          !this.activeSessionAuthorityMatches(
            this.values[5],
            row.session_authority_generation ?? 0,
          )
        ) {
          return ok(0);
        }
        row.status = 'unknown';
        row.lease_expires_at = null;
        row.last_error = this.values[0];
        return ok(1);
      }
      if (claim) {
        if (
          row.status === 'completed' ||
          (
            row.status !== 'unknown' &&
            String(row.lease_expires_at) > String(this.values[6])
          ) ||
          !this.activeSessionAuthorityMatches(
            this.values[7],
            row.session_authority_generation,
          )
        ) {
          return ok(0);
        }
        row.status = 'attempting';
        row.attempt_count = Number(row.attempt_count) + 1;
        row.lease_expires_at = this.values[0];
        row.lease_token = this.values[1];
        row.last_error = null;
        return ok(1);
      }
      if (failure) {
        if (
          row.status !== 'attempting' ||
          row.attempt_count !== this.values[5] ||
          row.lease_token !== this.values[6] ||
          Number(row.session_authority_generation ?? 0) !==
            Number(this.values[7]) ||
          !this.activeSessionAuthorityMatches(
            this.values[8],
            row.session_authority_generation ?? 0,
          )
        ) return ok(0);
        row.status = 'unknown';
        row.lease_expires_at = null;
        row.last_error = this.values[0];
        return ok(1);
      }
      if (
        row.status !== 'attempting' ||
        row.attempt_count !== this.values[6] ||
        row.lease_token !== this.values[7] ||
        Number(row.session_authority_generation ?? 0) !==
          Number(this.values[8]) ||
        !this.activeSessionAuthorityMatches(
          this.values[9],
          row.session_authority_generation ?? 0,
        )
      ) return ok(0);
      row.result_json ??= this.values[0];
      row.status = 'completed';
      row.lease_expires_at = null;
      row.last_error = null;
      row.completed_at ??= this.values[1];
      return ok(1);
    }
    if (normalized.startsWith('UPDATE confirmation_pauses')) {
      if (normalized.includes("SET status = 'expired'")) {
        await this.runConfirmationPauseUpdateHook('before', 'expire');
        const row = this.db.tables.confirmation_pauses.find(
          (candidate) => candidate.request_id === this.values[0],
        );
        if (
          !row ||
          row.status !== 'pending' ||
          String(row.expires_at) > String(this.values[1]) ||
          row.checkpoint_thread_id !== this.values[2] ||
          row.checkpoint_namespace !== this.values[3] ||
          row.checkpoint_id !== this.values[4] ||
          row.created_at !== this.values[5] ||
          row.expires_at !== this.values[6] ||
          row.action_digest !== this.values[7] ||
          row.approval_binding_digest !== this.values[8] ||
          row.session_id !== this.values[9] ||
          row.customer_id !== this.values[10] ||
          row.channel !== this.values[11] ||
          row.authenticated_subject !== this.values[12] ||
          row.authentication_evidence_ref !== this.values[13] ||
          row.session_generation !== this.values[14] ||
          row.pause_identity_digest !== this.values[15] ||
          !this.confirmationPauseGenerationIsCurrent(row) ||
          !this.confirmationPauseAuthorityIsCurrent(row)
        ) {
          return ok(0);
        }
        row.status = 'expired';
        await this.runConfirmationPauseUpdateHook('after', 'expire');
        return ok(1);
      }
      if (normalized.includes("SET status = 'rejected'")) {
        await this.runConfirmationPauseUpdateHook('before', 'reject');
        const row = this.db.tables.confirmation_pauses.find(
          (candidate) => candidate.request_id === this.values[3],
        );
        if (
          !row ||
          row.status !== 'pending' ||
          String(row.expires_at) <= String(this.values[4]) ||
          row.action_digest !== this.values[5] ||
          row.approval_binding_digest !== this.values[6] ||
          row.session_id !== this.values[7] ||
          row.customer_id !== this.values[8] ||
          row.channel !== this.values[9] ||
          row.authenticated_subject !== this.values[10] ||
          row.authentication_evidence_ref !== this.values[11] ||
          row.checkpoint_thread_id !== this.values[12] ||
          row.checkpoint_namespace !== this.values[13] ||
          row.checkpoint_id !== this.values[14] ||
          row.created_at !== this.values[15] ||
          row.expires_at !== this.values[16] ||
          row.session_generation !== this.values[17] ||
          row.pause_identity_digest !== this.values[18] ||
          !this.confirmationPauseGenerationIsCurrent(row) ||
          !this.confirmationPauseAuthorityIsCurrent(row)
        ) {
          return ok(0);
        }
        row.status = 'rejected';
        row.rejection_receipt_id = this.values[0];
        row.rejection_receipt_json = this.values[1];
        row.rejected_at = this.values[2];
        await this.runConfirmationPauseUpdateHook('after', 'reject');
        return ok(1);
      }
      await this.runConfirmationPauseUpdateHook('before', 'complete');
      const row = this.db.tables.confirmation_pauses.find(
        (candidate) => candidate.request_id === this.values[4],
      );
      if (
        !row ||
        row.status !== 'rejected' ||
        row.completion_status !== 'pending' ||
        row.rejection_receipt_id !== this.values[5] ||
        row.checkpoint_thread_id !== this.values[6] ||
        row.checkpoint_namespace !== this.values[7] ||
        row.checkpoint_id !== this.values[8] ||
        row.created_at !== this.values[9] ||
        row.expires_at !== this.values[10] ||
        row.action_digest !== this.values[11] ||
        row.approval_binding_digest !== this.values[12] ||
        row.session_id !== this.values[13] ||
        row.customer_id !== this.values[14] ||
        row.channel !== this.values[15] ||
        row.authenticated_subject !== this.values[16] ||
        row.authentication_evidence_ref !== this.values[17] ||
        row.session_generation !== this.values[18] ||
        row.pause_identity_digest !== this.values[19] ||
        !this.confirmationPauseGenerationIsCurrent(row) ||
        !this.confirmationPauseAuthorityIsCurrent(row)
      ) {
        return ok(0);
      }
      row.completion_status = this.values[0];
      row.result_json = this.values[1];
      row.completion_error = this.values[2];
      row.completed_at = this.values[3];
      await this.runConfirmationPauseUpdateHook('after', 'complete');
      return ok(1);
    }
    throw new Error(`Unsupported fake D1 run query: ${this.query}`);
  }

  async first<T = Row>(): Promise<T | null> {
    this.db.recordCall('first');
    const normalized = normalizeSql(this.query);
    if (
      normalized.startsWith('INSERT INTO confirmation_pause_sessions') ||
      normalized.startsWith(
        'INSERT INTO agent_run_text_deliveries',
      ) ||
      normalized.startsWith(
        'INSERT INTO non_agent_text_deliveries',
      ) ||
      (
        normalized.startsWith('INSERT INTO session_controls') &&
        normalized.includes(' RETURNING ')
      ) ||
      (
        normalized.startsWith('UPDATE ') &&
        normalized.includes(' RETURNING ')
      ) ||
      (
        normalized.startsWith('DELETE FROM agent_session_items') &&
        normalized.includes(' RETURNING ')
      )
    ) {
      const result = await this.run();
      return (result.results?.[0] as T | undefined) ?? null;
    }
    const rows = await this.selectRows<T>();
    return rows[0] ?? null;
  }

  async all<T = Row>(): Promise<QueryResult<T>> {
    this.db.recordCall('all');
    return { ...ok(), results: await this.selectRows<T>() };
  }

  private async selectRows<T>(): Promise<T[]> {
    const normalized = normalizeSql(this.query);
    if (normalized.includes('FROM agent_session_items')) {
      const sessionId = this.values[0];
      let rows = this.db.tables.agent_session_items
        .filter((row) => row.session_id === sessionId)
        .sort((left, right) => Number(left.id) - Number(right.id));
      if (normalized.includes('ORDER BY id DESC LIMIT ?')) {
        rows = rows.slice().reverse().slice(0, Number(this.values[1])).reverse();
      }
      // Fake query rows are projected to the caller-requested D1 result type.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      return rows.map((row) => ({ item_json: row.item_json })) as T[];
    }
    if (normalized.startsWith('PRAGMA table_info(')) {
      const table = normalized.match(/^PRAGMA table_info\(([^)]+)\)$/)?.[1] as TableName | undefined;
      if (!table || !this.db.hasTable(table)) return [];
      return this.db.listColumns(table).map((name) => ({ name })) as T[];
    }
    if (normalized.includes('FROM sqlite_master')) {
      const tableName = this.values[0] as TableName;
      return this.db.hasTable(tableName) ? ([{ name: tableName }] as T[]) : [];
    }
    if (
      normalized.startsWith('SELECT 1 AS current') &&
      normalized.includes("unixepoch('now') < unixepoch(?)")
    ) {
      return this.runCommitEligibilityIsCurrent(normalized, 0)
        ? ([{ current: 1 }] as T[])
        : [];
    }
    if (
      normalized.startsWith('SELECT 1 AS current') &&
      normalized.includes('AS session_authority_generation') &&
      normalized.includes(
        'WHERE authority.session_authority_generation = ?',
      )
    ) {
      return this.activeSessionAuthorityMatches(
        this.values[0],
        this.values[1],
      )
        ? ([{ current: 1 }] as T[])
        : [];
    }
    if (normalized.includes('FROM conversation_turns') && normalized.includes('WHERE id = ?')) {
      this.db.assertColumns('conversation_turns', ['id']);
      return this.db.tables.conversation_turns.filter((row) => row.id === this.values[0]) as T[];
    }
    if (normalized.includes('FROM langgraph_checkpoints')) {
      if (normalized.includes('substr(thread_id, 1, length(?))')) {
        const sessionId = String(this.values[0]);
        const prefix = String(this.values[1]);
        return [...this.db.tables.langgraph_checkpoints]
          .filter((row) =>
            row.thread_id === sessionId ||
            String(row.thread_id).startsWith(prefix)
          )
          .sort((left, right) =>
            String(left.thread_id).localeCompare(String(right.thread_id)) ||
            String(left.checkpoint_ns).localeCompare(
              String(right.checkpoint_ns),
            ) ||
            String(left.checkpoint_id).localeCompare(
              String(right.checkpoint_id),
            )
          ) as T[];
      }
      let rows = this.db.tables.langgraph_checkpoints.filter(
        (row) => row.thread_id === this.values[0] && row.checkpoint_ns === this.values[1],
      );
      if (normalized.includes('checkpoint_id = ?')) rows = rows.filter((row) => row.checkpoint_id === this.values[2]);
      if (normalized.includes('checkpoint_id < ?')) rows = rows.filter((row) => String(row.checkpoint_id) < String(this.values.at(-1)));
      rows = [...rows].sort((a, b) => String(b.checkpoint_id).localeCompare(String(a.checkpoint_id)));
      if (normalized.includes('LIMIT 1')) rows = rows.slice(0, 1);
      return rows as T[];
    }
    if (normalized.includes('FROM langgraph_checkpoint_writes')) {
      return this.db.tables.langgraph_checkpoint_writes
        .filter((row) => row.thread_id === this.values[0] && row.checkpoint_ns === this.values[1] && row.checkpoint_id === this.values[2])
        .sort((a, b) => String(a.task_id).localeCompare(String(b.task_id)) || Number(a.write_index) - Number(b.write_index)) as T[];
    }
    if (normalized.includes('FROM irreversible_operations')) {
      return this.db.tables.irreversible_operations.filter((row) => row.request_id === this.values[0]) as T[];
    }
    if (normalized.includes('FROM confirmation_pauses')) {
      return this.db.tables.confirmation_pauses.filter(
        (row) =>
          row.request_id === this.values[0] &&
          (
            !normalized.includes('JOIN confirmation_pause_sessions') ||
            this.confirmationPauseGenerationIsCurrent(row)
          ) &&
          this.confirmationPauseAuthorityIsCurrent(row),
      ) as T[];
    }
    if (normalized.includes('FROM conversation_turns') && normalized.includes('external_message_id')) {
      this.db.assertColumns('conversation_turns', ['session_id', 'external_message_id']);
      return this.db.tables.conversation_turns.filter(
        (row) => row.session_id === this.values[0] && row.external_message_id === this.values[1],
      ) as T[];
    }
    if (normalized.includes('FROM conversation_turns')) {
      this.db.assertColumns('conversation_turns', ['session_id']);
      let rows = this.db.tables.conversation_turns.filter((row) => row.session_id === this.values[0]);
      if (normalized.includes('ORDER BY created_at DESC')) {
        rows = [...rows].sort((a, b) => {
          const created = String(b.created_at).localeCompare(String(a.created_at));
          return created === 0 ? String(b.id).localeCompare(String(a.id)) : created;
        });
      }
      if (normalized.includes('ORDER BY created_at ASC')) {
        rows = [...rows].sort((a, b) => {
          const created = String(a.created_at).localeCompare(String(b.created_at));
          return created === 0 ? String(a.id).localeCompare(String(b.id)) : created;
        });
      }
      if (normalized.includes('LIMIT ?')) {
        const limit = Number(this.values[this.values.length - 1]);
        rows = rows.slice(0, Number.isFinite(limit) ? limit : undefined);
      }
      return rows as T[];
    }
    if (normalized.includes('FROM conversation_profiles')) {
      this.db.assertColumns('conversation_profiles', ['channel', 'external_user_id']);
      if (normalized.includes('ORDER BY profile_updated_at DESC')) {
        this.db.assertColumns('conversation_profiles', ['profile_updated_at']);
        const limit = Number(this.values[this.values.length - 1]);
        return [...this.db.tables.conversation_profiles]
          .sort((a, b) => String(b.profile_updated_at).localeCompare(String(a.profile_updated_at)))
          .slice(0, Number.isFinite(limit) ? limit : undefined) as T[];
      }
      return this.db.tables.conversation_profiles.filter(
        (row) => row.channel === this.values[0] && row.external_user_id === this.values[1],
      ) as T[];
    }
    if (normalized.includes('FROM conversation_events')) {
      this.db.assertColumns('conversation_events', ['session_id']);
      return this.db.tables.conversation_events.filter((row) => row.session_id === this.values[0]) as T[];
    }
    if (normalized.includes('FROM dashboard_events')) {
      this.db.assertColumns('dashboard_events', ['id', 'session_id', 'created_at']);
      let rows = [...this.db.tables.dashboard_events];
      if (normalized.includes('WHERE session_id = ?')) {
        rows = rows.filter((row) => row.session_id === this.values[0]);
      }
      if (normalized.includes('ORDER BY created_at DESC')) {
        rows.sort((a, b) => {
          const created = String(b.created_at).localeCompare(String(a.created_at));
          return created === 0 ? String(b.id).localeCompare(String(a.id)) : created;
        });
      }
      if (normalized.includes('ORDER BY created_at ASC')) {
        rows.sort((a, b) => {
          const created = String(a.created_at).localeCompare(String(b.created_at));
          return created === 0 ? String(a.id).localeCompare(String(b.id)) : created;
        });
      }
      if (normalized.includes('LIMIT ?')) {
        const limit = Number(this.values[this.values.length - 1]);
        rows = rows.slice(0, limit);
      }
      return rows as T[];
    }
    if (normalized.includes('FROM webhook_deliveries') && normalized.includes("status = 'received'")) {
      this.db.assertColumns('webhook_deliveries', ['channel', 'status', 'received_at', 'external_event_id']);
      const limit = Number(this.values[2]);
      return this.db.tables.webhook_deliveries
        .filter(
          (row) =>
            row.channel === this.values[0] &&
            row.status === 'received' &&
            String(row.received_at) < String(this.values[1]),
        )
        .sort((a, b) => {
          const received = String(a.received_at).localeCompare(String(b.received_at));
          return received === 0
            ? String(a.external_event_id).localeCompare(String(b.external_event_id))
            : received;
        })
        .slice(0, Number.isFinite(limit) ? limit : undefined) as T[];
    }
    if (normalized.includes('FROM webhook_deliveries')) {
      this.db.assertColumns('webhook_deliveries', ['channel', 'external_event_id']);
      return this.db.tables.webhook_deliveries.filter(
        (row) => row.channel === this.values[0] && row.external_event_id === this.values[1],
      ) as T[];
    }
    if (
      normalized.startsWith('SELECT 1 AS authorized') &&
      normalized.includes('FROM session_controls')
    ) {
      const authorized =
        this.pausedSessionAuthorityMatches(
          this.values[0],
          this.values[1],
        ) &&
        this.db.tables.session_controls.some(
          (row) =>
            row.session_id === this.values[0] &&
            row.assigned_agent_id === this.values[2],
        );
      return authorized ? ([{ authorized: 1 }] as T[]) : [];
    }
    if (normalized.includes('FROM non_agent_text_deliveries')) {
      this.db.assertColumns('non_agent_text_deliveries', ['request_key']);
      return this.db.tables.non_agent_text_deliveries.filter(
        (row) => row.request_key === this.values[0],
      ) as T[];
    }
    if (normalized.includes('FROM non_agent_text_delivery_attempts')) {
      const exists = this.db.tables.non_agent_text_delivery_attempts.some(
        (row) => row.delivery_attempt_token === this.values[0],
      );
      return exists ? ([{ token_exists: 1 }] as T[]) : [];
    }
    if (normalized.includes('FROM session_controls')) {
      this.db.assertColumns(
        'session_controls',
        normalized.includes('session_authority_generation')
          ? ['session_id', 'session_authority_generation']
          : ['session_id'],
      );
      if (normalized.includes(' IN (')) {
        const sessionIds = new Set(this.values);
        return this.db.tables.session_controls.filter((row) => sessionIds.has(row.session_id)) as T[];
      }
      return this.db.tables.session_controls.filter((row) => row.session_id === this.values[0]) as T[];
    }
    if (normalized.includes('FROM pending_customer_turns') && normalized.includes('external_message_id')) {
      this.db.assertColumns('pending_customer_turns', ['session_id', 'external_message_id']);
      return this.db.tables.pending_customer_turns.filter(
        (row) => row.session_id === this.values[0] && row.external_message_id === this.values[1],
      ) as T[];
    }
    if (normalized.includes('FROM customer_runs') && normalized.includes('WHERE id = ?')) {
      this.db.assertColumns('customer_runs', ['id']);
      return this.db.tables.customer_runs.filter((row) => row.id === this.values[0]) as T[];
    }
    if (normalized.includes('FROM customer_runs')) {
      this.db.assertColumns('customer_runs', ['session_id', 'client_message_id']);
      return this.db.tables.customer_runs.filter(
        (row) => row.session_id === this.values[0] && row.client_message_id === this.values[1],
      ) as T[];
    }
    if (normalized.includes('FROM customer_run_events')) {
      this.db.assertColumns('customer_run_events', ['run_id', 'sequence']);
      let rows = this.db.tables.customer_run_events.filter(
        (row) => row.run_id === this.values[0],
      );
      if (normalized.includes('sequence > ?')) {
        rows = rows.filter(
          (row) =>
            Number(row.sequence) > Number(this.values[1]),
        );
      }
      return [...rows]
        .sort((left, right) => Number(left.sequence) - Number(right.sequence)) as T[];
    }
    if (normalized.includes('FROM pending_customer_turns') && normalized.includes('turn_id = ?')) {
      this.db.assertColumns('pending_customer_turns', ['turn_id']);
      return this.db.tables.pending_customer_turns.filter((row) => row.turn_id === this.values[0]) as T[];
    }
    if (normalized.includes('FROM pending_customer_turns')) {
      this.db.assertColumns('pending_customer_turns', ['session_id', 'received_at', 'turn_id']);
      return [...this.db.tables.pending_customer_turns]
        .filter((row) => row.session_id === this.values[0])
        .sort((a, b) => {
          const received = String(a.received_at).localeCompare(String(b.received_at));
          return received === 0 ? String(a.turn_id).localeCompare(String(b.turn_id)) : received;
        }) as T[];
    }
    if (
      normalized.includes('FROM agent_run_text_deliveries') &&
      normalized.includes('WHERE run_id = ?') &&
      !normalized.includes(' AS delivery JOIN ')
    ) {
      this.db.assertColumns('agent_run_text_deliveries', ['run_id']);
      return this.db.tables.agent_run_text_deliveries.filter(
        (row) => row.run_id === this.values[0],
      ) as T[];
    }
    if (
      normalized.includes(
        'FROM agent_run_text_delivery_attempts',
      ) &&
      normalized.includes('delivery_attempt < ?') &&
      normalized.includes('ORDER BY delivery_attempt ASC')
    ) {
      const [runId, beforeAttempt] = this.values;
      return this.db.tables.agent_run_text_delivery_attempts
        .filter(
          (row) =>
            row.run_id === runId &&
            Number(row.delivery_attempt) < Number(beforeAttempt),
        )
        .sort(
          (left, right) =>
            Number(left.delivery_attempt) -
            Number(right.delivery_attempt),
        )
        .map((row) => ({
          delivery_attempt_token: row.delivery_attempt_token,
        })) as T[];
    }
    if (
      normalized.includes(
        'FROM agent_run_text_delivery_attempts',
      ) &&
      normalized.includes('delivery_attempt_token = ?')
    ) {
      const token = this.values.at(-1);
      return this.db.tables.agent_run_text_delivery_attempts.some(
        (row) => row.delivery_attempt_token === token,
      )
        ? ([{ found: 1 }] as T[])
        : [];
    }
    if (
      normalized.startsWith('SELECT 1 AS eligible WHERE EXISTS') &&
      normalized.includes('FROM agent_runs JOIN conversation_turns')
    ) {
      return this.agentRunDeliveryExecutionIsCurrent({
        assistantTurnId: this.values[0],
        channel: this.values[1],
        runId: this.values[2],
        executionAttempt: this.values[4],
        executionLeaseToken: this.values[5],
      })
        ? ([{ eligible: 1 }] as T[])
        : [];
    }
    if (
      normalized.startsWith('SELECT 1 AS eligible FROM agent_runs') &&
      normalized.includes('execution_attempt = ?') &&
      normalized.includes('execution_lease_token = ?') &&
      !normalized.includes("status = 'running'")
    ) {
      const [runId, executionAttempt, executionLeaseToken] =
        this.values;
      return this.db.tables.agent_runs.some(
        (row) =>
          row.id === runId &&
          Number(row.execution_attempt) ===
            Number(executionAttempt) &&
          row.execution_lease_token === executionLeaseToken,
      )
        ? ([{ eligible: 1 }] as T[])
        : [];
    }
    if (
      normalized.includes(
        'FROM agent_run_text_deliveries AS delivery JOIN agent_runs AS run',
      ) &&
      normalized.includes("delivery.status = 'sending'") &&
      normalized.includes(
        'delivery.run_execution_attempt = run.execution_attempt',
      ) &&
      normalized.includes(
        'delivery.run_execution_lease_token = run.execution_lease_token',
      )
    ) {
      this.db.assertColumns('agent_run_text_deliveries', [
        'run_id',
        'status',
        'run_execution_attempt',
        'run_execution_lease_token',
      ]);
      this.db.assertColumns('agent_runs', [
        'id',
        'session_id',
        'generation',
        'session_authority_generation',
        'status',
        'execution_attempt',
        'execution_lease_token',
        'execution_lease_expires_at',
      ]);
      const [runId, sessionId, generation, authorityGeneration] =
        this.values;
      const run = this.db.tables.agent_runs.find(
        (candidate) =>
          candidate.id === runId &&
          candidate.session_id === sessionId &&
          Number(candidate.generation) === Number(generation) &&
          Number(candidate.session_authority_generation ?? 0) ===
            Number(authorityGeneration) &&
          candidate.status === 'running' &&
          candidate.execution_lease_expires_at != null &&
          Date.parse(String(candidate.execution_lease_expires_at)) <=
            Date.now(),
      );
      if (!run) return [];
      const delivery = this.db.tables.agent_run_text_deliveries.find(
        (candidate) =>
          candidate.run_id === run.id &&
          candidate.status === 'sending' &&
          Number(candidate.run_execution_attempt) ===
            Number(run.execution_attempt) &&
          candidate.run_execution_lease_token ===
            run.execution_lease_token,
      );
      return delivery ? ([{ ...delivery }] as T[]) : [];
    }
    if (normalized.includes('FROM agent_runs') && normalized.includes('WHERE id = ?')) {
      this.db.assertColumns('agent_runs', ['id']);
      return this.db.tables.agent_runs.filter((row) => row.id === this.values[0]) as T[];
    }
    if (normalized.includes('FROM agent_runs') && normalized.includes('WHERE session_id = ? AND generation = ?')) {
      return this.db.tables.agent_runs.filter(
        (row) => row.session_id === this.values[0] && row.generation === this.values[1],
      ) as T[];
    }
    if (normalized.includes('FROM agent_runs')) {
      this.db.assertColumns('agent_runs', ['session_id', 'generation', 'id']);
      return [...this.db.tables.agent_runs]
        .filter((row) => row.session_id === this.values[0])
        .sort((a, b) => {
          const generation = Number(a.generation) - Number(b.generation);
          return generation === 0 ? String(a.id).localeCompare(String(b.id)) : generation;
        }) as T[];
    }
    if (normalized.includes('FROM agent_run_turns')) {
      this.db.assertColumns('agent_run_turns', ['run_id', 'turn_id', 'sequence']);
      return [...this.db.tables.agent_run_turns]
        .filter((row) => row.run_id === this.values[0])
        .sort((a, b) => {
          const sequence = Number(a.sequence) - Number(b.sequence);
          return sequence === 0 ? String(a.turn_id).localeCompare(String(b.turn_id)) : sequence;
        }) as T[];
    }
    if (normalized.includes('FROM session_agent_state')) {
      this.db.assertColumns('session_agent_state', ['session_id']);
      if (normalized.includes('current_run_id IS NULL') && normalized.includes('debounce_deadline_at <=')) {
        return [...this.db.tables.session_agent_state]
          .filter((row) => row.current_run_id === null)
          .filter((row) => row.debounce_deadline_at !== null && String(row.debounce_deadline_at) <= String(this.values[0]))
          .sort((a, b) => {
            const deadline = String(a.debounce_deadline_at).localeCompare(String(b.debounce_deadline_at));
            return deadline === 0 ? String(a.session_id).localeCompare(String(b.session_id)) : deadline;
          })
          .slice(0, Number(this.values[1])) as T[];
      }
      return this.db.tables.session_agent_state.filter((row) => row.session_id === this.values[0]) as T[];
    }
    if (normalized.includes('SELECT 1')) {
      return [{ ok: 1 }] as T[];
    }
    throw new Error(`Unsupported fake D1 select query: ${this.query}`);
  }

  private upsert(
    table:
      | 'conversation_turns'
      | 'conversation_profiles'
      | 'dashboard_events'
      | 'session_controls'
      | 'pending_customer_turns'
      | 'agent_runs'
      | 'session_agent_state'
      | 'customer_runs'
      | 'langgraph_checkpoints',
    row: Row,
    keys: string[] = ['id'],
  ): void {
    const rows = this.db.tables[table];
    const index =
      table === 'conversation_profiles'
        ? rows.findIndex((entry) => entry.channel === row.channel && entry.external_user_id === row.external_user_id)
        : table === 'session_controls'
          ? rows.findIndex((entry) => entry.session_id === row.session_id)
          : table === 'pending_customer_turns'
            ? rows.findIndex((entry) => entry.session_id === row.session_id && entry.external_message_id === row.external_message_id)
          : table === 'session_agent_state'
            ? rows.findIndex((entry) => entry.session_id === row.session_id)
        : rows.findIndex((entry) => keys.every((key) => entry[key] === row[key]));
    if (index === -1) rows.push(row);
    else rows[index] = { ...rows[index], ...row };
  }

  private findWebhookDelivery(channel = this.values[0], externalEventId = this.values[1]): Row | undefined {
    return this.db.tables.webhook_deliveries.find(
      (row) => row.channel === channel && row.external_event_id === externalEventId,
    );
  }

  private findNonAgentTextDelivery(
    requestKey: unknown,
  ): Row | undefined {
    return this.db.tables.non_agent_text_deliveries.find(
      (row) => row.request_key === requestKey,
    );
  }

  private webhookPayloadKind(row: Row): unknown {
    const payload =
      typeof row.payload === 'string'
        ? JSON.parse(row.payload) as unknown
        : row.payload;
    return typeof payload === 'object' && payload !== null
      ? (payload as Record<string, unknown>).kind
      : undefined;
  }

  private confirmationPauseGenerationIsCurrent(row: Row): boolean {
    return this.db.tables.confirmation_pause_sessions.some(
      (session) =>
        session.session_id === row.session_id &&
        session.generation === row.session_generation,
    );
  }

  private confirmationPauseAuthorityIsCurrent(row: Row): boolean {
    const control = this.sessionControl(row.session_id);
    return (
      control.agent_mode === 'ai_active' &&
      control.session_authority_generation ===
        Number(row.session_authority_generation ?? 0)
    );
  }

  private confirmationPauseFenceIsCurrent(
    sessionId: unknown,
    generation: unknown,
  ): boolean {
    return this.db.tables.confirmation_pause_sessions.some(
      (row) =>
        row.session_id === sessionId &&
        row.generation === generation,
    );
  }

  private sessionControl(sessionId: unknown): {
    agent_mode: unknown;
    assigned_agent_id: unknown;
    session_authority_generation: number;
    persisted: boolean;
  } {
    const row = this.db.tables.session_controls.find(
      (candidate) => candidate.session_id === sessionId,
    );
    return row
      ? {
          agent_mode: row.agent_mode,
          assigned_agent_id: row.assigned_agent_id,
          session_authority_generation: Number(
            row.session_authority_generation ?? 0,
          ),
          persisted: true,
        }
      : {
          agent_mode: 'ai_active',
          assigned_agent_id: null,
          session_authority_generation: 0,
          persisted: false,
        };
  }

  private agentRunDeliveryExecutionIsCurrent(input: {
    assistantTurnId: unknown;
    channel: unknown;
    runId: unknown;
    executionAttempt: unknown;
    executionLeaseToken: unknown;
  }): boolean {
    const run = this.db.tables.agent_runs.find(
      (candidate) =>
        candidate.id === input.runId &&
        Number(candidate.execution_attempt) ===
          Number(input.executionAttempt) &&
        candidate.execution_lease_token ===
          input.executionLeaseToken &&
        candidate.status === 'running' &&
        candidate.channel === input.channel &&
        candidate.execution_lease_expires_at != null &&
        Date.parse(String(candidate.execution_lease_expires_at)) >
          Date.now() &&
        candidate.assistant_turn_id === input.assistantTurnId,
    );
    if (!run) return false;
    const assistantTurn = this.db.tables.conversation_turns.some(
      (turn) =>
        turn.id === input.assistantTurnId &&
        turn.session_id === run.session_id &&
        turn.role === 'assistant' &&
        turn.channel === input.channel,
    );
    const owner = this.db.tables.session_agent_state.some(
      (state) =>
        state.session_id === run.session_id &&
        state.current_run_id === run.id &&
        Number(state.generation) === Number(run.generation),
    );
    return (
      assistantTurn &&
      owner &&
      this.activeSessionAuthorityMatches(
        run.session_id,
        run.session_authority_generation ?? 0,
      )
    );
  }

  private activeSessionAuthorityGeneration(
    sessionId: unknown,
  ): number | undefined {
    const control = this.sessionControl(sessionId);
    return control.agent_mode === 'ai_active'
      ? control.session_authority_generation
      : undefined;
  }

  private activeSessionAuthorityMatches(
    sessionId: unknown,
    expectedGeneration: unknown,
  ): boolean {
    const current = this.activeSessionAuthorityGeneration(sessionId);
    return (
      current !== undefined &&
      current === Number(expectedGeneration)
    );
  }

  private pausedSessionAuthorityMatches(
    sessionId: unknown,
    expectedGeneration: unknown,
  ): boolean {
    const control = this.sessionControl(sessionId);
    return (
      control.persisted &&
      control.agent_mode === 'human_paused' &&
      control.session_authority_generation ===
        Number(expectedGeneration)
    );
  }

  private runCommitEligibilityIsCurrent(
    normalized: string,
    coreBindingCount: number,
  ): boolean {
    if (!normalized.includes("unixepoch('now') < unixepoch(?)")) {
      return true;
    }
    const notAfter = this.values[coreBindingCount];
    if (notAfter !== null) {
      const expiry = Date.parse(String(notAfter));
      if (!Number.isFinite(expiry) || Date.now() >= expiry) return false;
    }
    const offset = coreBindingCount + 2;
    let ownerBindingCount: number;
    let ownerCurrent: boolean;
    if (normalized.includes('FROM session_agent_state AS state')) {
      const [
        sessionId,
        runId,
        generation,
        sessionAuthorityGeneration,
        executionAttempt,
        executionLeaseToken,
      ] = this.values.slice(
        offset,
        offset + 6,
      );
      const state = this.db.tables.session_agent_state.find(
        (candidate) =>
          candidate.session_id === sessionId &&
          candidate.current_run_id === runId &&
          candidate.generation === generation,
      );
      ownerBindingCount = 6;
      ownerCurrent = Boolean(
        state &&
        this.db.tables.agent_runs.some(
          (run) =>
            run.id === runId &&
            run.session_id === sessionId &&
            run.generation === generation &&
              Number(run.session_authority_generation ?? 0) ===
                Number(sessionAuthorityGeneration) &&
            run.status === 'running' &&
            Number(run.execution_attempt ?? 0) ===
              Number(executionAttempt) &&
            run.execution_lease_token === executionLeaseToken &&
            run.execution_lease_expires_at != null &&
            Date.parse(String(run.execution_lease_expires_at)) > Date.now(),
        ),
      );
    } else if (normalized.includes('FROM customer_runs AS run')) {
      const [
        runId,
        sessionId,
        sessionAuthorityGeneration,
      ] = this.values.slice(offset, offset + 3);
      ownerBindingCount = 3;
      ownerCurrent = this.db.tables.customer_runs.some(
        (run) =>
          run.id === runId &&
          run.session_id === sessionId &&
          Number(run.session_authority_generation ?? 0) ===
            Number(sessionAuthorityGeneration) &&
          (run.status === 'accepted' || run.status === 'running'),
      );
    } else if (
      normalized.includes(
        'FROM irreversible_operations AS operation',
      )
    ) {
      const [
        requestId,
        sessionId,
        operation,
        bindingFingerprint,
        sessionAuthorityGeneration,
        attempt,
        leaseToken,
      ] = this.values.slice(offset, offset + 7);
      ownerBindingCount = 7;
      ownerCurrent = this.db.tables.irreversible_operations.some(
        (candidate) =>
          candidate.request_id === requestId &&
          candidate.session_id === sessionId &&
          candidate.operation === operation &&
          candidate.binding_fingerprint === bindingFingerprint &&
          Number(candidate.session_authority_generation ?? 0) ===
            Number(sessionAuthorityGeneration) &&
          candidate.status === 'attempting' &&
          candidate.attempt_count === attempt &&
          candidate.lease_token === leaseToken &&
          Date.now() < Date.parse(String(candidate.lease_expires_at)),
      );
    } else {
      return false;
    }
    if (!ownerCurrent) return false;
    const [
      authoritySessionId,
      authorityGeneration,
      absentGeneration,
      absentSessionId,
    ] = this.values.slice(
      offset + ownerBindingCount,
      offset + ownerBindingCount + 4,
    );
    return (
      authoritySessionId === absentSessionId &&
      Number(authorityGeneration) === Number(absentGeneration) &&
      this.activeSessionAuthorityMatches(
        authoritySessionId,
        authorityGeneration,
      )
    );
  }

  private async runConfirmationPauseUpdateHook(
    timing: 'before' | 'after',
    kind: 'expire' | 'reject' | 'complete',
  ): Promise<void> {
    const hook = timing === 'before'
      ? this.db.beforeConfirmationPauseUpdate
      : this.db.afterConfirmationPauseUpdate;
    if (!hook) return;
    if (timing === 'before') {
      this.db.beforeConfirmationPauseUpdate = undefined;
    } else {
      this.db.afterConfirmationPauseUpdate = undefined;
    }
    await hook(kind);
  }

  private handleDelete(normalized: string): void {
    const fencePattern =
      /\s+AND EXISTS \(\s*SELECT 1 FROM confirmation_pause_sessions WHERE session_id = \? AND generation = \?\s*\)$/u;
    const fenced = fencePattern.test(normalized);
    if (fenced) {
      const sessionId = this.values.at(-2);
      const generation = this.values.at(-1);
      const fence = this.db.tables.confirmation_pause_sessions.some(
        (row) =>
          row.session_id === sessionId &&
          row.generation === generation,
      );
      if (!fence) return;
      normalized = normalized.replace(fencePattern, '');
    }
    const childMatch = normalized.match(
      /^DELETE FROM (customer_run_events|agent_run_turns) WHERE run_id IN \(\s*SELECT id FROM (customer_runs|agent_runs) WHERE session_id = \?\s*\)$/,
    );
    if (childMatch) {
      const childTable = childMatch[1] as 'customer_run_events' | 'agent_run_turns';
      const parentTable = childMatch[2] as 'customer_runs' | 'agent_runs';
      const runIds = new Set(
        this.db.tables[parentTable]
          .filter((row) => row.session_id === this.values[0])
          .map((row) => row.id),
      );
      this.db.tables[childTable] = this.db.tables[childTable].filter((row) => !runIds.has(row.run_id));
      return;
    }
    const operationFiltered = normalized.match(
      /^DELETE FROM irreversible_operations WHERE session_id = \? AND operation <> 'confirmation_resume'$/,
    );
    if (operationFiltered) {
      this.db.tables.irreversible_operations =
        this.db.tables.irreversible_operations.filter(
          (row) =>
            row.session_id !== this.values[0] ||
            row.operation === 'confirmation_resume',
        );
      return;
    }
    const nonAgentDeliveryPreserving = normalized.match(
      /^DELETE FROM webhook_deliveries WHERE session_id = \? AND NOT \(\s*channel = 'kfc' AND json_extract\(payload, '\$\.kind'\) = 'non_agent_text_delivery_v1'\s*\)$/,
    );
    if (nonAgentDeliveryPreserving) {
      this.db.tables.webhook_deliveries =
        this.db.tables.webhook_deliveries.filter(
          (row) =>
            row.session_id !== this.values[0] ||
            (
              row.channel === 'kfc' &&
              this.webhookPayloadKind(row) ===
                'non_agent_text_delivery_v1'
            ),
        );
      return;
    }
    const checkpointFamily = normalized.match(
      /^DELETE FROM (langgraph_checkpoint_writes|langgraph_checkpoints) WHERE \(\s*thread_id = \? OR substr\(thread_id, 1, length\(\?\)\) = \?\s*\)$/,
    );
    if (checkpointFamily) {
      const tableName = checkpointFamily[1] as
        | 'langgraph_checkpoint_writes'
        | 'langgraph_checkpoints';
      const sessionId = String(this.values[0]);
      const prefix = String(this.values[1]);
      this.db.tables[tableName] = this.db.tables[tableName].filter(
        (row) =>
          row.thread_id !== sessionId &&
          !String(row.thread_id).startsWith(prefix),
      );
      return;
    }
    const match = normalized.match(
      /^DELETE FROM ([^ ]+) WHERE (session_id|thread_id) = \?$/,
    );
    if (!match) throw new Error(`Unsupported fake D1 delete query: ${this.query}`);
    const tableName = match[1] as TableName;
    const key = match[2];
    if (key === 'session_id') this.db.assertColumns(tableName, ['session_id']);
    this.db.tables[tableName] = this.db.tables[tableName].filter((row) => row[key] !== this.values[0]);
  }

  private handleCreateTable(normalized: string): void {
    const match = normalized.match(/^CREATE TABLE IF NOT EXISTS ([^( ]+) \((.+)\)$/);
    if (!match) throw new Error(`Unsupported fake D1 create table query: ${this.query}`);
    const [, rawTableName, rawDefinition] = match;
    const tableName = rawTableName as TableName;
    const definitionWithoutPrimaryKey = rawDefinition.replace(/,\s*PRIMARY KEY\s*\([^)]+\)\s*$/, '');
    const columns = definitionWithoutPrimaryKey
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => part.split(/\s+/)[0]);
    this.db.ensureTable(tableName, columns);
  }

  private handleAlterTable(normalized: string): void {
    const match = normalized.match(/^ALTER TABLE ([^ ]+) ADD COLUMN ([^ ]+) /);
    if (!match) throw new Error(`Unsupported fake D1 alter table query: ${this.query}`);
    const [, rawTableName, rawColumnName] = match;
    const tableName = rawTableName as TableName;
    this.db.addColumn(tableName, rawColumnName);
    if (
      rawColumnName === 'session_authority_generation' &&
      normalized.includes('DEFAULT 0')
    ) {
      for (const row of this.db.tables[tableName]) {
        row.session_authority_generation ??= 0;
      }
    }
  }
}

function normalizeSql(query: string): string {
  return query.replace(/\s+/g, ' ').trim();
}

function jsonValuesEquivalent(
  left: unknown,
  right: unknown,
): boolean {
  try {
    const leftValue =
      typeof left === 'string'
        ? JSON.parse(left) as unknown
        : left;
    const rightValue =
      typeof right === 'string'
        ? JSON.parse(right) as unknown
        : right;
    return canonicalJsonValue(leftValue) ===
      canonicalJsonValue(rightValue);
  } catch {
    return false;
  }
}

function canonicalJsonValue(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJsonValue).join(',')}]`;
  }
  if (typeof value === 'object' && value !== null) {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) =>
        `${JSON.stringify(key)}:${canonicalJsonValue(entry)}`
      )
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function ok(changes = 0): QueryResult {
  return { success: true, meta: { changes } };
}
