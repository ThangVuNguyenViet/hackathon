import { randomUUID } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import type { AgentMode, ConversationProfile, DashboardEvent, ConversationTurn } from '../domain/types.js';
import type {
  ConversationStore,
  HistorySearchResult,
  ImportedConversationTurn,
  ImportedConversationTurnResult,
  ReserveWebhookDeliveryInput,
  ReserveWebhookDeliveryResult,
  SessionControl,
  StoredEvent,
  WebhookDelivery,
  WebhookDeliveryChannel,
} from './memoryStore.js';

type Queryable = Pool | PoolClient;

interface ConversationTurnRow {
  id: string;
  session_id: string;
  channel: ConversationTurn['channel'];
  role: ConversationTurn['role'];
  text: string;
  external_message_id: string | null;
  external_user_id: string | null;
  delivery_status: ConversationTurn['deliveryStatus'];
  metadata: Record<string, unknown> | null;
  created_at: Date | string;
}

interface ConversationProfileRow {
  channel: ConversationProfile['channel'];
  external_user_id: string;
  display_name: string | null;
  avatar_url: string | null;
  profile_source: ConversationProfile['profileSource'];
  profile_updated_at: Date | string;
}

interface StoredEventRow {
  id: string;
  session_id: string;
  source_type: string;
  payload: Record<string, unknown>;
  created_at: Date | string;
}

interface DashboardEventRow {
  id: string;
  session_id: string;
  type: DashboardEvent['type'];
  payload: Record<string, unknown>;
  created_at: Date | string;
}

interface WebhookDeliveryRow {
  channel: WebhookDeliveryChannel;
  external_event_id: string;
  external_thread_id: string;
  external_user_id: string;
  session_id: string;
  status: WebhookDelivery['status'];
  payload: Record<string, unknown>;
  received_at: Date | string;
  processed_at: Date | string | null;
  failed_at: Date | string | null;
  last_error: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface SessionControlRow {
  session_id: string;
  agent_mode: AgentMode;
  assigned_agent_id: string | null;
  updated_at: Date | string;
}

export class PostgresStore implements ConversationStore {
  constructor(private readonly db: Queryable) {}

