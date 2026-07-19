import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import worker, {
  DashboardSocket,
  WORKER_CUSTOMER_RUN_MAX_TEXT_EVENTS,
  WORKER_CUSTOMER_RUN_PACE_MS,
  scheduleAgentBackground,
  type MessengerWebhookJob,
  type QueueBinding,
  type WorkerEnv,
} from "../../src/worker.js";
import type { AgentTracer } from "../../src/observability/agentTracing.js";
import { FakeD1Database } from "../support/fakeD1Database.js";

const workerResponseFixture = vi.hoisted(() => ({ modelCandidate: undefined as string | undefined }));

vi.mock("../../src/api/serverOptions.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/api/serverOptions.js")>();
  const { createTestResponseComposer } = await import("../fixtures/testResponseComposer.js");
  const composer = () => {
    if (!workerResponseFixture.modelCandidate) throw new Error("missing_explicit_worker_test_response");
    return createTestResponseComposer(workerResponseFixture.modelCandidate, true);
  };
  const responseComposer = {
    composeResponse(input: Parameters<ReturnType<typeof createTestResponseComposer>["composeResponse"]>[0]) {
      return composer().composeResponse(input);
    },
    composeGenUiCompanion(input: Parameters<NonNullable<ReturnType<typeof createTestResponseComposer>["composeGenUiCompanion"]>>[0]) {
      return composer().composeGenUiCompanion!(input);
    },
    composeStandaloneSocial(input: Parameters<NonNullable<ReturnType<typeof createTestResponseComposer>["composeStandaloneSocial"]>>[0]) {
      return composer().composeStandaloneSocial!(input);
    },
  };
  return {
    ...original,
    buildServerOptionsFromEnv(env: Parameters<typeof original.buildServerOptionsFromEnv>[0]) {
      const options = original.buildServerOptionsFromEnv(env);
      return env.OPENAI_API_KEY ? options : { ...options, responseComposer };
    },
  };
});

afterEach(() => {
  workerResponseFixture.modelCandidate = undefined;
});

