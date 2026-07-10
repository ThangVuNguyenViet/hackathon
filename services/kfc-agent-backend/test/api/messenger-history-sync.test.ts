import { describe, expect, it } from "vitest";
import { buildServer } from "../../src/api/server.js";
import { DashboardEventBus } from "../../src/dashboard/eventBus.js";
import {
  MessengerHistorySyncCoordinator,
  MessengerHistorySyncService,
  type MessengerHistoryClient,
} from "../../src/channels/messengerHistory.js";
import { MemoryStore } from "../../src/persistence/memoryStore.js";

describe("Messenger history sync admin API", () => {
  it("syncs Messenger history before serving dashboard sessions and turns", async () => {
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

    const sessions = await server.inject({
      method: "GET",
      url: "/dashboard/sessions",
    });

    expect(sessions.statusCode).toBe(200);
    expect(sessions.json().sessions).toEqual([
      expect.objectContaining({
        sessionId: "messenger:psid_1",
        displayName: "Nguyen An",
        avatarUrl: "https://graph.local/psid_1.jpg",
        latestEventType: "conversation_turn_created",
      }),
    ]);

    const turns = await server.inject({
      method: "GET",
      url: "/dashboard/sessions/messenger:psid_1/turns",
    });
    expect(turns.json().turns).toEqual([
      expect.objectContaining({
        role: "user",
        text: "Mình muốn đặt gà rán",
        externalMessageId: "mid_1",
      }),
    ]);
    expect(fetchCount).toBeGreaterThanOrEqual(1);
    expect(profileFetchCount).toBe(1);
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
