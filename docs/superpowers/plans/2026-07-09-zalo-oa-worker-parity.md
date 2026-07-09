# Zalo OA Worker Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Zalo OA support to the Cloudflare Worker demo runtime with Messenger-parity monitor behavior: live text intake, per-user history, operator deeplinks, and customer display names.

**Architecture:** Keep Messenger and Zalo as transport adapters that normalize channel payloads into shared conversation records. Persist profile/display metadata at the backend boundary so Flutter reads one dashboard API contract and never calls channel APIs directly. Use Worker-compatible D1 migrations and matching in-memory/Postgres store methods so local tests, Worker proof, and the monitor use the same shape.

**Tech Stack:** TypeScript, Fastify, Cloudflare Workers, Cloudflare D1, Postgres, Vitest, Flutter, Dart, Patrol.

## Global Constraints

- Production demo target is the existing Cloudflare Worker runtime, not a local tunnel.
- Zalo OA ID is `4225933857518051795`.
- Zalo webhook URL shape is `<WORKER_URL>/webhooks/zalo`; verify the exact Worker URL before entering it in Zalo Developers.
- Runtime secrets stay in Cloudflare Worker secrets and local `.env`; never commit tokens.
- First launch replies with text only.
- Ingest all practical inbound Zalo event categories, but do not claim to inspect unprocessed image, file, audio, or location contents.
- The monitor must show customer display names for Messenger and Zalo when available; chat IDs are secondary/debug metadata.
- Worker proof must use polling APIs, not SSE.
- Zalo history backfill from before webhook enablement is out of scope unless official APIs are verified; runtime per-user history after webhook enablement is in scope.

---

## File Structure

- Modify `services/kfc-agent-backend/src/domain/types.ts`
  - Add `ConversationAttachment`, `ConversationProfile`, `ConversationTurn.metadata`, and dashboard event payload support through existing `Record<string, unknown>`.
- Modify `services/kfc-agent-backend/src/persistence/memoryStore.ts`
  - Add profile upsert/read methods and preserve turn metadata in memory tests.
- Modify `services/kfc-agent-backend/src/persistence/d1Store.ts`
  - Add Worker-compatible schema for `conversation_profiles` and `metadata` on `conversation_turns`.
- Modify `services/kfc-agent-backend/src/persistence/postgresStore.ts`
  - Mirror the profile and metadata store contract for local Node/Postgres runs.
- Modify `services/kfc-agent-backend/migrations/0001_worker_runtime.sql`
  - Add D1 migration statements for fresh Worker databases.
- Modify `services/kfc-agent-backend/src/channels/conversationEvent.ts`
  - Extend normalized channel events with `platformEventName`, `attachments`, `profile`, `shouldRunAgent`, and `acknowledgementText`.
- Modify `services/kfc-agent-backend/src/channels/zalo.ts`
  - Normalize text and non-text OA webhook events; keep exact raw event metadata; send text through OA API unchanged.
- Modify `services/kfc-agent-backend/src/channels/messenger.ts`
  - Capture profile-friendly names from webhook payload when present and expose a profile lookup client for PSID display names.
- Modify `services/kfc-agent-backend/src/clients/interfaces.ts`
  - Extend `MessengerClient` and `ZaloClient` with `getProfile(userId)`.
- Modify `services/kfc-agent-backend/src/api/routeHandlers.ts`
  - Share webhook processing helpers, persist profiles, handle non-agent events, emit dashboard profile/deeplink data, and add Zalo readiness.
- Modify `services/kfc-agent-backend/src/api/serverOptions.ts`, `src/config/env.ts`, `src/worker.ts`, `.env.example`
  - Wire Zalo and profile-related env values without committing secrets.
- Modify `services/kfc-agent-backend/test/channels/zalo-webhook.test.ts`
  - Add Zalo non-text, duplicate, missing token, and profile tests.
- Modify `services/kfc-agent-backend/test/channels/messenger-webhook.test.ts`
  - Add Messenger profile/display-name regression tests.
- Modify `services/kfc-agent-backend/test/api/health.test.ts`
  - Add `/ready` assertions for independent Zalo readiness.
- Modify `apps/kfc_live_monitor_flutter/lib/features/live_monitor/domain/chat_session.dart`
  - Add `customerId`, optional `avatarUrl`, and deeplink availability state if needed.
- Modify `apps/kfc_live_monitor_flutter/lib/features/live_monitor/data/backend_live_monitor_repository.dart`
  - Prefer backend `displayName`, preserve external ID, and map verified/unavailable deeplinks.
- Modify `apps/kfc_live_monitor_flutter/lib/features/live_monitor/presentation/widgets/session_card.dart`
  - Render display name as primary and ID as secondary only when distinct.
- Modify `apps/kfc_live_monitor_flutter/test/features/live_monitor/data/backend_live_monitor_repository_test.dart`
  - Test Messenger/Zalo display names, history hydration, and deeplink states.
- Modify `apps/kfc_live_monitor_flutter/test/features/live_monitor/presentation/session_card_test.dart`
  - Test visible display name and non-primary chat ID.
- Create: `apps/kfc_live_monitor_flutter/patrol_test/live_monitor_channel_parity_test.dart`
  - Add a focused Patrol proof for Worker-style channel parity: display names, refreshed history, and non-primary chat IDs.
- Modify `services/kfc-agent-backend/README.md`, `docs/deployment/hackathon-free-deploy.md`, `apps/kfc_live_monitor_flutter/README.md`
  - Document Zalo admin setup, secrets, webhook, monitor parity, and proof steps.

---

### Task 1: Shared Conversation Metadata And Profiles

**Files:**
- Modify: `services/kfc-agent-backend/src/domain/types.ts`
- Modify: `services/kfc-agent-backend/src/persistence/memoryStore.ts`
- Modify: `services/kfc-agent-backend/src/persistence/d1Store.ts`
- Modify: `services/kfc-agent-backend/src/persistence/postgresStore.ts`
- Modify: `services/kfc-agent-backend/migrations/0001_worker_runtime.sql`
- Test: `services/kfc-agent-backend/test/persistence/memory-store.test.ts`
- Test: `services/kfc-agent-backend/test/persistence/d1-store.test.ts`

**Interfaces:**
- Produces:
  - `ConversationAttachment`
  - `ConversationTurnMetadata`
  - `ConversationProfile`
  - `ConversationStore.upsertProfile(input: ConversationProfile): Promise<ConversationProfile>`
  - `ConversationStore.getProfile(channel: 'messenger' | 'zalo', externalUserId: string): Promise<ConversationProfile | undefined>`
  - `ConversationTurn.metadata: ConversationTurnMetadata | null`
- Consumes: existing `ConversationTurn`, `ConversationStore`, `D1Store`, `PostgresStore`, `MemoryStore`.

- [ ] **Step 1: Write failing tests for metadata and profiles**

Add this test to `services/kfc-agent-backend/test/persistence/memory-store.test.ts`:

```ts
it('stores turn metadata and channel customer profiles', async () => {
  const store = new MemoryStore();
  await store.upsertProfile({
    channel: 'messenger',
    externalUserId: 'psid_user_1',
    displayName: 'Nguyen An',
    avatarUrl: 'https://graph.local/avatar.jpg',
    profileSource: 'messenger_profile_api',
    profileUpdatedAt: '2026-07-09T00:00:00.000Z',
  });
  await store.appendTurn({
    sessionId: 'messenger:psid_user_1',
    channel: 'messenger',
    role: 'user',
    text: 'Ảnh menu',
    externalMessageId: 'mid_image_1',
    externalUserId: 'psid_user_1',
    deliveryStatus: 'received',
    metadata: {
      platformEventName: 'message',
      attachments: [{ type: 'image', url: 'https://cdn.local/image.jpg', title: 'image.jpg' }],
    },
  });

  await expect(store.getProfile('messenger', 'psid_user_1')).resolves.toMatchObject({
    displayName: 'Nguyen An',
    profileSource: 'messenger_profile_api',
  });
  await expect(store.listTurns('messenger:psid_user_1')).resolves.toEqual([
    expect.objectContaining({
      metadata: {
        platformEventName: 'message',
        attachments: [{ type: 'image', url: 'https://cdn.local/image.jpg', title: 'image.jpg' }],
      },
    }),
  ]);
});
```

Add this test to `services/kfc-agent-backend/test/persistence/d1-store.test.ts`:

```ts
it('persists profile rows and turn metadata in D1', async () => {
  const db = new FakeD1Database();
  const store = new D1Store(db);
  await store.initialize();

  await store.upsertProfile({
    channel: 'zalo',
    externalUserId: 'zalo_user_1',
    displayName: 'Tran Binh',
    avatarUrl: null,
    profileSource: 'zalo_webhook',
    profileUpdatedAt: '2026-07-09T00:00:00.000Z',
  });
  await store.appendTurn({
    sessionId: 'zalo:zalo_user_1',
    channel: 'zalo',
    role: 'user',
    text: '[Zalo image]',
    externalMessageId: 'zalo_image_1',
    externalUserId: 'zalo_user_1',
    deliveryStatus: 'received',
    metadata: {
      platformEventName: 'user_send_image',
      attachments: [{ type: 'image', url: 'https://zalo.local/image.jpg' }],
    },
  });

  expect(await store.getProfile('zalo', 'zalo_user_1')).toMatchObject({
    displayName: 'Tran Binh',
    profileSource: 'zalo_webhook',
  });
  expect((await store.listTurns('zalo:zalo_user_1'))[0]).toMatchObject({
    metadata: {
      platformEventName: 'user_send_image',
      attachments: [{ type: 'image', url: 'https://zalo.local/image.jpg' }],
    },
  });
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
cd services/kfc-agent-backend
npm test -- test/persistence/memory-store.test.ts test/persistence/d1-store.test.ts
```

Expected: FAIL with TypeScript errors for missing `metadata`, `ConversationProfile`, `upsertProfile`, and `getProfile`.

- [ ] **Step 3: Add domain types**

In `services/kfc-agent-backend/src/domain/types.ts`, replace the current `ConversationTurn` definition with:

```ts
export type ConversationAttachmentType = 'image' | 'file' | 'link' | 'sticker' | 'audio' | 'location' | 'unknown';

export interface ConversationAttachment {
  type: ConversationAttachmentType;
  url?: string;
  title?: string;
  mimeType?: string;
  sizeBytes?: number;
  latitude?: number;
  longitude?: number;
  raw?: Record<string, unknown>;
}

export interface ConversationTurnMetadata {
  platformEventName?: string;
  attachments?: ConversationAttachment[];
  rawEvent?: Record<string, unknown>;
}

export interface ConversationProfile {
  channel: Extract<Channel, 'messenger' | 'zalo'>;
  externalUserId: string;
  displayName: string | null;
  avatarUrl: string | null;
  profileSource: 'messenger_webhook' | 'messenger_profile_api' | 'zalo_webhook' | 'zalo_profile_api' | 'manual';
  profileUpdatedAt: string;
}

export interface ConversationTurn {
  id: string;
  sessionId: string;
  channel: Channel;
  role: 'user' | 'assistant' | 'tool' | 'system';
  text: string;
  externalMessageId: string | null;
  externalUserId: string | null;
  deliveryStatus: 'received' | 'pending' | 'sent' | 'failed' | 'not_applicable';
  metadata: ConversationTurnMetadata | null;
  createdAt: string;
}
```

Then update every `appendTurn` and `upsertImportedTurn` call that lacks metadata to pass `metadata: null`.

- [ ] **Step 4: Implement MemoryStore profile and metadata support**

In `services/kfc-agent-backend/src/persistence/memoryStore.ts`:

```ts
import type { ConversationProfile, ConversationTurn } from '../domain/types.js';
```

Add methods to `ConversationStore`:

```ts
upsertProfile(input: ConversationProfile): Promise<ConversationProfile>;
getProfile(
  channel: ConversationProfile['channel'],
  externalUserId: string,
): Promise<ConversationProfile | undefined>;
```

Add storage and implementation:

```ts
private readonly profiles = new Map<string, ConversationProfile>();

async upsertProfile(input: ConversationProfile): Promise<ConversationProfile> {
  this.profiles.set(profileKey(input.channel, input.externalUserId), input);
  return input;
}

async getProfile(
  channel: ConversationProfile['channel'],
  externalUserId: string,
): Promise<ConversationProfile | undefined> {
  return this.profiles.get(profileKey(channel, externalUserId));
}
```

Update `appendEvent` payloads in `appendTurn` and `upsertImportedTurn`:

```ts
metadata: input.metadata,
```

Add helper:

```ts
function profileKey(channel: ConversationProfile['channel'], externalUserId: string): string {
  return `${channel}:${externalUserId}`;
}
```

- [ ] **Step 5: Implement D1 schema and mappings**

In `services/kfc-agent-backend/src/persistence/d1Store.ts`, import `ConversationProfile` and add `metadata` to `ConversationTurnRow`:

```ts
metadata: string | null;
```

Add `ConversationProfileRow`:

```ts
interface ConversationProfileRow {
  channel: ConversationProfile['channel'];
  external_user_id: string;
  display_name: string | null;
  avatar_url: string | null;
  profile_source: ConversationProfile['profileSource'];
  profile_updated_at: string;
}
```

Add schema statements:

```ts
`ALTER TABLE conversation_turns ADD COLUMN metadata TEXT`,
`CREATE TABLE IF NOT EXISTS conversation_profiles (
  channel TEXT NOT NULL,
  external_user_id TEXT NOT NULL,
  display_name TEXT,
  avatar_url TEXT,
  profile_source TEXT NOT NULL,
  profile_updated_at TEXT NOT NULL,
  PRIMARY KEY (channel, external_user_id)
)`,
```

Update insert/select SQL for `conversation_turns` to include `metadata`, binding:

```ts
JSON.stringify(input.metadata ?? null)
```

Add methods:

