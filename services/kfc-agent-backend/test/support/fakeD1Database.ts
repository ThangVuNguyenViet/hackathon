type Row = Record<string, unknown>;

interface QueryResult<T = Row> {
  results?: T[];
  success: boolean;
  meta: Record<string, unknown>;
}

export class FakeD1Database {
  readonly tables = {
    conversation_turns: [] as Row[],
    conversation_events: [] as Row[],
    dashboard_events: [] as Row[],
    webhook_deliveries: [] as Row[],
  };

  prepare(query: string): FakeD1PreparedStatement {
    return new FakeD1PreparedStatement(this, query);
  }

  batch(statements: FakeD1PreparedStatement[]): Promise<QueryResult[]> {
    return Promise.all(statements.map((statement) => statement.run()));
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
    if (normalized.startsWith('CREATE TABLE') || normalized.startsWith('CREATE INDEX') || normalized.startsWith('CREATE UNIQUE INDEX')) {
      return ok();
    }
    if (normalized.startsWith('INSERT INTO conversation_turns')) {
      this.upsert('conversation_turns', {
        id: this.values[0],
        session_id: this.values[1],
        channel: this.values[2],
        role: this.values[3],
        text: this.values[4],
        external_message_id: this.values[5],
        external_user_id: this.values[6],
        delivery_status: this.values[7],
        created_at: this.values[8],
      });
      return ok();
    }
    if (normalized.startsWith('INSERT INTO conversation_events')) {
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
    if (normalized.startsWith('UPDATE conversation_turns')) {
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
          row.created_at = this.values[5];
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
    if (normalized.includes('FROM conversation_turns') && normalized.includes('WHERE id = ?')) {
      return this.db.tables.conversation_turns.filter((row) => row.id === this.values[0]) as T[];
    }
    if (normalized.includes('FROM conversation_turns') && normalized.includes('external_message_id')) {
      return this.db.tables.conversation_turns.filter(
        (row) => row.session_id === this.values[0] && row.external_message_id === this.values[1],
      ) as T[];
    }
    if (normalized.includes('FROM conversation_turns')) {
      return this.db.tables.conversation_turns.filter((row) => row.session_id === this.values[0]) as T[];
    }
    if (normalized.includes('FROM conversation_events')) {
      return this.db.tables.conversation_events.filter((row) => row.session_id === this.values[0]) as T[];
    }
    if (normalized.includes('FROM dashboard_events')) {
      return [...this.db.tables.dashboard_events] as T[];
    }
    if (normalized.includes('FROM webhook_deliveries')) {
      return this.db.tables.webhook_deliveries.filter(
        (row) => row.channel === this.values[0] && row.external_event_id === this.values[1],
      ) as T[];
    }
    if (normalized.includes('SELECT 1')) {
      return [{ ok: 1 }] as T[];
    }
    throw new Error(`Unsupported fake D1 select query: ${this.query}`);
  }

  private upsert(table: 'conversation_turns' | 'dashboard_events', row: Row): void {
    const rows = this.db.tables[table];
    const index = rows.findIndex((entry) => entry.id === row.id);
    if (index === -1) rows.push(row);
    else rows[index] = { ...rows[index], ...row };
  }

  private findWebhookDelivery(channel = this.values[0], externalEventId = this.values[1]): Row | undefined {
    return this.db.tables.webhook_deliveries.find(
      (row) => row.channel === channel && row.external_event_id === externalEventId,
    );
  }
}

function normalizeSql(query: string): string {
  return query.replace(/\s+/g, ' ').trim();
}

function ok(): QueryResult {
  return { success: true, meta: {} };
}