  async initialize(): Promise<void> {
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS conversation_turns (
        id text PRIMARY KEY,
        session_id text NOT NULL,
        channel text NOT NULL,
        role text NOT NULL,
        text text NOT NULL,
        external_message_id text,
        external_user_id text,
        delivery_status text NOT NULL,
        created_at timestamptz NOT NULL
      )
    `);
    await this.db.query(`
      ALTER TABLE conversation_turns
      ADD COLUMN IF NOT EXISTS metadata jsonb
    `);
    await this.db.query(`
      CREATE INDEX IF NOT EXISTS conversation_turns_session_created_idx
      ON conversation_turns (session_id, created_at, id)
    `);
    await this.db.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS conversation_turns_session_external_message_idx
      ON conversation_turns (session_id, external_message_id)
      WHERE external_message_id IS NOT NULL
    `);
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS conversation_events (
        id text PRIMARY KEY,
        session_id text NOT NULL,
        source_type text NOT NULL,
        payload jsonb NOT NULL,
        created_at timestamptz NOT NULL
      )
    `);
    await this.db.query(`
      CREATE INDEX IF NOT EXISTS conversation_events_session_created_idx
      ON conversation_events (session_id, created_at, id)
    `);
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS dashboard_events (
        event_sequence bigserial,
        id text PRIMARY KEY,
        session_id text NOT NULL,
        type text NOT NULL,
        payload jsonb NOT NULL,
        created_at timestamptz NOT NULL
      )
    `);
    await this.db.query(`
      ALTER TABLE dashboard_events
      ADD COLUMN IF NOT EXISTS event_sequence bigserial
    `);
    await this.db.query(`
      CREATE INDEX IF NOT EXISTS dashboard_events_session_created_idx
      ON dashboard_events (session_id, event_sequence, created_at, id)
    `);
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS webhook_deliveries (
        channel text NOT NULL,
        external_event_id text NOT NULL,
        external_thread_id text NOT NULL,
        external_user_id text NOT NULL,
        session_id text NOT NULL,
        status text NOT NULL,
        payload jsonb NOT NULL,
        received_at timestamptz NOT NULL,
        processed_at timestamptz,
        failed_at timestamptz,
        last_error text,
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL,
        PRIMARY KEY (channel, external_event_id)
      )
    `);
    await this.db.query(`
      CREATE INDEX IF NOT EXISTS webhook_deliveries_session_received_idx
      ON webhook_deliveries (session_id, received_at, channel, external_event_id)
    `);
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS conversation_profiles (
        channel text NOT NULL,
        external_user_id text NOT NULL,
        display_name text,
        avatar_url text,
        profile_source text NOT NULL,
        profile_updated_at timestamptz NOT NULL,
        PRIMARY KEY (channel, external_user_id)
      )
    `);
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS session_controls (
        session_id text PRIMARY KEY,
        agent_mode text NOT NULL,
        assigned_agent_id text,
        updated_at timestamptz NOT NULL
      )
    `);
  }

  async appendTurn(input: Omit<ConversationTurn, 'id' | 'createdAt'>): Promise<ConversationTurn> {
    const turn: ConversationTurn = {
      ...input,
      id: `turn_${randomUUID()}`,
      createdAt: new Date().toISOString(),
    };
    await this.db.query(
      `
        INSERT INTO conversation_turns (
          id, session_id, channel, role, text, external_message_id, external_user_id, delivery_status, metadata, created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `,
      [
        turn.id,
        turn.sessionId,
        turn.channel,
        turn.role,
        turn.text,
        turn.externalMessageId,
        turn.externalUserId,
        turn.deliveryStatus,
        input.metadata,
        turn.createdAt,
      ],
    );
    await this.appendEvent(input.sessionId, `conversation_turn:${input.role}`, {
      text: input.text,
      channel: input.channel,
      deliveryStatus: input.deliveryStatus,
      externalMessageId: input.externalMessageId,
      externalUserId: input.externalUserId,
      metadata: input.metadata,
    });
    return turn;
  }

  async upsertImportedTurn(input: ImportedConversationTurn): Promise<ImportedConversationTurnResult> {
    const turn: ConversationTurn = {
      ...input,
      id: input.id ?? `turn_${randomUUID()}`,
    };
    const result = await this.db.query<ConversationTurnRow & { inserted: boolean }>(
      `
        INSERT INTO conversation_turns (
          id, session_id, channel, role, text, external_message_id, external_user_id, delivery_status, metadata, created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (session_id, external_message_id) WHERE external_message_id IS NOT NULL
        DO UPDATE SET
          channel = EXCLUDED.channel,
          role = EXCLUDED.role,
          text = EXCLUDED.text,
          external_user_id = EXCLUDED.external_user_id,
          delivery_status = EXCLUDED.delivery_status,
          metadata = EXCLUDED.metadata,
          created_at = EXCLUDED.created_at
        RETURNING *, (xmax = 0) AS inserted
      `,
      [
        turn.id,
        turn.sessionId,
        turn.channel,
        turn.role,
        turn.text,
        turn.externalMessageId,
        turn.externalUserId,
        turn.deliveryStatus,
        turn.metadata,
        turn.createdAt,
      ],
    );
    const row = result.rows[0];
    if (!row) throw new Error(`Failed to upsert imported conversation turn: ${turn.externalMessageId ?? turn.id}`);
    if (row.inserted) {
      await this.appendEvent(input.sessionId, `conversation_turn:${input.role}`, {
        text: input.text,
        channel: input.channel,
        deliveryStatus: input.deliveryStatus,
        externalMessageId: input.externalMessageId,
        externalUserId: input.externalUserId,
        metadata: input.metadata,
      });
    }
    return { turn: turnFromRow(row), inserted: row.inserted };
  }

  async upsertProfile(input: ConversationProfile): Promise<ConversationProfile> {
    await this.db.query(
      `
        INSERT INTO conversation_profiles (
          channel, external_user_id, display_name, avatar_url, profile_source, profile_updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (channel, external_user_id) DO UPDATE SET
          display_name = EXCLUDED.display_name,
          avatar_url = EXCLUDED.avatar_url,
          profile_source = EXCLUDED.profile_source,
          profile_updated_at = EXCLUDED.profile_updated_at
      `,
      [
        input.channel,
        input.externalUserId,
        input.displayName,
        input.avatarUrl,
        input.profileSource,
        input.profileUpdatedAt,
      ],
    );
    return input;
  }

  async getProfile(
    channel: ConversationProfile['channel'],
    externalUserId: string,
  ): Promise<ConversationProfile | undefined> {
    const result = await this.db.query<ConversationProfileRow>(
      `
        SELECT *
        FROM conversation_profiles
        WHERE channel = $1 AND external_user_id = $2
        LIMIT 1
      `,
      [channel, externalUserId],
    );
    return result.rows[0] ? profileFromRow(result.rows[0]) : undefined;
  }

  async findTurnByExternalMessage(sessionId: string, externalMessageId: string): Promise<ConversationTurn | undefined> {
    const result = await this.db.query<ConversationTurnRow>(
      `
        SELECT *
        FROM conversation_turns
        WHERE session_id = $1 AND external_message_id = $2
        ORDER BY created_at ASC, id ASC
        LIMIT 1
      `,
      [sessionId, externalMessageId],
    );
    return result.rows[0] ? turnFromRow(result.rows[0]) : undefined;
  }

  async reserveWebhookDelivery(input: ReserveWebhookDeliveryInput): Promise<ReserveWebhookDeliveryResult> {
    const now = new Date().toISOString();
    const inserted = await this.db.query<WebhookDeliveryRow>(
      `
        INSERT INTO webhook_deliveries (
          channel, external_event_id, external_thread_id, external_user_id, session_id, status, payload,
          received_at, processed_at, failed_at, last_error, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, 'received', $6, $7, NULL, NULL, NULL, $8, $8)
        ON CONFLICT (channel, external_event_id) DO NOTHING
        RETURNING *
      `,
      [
        input.channel,
        input.externalEventId,
        input.externalThreadId,
        input.externalUserId,
        input.sessionId,
        JSON.stringify(input.payload),
        input.receivedAt,
        now,
      ],
    );
    if (inserted.rows[0]) return { delivery: webhookDeliveryFromRow(inserted.rows[0]), reserved: true };

    const existing = await this.getWebhookDelivery(input.channel, input.externalEventId);
    if (!existing) throw new Error(`Webhook delivery reservation missing after conflict: ${input.channel}:${input.externalEventId}`);
    return { delivery: existing, reserved: false };
  }

  async markWebhookDeliveryProcessed(channel: WebhookDeliveryChannel, externalEventId: string): Promise<WebhookDelivery> {
    return this.updateWebhookDelivery(channel, externalEventId, 'processed', null);
  }

  async markWebhookDeliveryFailed(
    channel: WebhookDeliveryChannel,
    externalEventId: string,
    lastError: string,
  ): Promise<WebhookDelivery> {
    return this.updateWebhookDelivery(channel, externalEventId, 'failed', lastError);
  }

  async getWebhookDelivery(channel: WebhookDeliveryChannel, externalEventId: string): Promise<WebhookDelivery | undefined> {
    const result = await this.db.query<WebhookDeliveryRow>(
      `
        SELECT *
        FROM webhook_deliveries
        WHERE channel = $1 AND external_event_id = $2
        LIMIT 1
      `,
      [channel, externalEventId],
    );
    return result.rows[0] ? webhookDeliveryFromRow(result.rows[0]) : undefined;
  }

  private async updateWebhookDelivery(
    channel: WebhookDeliveryChannel,
    externalEventId: string,
    status: WebhookDelivery['status'],
    lastError: string | null,
  ): Promise<WebhookDelivery> {
    const result = await this.db.query<WebhookDeliveryRow>(
      `
        UPDATE webhook_deliveries
        SET status = $3,
            processed_at = CASE WHEN $3 = 'processed' THEN NOW() ELSE processed_at END,
            failed_at = CASE WHEN $3 = 'failed' THEN NOW() ELSE failed_at END,
            last_error = $4,
            updated_at = NOW()
        WHERE channel = $1 AND external_event_id = $2
        RETURNING *
      `,
      [channel, externalEventId, status, lastError],
    );
    const row = result.rows[0];
    if (!row) throw new Error(`Webhook delivery not found: ${channel}:${externalEventId}`);
    return webhookDeliveryFromRow(row);
  }

  async updateTurnDeliveryStatus(
    turnId: string,
    deliveryStatus: ConversationTurn['deliveryStatus'],
    externalMessageId: string | null,
  ): Promise<ConversationTurn> {
    const result = await this.db.query<ConversationTurnRow>(
      `
        UPDATE conversation_turns
        SET delivery_status = $2, external_message_id = $3
        WHERE id = $1
        RETURNING *
      `,
      [turnId, deliveryStatus, externalMessageId],
    );
    const row = result.rows[0];
    if (!row) throw new Error(`Conversation turn not found: ${turnId}`);
    return turnFromRow(row);
  }

  async getSessionControl(sessionId: string): Promise<SessionControl> {
    const result = await this.db.query<SessionControlRow>(
      `
        SELECT *
        FROM session_controls
        WHERE session_id = $1
        LIMIT 1
      `,
      [sessionId],
    );
    return result.rows[0] ? sessionControlFromRow(result.rows[0]) : defaultSessionControl(sessionId);
  }

  async setSessionControl(
    sessionId: string,
    patch: { agentMode: AgentMode; assignedAgentId?: string | null },
  ): Promise<SessionControl> {
    const current = await this.getSessionControl(sessionId);
    const assignedAgentId = patch.assignedAgentId === undefined ? current.assignedAgentId : patch.assignedAgentId;
    const result = await this.db.query<SessionControlRow>(
      `
        INSERT INTO session_controls (session_id, agent_mode, assigned_agent_id, updated_at)
        VALUES ($1, $2, $3, NOW())
        ON CONFLICT (session_id) DO UPDATE SET
          agent_mode = EXCLUDED.agent_mode,
          assigned_agent_id = EXCLUDED.assigned_agent_id,
          updated_at = EXCLUDED.updated_at
        RETURNING *
      `,
      [sessionId, patch.agentMode, assignedAgentId],
    );
    const row = result.rows[0];
    if (!row) throw new Error(`Failed to update session control: ${sessionId}`);
    return sessionControlFromRow(row);
  }

  async listTurns(sessionId: string): Promise<ConversationTurn[]> {
    const result = await this.db.query<ConversationTurnRow>(
      `
        SELECT *
        FROM conversation_turns
        WHERE session_id = $1
        ORDER BY created_at ASC, id ASC
      `,
      [sessionId],
    );
    return result.rows.map(turnFromRow);
  }

  async appendEvent(sessionId: string, sourceType: string, payload: Record<string, unknown>): Promise<StoredEvent> {
    const event: StoredEvent = {
      id: `event_${randomUUID()}`,
      sessionId,
      sourceType,
      payload,
      createdAt: new Date().toISOString(),
    };
    await this.db.query(
      `
        INSERT INTO conversation_events (id, session_id, source_type, payload, created_at)
        VALUES ($1, $2, $3, $4, $5)
      `,
      [event.id, event.sessionId, event.sourceType, JSON.stringify(event.payload), event.createdAt],
    );
    return event;
  }

  async listEvents(sessionId: string): Promise<StoredEvent[]> {
    const result = await this.db.query<StoredEventRow>(
      `
        SELECT *
        FROM conversation_events
        WHERE session_id = $1
        ORDER BY created_at ASC, id ASC
      `,
      [sessionId],
    );
    return result.rows.map(storedEventFromRow);
  }

  async searchHistory(sessionId: string, query: string): Promise<HistorySearchResult[]> {
    const sessionEvents = await this.listEvents(sessionId);
    const lower = query.toLowerCase();
    return sessionEvents
      .filter((event) => typeof event.payload.text === 'string')
      .map((event) => {
        const text = String(event.payload.text).toLowerCase();
        const directHit = text.includes(lower);
        return { ...event, confidence: directHit ? 0.7 : 0 };
      })
      .filter((event) => event.confidence > 0)
      .sort((a, b) => b.confidence - a.confidence);
  }

  async appendDashboardEvent(event: DashboardEvent): Promise<void> {
    await this.db.query(
      `
        INSERT INTO dashboard_events (id, session_id, type, payload, created_at)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (id) DO NOTHING
      `,
      [event.id, event.sessionId, event.type, JSON.stringify(event.payload), event.createdAt],
    );
  }

  async listDashboardEvents(): Promise<DashboardEvent[]> {
    const result = await this.db.query<DashboardEventRow>(`
      SELECT *
      FROM dashboard_events
      ORDER BY event_sequence ASC, created_at ASC, id ASC
    `);
    return result.rows.map(dashboardEventFromRow);
  }
}

export async function createPostgresPersistence(input: { databaseUrl: string }): Promise<{
  pool: Pool;
  store: PostgresStore;
  dashboardEvents: DashboardEvent[];
}> {
  const pool = new Pool({ connectionString: input.databaseUrl });
  const store = new PostgresStore(pool);
  await store.initialize();
  return {
    pool,
    store,
    dashboardEvents: await store.listDashboardEvents(),
  };
}

function normalizeDate(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function turnFromRow(row: ConversationTurnRow): ConversationTurn {
  return {
    id: row.id,
    sessionId: row.session_id,
    channel: row.channel,
    role: row.role,
    text: row.text,
    externalMessageId: row.external_message_id,
    externalUserId: row.external_user_id,
    deliveryStatus: row.delivery_status,
    metadata: row.metadata as ConversationTurn['metadata'],
    createdAt: normalizeDate(row.created_at),
  };
}

function profileFromRow(row: ConversationProfileRow): ConversationProfile {
  return {
    channel: row.channel,
    externalUserId: row.external_user_id,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    profileSource: row.profile_source,
    profileUpdatedAt: normalizeDate(row.profile_updated_at),
  };
}

function storedEventFromRow(row: StoredEventRow): StoredEvent {
  return {
    id: row.id,
    sessionId: row.session_id,
    sourceType: row.source_type,
    payload: row.payload,
    createdAt: normalizeDate(row.created_at),
  };
}

function dashboardEventFromRow(row: DashboardEventRow): DashboardEvent {
  return {
    id: row.id,
    sessionId: row.session_id,
    type: row.type,
    payload: row.payload,
    createdAt: normalizeDate(row.created_at),
  };
}

function nullableDate(value: Date | string | null): string | null {
  return value === null ? null : normalizeDate(value);
}

function webhookDeliveryFromRow(row: WebhookDeliveryRow): WebhookDelivery {
  return {
    channel: row.channel,
    externalEventId: row.external_event_id,
    externalThreadId: row.external_thread_id,
    externalUserId: row.external_user_id,
    sessionId: row.session_id,
    status: row.status,
    payload: row.payload,
    receivedAt: normalizeDate(row.received_at),
    processedAt: nullableDate(row.processed_at),
    failedAt: nullableDate(row.failed_at),
    lastError: row.last_error,
    createdAt: normalizeDate(row.created_at),
    updatedAt: normalizeDate(row.updated_at),
  };
}

function sessionControlFromRow(row: SessionControlRow): SessionControl {
  return {
    sessionId: row.session_id,
    agentMode: row.agent_mode,
    assignedAgentId: row.assigned_agent_id,
    updatedAt: normalizeDate(row.updated_at),
  };
}

function defaultSessionControl(sessionId: string): SessionControl {
  return {
    sessionId,
    agentMode: 'ai_active',
    assignedAgentId: null,
    updatedAt: new Date().toISOString(),
  };
}
