type Row = Record<string, unknown>;
type TableName =
  | 'conversation_turns'
  | 'conversation_profiles'
  | 'conversation_events'
  | 'dashboard_events'
  | 'webhook_deliveries'
  | 'session_controls'
  | 'pending_customer_turns'
  | 'agent_runs'
  | 'agent_run_turns'
  | 'session_agent_state'
  | 'customer_runs'
  | 'customer_run_events'
  | 'langgraph_checkpoints'
  | 'langgraph_checkpoint_writes'
  | 'irreversible_operations';

interface QueryResult<T = Row> {
  results?: T[];
  success: boolean;
  meta: Record<string, unknown>;
}

export class FakeD1Database {
  readonly calls = { batch: 0, run: 0, first: 0, all: 0 };
  readonly tables = {
    conversation_turns: [] as Row[],
    conversation_profiles: [] as Row[],
    conversation_events: [] as Row[],
    dashboard_events: [] as Row[],
    webhook_deliveries: [] as Row[],
    session_controls: [] as Row[],
    pending_customer_turns: [] as Row[],
    agent_runs: [] as Row[],
    agent_run_turns: [] as Row[],
    session_agent_state: [] as Row[],
    customer_runs: [] as Row[],
    customer_run_events: [] as Row[],
    langgraph_checkpoints: [] as Row[],
    langgraph_checkpoint_writes: [] as Row[],
    irreversible_operations: [] as Row[],
  };
  private readonly schemas = new Map<TableName, Set<string>>();

  prepare(query: string): FakeD1PreparedStatement {
    return new FakeD1PreparedStatement(this, query);
  }

