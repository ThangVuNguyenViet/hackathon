import { describe, expect, it, vi } from "vitest";
import { DashboardEventBus } from "../../src/dashboard/eventBus.js";
import { MemoryStore } from "../../src/persistence/memoryStore.js";
import {
  createMessengerHistoryClient,
  MessengerHistorySyncService,
} from "../../src/channels/messengerHistory.js";

describe("Messenger history sync", () => {
  it("fetches conversations and nested message pages from Meta pagination", async () => {
    const fetchImpl = vi.fn(async (url: Parameters<typeof fetch>[0]) => {
      const value = String(url);
      if (
        value.startsWith(
          "https://graph.local/page_1/conversations?platform=messenger",
        )
      ) {
        return jsonResponse({
          data: [
            {
              id: "conv_1",
              updated_time: "2026-07-08T08:00:00+0000",
              participants: { data: [{ id: "page_1" }, { id: "psid_1" }] },
              messages: {
                data: [
                  {
                    id: "mid_1",
                    message: "Xin chào",
                    from: { id: "psid_1" },
                    to: { data: [{ id: "page_1" }] },
                    created_time: "2026-07-08T07:59:00+0000",
                  },
                ],
                paging: {
                  next: "https://graph.local/conv_1/messages?after=page2",
                },
              },
            },
          ],
          paging: {
            next: "https://graph.local/page_1/conversations?after=page2",
          },
        });
      }
      if (value === "https://graph.local/conv_1/messages?after=page2") {
        return jsonResponse({
          data: [
            {
              id: "mid_2",
              message: "Chào bạn",
              from: { id: "page_1" },
              to: { data: [{ id: "psid_1" }] },
              created_time: "2026-07-08T08:00:00+0000",
            },
          ],
        });
      }
      if (value === "https://graph.local/page_1/conversations?after=page2") {
        return jsonResponse({
          data: [
            {
              id: "conv_2",
              participants: { data: [{ id: "page_1" }, { id: "psid_2" }] },
              messages: {
                data: [
                  {
                    id: "mid_3",
                    from: { id: "psid_2" },
                    created_time: "2026-07-08T08:01:00+0000",
                  },
                ],
              },
            },
          ],
        });
      }
      throw new Error(`Unexpected URL: ${value}`);
    });

    const client = createMessengerHistoryClient({
      pageId: "page_1",
      pageAccessToken: "token_1",
      graphApiBaseUrl: "https://graph.local",
      fetchImpl,
    });

    const conversations = await client.fetchConversations({
      limitMessagesPerConversation: 2,
    });

    expect(conversations).toHaveLength(2);
    expect(conversations[0]).toMatchObject({
      id: "conv_1",
      participantIds: ["page_1", "psid_1"],
      messages: [
        expect.objectContaining({
          id: "mid_1",
          text: "Xin chào",
          fromId: "psid_1",
        }),
        expect.objectContaining({
          id: "mid_2",
          text: "Chào bạn",
          fromId: "page_1",
        }),
      ],
    });
    expect(conversations[1]?.messages[0]).toMatchObject({
      id: "mid_3",
      text: "[unsupported Messenger message]",
    });
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain(
      "platform=messenger",
    );
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain(
      "access_token=token_1",
    );
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain(
      "messages.limit%282%29",
    );
  });

  it("uses a bounded default message limit without chasing nested message pages", async () => {
    const fetchImpl = vi.fn(async (url: Parameters<typeof fetch>[0]) => {
      const value = String(url);
      if (
        value.startsWith(
          "https://graph.local/page_1/conversations?platform=messenger",
        )
      ) {
        return jsonResponse({
          data: [
            {
              id: "conv_1",
              participants: { data: [{ id: "page_1" }, { id: "psid_1" }] },
              messages: {
                data: Array.from({ length: 20 }, (_, index) => ({
                  id: `mid_${index + 1}`,
                  message: `Message ${index + 1}`,
                  from: { id: "psid_1" },
                  created_time: `2026-07-08T08:${String(index).padStart(2, "0")}:00+0000`,
                })),
                paging: {
                  next: "https://graph.local/conv_1/messages?after=page2",
                },
              },
            },
          ],
        });
      }
      throw new Error(`Unexpected URL: ${value}`);
    });

    const client = createMessengerHistoryClient({
      pageId: "page_1",
      pageAccessToken: "token_1",
      graphApiBaseUrl: "https://graph.local",
      fetchImpl,
    });

    const conversations = await client.fetchConversations();

    expect(conversations[0]?.messages).toHaveLength(20);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain(
      "messages.limit%2820%29",
    );
  });

  it("imports historical messages with deterministic dashboard events and idempotency", async () => {
    const store = new MemoryStore();
    const dashboard = new DashboardEventBus();
    const service = new MessengerHistorySyncService({
      pageId: "page_1",
      store,
      dashboard,
      client: {
        async fetchConversations() {
          return [
            {
              id: "conv_1",
              participantIds: ["page_1", "psid_1"],
              updatedTime: "2026-07-08T08:00:00.000Z",
              messages: [
                {
                  id: "mid_1",
                  text: "Mình muốn đặt gà",
                  fromId: "psid_1",
                  toIds: ["page_1"],
                  createdTime: "2026-07-08T07:59:00.000Z",
                  raw: { id: "mid_1" },
                },
                {
                  id: "mid_2",
                  text: "Dạ KFC hỗ trợ bạn",
                  fromId: "page_1",
                  toIds: ["psid_1"],
                  createdTime: "2026-07-08T08:00:00.000Z",
                  raw: { id: "mid_2" },
                },
              ],
            },
          ];
        },
      },
    });

    const first = await service.sync();
    const second = await service.sync();

    expect(first).toMatchObject({
      ok: true,
      conversationsScanned: 1,
      messagesImported: 2,
      messagesSkipped: 0,
    });
    expect(second).toMatchObject({
      ok: true,
      conversationsScanned: 1,
      messagesImported: 0,
      messagesSkipped: 2,
    });

    const turns = await store.listTurns("messenger:psid_1");
    expect(turns).toEqual([
      expect.objectContaining({
        role: "user",
        text: "Mình muốn đặt gà",
        externalMessageId: "mid_1",
        externalUserId: "psid_1",
        deliveryStatus: "received",
      }),
      expect.objectContaining({
        role: "assistant",
        text: "Dạ KFC hỗ trợ bạn",
        externalMessageId: "mid_2",
        externalUserId: "psid_1",
        deliveryStatus: "sent",
      }),
    ]);

    expect(
      dashboard.getEvents("messenger:psid_1").map((event) => event.id),
    ).toEqual([
      "dash_import_mid_1_customer_message_received",
      "dash_import_mid_1_conversation_turn_created",
      "dash_import_mid_2_conversation_turn_created",
    ]);
  });
});

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
