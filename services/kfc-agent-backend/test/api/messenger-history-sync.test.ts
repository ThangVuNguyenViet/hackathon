import { describe, expect, it } from "vitest";
import { buildDemoAdminServer as buildServer } from '../fixtures/demoAdminServer.js';
import { DashboardEventBus } from "../../src/dashboard/eventBus.js";
import {
  MessengerHistorySyncCoordinator,
  MessengerHistorySyncService,
  type MessengerHistoryMessage,
  type MessengerHistoryClient,
} from "../../src/channels/messengerHistory.js";
import type { MonitorSessionIntelligence } from "../../src/domain/types.js";
import type { MonitorSessionIntelligenceJudge } from "../../src/monitor/sessionIntelligence.js";
import { MemoryStore } from "../../src/persistence/memoryStore.js";

describe("Messenger history sync admin API", () => {
  it("keeps dashboard reads durable-only until explicit history sync", async () => {
    const store = new MemoryStore();
    const dashboard = new DashboardEventBus();
    let fetchCount = 0;
    let profileFetchCount = 0;
    const client: MessengerHistoryClient = {
      async fetchConversations() {
        fetchCount += 1;
        return [
          {
            id: "conv_1",
            participantIds: ["page_1", "psid_1"],
            updatedTime: null,
            messages: [
              {
                id: "mid_1",
                text: "Mình muốn đặt gà rán",
                fromId: "psid_1",
                toIds: ["page_1"],
                createdTime: new Date().toISOString(),
                raw: { id: "mid_1" },
              },
            ],
          },
        ];
      },
      async fetchProfile(recipientId) {
        profileFetchCount += 1;
        expect(recipientId).toBe("psid_1");
        return {
          displayName: "Nguyen An",
          avatarUrl: "https://graph.local/psid_1.jpg",
          profileSource: "messenger_profile_api",
        };
      },
    };
    const messengerHistorySync = new MessengerHistorySyncCoordinator(
      new MessengerHistorySyncService({
        pageId: "page_1",
        store,
        dashboard,
        client,
      }),
    );
    const server = buildServer({ store, dashboard, messengerHistorySync });

    const sessionsBeforeSync = await server.inject({
      method: "GET",
      url: "/dashboard/sessions",
    });
    const turnsBeforeSync = await server.inject({
      method: "GET",
      url: "/dashboard/sessions/messenger:psid_1/turns",
    });

    expect(sessionsBeforeSync.statusCode).toBe(200);
    expect(sessionsBeforeSync.json().sessions).toEqual([]);
    expect(turnsBeforeSync.statusCode).toBe(200);
    expect(turnsBeforeSync.json().turns).toEqual([]);
    expect(fetchCount).toBe(0);
    expect(profileFetchCount).toBe(0);

    const sync = await server.inject({
      method: "POST",
      url: "/admin/messenger/sync-history",
      payload: {},
    });
    const sessionsAfterSync = await server.inject({
      method: "GET",
      url: "/dashboard/sessions",
    });
    const turnsAfterSync = await server.inject({
      method: "GET",
      url: "/dashboard/sessions/messenger:psid_1/turns",
    });

    expect(sync.statusCode).toBe(200);
    expect(sessionsAfterSync.json().sessions).toEqual([
      expect.objectContaining({
        sessionId: "messenger:psid_1",
        displayName: "Nguyen An",
        avatarUrl: "https://graph.local/psid_1.jpg",
        latestEventType: "conversation_turn_created",
      }),
    ]);
    expect(turnsAfterSync.json().turns).toEqual([
      expect.objectContaining({
        role: "user",
        text: "Mình muốn đặt gà rán",
        externalMessageId: "mid_1",
      }),
    ]);
    expect(fetchCount).toBe(1);
    expect(profileFetchCount).toBe(1);
  });

  it("hydrates Messenger dashboard AI context and re-evaluates after five new customer turns", async () => {
    const store = new MemoryStore();
    const dashboard = new DashboardEventBus();
    const messages: MessengerHistoryMessage[] = [
      historyMessage(1, "Mình muốn đặt gà rán"),
    ];
    let judgeCalls = 0;
    const client: MessengerHistoryClient = {
      async fetchConversations() {
        return [
          {
            id: "conv_1",
            participantIds: ["page_1", "psid_1"],
            updatedTime: null,
            messages,
          },
        ];
      },
      async fetchProfile() {
        return {
          displayName: "Nguyen An",
          avatarUrl: null,
          profileSource: "messenger_profile_api",
        };
      },
    };
    const monitorJudge: MonitorSessionIntelligenceJudge = {
      async judge(input) {
        judgeCalls += 1;
        return {
          ...input.deterministicFallback,
          contextSummary: `AI context after ${input.deterministicFallback.evaluatedCustomerTurnCount} customer turns`,
          source: "ai_monitor_judge",
          model: "gpt-test",
          promptVersion: "monitor-judge-v1",
        } satisfies MonitorSessionIntelligence;
      },
    };
    const deferredTasks: Array<() => Promise<void>> = [];
    const runDeferredTasks = async () => {
      const tasks = deferredTasks.splice(0);
      await Promise.all(tasks.map((task) => task()));
    };
    const messengerHistorySync = new MessengerHistorySyncCoordinator(
      new MessengerHistorySyncService({
        pageId: "page_1",
        store,
        dashboard,
        client,
      }),
    );
    const server = buildServer({
      store,
      dashboard,
      messengerHistorySync,
      monitorJudge,
      defer: (task) => deferredTasks.push(task),
    });

    await server.inject({
      method: "POST",
      url: "/admin/messenger/sync-history",
      payload: {},
    });
    const first = await server.inject({
      method: "GET",
      url: "/dashboard/sessions",
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().sessions).toEqual([
      expect.objectContaining({
        sessionId: "messenger:psid_1",
        sessionIntelligence: expect.objectContaining({
          source: "runtime_rule_fallback",
          evaluatedCustomerTurnCount: 1,
        }),
      }),
    ]);
    expect(judgeCalls).toBe(0);
    expect(deferredTasks).toHaveLength(1);

    await runDeferredTasks();
    const firstRefined = await server.inject({
      method: "GET",
      url: "/dashboard/sessions",
    });
    expect(firstRefined.json().sessions[0].sessionIntelligence).toMatchObject({
      source: "ai_monitor_judge",
      contextSummary: "AI context after 1 customer turns",
      evaluatedCustomerTurnCount: 1,
    });
    expect(judgeCalls).toBe(1);
    expect(deferredTasks).toHaveLength(0);

    messages.push(
      historyMessage(2, "Thêm 1 Pepsi"),
      historyMessage(3, "Lấy giao hàng"),
      historyMessage(4, "Địa chỉ quận 1"),
      historyMessage(5, "Có khuyến mãi không?"),
    );
    await server.inject({
      method: "POST",
      url: "/admin/messenger/sync-history",
      payload: {},
    });
    const belowThreshold = await server.inject({
      method: "GET",
      url: "/dashboard/sessions",
    });
    expect(belowThreshold.statusCode).toBe(200);
    expect(belowThreshold.json().sessions[0].sessionIntelligence).toMatchObject(
      {
        source: "ai_monitor_judge",
        contextSummary: "AI context after 1 customer turns",
        evaluatedCustomerTurnCount: 1,
      },
    );
    expect(judgeCalls).toBe(1);

    messages.push(historyMessage(6, "Giao sớm giúp mình"));
    await server.inject({
      method: "POST",
      url: "/admin/messenger/sync-history",
      payload: {},
    });
    const atThreshold = await server.inject({
      method: "GET",
      url: "/dashboard/sessions",
    });
    expect(atThreshold.statusCode).toBe(200);
    expect(atThreshold.json().sessions[0].sessionIntelligence).toMatchObject({
      source: "runtime_rule_fallback",
      contextSummary: "AI context after 1 customer turns",
      evaluatedCustomerTurnCount: 6,
    });
    expect(judgeCalls).toBe(1);
    expect(deferredTasks).toHaveLength(1);

    await runDeferredTasks();
    const thresholdRefined = await server.inject({
      method: "GET",
      url: "/dashboard/sessions",
    });
    expect(
      thresholdRefined.json().sessions[0].sessionIntelligence,
    ).toMatchObject({
      source: "ai_monitor_judge",
      contextSummary: "AI context after 6 customer turns",
      evaluatedCustomerTurnCount: 6,
    });
    expect(judgeCalls).toBe(2);
  });

  it("keeps Messenger dashboard sessions visible when AI context judgment fails", async () => {
    const store = new MemoryStore();
    const dashboard = new DashboardEventBus();
    const client: MessengerHistoryClient = {
      async fetchConversations() {
        return [
          {
            id: "conv_1",
            participantIds: ["page_1", "psid_1"],
            updatedTime: null,
            messages: [historyMessage(1, "Hello shop")],
          },
        ];
      },
    };
    const messengerHistorySync = new MessengerHistorySyncCoordinator(
      new MessengerHistorySyncService({
        pageId: "page_1",
        store,
        dashboard,
        client,
      }),
    );
    const deferredTasks: Array<() => Promise<void>> = [];
    const server = buildServer({
      store,
      dashboard,
      messengerHistorySync,
      defer: (task) => deferredTasks.push(task),
      monitorJudge: {
        async judge() {
          throw new Error("OpenAI unavailable");
        },
      },
    });

    await server.inject({
      method: "POST",
      url: "/admin/messenger/sync-history",
      payload: {},
    });
    const sessions = await server.inject({
      method: "GET",
      url: "/dashboard/sessions",
    });

    expect(sessions.statusCode).toBe(200);
    expect(sessions.json().sessions).toEqual([
      expect.objectContaining({
        sessionId: "messenger:psid_1",
        sessionIntelligence: expect.objectContaining({
          source: "runtime_rule_fallback",
          contextSummary: "",
          evaluatedCustomerTurnCount: 1,
        }),
      }),
    ]);
    expect(deferredTasks).toHaveLength(1);

    await deferredTasks[0]?.();
    expect(
      dashboard
        .listSessionSummaries()
        .find((summary) => summary.sessionId === "messenger:psid_1")
        ?.sessionIntelligence,
    ).toMatchObject({
      source: "runtime_rule_fallback",
      evaluatedCustomerTurnCount: 1,
      fallbackReason: "OpenAI unavailable",
    });
  });

  it("runs a manual sync and exposes status without sending agent replies", async () => {
    const store = new MemoryStore();
    const dashboard = new DashboardEventBus();
    let profileFetchCount = 0;
    const client: MessengerHistoryClient = {
      async fetchConversations(options) {
        expect(options).toEqual({
          limitConversations: 1,
          since: "2026-07-01T00:00:00.000Z",
        });
        return [
          {
            id: "conv_1",
            participantIds: ["page_1", "psid_1"],
            updatedTime: null,
            messages: [
              {
                id: "mid_1",
                text: "Lịch sử trước đó",
                fromId: "psid_1",
                toIds: ["page_1"],
                createdTime: "2026-07-08T08:00:00.000Z",
                raw: { id: "mid_1" },
              },
            ],
          },
        ];
      },
      async fetchProfile(recipientId) {
        profileFetchCount += 1;
        expect(recipientId).toBe("psid_1");
        return {
          displayName: "Tran Binh",
          avatarUrl: null,
          profileSource: "messenger_profile_api",
        };
      },
    };
    const messengerHistorySync = new MessengerHistorySyncCoordinator(
      new MessengerHistorySyncService({
        pageId: "page_1",
        store,
        dashboard,
        client,
      }),
    );
    const server = buildServer({ store, dashboard, messengerHistorySync });

    const syncResponse = await server.inject({
      method: "POST",
      url: "/admin/messenger/sync-history",
      payload: { limitConversations: 1, since: "2026-07-01T00:00:00.000Z" },
    });
    expect(syncResponse.statusCode).toBe(200);
    expect(syncResponse.json()).toMatchObject({
      ok: true,
      conversationsScanned: 1,
      messagesImported: 1,
      messagesSkipped: 0,
    });

    const statusResponse = await server.inject({
      method: "GET",
      url: "/admin/messenger/sync-history/status",
    });
    expect(statusResponse.statusCode).toBe(200);
    expect(statusResponse.json()).toMatchObject({
      running: false,
      lastError: null,
      lastResult: {
        conversationsScanned: 1,
        messagesImported: 1,
        messagesSkipped: 0,
      },
    });

    const turns = await server.inject({
      method: "GET",
      url: "/dashboard/sessions/messenger:psid_1/turns",
    });
    expect(turns.json().turns).toEqual([
      expect.objectContaining({
        role: "user",
        text: "Lịch sử trước đó",
        externalMessageId: "mid_1",
      }),
    ]);
    await expect(
      store.getProfile("messenger", "psid_1"),
    ).resolves.toMatchObject({
      displayName: "Tran Binh",
      profileSource: "messenger_profile_api",
    });
    expect(profileFetchCount).toBe(1);
  });

  it("keeps syncing history when Messenger profile lookup fails", async () => {
    const store = new MemoryStore();
    const dashboard = new DashboardEventBus();
    const client: MessengerHistoryClient = {
      async fetchConversations() {
        return [
          {
            id: "conv_1",
            participantIds: ["page_1", "psid_without_profile"],
            updatedTime: null,
            messages: [
              {
                id: "mid_1",
                text: "Hello shop",
                fromId: "psid_without_profile",
                toIds: ["page_1"],
                createdTime: "2026-07-10T00:00:00.000Z",
                raw: { id: "mid_1" },
              },
            ],
          },
        ];
      },
      async fetchProfile() {
        throw new Error("Meta profile lookup failed");
      },
    };
    const service = new MessengerHistorySyncService({
      pageId: "page_1",
      store,
      dashboard,
      client,
    });

    await expect(
      service.sync({ limitConversations: 1 }),
    ).resolves.toMatchObject({
      ok: true,
      conversationsScanned: 1,
      messagesImported: 1,
      messagesSkipped: 0,
    });
    await expect(
      store.listTurns("messenger:psid_without_profile"),
    ).resolves.toEqual([
      expect.objectContaining({
        role: "user",
        text: "Hello shop",
        externalUserId: "psid_without_profile",
      }),
    ]);
    await expect(
      store.getProfile("messenger", "psid_without_profile"),
    ).resolves.toBeUndefined();
  });

  it("uses Messenger conversation participant profile when direct profile lookup fails", async () => {
    const store = new MemoryStore();
    const dashboard = new DashboardEventBus();
    const client: MessengerHistoryClient = {
      async fetchConversations() {
        return [
          {
            id: "conv_1",
            participantIds: ["page_1", "psid_participant"],
            participantProfiles: [
              {
                id: "psid_participant",
                displayName: "Participant Customer",
                avatarUrl: "https://graph.local/participant.jpg",
              },
            ],
            updatedTime: null,
            messages: [
              {
                id: "mid_1",
                text: "Hello shop",
                fromId: "psid_participant",
                toIds: ["page_1"],
                createdTime: "2026-07-10T00:00:00.000Z",
                raw: { id: "mid_1" },
              },
            ],
          },
        ];
      },
      async fetchProfile() {
        throw new Error("Meta profile lookup failed");
      },
    };
    const service = new MessengerHistorySyncService({
      pageId: "page_1",
      store,
      dashboard,
      client,
    });

    await expect(
      service.sync({ limitConversations: 1 }),
    ).resolves.toMatchObject({
      ok: true,
      conversationsScanned: 1,
      messagesImported: 1,
      messagesSkipped: 0,
    });
    await expect(
      store.getProfile("messenger", "psid_participant"),
    ).resolves.toMatchObject({
      displayName: "Participant Customer",
      avatarUrl: "https://graph.local/participant.jpg",
      profileSource: "messenger_profile_api",
    });
  });
});

function historyMessage(index: number, text: string): MessengerHistoryMessage {
  return {
    id: `mid_${index}`,
    text,
    fromId: "psid_1",
    toIds: ["page_1"],
    createdTime: new Date(Date.now() + index * 1000).toISOString(),
    raw: { id: `mid_${index}` },
  };
}