  async batch(statements: FakeD1PreparedStatement[]): Promise<QueryResult[]> {
    this.calls.batch += 1;
    const results: QueryResult[] = [];
    for (const statement of statements) results.push(await statement.run());
    return results;
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
      return ok();
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
      const exists = this.db.tables.irreversible_operations.some((row) => row.request_id === this.values[0]);
      if (!exists) {
        this.db.tables.irreversible_operations.push({
          request_id: this.values[0],
          session_id: this.values[1],
          operation: this.values[2],
          binding_fingerprint: this.values[3],
          result_json: null,
          created_at: this.values[4],
          completed_at: null,
        });
      }
      return ok(exists ? 0 : 1);
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
    if (normalized.startsWith('INSERT INTO conversation_events')) {
      this.db.assertColumns('conversation_events', ['id', 'session_id', 'source_type', 'payload', 'created_at']);
      this.db.tables.conversation_events.push({
        id: this.values[0],
        session_id: this.values[1],
        source_type: this.values[2],
        payload: this.values[3],
        created_at: this.values[4],
      });
      return ok();
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
    if (normalized.startsWith('INSERT INTO webhook_deliveries')) {
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
      return ok();
    }
    if (normalized.startsWith('INSERT INTO session_controls')) {
      this.db.assertColumns('session_controls', ['session_id', 'agent_mode', 'assigned_agent_id', 'updated_at']);
      this.upsert('session_controls', {
        session_id: this.values[0],
        agent_mode: this.values[1],
        assigned_agent_id: this.values[2],
        updated_at: this.values[3],
      });
      return ok();
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
      if (existing) return ok(0);
      this.db.tables.customer_runs.push({
        id: this.values[0],
        schema_version: this.values[1],
        session_id: this.values[2],
        customer_id: this.values[3],
        client_message_id: this.values[4],
        request_fingerprint: this.values[5],
        generation: this.values[6],
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
      const run = this.db.tables.customer_runs.find(
        (row) => row.id === this.values[7] && row.next_event_sequence === this.values[8],
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
    if (normalized.startsWith('INSERT INTO agent_runs')) {
      this.db.assertColumns('agent_runs', [
        'id',
        'session_id',
        'generation',
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
      this.upsert('agent_runs', {
        id: this.values[0],
        session_id: this.values[1],
        generation: this.values[2],
        channel: this.values[3],
        external_user_id: this.values[4],
        status: this.values[5],
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
      return ok();
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
      const row = this.db.tables.pending_customer_turns.find((entry) => entry.turn_id === this.values[2]);
      if (row) {
        row.status = 'claimed';
        row.claimed_run_id = this.values[0];
        row.updated_at = this.values[1];
      }
      return ok();
    }
    if (normalized.startsWith('DELETE FROM ')) {
      this.handleDelete(normalized);
      return ok();
    }
    if (normalized.startsWith('UPDATE agent_runs')) {
      const id = this.values[12];
      const row = this.db.tables.agent_runs.find((entry) => entry.id === id);
      if (row) {
        row.status = this.values[0];
        row.superseded_by_run_id = this.values[1];
        row.irreversible_side_effect_at = this.values[2];
        row.irreversible_tool_name = this.values[3];
        row.assistant_turn_id = this.values[4];
        row.delivery_status = this.values[5];
        row.delivery_external_message_id = this.values[6];
        row.error_code = this.values[7];
        row.error_message = this.values[8];
        row.started_at = this.values[9];
        row.completed_at = this.values[10];
        row.updated_at = this.values[11];
      }
      return ok();
    }
    if (normalized.startsWith('UPDATE customer_runs')) {
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
      const row = this.db.tables.irreversible_operations.find((candidate) =>
        candidate.request_id === this.values[2] &&
        candidate.session_id === this.values[3] &&
        candidate.operation === this.values[4] &&
        candidate.binding_fingerprint === this.values[5],
      );
      if (!row) return ok(0);
      row.result_json ??= this.values[0];
      row.completed_at ??= this.values[1];
      return ok(1);
    }
    throw new Error(`Unsupported fake D1 run query: ${this.query}`);
  }

  async first<T = Row>(): Promise<T | null> {
    this.db.recordCall('first');
    const rows = await this.selectRows<T>();
    return rows[0] ?? null;
  }

  async all<T = Row>(): Promise<QueryResult<T>> {
    this.db.recordCall('all');
    return { ...ok(), results: await this.selectRows<T>() };
  }

  private async selectRows<T>(): Promise<T[]> {
    const normalized = normalizeSql(this.query);
    if (normalized.startsWith('PRAGMA table_info(')) {
      const table = normalized.match(/^PRAGMA table_info\(([^)]+)\)$/)?.[1] as TableName | undefined;
      if (!table || !this.db.hasTable(table)) return [];
      return this.db.listColumns(table).map((name) => ({ name })) as T[];
    }
    if (normalized.includes('FROM sqlite_master')) {
      const tableName = this.values[0] as TableName;
      return this.db.hasTable(tableName) ? ([{ name: tableName }] as T[]) : [];
    }
    if (normalized.includes('FROM conversation_turns') && normalized.includes('WHERE id = ?')) {
      this.db.assertColumns('conversation_turns', ['id']);
      return this.db.tables.conversation_turns.filter((row) => row.id === this.values[0]) as T[];
    }
    if (normalized.includes('FROM langgraph_checkpoints')) {
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
    if (normalized.includes('FROM session_controls')) {
      this.db.assertColumns('session_controls', ['session_id']);
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
      return [...this.db.tables.customer_run_events]
        .filter((row) => row.run_id === this.values[0] && Number(row.sequence) > Number(this.values[1]))
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
    if (normalized.includes('FROM agent_runs') && normalized.includes('WHERE id = ?')) {
      this.db.assertColumns('agent_runs', ['id']);
      return this.db.tables.agent_runs.filter((row) => row.id === this.values[0]) as T[];
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

  private handleDelete(normalized: string): void {
    const match = normalized.match(/^DELETE FROM ([^ ]+) WHERE (session_id|thread_id) = \?$/);
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
    this.db.addColumn(rawTableName as TableName, rawColumnName);
  }
}

function normalizeSql(query: string): string {
  return query.replace(/\s+/g, ' ').trim();
}

function ok(changes = 0): QueryResult {
  return { success: true, meta: { changes } };
}
