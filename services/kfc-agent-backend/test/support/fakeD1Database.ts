type Row = Record<string, unknown>;
type TableName =
  | 'conversation_turns'
  | 'conversation_profiles'
  | 'conversation_events'
  | 'dashboard_events'
  | 'webhook_deliveries'
  | 'session_controls';

interface QueryResult<T = Row> {
  results?: T[];
  success: boolean;
  meta: Record<string, unknown>;
}

export class FakeD1Database {
  readonly tables = {
    conversation_turns: [] as Row[],
    conversation_profiles: [] as Row[],
    conversation_events: [] as Row[],
    dashboard_events: [] as Row[],
    webhook_deliveries: [] as Row[],
    session_controls: [] as Row[],
  };
  private readonly schemas = new Map<TableName, Set<string>>();

  prepare(query: string): FakeD1PreparedStatement {
    return new FakeD1PreparedStatement(this, query);
  }

  batch(statements: FakeD1PreparedStatement[]): Promise<QueryResult[]> {
    return Promise.all(statements.map((statement) => statement.run()));
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
    const normalized = normalizeSql(this.query);
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
    throw new Error(`Unsupported fake D1 run query: ${this.query}`);
  }

  async first<T = Row>(): Promise<T | null> {
    const rows = await this.selectRows<T>();
    return rows[0] ?? null;
  }

  async all<T = Row>(): Promise<QueryResult<T>> {
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
    if (normalized.includes('FROM conversation_turns') && normalized.includes('external_message_id')) {
      this.db.assertColumns('conversation_turns', ['session_id', 'external_message_id']);
      return this.db.tables.conversation_turns.filter(
        (row) => row.session_id === this.values[0] && row.external_message_id === this.values[1],
      ) as T[];
    }
    if (normalized.includes('FROM conversation_turns')) {
      this.db.assertColumns('conversation_turns', ['session_id']);
      return this.db.tables.conversation_turns.filter((row) => row.session_id === this.values[0]) as T[];
    }
    if (normalized.includes('FROM conversation_profiles')) {
      this.db.assertColumns('conversation_profiles', ['channel', 'external_user_id']);
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
    if (normalized.includes('FROM webhook_deliveries')) {
      this.db.assertColumns('webhook_deliveries', ['channel', 'external_event_id']);
      return this.db.tables.webhook_deliveries.filter(
        (row) => row.channel === this.values[0] && row.external_event_id === this.values[1],
      ) as T[];
    }
    if (normalized.includes('FROM session_controls')) {
      this.db.assertColumns('session_controls', ['session_id']);
      return this.db.tables.session_controls.filter((row) => row.session_id === this.values[0]) as T[];
    }
    if (normalized.includes('SELECT 1')) {
      return [{ ok: 1 }] as T[];
    }
    throw new Error(`Unsupported fake D1 select query: ${this.query}`);
  }

  private upsert(table: 'conversation_turns' | 'conversation_profiles' | 'dashboard_events' | 'session_controls', row: Row): void {
    const rows = this.db.tables[table];
    const index =
      table === 'conversation_profiles'
        ? rows.findIndex((entry) => entry.channel === row.channel && entry.external_user_id === row.external_user_id)
        : table === 'session_controls'
          ? rows.findIndex((entry) => entry.session_id === row.session_id)
        : rows.findIndex((entry) => entry.id === row.id);
    if (index === -1) rows.push(row);
    else rows[index] = { ...rows[index], ...row };
  }

  private findWebhookDelivery(channel = this.values[0], externalEventId = this.values[1]): Row | undefined {
    return this.db.tables.webhook_deliveries.find(
      (row) => row.channel === channel && row.external_event_id === externalEventId,
    );
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

function ok(): QueryResult {
  return { success: true, meta: {} };
}