describe("Cloudflare Worker backend", () => {
  it("disables artificial text pacing inside waitUntil", () => {
    expect(WORKER_CUSTOMER_RUN_PACE_MS).toBe(0);
    expect(WORKER_CUSTOMER_RUN_MAX_TEXT_EVENTS).toBe(3);
  });

  it("runs deferred agent work before flushing traces once through waitUntil", async () => {
    const order: string[] = [];
    const backgroundWork: Promise<unknown>[] = [];
    const tracer: AgentTracer = {
      async startTurn() {
        throw new Error("not used");
      },
      async flush() {
        order.push("flush");
      },
    };

    scheduleAgentBackground(
      { waitUntil: (promise) => backgroundWork.push(promise) },
      [async () => { order.push("monitor"); }],
      tracer,
    );

    expect(backgroundWork).toHaveLength(1);
    await backgroundWork[0];
    expect(order).toEqual(["monitor", "flush"]);
  });

  it("forwards dashboard WebSocket upgrades to the dashboard socket", async () => {
    const fetchSocket = vi.fn(async () => new Response("upgraded"));
    const workerEnv = env({
      DASHBOARD_SOCKET: {
        getByName: vi.fn(() => ({ fetch: fetchSocket })),
      },
    });
    const request = adminRequest("https://worker.local/dashboard/socket", {
      headers: { Upgrade: "websocket" },
    });

    const response = await worker.fetch(request, workerEnv);

    expect(await response.text()).toBe("upgraded");
    expect(fetchSocket).toHaveBeenCalledWith(request);
  });

  it("broadcasts dashboard events to every connected monitor", async () => {
    const first = { send: vi.fn() };
    const second = { send: vi.fn() };
    const socket = new DashboardSocket(
      {
        acceptWebSocket: vi.fn(),
        getWebSockets: () => [first, second] as unknown as WebSocket[],
      },
      {},
    );
    const event = {
      id: "dashboard_event_1",
      sessionId: "messenger:psid_1",
      type: "conversation_turn_created",
      payload: {},
      createdAt: "2026-07-11T00:00:00.000Z",
    };

    const response = await socket.fetch(
      new Request("https://socket.local/events", {
        method: "POST",
        body: JSON.stringify(event),
      }),
    );

    expect(response.status).toBe(202);
    expect(first.send).toHaveBeenCalledWith(JSON.stringify(event));
    expect(second.send).toHaveBeenCalledWith(JSON.stringify(event));
  });

  it("keeps Messenger dashboard broadcasts alive with waitUntil", async () => {
    const queue = new FakeQueue();
    const socketFetch = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(null, { status: 202 }),
    );
    const backgroundWork: Promise<unknown>[] = [];
    const workerEnv = env({
      MESSENGER_WEBHOOK_QUEUE: queue,
      DASHBOARD_SOCKET: {
        getByName: vi.fn(() => ({ fetch: socketFetch })),
      },
    });

    const response = await worker.fetch(
      messengerWebhookRequest(messengerPayload("mid_wait_until")),
      workerEnv,
      { waitUntil: (promise) => backgroundWork.push(promise) },
    );
    await Promise.all(backgroundWork);

    expect(response.status).toBe(200);
    expect(backgroundWork.length).toBeGreaterThan(0);
    expect(socketFetch).toHaveBeenCalled();
    const publishedEvent = JSON.parse(
      String(socketFetch.mock.calls.at(-1)?.[1]?.body),
    ) as { sessionId: string; type: string };
    expect(publishedEvent).toMatchObject({
      sessionId: "messenger:psid_1",
      type: "agent_run_pending",
    });
  });

  it("flushes production LangSmith traces through waitUntil after the chat response", async () => {
    workerResponseFixture.modelCandidate = "Xin chào, mình có thể hỗ trợ bạn xem menu hoặc đặt món.";
    const backgroundWork: Promise<unknown>[] = [];
    const langsmithFetch = vi.fn(async (input: RequestInfo | URL) =>
      String(input).endsWith('/info')
        ? Response.json({ batch_ingest_config: { use_multipart_endpoint: false } })
        : new Response(null, { status: 202 }),
    );
    vi.stubGlobal("fetch", langsmithFetch);
    try {
      const response = await worker.fetch(
        new Request("https://worker.local/chat/kfc/message", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId: "kfc:langsmith_wait_until",
            customerId: "langsmith_wait_until",
            clientMessageId: "kfc_langsmith_wait_until_1",
            text: "hi",
          }),
        }),
        env({
          LANGSMITH_API_KEY: "langsmith_test_key",
          LANGSMITH_PROJECT: "kfc-agent-backend-local",
          LANGSMITH_ENDPOINT: "https://apac.api.smith.langchain.com",
          LANGSMITH_TRACING_SAMPLING_RATE: "1",
        }),
        { waitUntil: (promise) => backgroundWork.push(promise) },
      );

      expect(response.status).toBe(200);
      expect(backgroundWork.length).toBeGreaterThan(0);
      await Promise.all(backgroundWork);
      expect(
        langsmithFetch.mock.calls.some(([request]) => String(request).startsWith("https://apac.api.smith.langchain.com")),
      ).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("keeps direct Zalo webhook trace flushing alive with waitUntil after its immediate response", async () => {
    workerResponseFixture.modelCandidate = "Xin chào, mình có thể hỗ trợ bạn xem menu hoặc đặt món.";
    const backgroundWork: Promise<unknown>[] = [];
    const langsmithFetch = vi.fn(async (input: RequestInfo | URL) =>
      String(input).endsWith('/info')
        ? Response.json({ batch_ingest_config: { use_multipart_endpoint: false } })
        : new Response(null, { status: 202 }),
    );
    vi.stubGlobal("fetch", langsmithFetch);
    try {
      const response = await worker.fetch(
        new Request("https://worker.local/webhooks/zalo", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            event_name: "user_send_text",
            sender: { id: "zalo_wait_until" },
            recipient: { id: "oa_local" },
            message: { msg_id: "zalo_wait_until_1", text: "Xin chào KFC" },
            timestamp: 1783323124608,
          }),
        }),
        env({
          LANGSMITH_API_KEY: "langsmith_test_key",
          LANGSMITH_PROJECT: "kfc-agent-backend-local",
          LANGSMITH_ENDPOINT: "https://apac.api.smith.langchain.com",
          LANGSMITH_TRACING_SAMPLING_RATE: "1",
          ZALO_FETCH: vi.fn(async () =>
            Response.json({ message_id: "zalo_reply_wait_until" }),
          ) as typeof fetch,
        }),
        { waitUntil: (promise) => backgroundWork.push(promise) },
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        received: 1,
        processed: 1,
        skippedDuplicates: 0,
        failed: 0,
      });
      expect(backgroundWork.length).toBeGreaterThan(0);
      await Promise.all(backgroundWork);
      expect(
        langsmithFetch.mock.calls.some(([request]) =>
          String(request).startsWith("https://apac.api.smith.langchain.com"),
        ),
      ).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("persists each KFC dashboard event exactly once through waitUntil", async () => {
    workerResponseFixture.modelCandidate = "Xin chào, mình có thể hỗ trợ bạn xem menu hoặc đặt món.";
    const database = new FakeD1Database();
    const prepare = database.prepare.bind(database);
    let dashboardInsertCount = 0;
    vi.spyOn(database, "prepare").mockImplementation((query) => {
      if (/INSERT OR IGNORE INTO dashboard_events/i.test(query)) {
        dashboardInsertCount += 1;
      }
      return prepare(query);
    });
    const backgroundWork: Promise<unknown>[] = [];

    const response = await worker.fetch(
      new Request("https://worker.local/chat/kfc/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: "kfc:dashboard_wait_until",
          customerId: "dashboard_wait_until",
          clientMessageId: "dashboard_wait_until_1",
          text: "hi",
        }),
      }),
      env({ DB: database }),
      { waitUntil: (promise) => backgroundWork.push(promise) },
    );
    await Promise.all(backgroundWork);

    expect(response.status).toBe(200);
    expect(database.tables.dashboard_events.length).toBeGreaterThan(0);
    expect(dashboardInsertCount).toBe(database.tables.dashboard_events.length);
  });

  class FakeQueue implements QueueBinding<MessengerWebhookJob> {
    readonly messages: MessengerWebhookJob[] = [];
    readonly send = vi.fn(async (message: MessengerWebhookJob) => {
      this.messages.push(message);
    });
  }

  function env(overrides: Partial<WorkerEnv> = {}): WorkerEnv {
    return {
      DB: new FakeD1Database(),
      MESSENGER_VERIFY_TOKEN: "local_verify",
      META_PAGE_ID: "118976205445198",
      META_APP_SECRET: "meta_app_secret_local",
      META_PAGE_ACCESS_TOKEN: "page_token_local",
      META_INBOX_URL_TEMPLATE:
        "https://business.facebook.com/latest/inbox/all?asset_id={pageId}&selected_item_id={externalUserId}",
      ZALO_OA_ID: "oa_local",
      ZALO_ACCESS_TOKEN: "zalo_token_local",
      ZALO_INBOX_URL_TEMPLATE:
        "https://oa.zalo.me/chatv2?oaid={pageId}&uid={externalUserId}",
      OPENAI_API_KEY: "",
      KFC_COMMERCE_MODE: "fixture",
      RELEASE_GIT_SHA: "0123456789abcdef",
      RELEASE_DEPLOYMENT_ID: "worker-deployment-1",
      RELEASE_BUILT_AT: "2026-07-11T08:30:00Z",
      RELEASE_DIRTY: "false",
      KFC_DEMO_ADMIN_TOKEN: "demo_admin",
      ...overrides,
    };
  }

  function messengerPayload(
    mid = "mid_1",
    senderId = "psid_1",
    text = "Cho mình 1 Combo 99K",
  ) {
    return {
      object: "page",
      entry: [
        {
          id: "118976205445198",
          messaging: [
            {
              sender: { id: senderId },
              recipient: { id: "118976205445198" },
              timestamp: 1783323124608,
              message: { mid, text },
            },
          ],
        },
      ],
    };
  }

  function messengerWebhookRequest(payload: unknown): Request {
    const body = JSON.stringify(payload);
    const signature = createHmac("sha256", "meta_app_secret_local").update(body).digest("hex");
    return new Request("https://worker.local/webhooks/messenger", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Hub-Signature-256": `sha256=${signature}`,
      },
      body,
    });
  }

  function adminRequest(input: string, init: RequestInit = {}): Request {
    const headers = new Headers(init.headers);
    headers.set("Authorization", "Bearer demo_admin");
    return new Request(input, { ...init, headers });
  }

  it("serves health, readiness, and Messenger verification through fetch", async () => {
    const workerEnv = env({
      GOOGLE_API_KEY: "google_test_key",
      LANGSMITH_API_KEY: "langsmith_test_key",
      LANGSMITH_PROJECT: "kfc-agent-backend-local",
      LANGSMITH_ENDPOINT: "https://apac.api.smith.langchain.com",
      LANGSMITH_TRACING_SAMPLING_RATE: "1",
    });
    const health = await worker.fetch(
      new Request("https://worker.local/health"),
      workerEnv,
    );
    const ready = await worker.fetch(
      new Request("https://worker.local/ready"),
      workerEnv,
    );
    const verify = await worker.fetch(
      new Request(
        "https://worker.local/webhooks/messenger?hub.mode=subscribe&hub.verify_token=local_verify&hub.challenge=CHALLENGE_123",
      ),
      workerEnv,
    );

    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({
      ok: true,
      service: "kfc-agent-backend",
    });
    expect(ready.status).toBe(200);
    expect(await ready.json()).toMatchObject({
      ok: true,
      checks: {
        database: { ok: true },
        fixtures: { ok: true },
        messenger: { ok: true },
        observability: {
          ok: true,
          langsmith: {
            configured: true,
            project: "kfc-agent-backend-local",
            endpoint: "https://apac.api.smith.langchain.com",
            samplingRate: 1,
          },
        },
      },
      release: {
        gitSha: "0123456789abcdef",
        deploymentId: "worker-deployment-1",
        releaseBuiltAt: "2026-07-11T08:30:00Z",
        dirty: false,
      },
    });
    expect(verify.status).toBe(200);
    expect(await verify.text()).toBe("CHALLENGE_123");
  });

  it("fails closed on private operations routes and accepts the demo-admin token", async () => {
    const configured = env({ KFC_DEMO_ADMIN_TOKEN: "demo_admin" });
    const missingConfig = await worker.fetch(
      new Request("https://worker.local/dashboard/sessions"),
      env({ KFC_DEMO_ADMIN_TOKEN: "" }),
    );
    const unauthorized = await worker.fetch(
      new Request("https://worker.local/dashboard/sessions"),
      configured,
    );
    const dashboard = await worker.fetch(
      new Request("https://worker.local/dashboard/sessions", {
        headers: { Authorization: "Bearer demo_admin" },
      }),
      configured,
    );
    const updates = await worker.fetch(
      new Request("https://worker.local/chat/kfc/sessions/kfc%3Acustomer/updates", {
        headers: { "X-KFC-Demo-Admin-Token": "demo_admin" },
      }),
      configured,
    );

    expect(missingConfig.status).toBe(503);
    expect(unauthorized.status).toBe(401);
    expect(dashboard.status).toBe(200);
    expect(updates.status).toBe(200);
  });

  it("serves Worker readiness without loading dashboard route dependencies", async () => {
    const workerEnv = env({
      GOOGLE_API_KEY: "google_test_key",
      MESSENGER_FETCH: vi.fn(async () => {
        throw new Error("Messenger fetch should not run for shallow readiness");
      }) as typeof fetch,
    });

    const ready = await worker.fetch(
      new Request("https://worker.local/ready"),
      workerEnv,
    );

    expect(ready.status).toBe(200);
    expect(await ready.json()).toMatchObject({
      ok: true,
      checks: {
        database: { ok: true },
        messenger: { ok: true, configured: true, required: true },
        zalo: { ok: true, configured: true, required: false },
        openai: { ok: true, configured: false, required: false },
      },
    });
  });

  it("serves Messenger verification without touching D1", async () => {
    const workerEnv = env({
      DB: {
        prepare() {
          throw new Error("D1 should not be initialized for verification");
        },
      },
    });

    const verify = await worker.fetch(
      new Request(
        "https://worker.local/webhooks/messenger?hub.mode=subscribe&hub.verify_token=local_verify&hub.challenge=FAST_PATH",
      ),
      workerEnv,
    );

    expect(verify.status).toBe(200);
    expect(await verify.text()).toBe("FAST_PATH");
  });

  it("uses a permission-compatible Messenger token check for deep readiness", async () => {
    const messengerFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      expect(url).toContain("/118976205445198/subscribed_apps");
      return new Response(
        JSON.stringify({ data: [{ id: "1066574476058659" }] }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }) as typeof fetch;
    const workerEnv = env({
      GOOGLE_API_KEY: "google_test_key",
      MESSENGER_FETCH: messengerFetch,
    });

    const response = await worker.fetch(
      new Request("https://worker.local/ready?deep=1"),
      workerEnv,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      checks: {
        messengerToken: { ok: true, configured: true, required: true },
        zalo: { ok: true, configured: true, required: false },
      },
      release: { gitSha: "0123456789abcdef", deploymentId: "worker-deployment-1", releaseBuiltAt: "2026-07-11T08:30:00Z", dirty: false },
      proof: {
        deployment: { gitSha: "0123456789abcdef", deploymentId: "worker-deployment-1", builtAt: "2026-07-11T08:30:00Z", dirty: false },
        commerceEnvironment: null,
        graph: { runtime: "langchain-create-agent-v1", checkpoint: "d1-v1" },
        versions: {
          agent: {
            provider: "google",
            model: "gemini-3.1-flash-lite",
            profile: "google-gemini-3.1-flash-lite-thinking-low",
          },
          ledger: "kfc-scenario-ledger-v1",
        },
      },
    });
    expect(messengerFetch).toHaveBeenCalledTimes(1);
  });

  it("reports the configured agent provider and model without exposing its credential", async () => {
    const credential = "private-google-api-key";
    const response = await worker.fetch(
      new Request("https://worker.local/ready"),
      env({
        KFC_AGENT_PROVIDER: "google",
        KFC_AGENT_MODEL: "gemini-3.1-flash-lite",
        GOOGLE_API_KEY: credential,
      }),
    );
    const body = await response.json() as Record<string, unknown>;

    expect(body).toMatchObject({
      checks: {
        agent: {
          ok: true,
          configured: true,
          provider: "google",
          model: "gemini-3.1-flash-lite",
          profile: "google-gemini-3.1-flash-lite-thinking-low",
        },
      },
    });
    expect(JSON.stringify(body)).not.toContain(credential);
    expect(JSON.stringify(body)).not.toContain("private-value");
  });

  it("enqueues one Messenger wakeup job and processes the latest run", async () => {
    workerResponseFixture.modelCandidate = "Mình đã cập nhật Combo 99K vào giỏ.";
    const queue = new FakeQueue();
    const db = new FakeD1Database();
    const messengerFetch = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "POST") {
          const body = JSON.parse(String(init.body ?? "{}")) as {
            sender_action?: string;
          };
          if (body.sender_action) {
            return new Response(JSON.stringify({ recipient_id: "psid_1" }), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            });
          }
          return new Response(JSON.stringify({ message_id: "reply_1" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response(
          JSON.stringify({
            first_name: "Demo",
            last_name: "Customer",
            profile_pic: "https://example.test/a.png",
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      },
    );
    const workerEnv = env({
      DB: db,
      MESSENGER_WEBHOOK_QUEUE: queue,
      MESSENGER_FETCH: messengerFetch as typeof fetch,
    });
    const payload = messengerPayload();

    const first = await worker.fetch(
      messengerWebhookRequest(payload),
      workerEnv,
    );
    expect(
      messengerFetch.mock.calls.map((call) =>
        JSON.parse(String(call[1]?.body ?? "{}")) as {
          sender_action?: string | undefined;
        },
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sender_action: "typing_on" }),
      ]),
    );
    const second = await worker.fetch(
      messengerWebhookRequest(payload),
      workerEnv,
    );
    const turnsBeforeQueue = await worker.fetch(
      adminRequest(
        "https://worker.local/dashboard/sessions/messenger%3Apsid_1/turns",
      ),
      workerEnv,
    );
    expect(messengerFetch).not.toHaveBeenCalledWith(
      expect.stringContaining("/conversations?"),
    );

    const ack = vi.fn();
    await worker.queue(
      { messages: queue.messages.map((body) => ({ body, ack })) },
      workerEnv,
    );

    const turns = await worker.fetch(
      adminRequest(
        "https://worker.local/dashboard/sessions/messenger%3Apsid_1/turns",
      ),
      workerEnv,
    );
    const stream = await worker.fetch(
      adminRequest("https://worker.local/dashboard/stream"),
      workerEnv,
    );

    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({
      received: 1,
      queued: 1,
      skippedDuplicates: 0,
      failed: 0,
    });
    expect(await second.json()).toMatchObject({
      received: 1,
      queued: 0,
      skippedDuplicates: 1,
      failed: 0,
    });
    expect(queue.send).toHaveBeenCalledTimes(1);
    expect(await turnsBeforeQueue.json()).toMatchObject({ turns: [] });
    expect(ack).toHaveBeenCalledTimes(1);
    expect(await turns.json()).toMatchObject({
      turns: expect.arrayContaining([
        expect.objectContaining({ role: "user" }),
        expect.objectContaining({ role: "assistant" }),
      ]),
    });
    expect(
      messengerFetch.mock.calls.map(
        (call) =>
          JSON.parse(String(call[1]?.body ?? "{}")) as {
            message?: { text?: string };
            sender_action?: string;
          },
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sender_action: "mark_seen" }),
        expect.objectContaining({ sender_action: "typing_on" }),
        expect.objectContaining({ sender_action: "typing_off" }),
        expect.objectContaining({
          message: expect.objectContaining({ text: expect.any(String) }),
        }),
      ]),
    );
    expect(stream.status).toBe(501);

    queue.messages.length = 0;
    workerResponseFixture.modelCandidate = "Mình có thể gợi ý món phù hợp với ngân sách 180.000đ cho hai người.";
    await worker.fetch(
      messengerWebhookRequest(
        messengerPayload(
          "mid_2",
          "psid_1",
          "Ngân sách khoảng 180.000đ cho 2 người nhé.",
        ),
      ),
      workerEnv,
    );
    const secondAck = vi.fn();
    await worker.queue(
      { messages: queue.messages.map((body) => ({ body, ack: secondAck })) },
      workerEnv,
    );

    expect(secondAck).toHaveBeenCalledTimes(1);
    expect(db.tables.agent_runs).toHaveLength(2);
    expect(db.tables.agent_runs[1]).toMatchObject({
      coalesced_input_text:
        "1. Ngân sách khoảng 180.000đ cho 2 người nhé.",
    });
  });

  it("persists first-party KFC chat traffic in D1", async () => {
    workerResponseFixture.modelCandidate = "Mình đã cập nhật các món giao về Quận 7 vào giỏ.";
    const db = new FakeD1Database();
    const workerEnv = env({ DB: db });

    const response = await worker.fetch(
      new Request("https://worker.local/chat/kfc/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: "kfc:customer-proof",
          customerId: "customer-proof",
          clientMessageId: "kfc_worker_message_1",
          text: "Cho mình 1 combo gà cay và 2 Pepsi, giao về Quận 7.",
        }),
      }),
      workerEnv,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      state: expect.objectContaining({ sessionId: "kfc:customer-proof" }),
    });
    expect(db.tables.webhook_deliveries).toEqual([]);
    expect(db.tables.conversation_turns).toHaveLength(2);
    expect(db.hasTable("langgraph_checkpoints")).toBe(true);
    expect(db.hasTable("langgraph_checkpoint_writes")).toBe(true);
    expect(db.tables.langgraph_checkpoints.length).toBeGreaterThan(0);
    expect(db.tables.langgraph_checkpoints.every((row) => row.thread_id === "kfc:customer-proof")).toBe(true);
    expect(db.tables.conversation_events.length).toBeGreaterThan(0);
    expect(db.tables.dashboard_events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "assistant_reply_sent" }),
        expect.objectContaining({ type: "session_intelligence_updated" }),
      ]),
    );
  });

  it("uses one customer-facing agent model while keeping the monitor judge deferred", async () => {
    const db = new FakeD1Database();
    const backgroundWork: Promise<unknown>[] = [];
    const modelCalls = new Map<string, number>();
    const openAiFetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { model: string };
      modelCalls.set(body.model, (modelCalls.get(body.model) ?? 0) + 1);
      if (body.model === "gpt-4.1-mini") {
        return Response.json({
          id: "resp_worker_agent",
          object: "response",
          created_at: 1_784_073_600,
          status: "completed",
          model: "gpt-4.1-mini",
          output: [
            {
              id: "msg_worker_agent",
              type: "message",
              status: "completed",
              role: "assistant",
              content: [
                {
                  type: "output_text",
                  text: "model agent reply",
                  annotations: [],
                },
              ],
            },
          ],
          usage: {
            input_tokens: 1,
            output_tokens: 1,
            total_tokens: 2,
            input_tokens_details: { cached_tokens: 0 },
            output_tokens_details: { reasoning_tokens: 0 },
          },
        });
      }
      if (body.model === "monitor-judge-test") {
        return Response.json({
          output_text: JSON.stringify({
            schemaVersion: 1,
            orderStage: "collecting_info",
            aiAutomationConfidencePercent: 75,
            riskLevel: "low",
            priorityRank: 50,
            reasons: ["awaiting_customer_info"],
            contextSummary: "Khách vừa bắt đầu hội thoại.",
            evaluatedCustomerTurnCount: 1,
            evidence: {
              dashboardEventTypes: ["customer_message_received"],
              toolNames: [],
              escalationReasons: [],
              safetyGateReasons: [],
            },
            source: "ai_monitor_judge",
            model: "monitor-judge-test",
            promptVersion: "monitor-judge-v1",
            updatedAt: "2026-07-11T00:00:00.000Z",
          }),
        });
      }
      throw new Error(`Unexpected OpenAI model: ${body.model}`);
    });
    vi.stubGlobal("fetch", openAiFetch);
    try {
      const response = await worker.fetch(
        new Request("https://worker.local/chat/kfc/message", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId: "kfc:worker_social_contract",
            customerId: "worker_social_contract",
            clientMessageId: "kfc_worker_social_contract_1",
            text: "social router input",
          }),
        }),
        env({
          DB: db,
          KFC_AGENT_PROVIDER: "openai",
          KFC_AGENT_MODEL: "gpt-4.1-mini",
          OPENAI_API_KEY: "test_key",
          OPENAI_BASE_URL: "https://openai.local/v1",
          OPENAI_MONITOR_JUDGE_MODEL: "monitor-judge-test",
        }),
        { waitUntil: (promise) => backgroundWork.push(promise) },
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        responseText: "model agent reply",
        sessionId: "kfc:worker_social_contract",
        customerId: "worker_social_contract",
      });
      expect(modelCalls.get("gpt-4.1-mini")).toBe(1);

      await Promise.all([...backgroundWork]);
      await Promise.all([...backgroundWork]);

      expect(modelCalls.get("monitor-judge-test")).toBe(1);
      expect(
        db.tables.dashboard_events.filter(
          (event) => event.type === "session_intelligence_updated",
        ),
      ).toHaveLength(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("recovers stale queued Messenger deliveries when the queue consumer did not run", async () => {
    workerResponseFixture.modelCandidate = "Mình đã cập nhật Combo 99K vào giỏ.";
    const queue = new FakeQueue();
    const db = new FakeD1Database();
    const messengerFetch = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "POST") {
          const body = JSON.parse(String(init.body ?? "{}")) as {
            sender_action?: string;
          };
          if (body.sender_action) {
            return new Response(JSON.stringify({ recipient_id: "psid_1" }), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            });
          }
          return new Response(
            JSON.stringify({ message_id: "reply_recovered" }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          );
        }
        return new Response(
          JSON.stringify({ first_name: "Recovered", last_name: "Customer" }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      },
    );
    const workerEnv = env({
      DB: db,
      MESSENGER_WEBHOOK_QUEUE: queue,
      MESSENGER_FETCH: messengerFetch as typeof fetch,
      KFC_DEMO_ADMIN_TOKEN: "demo_admin",
    });

    const webhook = await worker.fetch(
      messengerWebhookRequest(messengerPayload("mid_stale_1")),
      workerEnv,
    );
    const turnsBeforeRecovery = await worker.fetch(
      adminRequest(
        "https://worker.local/dashboard/sessions/messenger%3Apsid_1/turns",
      ),
      workerEnv,
    );

    const recovery = await worker.fetch(
      new Request(
        "https://worker.local/admin/messenger/recover-stale-deliveries?olderThanMs=0&limit=5",
        {
          method: "POST",
          headers: { Authorization: "Bearer demo_admin" },
        },
      ),
      workerEnv,
    );
    const recoveryAgain = await worker.fetch(
      new Request(
        "https://worker.local/admin/messenger/recover-stale-deliveries?olderThanMs=0&limit=5",
        {
          method: "POST",
          headers: { Authorization: "Bearer demo_admin" },
        },
      ),
      workerEnv,
    );
    const turnsAfterRecovery = await worker.fetch(
      adminRequest(
        "https://worker.local/dashboard/sessions/messenger%3Apsid_1/turns",
      ),
      workerEnv,
    );

    expect(webhook.status).toBe(200);
    expect(await webhook.json()).toMatchObject({
      received: 1,
      queued: 1,
      skippedDuplicates: 0,
      failed: 0,
    });
    expect(await turnsBeforeRecovery.json()).toMatchObject({ turns: [] });
    expect(recovery.status).toBe(200);
    expect(await recovery.json()).toMatchObject({
      scanned: 1,
      processed: 1,
      failed: 0,
      skipped: 0,
    });
    expect(await recoveryAgain.json()).toMatchObject({
      scanned: 0,
      processed: 0,
      failed: 0,
      skipped: 0,
    });
    expect(await turnsAfterRecovery.json()).toMatchObject({
      turns: expect.arrayContaining([
        expect.objectContaining({
          role: "user",
          externalMessageId: "mid_stale_1",
        }),
        expect.objectContaining({
          role: "assistant",
          deliveryStatus: "sent",
          externalMessageId: "reply_recovered",
        }),
      ]),
    });
    expect(db.tables.webhook_deliveries).toContainEqual(
      expect.objectContaining({
        external_event_id: "mid_stale_1",
        status: "processed",
      }),
    );
  });

  it("recovers stale queued Messenger deliveries from the scheduled Worker path", async () => {
    workerResponseFixture.modelCandidate = "Mình đã cập nhật Combo 99K vào giỏ.";
    const queue = new FakeQueue();
    const db = new FakeD1Database();
    const messengerFetch = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "POST") {
          const body = JSON.parse(String(init.body ?? "{}")) as {
            sender_action?: string;
          };
          if (body.sender_action) {
            return new Response(JSON.stringify({ recipient_id: "psid_1" }), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            });
          }
          return new Response(
            JSON.stringify({ message_id: "reply_scheduled_recovery" }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          );
        }
        return new Response(
          JSON.stringify({ first_name: "Scheduled", last_name: "Customer" }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      },
    );
    const workerEnv = env({
      DB: db,
      MESSENGER_WEBHOOK_QUEUE: queue,
      MESSENGER_FETCH: messengerFetch as typeof fetch,
    });

    await worker.fetch(
      messengerWebhookRequest(messengerPayload("mid_scheduled_stale_1")),
      workerEnv,
    );

    await (
      worker as typeof worker & {
        scheduled(controller: unknown, env: WorkerEnv): Promise<void>;
      }
    ).scheduled({ scheduledTime: Date.now() }, workerEnv);

    expect(db.tables.webhook_deliveries).toContainEqual(
      expect.objectContaining({
        external_event_id: "mid_scheduled_stale_1",
        status: "processed",
      }),
    );
    expect(db.tables.conversation_turns).toContainEqual(
      expect.objectContaining({
        role: "assistant",
        external_message_id: "reply_scheduled_recovery",
      }),
    );
  });

  it("returns 503 when the Messenger queue binding is missing", async () => {
    const workerEnv = env();

    const response = await worker.fetch(
      messengerWebhookRequest(messengerPayload()),
      workerEnv,
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      errorCode: "messenger_webhook_queue_not_configured",
    });
  });

  it("fails closed before queueing Messenger webhooks without valid authenticity evidence", async () => {
    const queue = new FakeQueue();
    const unsigned = () => new Request("https://worker.local/webhooks/messenger", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(messengerPayload("mid_unsigned")),
    });
    const invalidSignatureRequest = messengerWebhookRequest(messengerPayload("mid_invalid_signature"));
    invalidSignatureRequest.headers.set("X-Hub-Signature-256", `sha256=${"0".repeat(64)}`);

    const missingSecret = await worker.fetch(
      unsigned(),
      env({ MESSENGER_WEBHOOK_QUEUE: queue, META_APP_SECRET: "" }),
    );
    const missingSignature = await worker.fetch(
      unsigned(),
      env({ MESSENGER_WEBHOOK_QUEUE: queue }),
    );
    const invalidSignature = await worker.fetch(
      invalidSignatureRequest,
      env({ MESSENGER_WEBHOOK_QUEUE: queue }),
    );

    expect(missingSecret.status).toBe(503);
    expect(await missingSecret.json()).toMatchObject({
      errorCode: "messenger_webhook_authenticity_not_configured",
    });
    expect(missingSignature.status).toBe(401);
    expect(await missingSignature.json()).toMatchObject({
      errorCode: "invalid_messenger_webhook_signature",
    });
    expect(invalidSignature.status).toBe(401);
    expect(await invalidSignature.json()).toMatchObject({
      errorCode: "invalid_messenger_webhook_signature",
    });
    expect(queue.messages).toEqual([]);
  });

  it("stores expired Messenger token failures from the queue without throwing", async () => {
    workerResponseFixture.modelCandidate = "Mình đã cập nhật Combo 99K vào giỏ.";
    const queue = new FakeQueue();
    const db = new FakeD1Database();
    const workerEnv = env({
      DB: db,
      MESSENGER_WEBHOOK_QUEUE: queue,
      MESSENGER_FETCH: vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: {
                message: "Error validating access token: Session has expired",
                code: 190,
                error_subcode: 463,
              },
            }),
            { status: 400, headers: { "Content-Type": "application/json" } },
          ),
      ) as typeof fetch,
    });

    const response = await worker.fetch(
      messengerWebhookRequest(messengerPayload("mid_expired_token")),
      workerEnv,
    );
    const ack = vi.fn();

    await worker.queue(
      { messages: queue.messages.map((body) => ({ body, ack })) },
      workerEnv,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      received: 1,
      queued: 1,
      failed: 0,
    });
    expect(ack).toHaveBeenCalledTimes(1);
    expect(db.tables.webhook_deliveries).toContainEqual(
      expect.objectContaining({
        external_event_id: "mid_expired_token",
        status: "failed",
        last_error: "Error validating access token: Session has expired",
      }),
    );
  });

  it("serves dashboard sessions from bounded D1 summaries with profile deeplinks", async () => {
    const db = new FakeD1Database();
    const workerEnv = env({
      DB: db,
      GOOGLE_API_KEY: "google_test_key",
      MESSENGER_FETCH: vi.fn(
        async () =>
          new Response(JSON.stringify({ data: [] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
      ),
    });
    const storeReady = await worker.fetch(
      new Request("https://worker.local/ready"),
      workerEnv,
    );
    expect(storeReady.status).toBe(200);

    await db
      .prepare(
        `INSERT OR IGNORE INTO dashboard_events (id, session_id, type, payload, created_at) VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(
        "dash_1",
        "zalo:zalo_user_1",
        "customer_message_received",
        "{}",
        new Date().toISOString(),
      )
      .run();
    await db
      .prepare(
        `INSERT OR IGNORE INTO dashboard_events (id, session_id, type, payload, created_at) VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(
        "dash_2",
        "zalo:zalo_user_1",
        "assistant_reply_sent",
        "{}",
        new Date().toISOString(),
      )
      .run();
    await db
      .prepare(
        `INSERT OR IGNORE INTO dashboard_events (id, session_id, type, payload, created_at) VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(
        "dash_mock",
        "unknown:local_customer_1",
        "assistant_reply_sent",
        "{}",
        new Date().toISOString(),
      )
      .run();
    await db
      .prepare(
        `INSERT INTO conversation_profiles (channel, external_user_id, display_name, avatar_url, profile_source, profile_updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(channel, external_user_id) DO UPDATE SET
           display_name = excluded.display_name,
           avatar_url = excluded.avatar_url,
           profile_source = excluded.profile_source,
           profile_updated_at = excluded.profile_updated_at`,
      )
      .bind(
        "zalo",
        "zalo_user_1",
        "Tran Binh",
        "https://zalo.local/b.jpg",
        "zalo_webhook",
        "2026-07-09T00:00:01.000Z",
      )
      .run();

    const response = await worker.fetch(
      adminRequest("https://worker.local/dashboard/sessions"),
      workerEnv,
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(
      body.sessions.map((session: { sessionId: string }) => session.sessionId),
    ).toEqual(["zalo:zalo_user_1"]);
    expect(body).toMatchObject({
      sessions: [
        {
          sessionId: "zalo:zalo_user_1",
          latestEventType: "assistant_reply_sent",
          externalUserId: "zalo_user_1",
          displayName: "Tran Binh",
          avatarUrl: "https://zalo.local/b.jpg",
          deeplink: {
            status: "available",
            url: "https://oa.zalo.me/chatv2?oaid=oa_local&uid=zalo_user_1",
          },
        },
      ],
    });
  });

  it("serves Worker dashboard sessions active within the last 24 hours", async () => {
    const db = new FakeD1Database();
    const workerEnv = env({
      DB: db,
      GOOGLE_API_KEY: "google_test_key",
    });
    const storeReady = await worker.fetch(
      new Request("https://worker.local/ready"),
      workerEnv,
    );
    expect(storeReady.status).toBe(200);

    const now = Date.now();
    for (const [id, sessionId, createdAt] of [
      [
        "dash_within_day",
        "messenger:session_within_day",
        new Date(now - 20 * 60 * 60 * 1000).toISOString(),
      ],
      [
        "dash_older_than_day",
        "messenger:session_older_than_day",
        new Date(now - 24 * 60 * 60 * 1000 - 1).toISOString(),
      ],
    ]) {
      await db
        .prepare(
          `INSERT OR IGNORE INTO dashboard_events (id, session_id, type, payload, created_at) VALUES (?, ?, ?, ?, ?)`,
        )
        .bind(id, sessionId, "customer_message_received", "{}", createdAt)
        .run();
    }

    const response = await worker.fetch(
      adminRequest("https://worker.local/dashboard/sessions"),
      workerEnv,
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(
      body.sessions.map((session: { sessionId: string }) => session.sessionId),
    ).toEqual(["messenger:session_within_day"]);
  });

  it("serves Worker dashboard sessions without blocking on Messenger history sync", async () => {
    const db = new FakeD1Database();
    const messengerFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/conversations?")) {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: "conv_1",
                participants: {
                  data: [{ id: "118976205445198" }, { id: "psid_history" }],
                },
                messages: {
                  data: [
                    {
                      id: "mid_history",
                      message: "Cho mình xem lại đơn cũ",
                      from: { id: "psid_history" },
                      to: { data: [{ id: "118976205445198" }] },
                      created_time: new Date().toISOString(),
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    const workerEnv = env({ DB: db, MESSENGER_FETCH: messengerFetch });

    const response = await worker.fetch(
      adminRequest("https://worker.local/dashboard/sessions"),
      workerEnv,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ sessions: [] });
    expect(messengerFetch).not.toHaveBeenCalled();
  });

  it("supports Messenger history sync through Worker fetch", async () => {
    const db = new FakeD1Database();
    const messengerFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/psid_history?")) {
        return new Response(
          JSON.stringify({
            first_name: "History",
            last_name: "Customer",
            profile_pic: "https://graph.local/h.jpg",
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      }
      if (url.includes("/conversations?")) {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: "conv_1",
                participants: {
                  data: [{ id: "118976205445198" }, { id: "psid_history" }],
                },
                messages: {
                  data: [
                    {
                      id: "mid_history_customer",
                      message: "Cho mình đặt combo 99K",
                      from: { id: "psid_history" },
                      to: { data: [{ id: "118976205445198" }] },
                      created_time: new Date().toISOString(),
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    const workerEnv = env({ DB: db, MESSENGER_FETCH: messengerFetch });

    const sync = await worker.fetch(
      adminRequest("https://worker.local/admin/messenger/sync-history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limitConversations: 1 }),
      }),
      workerEnv,
    );
    const sessions = await worker.fetch(
      adminRequest("https://worker.local/dashboard/sessions"),
      workerEnv,
    );
    const status = await worker.fetch(
      adminRequest("https://worker.local/admin/messenger/sync-history/status"),
      workerEnv,
    );

    expect(sync.status).toBe(200);
    expect(await sync.json()).toMatchObject({
      ok: true,
      conversationsScanned: 1,
      messagesImported: 1,
    });
    expect(sessions.status).toBe(200);
    expect(await sessions.json()).toMatchObject({
      sessions: [
        expect.objectContaining({
          sessionId: "messenger:psid_history",
          externalUserId: "psid_history",
          displayName: "History Customer",
          avatarUrl: "https://graph.local/h.jpg",
          sessionIntelligence: null,
          deeplink: expect.objectContaining({ status: "available" }),
        }),
      ],
    });
    expect(status.status).toBe(200);
    expect(await status.json()).toMatchObject({ running: false });
  });

  it("stores Messenger history participant names when direct profile lookup fails", async () => {
    const db = new FakeD1Database();
    const messengerFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/psid_history_participant?")) {
        return new Response(
          JSON.stringify({ error: { message: "Profile unavailable" } }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          },
        );
      }
      if (url.includes("/conversations?")) {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: "conv_1",
                participants: {
                  data: [
                    { id: "118976205445198", name: "KFC Page" },
                    {
                      id: "psid_history_participant",
                      name: "History Participant",
                      picture: {
                        data: {
                          url: "https://graph.local/history-participant.jpg",
                        },
                      },
                    },
                  ],
                },
                messages: {
                  data: [
                    {
                      id: "mid_history_participant",
                      message: "Cho mình đặt combo 99K",
                      from: { id: "psid_history_participant" },
                      to: { data: [{ id: "118976205445198" }] },
                      created_time: new Date().toISOString(),
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    const workerEnv = env({ DB: db, MESSENGER_FETCH: messengerFetch });

    const sync = await worker.fetch(
      adminRequest("https://worker.local/admin/messenger/sync-history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limitConversations: 1 }),
      }),
      workerEnv,
    );
    const sessions = await worker.fetch(
      adminRequest("https://worker.local/dashboard/sessions"),
      workerEnv,
    );

    expect(sync.status).toBe(200);
    expect(await sync.json()).toMatchObject({
      ok: true,
      conversationsScanned: 1,
      messagesImported: 1,
    });
    expect(await sessions.json()).toMatchObject({
      sessions: [
        expect.objectContaining({
          sessionId: "messenger:psid_history_participant",
          externalUserId: "psid_history_participant",
          displayName: "History Participant",
          avatarUrl: "https://graph.local/history-participant.jpg",
        }),
      ],
    });
  });

  it("backfills Messenger profile names for existing dashboard sessions", async () => {
    const db = new FakeD1Database();
    const messengerFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/psid_needs_profile?")) {
        return new Response(
          JSON.stringify({
            first_name: "Profile",
            last_name: "Backfill",
            profile_pic: "https://graph.local/profile.jpg",
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      }
      return new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    const workerEnv = env({ DB: db, MESSENGER_FETCH: messengerFetch });
    await worker.fetch(new Request("https://worker.local/ready"), workerEnv);
    await db
      .prepare(
        `INSERT OR IGNORE INTO dashboard_events (id, session_id, type, payload, created_at) VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(
        "dash_profile_backfill",
        "messenger:psid_needs_profile",
        "customer_message_received",
        "{}",
        new Date().toISOString(),
      )
      .run();

    const backfill = await worker.fetch(
      adminRequest("https://worker.local/admin/messenger/backfill-profiles", {
        method: "POST",
      }),
      workerEnv,
    );
    const sessions = await worker.fetch(
      adminRequest("https://worker.local/dashboard/sessions"),
      workerEnv,
    );

    expect(backfill.status).toBe(200);
    expect(await backfill.json()).toMatchObject({
      scanned: 1,
      updated: 1,
      failed: 0,
      profiles: [
        expect.objectContaining({
          sessionId: "messenger:psid_needs_profile",
          displayName: "Profile Backfill",
          status: "updated",
        }),
      ],
    });
    expect(await sessions.json()).toMatchObject({
      sessions: [
        expect.objectContaining({
          sessionId: "messenger:psid_needs_profile",
          displayName: "Profile Backfill",
          avatarUrl: "https://graph.local/profile.jpg",
        }),
      ],
    });
  });

  it("backfills Messenger profile names from conversation participants when profile lookup fails", async () => {
    const db = new FakeD1Database();
    const messengerFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/psid_participant_profile?")) {
        return new Response(
          JSON.stringify({ error: { message: "Profile unavailable" } }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          },
        );
      }
      if (url.includes("/conversations?")) {
        return new Response(
          JSON.stringify({
            data: [
              {
                participants: {
                  data: [
                    { id: "118976205445198", name: "KFC Page" },
                    {
                      id: "psid_participant_profile",
                      name: "Participant Name",
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    const workerEnv = env({ DB: db, MESSENGER_FETCH: messengerFetch });
    await worker.fetch(new Request("https://worker.local/ready"), workerEnv);
    await db
      .prepare(
        `INSERT OR IGNORE INTO dashboard_events (id, session_id, type, payload, created_at) VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(
        "dash_profile_participant_backfill",
        "messenger:psid_participant_profile",
        "customer_message_received",
        "{}",
        new Date().toISOString(),
      )
      .run();

    const backfill = await worker.fetch(
      adminRequest("https://worker.local/admin/messenger/backfill-profiles", {
        method: "POST",
      }),
      workerEnv,
    );
    const sessions = await worker.fetch(
      adminRequest("https://worker.local/dashboard/sessions"),
      workerEnv,
    );

    expect(backfill.status).toBe(200);
    expect(await backfill.json()).toMatchObject({
      scanned: 1,
      updated: 1,
      failed: 0,
      profiles: [
        expect.objectContaining({
          sessionId: "messenger:psid_participant_profile",
          displayName: "Participant Name",
          status: "updated",
        }),
      ],
    });
    expect(await sessions.json()).toMatchObject({
      sessions: [
        expect.objectContaining({
          sessionId: "messenger:psid_participant_profile",
          displayName: "Participant Name",
        }),
      ],
    });
  });

  it("supports dashboard human takeover controls through Worker fetch", async () => {
    const db = new FakeD1Database();
    const workerEnv = env({
      DB: db,
      MESSENGER_FETCH: vi.fn(
        async () =>
          new Response(JSON.stringify({ data: [] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
      ),
    });
    await worker.fetch(new Request("https://worker.local/ready"), workerEnv);

    const join = await worker.fetch(
      adminRequest(
        "https://worker.local/dashboard/sessions/messenger%3Apsid_1/human-join",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agentId: "monitor_agent_local" }),
        },
      ),
      workerEnv,
    );
    const events = await worker.fetch(
      adminRequest("https://worker.local/dashboard/events/messenger%3Apsid_1"),
      workerEnv,
    );
    const sessions = await worker.fetch(
      adminRequest("https://worker.local/dashboard/sessions"),
      workerEnv,
    );

    expect(join.status).toBe(200);
    expect(await join.json()).toMatchObject({
      sessionId: "messenger:psid_1",
      agentMode: "human_paused",
      assignedAgentId: "monitor_agent_local",
    });
    expect((await events.json()).events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "session_updated",
          payload: expect.objectContaining({
            updateType: "human_joined",
            agentMode: "human_paused",
            agentId: "monitor_agent_local",
          }),
        }),
      ]),
    );
    expect(await sessions.json()).toMatchObject({
      sessions: [
        expect.objectContaining({
          sessionId: "messenger:psid_1",
          latestEventType: "session_updated",
        }),
      ],
    });
  });

  it("resumes AI for the latest unanswered paused Messenger turn through Worker fetch", async () => {
    workerResponseFixture.modelCandidate = "Mình đã cập nhật Combo 99K vào giỏ.";
    const db = new FakeD1Database();
    const queue = new FakeQueue();
    const messengerFetch = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "POST") {
          const body = JSON.parse(String(init.body ?? "{}")) as {
            sender_action?: string;
          };
          if (body.sender_action) {
            return new Response(JSON.stringify({ recipient_id: "psid_1" }), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            });
          }
          return new Response(
            JSON.stringify({ message_id: "reply_after_resume" }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          );
        }
        return new Response(
          JSON.stringify({ first_name: "Demo", last_name: "Customer" }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      },
    );
    const workerEnv = env({
      DB: db,
      MESSENGER_WEBHOOK_QUEUE: queue,
      MESSENGER_FETCH: messengerFetch as typeof fetch,
    });
    await worker.fetch(new Request("https://worker.local/ready"), workerEnv);

    await worker.fetch(
      adminRequest(
        "https://worker.local/dashboard/sessions/messenger%3Apsid_1/human-join",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agentId: "monitor_agent_local" }),
        },
      ),
      workerEnv,
    );
    const inbound = await worker.fetch(
      messengerWebhookRequest(messengerPayload("mid_paused_worker")),
      workerEnv,
    );
    const ack = vi.fn();
    await worker.queue(
      { messages: queue.messages.map((body) => ({ body, ack })) },
      workerEnv,
    );

    const beforeResume = await worker.fetch(
      adminRequest(
        "https://worker.local/dashboard/sessions/messenger%3Apsid_1/turns",
      ),
      workerEnv,
    );
    const resume = await worker.fetch(
      adminRequest(
        "https://worker.local/dashboard/sessions/messenger%3Apsid_1/resume-ai",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agentId: "monitor_agent_local" }),
        },
      ),
      workerEnv,
    );
    const afterResume = await worker.fetch(
      adminRequest(
        "https://worker.local/dashboard/sessions/messenger%3Apsid_1/turns",
      ),
      workerEnv,
    );

    expect(inbound.status).toBe(200);
    expect(await inbound.json()).toMatchObject({
      received: 1,
      queued: 1,
      skippedDuplicates: 0,
      failed: 0,
    });
    expect(await beforeResume.json()).toMatchObject({
      turns: [
        expect.objectContaining({
          role: "user",
          externalMessageId: "mid_paused_worker",
        }),
      ],
    });
    expect(resume.status).toBe(200);
    expect(await resume.json()).toMatchObject({
      agentMode: "ai_active",
      recoveredUnanswered: true,
    });
    expect(await afterResume.json()).toMatchObject({
      turns: [
        expect.objectContaining({
          role: "user",
          externalMessageId: "mid_paused_worker",
        }),
        expect.objectContaining({
          role: "assistant",
          deliveryStatus: "sent",
          externalMessageId: "reply_after_resume",
        }),
      ],
    });
  });

  it("serves bounded Worker dashboard turns newest-last", async () => {
    const db = new FakeD1Database();
    const workerEnv = env({ DB: db });
    await worker.fetch(new Request("https://worker.local/ready"), workerEnv);

    for (let index = 0; index < 14; index += 1) {
      await db
        .prepare(
          `INSERT INTO conversation_turns (
            id, session_id, channel, role, text, external_message_id, external_user_id, delivery_status, metadata, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          `turn_${index}`,
          "messenger:psid_many",
          "messenger",
          index % 2 === 0 ? "user" : "assistant",
          `Turn ${index}`,
          `mid_${index}`,
          "psid_many",
          "received",
          null,
          `2026-07-09T00:00:${String(index).padStart(2, "0")}.000Z`,
        )
        .run();
    }

    const response = await worker.fetch(
      adminRequest(
        "https://worker.local/dashboard/sessions/messenger%3Apsid_many/turns",
      ),
      workerEnv,
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { turns: Array<{ text: string }> };
    expect(body.turns.map((turn) => turn.text)).toEqual([
      "Turn 4",
      "Turn 5",
      "Turn 6",
      "Turn 7",
      "Turn 8",
      "Turn 9",
      "Turn 10",
      "Turn 11",
      "Turn 12",
      "Turn 13",
    ]);

    const proofResponse = await worker.fetch(
      adminRequest(
        "https://worker.local/dashboard/sessions/messenger%3Apsid_many/turns?limit=100",
      ),
      workerEnv,
    );
    const proofBody = (await proofResponse.json()) as {
      turns: Array<{ text: string }>;
    };
    expect(proofBody.turns).toHaveLength(14);
    expect(proofBody.turns[0]?.text).toBe("Turn 0");
  });
});