```ts
async upsertProfile(input: ConversationProfile): Promise<ConversationProfile> {
  await this.db
    .prepare(
      `INSERT INTO conversation_profiles (
        channel, external_user_id, display_name, avatar_url, profile_source, profile_updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(channel, external_user_id) DO UPDATE SET
        display_name = excluded.display_name,
        avatar_url = excluded.avatar_url,
        profile_source = excluded.profile_source,
        profile_updated_at = excluded.profile_updated_at`,
    )
    .bind(input.channel, input.externalUserId, input.displayName, input.avatarUrl, input.profileSource, input.profileUpdatedAt)
    .run();
  return input;
}

async getProfile(
  channel: ConversationProfile['channel'],
  externalUserId: string,
): Promise<ConversationProfile | undefined> {
  const row = await this.db
    .prepare(`SELECT * FROM conversation_profiles WHERE channel = ? AND external_user_id = ? LIMIT 1`)
    .bind(channel, externalUserId)
    .first<ConversationProfileRow>();
  return row ? profileFromRow(row) : undefined;
}
```

Update `turnFromRow`:

```ts
metadata: row.metadata ? JSON.parse(row.metadata) : null,
```

Add:

```ts
function profileFromRow(row: ConversationProfileRow): ConversationProfile {
  return {
    channel: row.channel,
    externalUserId: row.external_user_id,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    profileSource: row.profile_source,
    profileUpdatedAt: row.profile_updated_at,
  };
}
```

- [ ] **Step 6: Implement Postgres schema and mappings**

In `services/kfc-agent-backend/src/persistence/postgresStore.ts`, mirror Step 5 using `jsonb` metadata:

```ts
metadata: Record<string, unknown> | null;
```

Add during `initialize()`:

```ts
await this.db.query(`
  ALTER TABLE conversation_turns
  ADD COLUMN IF NOT EXISTS metadata jsonb
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
```

Add `upsertProfile`, `getProfile`, and row mapping using `$1` parameters equivalent to D1.

- [ ] **Step 7: Update D1 migration SQL**

Append to `services/kfc-agent-backend/migrations/0001_worker_runtime.sql`:

```sql
ALTER TABLE conversation_turns ADD COLUMN metadata TEXT;

CREATE TABLE IF NOT EXISTS conversation_profiles (
  channel TEXT NOT NULL,
  external_user_id TEXT NOT NULL,
  display_name TEXT,
  avatar_url TEXT,
  profile_source TEXT NOT NULL,
  profile_updated_at TEXT NOT NULL,
  PRIMARY KEY (channel, external_user_id)
);
```

- [ ] **Step 8: Run persistence tests**

Run:

```bash
cd services/kfc-agent-backend
npm test -- test/persistence/memory-store.test.ts test/persistence/d1-store.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add services/kfc-agent-backend/src/domain/types.ts \
  services/kfc-agent-backend/src/persistence/memoryStore.ts \
  services/kfc-agent-backend/src/persistence/d1Store.ts \
  services/kfc-agent-backend/src/persistence/postgresStore.ts \
  services/kfc-agent-backend/migrations/0001_worker_runtime.sql \
  services/kfc-agent-backend/test/persistence/memory-store.test.ts \
  services/kfc-agent-backend/test/persistence/d1-store.test.ts
git commit -m "feat: persist channel profiles and turn metadata"
```

---

### Task 2: Zalo Event Normalization And Text-Only Reply Boundary

**Files:**
- Modify: `services/kfc-agent-backend/src/channels/conversationEvent.ts`
- Modify: `services/kfc-agent-backend/src/channels/zalo.ts`
- Test: `services/kfc-agent-backend/test/channels/zalo-webhook.test.ts`

**Interfaces:**
- Consumes: `ConversationAttachment`, `ConversationProfile` from Task 1.
- Produces:
  - `ConversationEvent.attachments`
  - `ConversationEvent.profile`
  - `ConversationEvent.platformEventName`
  - `ConversationEvent.shouldRunAgent`
  - `ConversationEvent.acknowledgementText`

- [ ] **Step 1: Write failing Zalo normalization tests**

Add tests to `services/kfc-agent-backend/test/channels/zalo-webhook.test.ts`:

```ts
it('records a Zalo image event without running order tools', async () => {
  const zaloFetchImpl = vi.fn(async () =>
    new Response(JSON.stringify({ error: 0, message_id: 'zalo_ack_1' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
  const server = buildServer({
    zaloOaId: 'oa_local',
    zaloAccessToken: 'zalo_token_local',
    zaloApiBaseUrl: 'https://zalo.local',
    zaloFetchImpl,
    toolPlanner: new StaticToolPlanner([
      {
        intent: 'ordering',
        entities: { itemText: 'should not run' },
        toolCalls: [{ toolName: 'updateCart', arguments: { itemCode: '20751', quantity: 1 } }],
        responseClaims: [],
      },
    ]),
  });

  const response = await server.inject({
    method: 'POST',
    url: '/webhooks/zalo',
    payload: {
      event_name: 'user_send_image',
      sender: { id: 'zalo_user_1', name: 'Tran Binh' },
      recipient: { id: 'oa_local' },
      message: {
        msg_id: 'zalo_image_1',
        attachments: [{ type: 'image', payload: { url: 'https://zalo.local/image.jpg' } }],
      },
      timestamp: 1783323124608,
    },
  });

  expect(response.statusCode).toBe(200);
  expect(response.json()).toMatchObject({ received: 1, processed: 1, skippedDuplicates: 0, failed: 0 });
  expect(zaloFetchImpl).toHaveBeenCalledOnce();

  const turns = await server.inject({ method: 'GET', url: '/dashboard/sessions/zalo:zalo_user_1/turns' });
  expect(turns.json().turns[0]).toMatchObject({
    role: 'user',
    text: '[Zalo image]',
    externalUserId: 'zalo_user_1',
    metadata: {
      platformEventName: 'user_send_image',
      attachments: [{ type: 'image', url: 'https://zalo.local/image.jpg' }],
    },
  });

  const events = await server.inject({ method: 'GET', url: '/dashboard/events/zalo:zalo_user_1' });
  expect(events.json().events.find((event: { type: string }) => event.type === 'cart_changed')).toBeUndefined();
});

it('normalizes Zalo link, file, sticker, audio, location, follow, and unsupported events', async () => {
  const payloads = [
    { event_name: 'user_send_link', message: { msg_id: 'link_1', text: 'https://kfcvietnam.com.vn' } },
    { event_name: 'user_send_file', message: { msg_id: 'file_1', attachments: [{ type: 'file', payload: { url: 'https://zalo.local/menu.pdf', name: 'menu.pdf' } }] } },
    { event_name: 'user_send_sticker', message: { msg_id: 'sticker_1', attachments: [{ type: 'sticker', payload: { id: 'stk_1' } }] } },
    { event_name: 'user_send_audio', message: { msg_id: 'audio_1', attachments: [{ type: 'audio', payload: { url: 'https://zalo.local/audio.m4a' } }] } },
    { event_name: 'user_send_location', message: { msg_id: 'loc_1', attachments: [{ type: 'location', payload: { latitude: 10.77, longitude: 106.7 } }] } },
    { event_name: 'follow', timestamp: 1783323124608 },
    { event_name: 'future_event', timestamp: 1783323124608 },
  ];

  for (const payload of payloads) {
    const server = buildServer({ zaloOaId: 'oa_local', zaloAccessToken: 'token' });
    const response = await server.inject({
      method: 'POST',
      url: '/webhooks/zalo',
      payload: {
        ...payload,
        sender: { id: 'zalo_user_1', name: 'Tran Binh' },
        recipient: { id: 'oa_local' },
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ received: 1 });
  }
});
```

- [ ] **Step 2: Run Zalo tests and verify failure**

Run:

```bash
cd services/kfc-agent-backend
npm test -- test/channels/zalo-webhook.test.ts
```

Expected: FAIL because `ConversationEvent` lacks metadata/profile fields and non-text events are dropped.

- [ ] **Step 3: Extend `ConversationEvent`**

In `services/kfc-agent-backend/src/channels/conversationEvent.ts`:

```ts
import type { Channel, ConversationAttachment, ConversationProfile } from '../domain/types.js';

export interface ConversationEvent {
  channel: Extract<Channel, 'messenger' | 'zalo' | 'messenger_mock' | 'zalo_mock' | 'web_mock'>;
  externalUserId: string;
  externalThreadId: string;
  text: string;
  eventType: 'message' | 'postback' | 'attachment' | 'follow' | 'unsupported';
  rawEventId: string;
  receivedAt: string;
  platformEventName?: string;
  attachments?: ConversationAttachment[];
  profile?: ConversationProfile;
  shouldRunAgent: boolean;
  acknowledgementText?: string;
  rawEvent?: Record<string, unknown>;
}
```

Update Messenger normalization to set `shouldRunAgent: true`, `platformEventName: 'message'`, `rawEvent`.

- [ ] **Step 4: Replace Zalo webhook schema and attachment parser**

In `services/kfc-agent-backend/src/channels/zalo.ts`, add local helper types and functions:

```ts
const zaloWebhookSchema = z
  .object({
    event_name: z.string(),
    sender: z.object({ id: z.string(), name: z.string().optional(), avatar: z.string().optional() }).passthrough().optional(),
    recipient: z.object({ id: z.string() }).passthrough().optional(),
    message: z
      .object({
        msg_id: z.string().optional(),
        text: z.string().optional(),
        attachments: z.array(z.unknown()).optional(),
      })
      .passthrough()
      .optional(),
    timestamp: z.number().optional(),
  })
  .passthrough();

function attachmentText(eventName: string): string {
  if (eventName.includes('image')) return '[Zalo image]';
  if (eventName.includes('file')) return '[Zalo file]';
  if (eventName.includes('link')) return '[Zalo link]';
  if (eventName.includes('sticker')) return '[Zalo sticker]';
  if (eventName.includes('audio') || eventName.includes('voice')) return '[Zalo audio]';
  if (eventName.includes('location')) return '[Zalo location]';
  if (eventName === 'follow') return '[Zalo follow]';
  return '[Unsupported Zalo event]';
}

function normalizeAttachment(value: unknown): ConversationAttachment {
  const attachment = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const payload = attachment.payload && typeof attachment.payload === 'object'
    ? (attachment.payload as Record<string, unknown>)
    : {};
  const type = typeof attachment.type === 'string' ? attachment.type : 'unknown';
  return {
    type: ['image', 'file', 'link', 'sticker', 'audio', 'location'].includes(type)
      ? (type as ConversationAttachment['type'])
      : 'unknown',
    url: typeof payload.url === 'string' ? payload.url : undefined,
    title: typeof payload.name === 'string' ? payload.name : undefined,
    latitude: typeof payload.latitude === 'number' ? payload.latitude : undefined,
    longitude: typeof payload.longitude === 'number' ? payload.longitude : undefined,
    raw: attachment,
  };
}
```

- [ ] **Step 5: Implement Zalo event normalization**

Update `normalizeZaloWebhook`:

```ts
export function normalizeZaloWebhook(payload: unknown, expectedOaId?: string): ConversationEvent[] {
  const body = zaloWebhookSchema.parse(payload);
  if (expectedOaId && body.recipient?.id && body.recipient.id !== expectedOaId) return [];
  if (!body.sender?.id) return [];

  const timestamp = body.timestamp ?? Date.now();
  const attachments = (body.message?.attachments ?? []).map(normalizeAttachment);
  const text = body.message?.text?.trim();
  const hasText = Boolean(text);
  const eventName = body.event_name;
  const isText = eventName.includes('text') && hasText;
  const isFollow = eventName === 'follow';
  const fallbackText = text ?? attachmentText(eventName);

  return [
    {
      channel: 'zalo',
      externalUserId: body.sender.id,
      externalThreadId: body.sender.id,
      text: fallbackText,
      eventType: isText ? 'message' : isFollow ? 'follow' : attachments.length > 0 ? 'attachment' : 'unsupported',
      rawEventId: body.message?.msg_id ?? `${body.sender.id}:${eventName}:${timestamp}`,
      receivedAt: new Date(timestamp).toISOString(),
      platformEventName: eventName,
      attachments,
      profile: {
        channel: 'zalo',
        externalUserId: body.sender.id,
        displayName: body.sender.name ?? null,
        avatarUrl: body.sender.avatar ?? null,
        profileSource: 'zalo_webhook',
        profileUpdatedAt: new Date(timestamp).toISOString(),
      },
      shouldRunAgent: isText,
      acknowledgementText: isText ? undefined : 'Mình đã nhận được nội dung bạn gửi. Bạn mô tả yêu cầu đặt món bằng tin nhắn chữ giúp mình nhé.',
      rawEvent: body,
    },
  ];
}
```

- [ ] **Step 6: Run Zalo tests**

Run:

```bash
cd services/kfc-agent-backend
npm test -- test/channels/zalo-webhook.test.ts
```

Expected: FAIL until Task 3 route handling persists non-agent events and sends acknowledgement.

- [ ] **Step 7: Leave changes uncommitted for Task 3**

Do not commit after Task 2. The new route-level tests intentionally stay red until Task 3 adds persistence, acknowledgement replies, and readiness behavior.

---

### Task 3: Webhook Processing, Zalo Readiness, And Failure States

**Files:**
- Modify: `services/kfc-agent-backend/src/api/routeHandlers.ts`
- Modify: `services/kfc-agent-backend/src/api/serverOptions.ts`
- Modify: `services/kfc-agent-backend/src/config/env.ts`
- Modify: `services/kfc-agent-backend/src/worker.ts`
- Modify: `services/kfc-agent-backend/.env.example`
- Test: `services/kfc-agent-backend/test/channels/zalo-webhook.test.ts`
- Test: `services/kfc-agent-backend/test/api/health.test.ts`

**Interfaces:**
- Consumes: `ConversationEvent.shouldRunAgent`, `ConversationEvent.acknowledgementText`, `ConversationEvent.profile`, `ConversationTurn.metadata`.
- Produces:
  - `/ready` response body with `checks.zalo`.
  - persisted non-text Zalo turns.
  - failed delivery state for missing Zalo token.

- [ ] **Step 1: Add failing readiness test**

In `services/kfc-agent-backend/test/api/health.test.ts`:

```ts
it('reports Messenger and Zalo readiness independently', async () => {
  const server = buildServer({
    messengerVerifyToken: 'verify',
    messengerPageAccessToken: 'page_token',
    zaloOaId: '4225933857518051795',
    zaloAccessToken: 'zalo_token',
  });

  const response = await server.inject({ method: 'GET', url: '/ready' });

  expect(response.statusCode).toBe(200);
  expect(response.json().checks).toMatchObject({
    messenger: { ok: true, configured: true, required: true },
    zalo: { ok: true, configured: true, required: true },
  });
});

it('keeps Messenger readiness visible when Zalo is missing', async () => {
  const server = buildServer({
    messengerVerifyToken: 'verify',
    messengerPageAccessToken: 'page_token',
  });

  const response = await server.inject({ method: 'GET', url: '/ready' });

  expect(response.statusCode).toBe(503);
  expect(response.json().checks).toMatchObject({
    messenger: { ok: true, configured: true, required: true },
    zalo: { ok: false, configured: false, required: true },
  });
});
```

- [ ] **Step 2: Add failing missing-token Zalo test**

In `services/kfc-agent-backend/test/channels/zalo-webhook.test.ts`:

```ts
it('preserves inbound Zalo transcript when outbound token is missing', async () => {
  const store = new MemoryStore();
  const server = buildServer({
    store,
    zaloOaId: 'oa_local',
    toolPlanner: new StaticToolPlanner([
      { intent: 'ordering', entities: {}, toolCalls: [], responseClaims: [] },
    ]),
    responseComposer: {
      async composeResponse() {
        return 'Dạ KFC hỗ trợ bạn.';
      },
    },
  });

  const response = await server.inject({
    method: 'POST',
    url: '/webhooks/zalo',
    payload: {
      event_name: 'user_send_text',
      sender: { id: 'zalo_user_1', name: 'Tran Binh' },
      recipient: { id: 'oa_local' },
      message: { msg_id: 'zalo_missing_token_1', text: 'Cho mình combo 99K' },
      timestamp: 1783323124608,
    },
  });

  expect(response.statusCode).toBe(200);
  expect(response.json()).toMatchObject({ received: 1, processed: 0, failed: 1 });
  expect(await store.listTurns('zalo:zalo_user_1')).toEqual([
    expect.objectContaining({ role: 'user', text: 'Cho mình combo 99K' }),
    expect.objectContaining({ role: 'assistant', deliveryStatus: 'failed' }),
  ]);
  expect(await store.getWebhookDelivery('zalo', 'zalo_missing_token_1')).toMatchObject({
    status: 'failed',
    lastError: 'missing_zalo_access_token',
  });
});
```

- [ ] **Step 3: Run tests and verify failure**

Run:

```bash
cd services/kfc-agent-backend
npm test -- test/api/health.test.ts test/channels/zalo-webhook.test.ts
```

Expected: FAIL because `checks.zalo` and non-agent/failed delivery handling are incomplete.

- [ ] **Step 4: Add Zalo readiness check**

In `services/kfc-agent-backend/src/api/routeHandlers.ts`, update `ready()`:

```ts
const messenger = checkMessengerConfig(options);
const zalo = checkZaloConfig(options);
const checks = { database, fixtures, messenger, zalo, openai };
```

Add:

```ts
function checkZaloConfig(options: RouteOptions): ReadinessCheckResult {
  const configured = Boolean(options.zaloOaId && options.zaloAccessToken);
  return {
    ok: configured,
    configured,
    required: true,
  };
}
```

- [ ] **Step 5: Extract shared webhook processing helpers**

In `createRouteHandlers`, add helpers:

```ts
async function persistEventProfile(event: ConversationEvent): Promise<void> {
  if (event.profile?.displayName || event.profile?.avatarUrl) {
    await store.upsertProfile(event.profile);
  }
}

function turnMetadataFor(event: ConversationEvent): ConversationTurnMetadata | null {
  if (!event.platformEventName && !event.attachments?.length && !event.rawEvent) return null;
  return {
    platformEventName: event.platformEventName,
    attachments: event.attachments,
    rawEvent: event.rawEvent,
  };
}

async function persistNonAgentInboundEvent(sessionId: string, event: ConversationEvent): Promise<void> {
  await persistEventProfile(event);
  await store.appendTurn({
    sessionId,
    channel: event.channel,
    role: 'user',
    text: event.text,
    externalMessageId: event.rawEventId,
    externalUserId: event.externalUserId,
    deliveryStatus: 'received',
    metadata: turnMetadataFor(event),
  });
}
```

Import `ConversationTurnMetadata` from `../domain/types.js`.

- [ ] **Step 6: Update Zalo webhook loop**

In `zaloWebhook`, after reservation and before agent execution:

```ts
await persistEventProfile(event);

if (!event.shouldRunAgent) {
  await persistNonAgentInboundEvent(sessionId, event);
  clients ??= await createWebhookClients();
  const acknowledgement = event.acknowledgementText;
  if (acknowledgement) {
    const delivery = await deliverAssistantReply({
      clients,
      sessionId,
      externalUserId: event.externalUserId,
      responseText: acknowledgement,
      channel: 'zalo',
    });
    if (!delivery.ok) {
      await store.markWebhookDeliveryFailed('zalo', event.rawEventId, delivery.errorCode ?? 'assistant_reply_delivery_failed');
      stats.failed += 1;
      continue;
    }
  }
  await store.markWebhookDeliveryProcessed('zalo', event.rawEventId);
  stats.processed += 1;
  continue;
}
```

Then call `runAgentTurn` only for `event.shouldRunAgent === true` and pass the metadata into the graph input:

```ts
const output = await runAgentTurn({
  sessionId,
  customerId: event.externalUserId,
  channel: event.channel,
  text: event.text,
  externalMessageId: event.rawEventId,
  metadata: turnMetadataFor(event),
  clients,
  store,
  dashboard,
  responseComposer: options.responseComposer,
  toolPlanner: options.toolPlanner,
});
```

Do not append the inbound text turn before `runAgentTurn`; `runAgentTurn` owns user-turn creation for agent-handled events.

- [ ] **Step 7: Ensure assistant pending turns include metadata**

Find all assistant turn creation inside `runAgentTurn` or graph nodes and add:

```ts
metadata: null,
```

Add optional metadata to `AgentTurnInput` in `services/kfc-agent-backend/src/graph/buildGraph.ts`:

```ts
metadata?: ConversationTurnMetadata | null;
```

Then pass:

```ts
metadata: input.metadata ?? null,
```

Update the `customer_message_received` and `conversation_turn_created` dashboard payloads for the user turn to include:

```ts
metadata: userTurn.metadata,
```

- [ ] **Step 8: Wire env fields**

In `services/kfc-agent-backend/src/config/env.ts`, add:

```ts
ZALO_REFRESH_TOKEN: z.string().optional().default(''),
ZALO_APP_ID: z.string().optional().default(''),
ZALO_APP_SECRET: z.string().optional().default(''),
```

In `.env.example`, add:

```text
ZALO_REFRESH_TOKEN=
ZALO_APP_ID=
ZALO_APP_SECRET=
```

Do not use these refresh values until the official refresh endpoint is verified.

- [ ] **Step 9: Run backend webhook/readiness tests**

Run:

```bash
cd services/kfc-agent-backend
npm test -- test/api/health.test.ts test/channels/zalo-webhook.test.ts test/channels/messenger-webhook.test.ts
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add services/kfc-agent-backend/src/api/routeHandlers.ts \
  services/kfc-agent-backend/src/api/serverOptions.ts \
  services/kfc-agent-backend/src/config/env.ts \
  services/kfc-agent-backend/src/worker.ts \
  services/kfc-agent-backend/.env.example \
  services/kfc-agent-backend/test/api/health.test.ts \
  services/kfc-agent-backend/test/channels/zalo-webhook.test.ts \
  services/kfc-agent-backend/test/channels/messenger-webhook.test.ts
git commit -m "feat: process Zalo webhooks with readiness"
```

---

### Task 4: Channel Profiles, Display Names, And Deeplink API Data

**Files:**
- Modify: `services/kfc-agent-backend/src/clients/interfaces.ts`
- Modify: `services/kfc-agent-backend/src/channels/messenger.ts`
- Modify: `services/kfc-agent-backend/src/channels/zalo.ts`
- Modify: `services/kfc-agent-backend/src/api/routeHandlers.ts`
- Test: `services/kfc-agent-backend/test/channels/messenger-webhook.test.ts`
- Test: `services/kfc-agent-backend/test/channels/zalo-webhook.test.ts`

**Interfaces:**
- Consumes: profile persistence from Task 1.
- Produces dashboard sessions:
  - `displayName: string | null`
  - `externalUserId: string | null`
  - `avatarUrl: string | null`
  - `deeplink: { status: 'available' | 'unavailable'; url: string | null; reason?: string }`

- [ ] **Step 1: Add failing dashboard session profile tests**

In `services/kfc-agent-backend/test/channels/messenger-webhook.test.ts`:

```ts
it('uses Messenger profile name in dashboard session summaries', async () => {
  const messengerFetchImpl = vi.fn(async (url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    if (String(url).includes('/psid_user_1')) {
      return new Response(JSON.stringify({ first_name: 'Nguyen', last_name: 'An', profile_pic: 'https://graph.local/a.jpg' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ message_id: 'reply_1' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  const server = buildServer({
    messengerVerifyToken: 'verify',
    metaPageId: '118976205445198',
    messengerPageAccessToken: 'page_token',
    messengerGraphApiBaseUrl: 'https://graph.local',
    messengerFetchImpl,
  });

  await server.inject({
    method: 'POST',
    url: '/webhooks/messenger',
    payload: {
      object: 'page',
      entry: [{ id: '118976205445198', messaging: [{ sender: { id: 'psid_user_1' }, recipient: { id: '118976205445198' }, message: { mid: 'mid_profile', text: 'Hi' } }] }],
    },
  });

  const sessions = await server.inject({ method: 'GET', url: '/dashboard/sessions' });
  expect(sessions.json().sessions[0]).toMatchObject({
    sessionId: 'messenger:psid_user_1',
    displayName: 'Nguyen An',
    externalUserId: 'psid_user_1',
    avatarUrl: 'https://graph.local/a.jpg',
    deeplink: { status: 'unavailable', url: null, reason: 'messenger_deeplink_unverified' },
  });
});
```

In `services/kfc-agent-backend/test/channels/zalo-webhook.test.ts`:

```ts
it('uses Zalo webhook sender name in dashboard session summaries', async () => {
  const server = buildServer({ zaloOaId: 'oa_local', zaloAccessToken: 'token' });
  await server.inject({
    method: 'POST',
    url: '/webhooks/zalo',
    payload: {
      event_name: 'user_send_text',
      sender: { id: 'zalo_user_1', name: 'Tran Binh', avatar: 'https://zalo.local/b.jpg' },
      recipient: { id: 'oa_local' },
      message: { msg_id: 'zalo_profile_1', text: 'Hi' },
      timestamp: 1783323124608,
    },
  });

  const sessions = await server.inject({ method: 'GET', url: '/dashboard/sessions' });
  expect(sessions.json().sessions[0]).toMatchObject({
    sessionId: 'zalo:zalo_user_1',
    displayName: 'Tran Binh',
    externalUserId: 'zalo_user_1',
    avatarUrl: 'https://zalo.local/b.jpg',
    deeplink: { status: 'unavailable', url: null, reason: 'zalo_deeplink_unverified' },
  });
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
cd services/kfc-agent-backend
npm test -- test/channels/messenger-webhook.test.ts test/channels/zalo-webhook.test.ts
```

Expected: FAIL because profile lookup and dashboard session fields are absent.

- [ ] **Step 3: Extend channel clients**

In `services/kfc-agent-backend/src/clients/interfaces.ts`:

```ts
export interface ChannelUserProfile {
  displayName: string | null;
  avatarUrl: string | null;
  profileSource: ConversationProfile['profileSource'];
}

export interface MessengerClient {
  sendText(recipientId: string, text: string): Promise<ToolResult<{ messageId: string }>>;
  getProfile(recipientId: string): Promise<ToolResult<ChannelUserProfile>>;
}

export interface ZaloClient {
  sendText(recipientId: string, text: string): Promise<ToolResult<{ messageId: string }>>;
  getProfile(recipientId: string): Promise<ToolResult<ChannelUserProfile>>;
}
```

Import `ConversationProfile` from `domain/types`.

- [ ] **Step 4: Implement Messenger profile lookup**

In `createMessengerClient`, add:

```ts
async getProfile(recipientId) {
  if (!input.pageAccessToken) {
    return { ok: false, errorCode: 'missing_page_access_token', message: 'Messenger page access token is not configured' };
  }
  try {
    const response = await fetchImpl(
      `${graphApiBaseUrl}/${recipientId}?fields=first_name,last_name,profile_pic&access_token=${input.pageAccessToken}`,
    );
    const body = (await response.json()) as { first_name?: string; last_name?: string; profile_pic?: string; error?: { message?: string } };
    if (!response.ok || body.error) {
      return { ok: false, errorCode: 'messenger_profile_failed', message: body.error?.message ?? 'Messenger profile lookup failed' };
    }
    const displayName = [body.first_name, body.last_name].filter(Boolean).join(' ').trim() || null;
    return { ok: true, value: { displayName, avatarUrl: body.profile_pic ?? null, profileSource: 'messenger_profile_api' }, message: 'ok' };
  } catch (error) {
    return { ok: false, errorCode: 'messenger_profile_failed', message: error instanceof Error ? error.message : 'Messenger profile lookup failed' };
  }
}
```

- [ ] **Step 5: Implement Zalo profile fallback**

In `createZaloClient`, add:

```ts
async getProfile(_recipientId) {
  return {
    ok: false,
    errorCode: 'zalo_profile_lookup_not_configured',
    message: 'Zalo profile lookup is not configured; webhook sender profile is used when available',
  };
}
```

Do not guess a Zalo profile endpoint in this task.

- [ ] **Step 6: Persist profile during webhook processing**

In `routeHandlers.ts`, after reserving a Messenger event and before `runAgentTurn`, call:

```ts
const profileResult = await clients.messenger.getProfile(event.externalUserId);
if (profileResult.ok) {
  await store.upsertProfile({
    channel: 'messenger',
    externalUserId: event.externalUserId,
    displayName: profileResult.value.displayName,
    avatarUrl: profileResult.value.avatarUrl,
    profileSource: profileResult.value.profileSource,
    profileUpdatedAt: new Date().toISOString(),
  });
}
```

For Zalo, `event.profile` is already persisted by Task 3.

- [ ] **Step 7: Add dashboard session fields**

In `dashboardSessions()`, change summaries to enrich each session:

```ts
async dashboardSessions() {
  const summaries = await Promise.all(
    dashboard.listSessionSummaries().map(async (summary) => {
      const [channel, externalUserId] = summary.sessionId.split(':', 2);
      const profile =
        channel === 'messenger' || channel === 'zalo'
          ? await store.getProfile(channel, externalUserId)
          : undefined;
      return {
        ...summary,
        externalUserId,
        displayName: profile?.displayName ?? null,
        avatarUrl: profile?.avatarUrl ?? null,
        deeplink: deeplinkForSession(summary.sessionId),
      };
    }),
  );
  return { status: 200, body: { sessions: summaries } };
}
```

Update `RouteHandlers.dashboardSessions` return type to `Promise<HandlerResponse>` and update Fastify/Worker route callers to `await`.

Add:

```ts
function deeplinkForSession(sessionId: string): { status: 'available' | 'unavailable'; url: string | null; reason?: string } {
  if (sessionId.startsWith('messenger:')) {
    return { status: 'unavailable', url: null, reason: 'messenger_deeplink_unverified' };
  }
  if (sessionId.startsWith('zalo:')) {
    return { status: 'unavailable', url: null, reason: 'zalo_deeplink_unverified' };
  }
  return { status: 'unavailable', url: null, reason: 'unknown_channel' };
}
```

- [ ] **Step 8: Run channel profile tests**

Run:

```bash
cd services/kfc-agent-backend
npm test -- test/channels/messenger-webhook.test.ts test/channels/zalo-webhook.test.ts test/api/health.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add services/kfc-agent-backend/src/clients/interfaces.ts \
  services/kfc-agent-backend/src/channels/messenger.ts \
  services/kfc-agent-backend/src/channels/zalo.ts \
  services/kfc-agent-backend/src/api/routeHandlers.ts \
  services/kfc-agent-backend/test/channels/messenger-webhook.test.ts \
  services/kfc-agent-backend/test/channels/zalo-webhook.test.ts
git commit -m "feat: expose channel display profiles"
```

---

### Task 5: Flutter Monitor Display Names, History, And Deeplink States

**Files:**
- Modify: `apps/kfc_live_monitor_flutter/lib/features/live_monitor/domain/chat_session.dart`
- Modify: `apps/kfc_live_monitor_flutter/lib/features/live_monitor/data/backend_live_monitor_repository.dart`
- Modify: `apps/kfc_live_monitor_flutter/lib/features/live_monitor/presentation/widgets/session_card.dart`
- Test: `apps/kfc_live_monitor_flutter/test/features/live_monitor/data/backend_live_monitor_repository_test.dart`
- Test: `apps/kfc_live_monitor_flutter/test/features/live_monitor/presentation/session_card_test.dart`

**Interfaces:**
- Consumes backend `/dashboard/sessions` fields from Task 4.
- Produces monitor UI model with customer display name primary and external user ID secondary.

- [ ] **Step 1: Write failing repository tests**

In `backend_live_monitor_repository_test.dart`, update the first test session JSON:

```dart
'{"sessions":[{"sessionId":"messenger:psid_user_1","displayName":"Nguyen An","externalUserId":"psid_user_1","avatarUrl":"https://graph.local/a.jpg","deeplink":{"status":"unavailable","url":null,"reason":"messenger_deeplink_unverified"},"latestEventType":"payment_failed","updatedAt":"2026-07-07T00:00:00.000Z"}]}'
```

Change assertions:

```dart
expect(sessions.single.customerName, 'Nguyen An');
expect(sessions.single.customerId, 'psid_user_1');
expect(sessions.single.avatarUrl, 'https://graph.local/a.jpg');
expect(sessions.single.deeplink.status, DeeplinkStatus.unavailable);
expect(sessions.single.deeplink.reason, 'messenger_deeplink_unverified');
```

Add a Zalo test:

```dart
test('backend repository maps Zalo display names and history', () async {
  final repository = BackendLiveMonitorRepository(
    baseUrl: 'http://localhost:18090',
    client: MockClient((request) async {
      final path = request.url.path;
      if (path == '/dashboard/sessions') {
        return jsonResponse(
          '{"sessions":[{"sessionId":"zalo:zalo_user_1","displayName":"Tran Binh","externalUserId":"zalo_user_1","avatarUrl":null,"deeplink":{"status":"unavailable","url":null,"reason":"zalo_deeplink_unverified"},"latestEventType":"assistant_reply_sent","updatedAt":"2026-07-09T00:00:00.000Z"}]}',
        );
      }
      if (path == '/dashboard/sessions/zalo%3Azalo_user_1/turns') {
        return jsonResponse(
          '{"turns":[{"role":"user","text":"Cho mình combo 99K","channel":"zalo","externalUserId":"zalo_user_1"},{"role":"assistant","text":"Dạ mình hỗ trợ bạn.","channel":"zalo","externalUserId":"zalo_user_1"}]}',
        );
      }
      if (path == '/dashboard/events/zalo%3Azalo_user_1') {
        return jsonResponse('{"events":[{"type":"assistant_reply_sent","payload":{"deliveryStatus":"sent"}}]}');
      }
      return http.Response('not found', 404);
    }),
  );

  final sessions = await repository.loadSessions();

  expect(sessions.single.customerName, 'Tran Binh');
  expect(sessions.single.customerId, 'zalo_user_1');
  expect(sessions.single.channel, ChatChannel.zalo);
  expect(sessions.single.turns.map((turn) => turn.message), ['Cho mình combo 99K', 'Dạ mình hỗ trợ bạn.']);
});
```

- [ ] **Step 2: Write failing presentation test**

In `session_card_test.dart`, add:

```dart
testWidgets('session card shows display name before chat id', (tester) async {
  final session = ChatSession(
    id: 'messenger:psid_user_1',
    customerId: 'psid_user_1',
    customerName: 'Nguyen An',
    channel: ChatChannel.messenger,
    severity: SessionSeverity.normal,
    status: SessionStatus.aiHandling,
    orderState: OrderState.collectingInfo,
    lastActivityLabel: 'Live',
    orderLabel: 'Order',
    confidencePercent: 92,
    riskLabel: 'Low',
    deeplink: const ChatDeeplink.unavailable(reason: 'messenger_deeplink_unverified'),
    turns: const [ChatTurn(speaker: 'User', message: 'Hi')],
  );

  await tester.pumpWidget(
    TestApp(
      child: SizedBox(
        width: 420,
        height: 720,
        child: SessionCard(session: session, onOpenSession: () {}),
      ),
    ),
  );

  expect(find.text('Nguyen An'), findsOneWidget);
  expect(find.text('psid_user_1'), findsNothing);
});
```

- [ ] **Step 3: Run Flutter tests and verify failure**

Run:

```bash
cd apps/kfc_live_monitor_flutter
flutter test test/features/live_monitor/data/backend_live_monitor_repository_test.dart \
  test/features/live_monitor/presentation/session_card_test.dart
```

Expected: FAIL because `customerId`, `avatarUrl`, and typed deeplink state are absent.

- [ ] **Step 4: Extend domain model**

In `chat_session.dart`, add:

```dart
enum DeeplinkStatus { available, unavailable }

class ChatDeeplink {
  const ChatDeeplink.available(this.url)
    : status = DeeplinkStatus.available,
      reason = null;

  const ChatDeeplink.unavailable({required this.reason})
    : status = DeeplinkStatus.unavailable,
      url = null;

  final DeeplinkStatus status;
  final String? url;
  final String? reason;
}
```

Update `ChatSession` constructor and fields:

```dart
required this.customerId,
required this.deeplink,
this.avatarUrl,
```

```dart
final String customerId;
final String? avatarUrl;
final ChatDeeplink deeplink;
```

Replace existing `final String deeplink;`.

- [ ] **Step 5: Update backend repository mapping**

In `backend_live_monitor_repository.dart`, update `ChatSession` construction:

```dart
final summaryMap = _asMap(summary);
...
customerId: _asString(summaryMap['externalUserId']).isEmpty
    ? sessionId
    : _asString(summaryMap['externalUserId']),
customerName: _displayNameFor(sessionId, turns, summaryMap),
avatarUrl: _nullableString(summaryMap['avatarUrl']),
deeplink: _deeplinkFor(summaryMap['deeplink']),
```

Add:

```dart
String _displayNameFor(String sessionId, List<Object?> turns, Map<String, dynamic> summary) {
  final displayName = _asString(summary['displayName']);
  if (displayName.isNotEmpty) return displayName;
  for (final turn in turns.reversed) {
    final externalUserId = _asString(_asMap(turn)['externalUserId']);
    if (externalUserId.isNotEmpty) return externalUserId;
  }
  return sessionId;
}

String? _nullableString(Object? value) {
  final text = _asString(value);
  return text.isEmpty ? null : text;
}

ChatDeeplink _deeplinkFor(Object? value) {
  final map = _asMap(value);
  final status = _asString(map['status']);
  final url = _nullableString(map['url']);
  if (status == 'available' && url != null) return ChatDeeplink.available(url);
  return ChatDeeplink.unavailable(reason: _asString(map['reason']).isEmpty ? 'deeplink_unavailable' : _asString(map['reason']));
}
```

Keep `_customerNameFor` only if no callers remain; otherwise replace callers with `_displayNameFor`.

- [ ] **Step 6: Update mock repository call sites**

Find all `ChatSession(` in `apps/kfc_live_monitor_flutter/lib` and `apps/kfc_live_monitor_flutter/test`:

```bash
cd apps/kfc_live_monitor_flutter
rg -n "ChatSession\\(" lib test patrol_test
```

For every fixture, add:

```dart
customerId: '<existing-session-user-id>',
deeplink: const ChatDeeplink.unavailable(reason: 'mock_deeplink'),
```

Convert current mock deeplink strings to typed available deeplinks:

```dart
deeplink: const ChatDeeplink.available('mockchat://messenger/session-payment-nguyen-a'),
```

- [ ] **Step 7: Update session card display**

In `session_card.dart`, keep primary display as `session.customerName`. Do not render `session.customerId` in `_CardHeader`.

Update `_OpenChatButton` to receive `ChatDeeplink deeplink` and `VoidCallback onPressed`:

```dart
_OpenChatButton(
  key: LiveMonitorKeys.sessionOpenChatButton(session.id),
  deeplink: session.deeplink,
  onPressed: onOpenSession,
),
```

Replace `_OpenChatButton` with:

```dart
class _OpenChatButton extends StatelessWidget {
  const _OpenChatButton({
    super.key,
    required this.deeplink,
    required this.onPressed,
  });

  final ChatDeeplink deeplink;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    final enabled = deeplink.status == DeeplinkStatus.available;
    final button = Semantics(
      button: true,
      enabled: enabled,
      label: enabled ? 'Open chat' : 'Chat link unavailable',
      child: MouseRegion(
        cursor: enabled ? SystemMouseCursors.click : SystemMouseCursors.basic,
        child: GestureDetector(
          behavior: HitTestBehavior.opaque,
          onTap: enabled ? onPressed : null,
          child: DecoratedBox(
            decoration: BoxDecoration(
              color: KfcOpsTokens.surfaceContainerLowest,
              border: Border.all(color: KfcOpsTokens.secondaryContainer),
              borderRadius: const BorderRadius.all(KfcOpsTokens.radiusMd),
            ),
            child: SizedBox(
              width: 96,
              height: 32,
              child: Center(
                child: FittedBox(
                  fit: BoxFit.scaleDown,
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(
                        LucideIcons.externalLink,
                        size: 14,
                        color: enabled ? KfcOpsTokens.onSurface : KfcOpsTokens.secondary,
                      ),
                      const SizedBox(width: KfcOpsTokens.spacingXs),
                      Text(
                        'Open chat',
                        style: TextStyle(
                          color: enabled ? KfcOpsTokens.onSurface : KfcOpsTokens.secondary,
                          fontSize: 11,
                          fontWeight: FontWeight.w600,
                          height: 14 / 11,
                          letterSpacing: 0,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
    if (enabled) return button;
    return Tooltip(message: deeplink.reason ?? 'Chat link unavailable', child: button);
  }
}
```

- [ ] **Step 8: Run Flutter tests**

Run:

```bash
cd apps/kfc_live_monitor_flutter
flutter test test/features/live_monitor/data/backend_live_monitor_repository_test.dart \
  test/features/live_monitor/presentation/session_card_test.dart
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/kfc_live_monitor_flutter/lib/features/live_monitor/domain/chat_session.dart \
  apps/kfc_live_monitor_flutter/lib/features/live_monitor/data/backend_live_monitor_repository.dart \
  apps/kfc_live_monitor_flutter/lib/features/live_monitor/presentation/widgets/session_card.dart \
  apps/kfc_live_monitor_flutter/test/features/live_monitor/data/backend_live_monitor_repository_test.dart \
  apps/kfc_live_monitor_flutter/test/features/live_monitor/presentation/session_card_test.dart \
  apps/kfc_live_monitor_flutter/lib/features/live_monitor/data/mock_live_monitor_repository.dart \
  apps/kfc_live_monitor_flutter/test/features/live_monitor/application/live_monitor_controller_test.dart \
  apps/kfc_live_monitor_flutter/test/features/live_monitor/data/mock_live_monitor_repository_test.dart
git commit -m "feat: show channel customer names in monitor"
```

---

### Task 6: Worker Docs, Zalo Admin Checklist, And UI Proof Harness

**Files:**
- Modify: `services/kfc-agent-backend/README.md`
- Modify: `docs/deployment/hackathon-free-deploy.md`
- Modify: `apps/kfc_live_monitor_flutter/README.md`
- Modify: `apps/kfc_live_monitor_flutter/patrol_test/live_monitor_message_history_test.dart`
- Test: `tests/deployment/deploy_scripts.test.sh`

**Interfaces:**
- Consumes all previous tasks.
- Produces repeatable admin setup/proof instructions and monitor UI proof coverage.

- [ ] **Step 1: Add failing deployment docs test**

In `tests/deployment/deploy_scripts.test.sh`, add:

```bash
grep -q "webhooks/zalo" "$ROOT_DIR/docs/deployment/hackathon-free-deploy.md"
grep -q "ZALO_OA_ID" "$ROOT_DIR/docs/deployment/hackathon-free-deploy.md"
grep -q "4225933857518051795" "$ROOT_DIR/docs/deployment/hackathon-free-deploy.md"
grep -q "customer display name" "$ROOT_DIR/docs/deployment/hackathon-free-deploy.md"
```

- [ ] **Step 2: Run deployment docs test and verify failure**

Run:

```bash
bash tests/deployment/deploy_scripts.test.sh
```

Expected: FAIL because the deployment doc does not yet include Zalo setup.

- [ ] **Step 3: Update backend README**

In `services/kfc-agent-backend/README.md`, update `Messenger And Zalo` with:

```markdown
## Messenger And Zalo

Messenger and Zalo adapters are transport boundaries. They normalize inbound channel payloads into the same graph input used by scenario replay and persist profile/display metadata for the live monitor.

- Messenger setup uses Page ID `118976205445198`.
- Zalo setup uses OA ID `4225933857518051795`.
- `GET /webhooks/messenger` handles Meta verification with `MESSENGER_VERIFY_TOKEN`.
- `POST /webhooks/messenger` accepts Page webhook deliveries.
- `POST /webhooks/zalo` accepts Zalo OA webhook deliveries.
- Zalo text messages run the agent and receive text replies.
- Zalo image, file, link, sticker, audio, location, follow, and unsupported events are recorded into transcript history. The first launch replies with text only and does not inspect unprocessed media contents.
- The dashboard session summary includes `displayName`, `externalUserId`, `avatarUrl`, and a typed `deeplink` state for both Messenger and Zalo.
- Local tests use fixture payloads and do not require live channel credentials.
```

- [ ] **Step 4: Update Cloudflare deployment doc**

In `docs/deployment/hackathon-free-deploy.md`, add a `Zalo OA Setup` section:

````markdown
## Zalo OA Setup

Use the stable Worker URL, not a tunnel:

```text
<WORKER_URL>/webhooks/zalo
```

Confirmed OA:

```text
OA name: Công ty Cp Dd Thương Mại Điện Tử
OA ID: 4225933857518051795
```

Admin checklist:

1. Open Zalo Developers as the OA admin.
2. Create a Zalo Developer app because the inspected account currently had `0/100` apps.
3. Link or authorize the app for OA `4225933857518051795`.
4. Generate an OA access token for the app/OA pair.
5. Configure the app webhook URL to `<WORKER_URL>/webhooks/zalo`.
6. Enable OA customer-message webhook events.
7. Add Worker secrets:

```bash
npx wrangler secret put ZALO_OA_ID
npx wrangler secret put ZALO_ACCESS_TOKEN
```

Use `4225933857518051795` for `ZALO_OA_ID`. If Zalo provides refresh credentials, store them as secrets too:

```bash
npx wrangler secret put ZALO_REFRESH_TOKEN
npx wrangler secret put ZALO_APP_ID
npx wrangler secret put ZALO_APP_SECRET
```

Do not commit any token value.

Required Zalo smoke proof:

```bash
curl -s <WORKER_URL>/health
curl -s <WORKER_URL>/ready
```

Then send a real Zalo message to the OA and verify:

```bash
curl -s <WORKER_URL>/dashboard/sessions
curl -s <WORKER_URL>/dashboard/sessions/zalo%3A<zalo-user-id>/turns
curl -s <WORKER_URL>/dashboard/events/zalo%3A<zalo-user-id>
```

The monitor dashboard must show the customer display name for Messenger and Zalo when available. A chat ID alone is not acceptable as the primary customer label.
````

- [ ] **Step 5: Update Flutter README**

In `apps/kfc_live_monitor_flutter/README.md`, add:

```markdown
## Channel Parity Proof

The live monitor must verify these behaviors for both Messenger and Zalo:

- live text intake appears without app restart through Worker-backed polling;
- per-user history hydrates from `/dashboard/sessions/:sessionId/turns`;
- customer display name is primary and chat ID is secondary/debug context;
- open-chat action uses a verified platform deeplink or shows an unavailable state.
```

- [ ] **Step 6: Add Patrol channel parity proof**

Create `apps/kfc_live_monitor_flutter/patrol_test/live_monitor_channel_parity_test.dart`:

```dart
import 'test_app.dart';

void main() {
testApp(
  'monitor shows channel display names and refreshed history',
  ($, modules, system, apiClients) async {
    await modules.liveMonitor.waitForHistorySession();
    await modules.liveMonitor.waitForPersistedHistory();

    apiClients.liveMonitorHistory.emitZaloSessionWithDisplayName();
    await modules.liveMonitor.waitForZaloDisplayName();
    await modules.liveMonitor.waitForZaloPersistedHistory();

    apiClients.liveMonitorHistory.emitMessengerSessionWithDisplayName();
    await modules.liveMonitor.waitForMessengerDisplayName();
    await modules.liveMonitor.expectChatIdNotPrimary();
  },
);
}
```

Implement helper methods in `patrol_test/modules/live_monitor.dart` and `patrol_test/api_clients/live_monitor_history_client.dart` using the same fake backend pattern already used by `emitRefreshedHistory()`.

- [ ] **Step 7: Run docs and monitor proof tests**

Run:

```bash
bash tests/deployment/deploy_scripts.test.sh
cd apps/kfc_live_monitor_flutter
flutter test test/features/live_monitor/data/backend_live_monitor_repository_test.dart \
  test/features/live_monitor/presentation/session_card_test.dart
```

Expected: PASS.

Run Patrol when an iOS simulator is available:

```bash
cd apps/kfc_live_monitor_flutter
patrol test -t patrol_test/live_monitor_channel_parity_test.dart -d <ios-simulator-id>
```

Expected: PASS with display-name and history assertions.

- [ ] **Step 8: Commit**

```bash
git add services/kfc-agent-backend/README.md \
  docs/deployment/hackathon-free-deploy.md \
  apps/kfc_live_monitor_flutter/README.md \
  apps/kfc_live_monitor_flutter/patrol_test/live_monitor_message_history_test.dart \
  apps/kfc_live_monitor_flutter/patrol_test/live_monitor_channel_parity_test.dart \
  apps/kfc_live_monitor_flutter/patrol_test/modules/live_monitor.dart \
  apps/kfc_live_monitor_flutter/patrol_test/api_clients/live_monitor_history_client.dart \
  tests/deployment/deploy_scripts.test.sh
git commit -m "docs: add Zalo OA setup and monitor proof"
```

---

### Task 7: Final Verification And Live Setup Gate

**Files:**
- No planned source modifications.
- Produce proof artifacts under `artifacts/kfc-ai-chat-ordering/proof/<timestamp>/` if running live proof.

**Interfaces:**
- Consumes completed Tasks 1-6.
- Produces a verified readiness report and blocks live Zalo admin changes until credentials are available.

- [ ] **Step 1: Run full backend verification**

```bash
cd services/kfc-agent-backend
npm test
npm run build
```

Expected: PASS.

- [ ] **Step 2: Run Flutter verification**

```bash
cd apps/kfc_live_monitor_flutter
flutter test
```

Expected: PASS.

- [ ] **Step 3: Run deployment docs verification**

```bash
bash tests/deployment/deploy_scripts.test.sh
```

Expected: PASS.

- [ ] **Step 4: Verify Worker deploy readiness locally**

```bash
cd services/kfc-agent-backend
npm run worker:deploy:dry-run
```

Expected: Wrangler dry-run succeeds.

- [ ] **Step 5: Live admin gate**

Before changing Zalo admin settings, confirm these values are known:

```text
WORKER_URL=<exact deployed Cloudflare Worker URL>
ZALO_OA_ID=4225933857518051795
ZALO_ACCESS_TOKEN=<secret value available but not printed>
```

Do not proceed with Zalo admin changes if `WORKER_URL` or `ZALO_ACCESS_TOKEN` is missing.

- [ ] **Step 6: Live proof commands after admin setup**

```bash
curl -s "$WORKER_URL/health"
curl -s "$WORKER_URL/ready"
curl -s "$WORKER_URL/dashboard/sessions"
```

Expected:

```text
/health returns ok true
/ready has checks.zalo.ok true and checks.messenger remains visible
/dashboard/sessions includes a zalo:<user> session after a real OA message
```

- [ ] **Step 7: Capture monitor UI proof**

Run the deployed or local monitor against `KFC_AGENT_BACKEND_URL=$WORKER_URL`. Capture evidence that:

```text
Zalo session shows display name as primary label
Messenger session shows display name as primary label
Zalo turns hydrate from /dashboard/sessions/:sessionId/turns
Open-chat action is verified URL or explicit unavailable state
```

- [ ] **Step 8: Commit proof docs only if source docs changed**

If proof commands require doc corrections:

```bash
git add services/kfc-agent-backend/README.md docs/deployment/hackathon-free-deploy.md apps/kfc_live_monitor_flutter/README.md
git commit -m "docs: record Zalo OA proof corrections"
```

If no docs changed, do not create an empty commit.
