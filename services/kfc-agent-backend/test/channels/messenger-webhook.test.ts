import { describe, expect, it, vi } from "vitest";
import { buildServer } from "../../src/api/server.js";
import { DashboardEventBus } from "../../src/dashboard/eventBus.js";
import { StaticToolPlanner } from "../../src/llm/toolPlanner.js";
import { MemoryStore } from "../../src/persistence/memoryStore.js";

describe("Messenger webhook adapter", () => {
  it("returns the raw Meta challenge when verify token matches", async () => {
    const server = buildServer({
      messengerVerifyToken: "local_verify",
      metaPageId: "118976205445198",
    });
    const response = await server.inject({
      method: "GET",
      url: "/webhooks/messenger?hub.mode=subscribe&hub.verify_token=local_verify&hub.challenge=CHALLENGE_123",
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe("CHALLENGE_123");
  });

  it("rejects a mismatched verify token", async () => {
    const server = buildServer({
      messengerVerifyToken: "local_verify",
      metaPageId: "118976205445198",
    });
    const response = await server.inject({
      method: "GET",
      url: "/webhooks/messenger?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=CHALLENGE_123",
    });

    expect(response.statusCode).toBe(403);
  });

  it("normalizes a page text message and runs the agent turn", async () => {
    const messengerFetchImpl = vi.fn(
      async (
        _url: Parameters<typeof fetch>[0],
        init?: Parameters<typeof fetch>[1],
      ) =>
        new Response(
          JSON.stringify(
            hasSenderAction(init)
              ? { recipient_id: "psid_user_1" }
              : { message_id: "messenger_reply_1" },
          ),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
    );
    const server = buildServer({
      messengerVerifyToken: "local_verify",
      metaPageId: "118976205445198",
      messengerPageAccessToken: "page_token_local",
      messengerGraphApiBaseUrl: "https://graph.local",
      messengerFetchImpl,
      toolPlanner: new StaticToolPlanner([
        {
          intent: "ordering",
          entities: { itemText: "Combo Hợp Gu 99K" },
          toolCalls: [
            {
              toolName: "searchMenu",
              arguments: { query: "Combo Hợp Gu 99K" },
            },
            {
              toolName: "updateCart",
              arguments: { itemCode: "20751", quantity: 1 },
            },
          ],
          responseClaims: [],
        },
      ]),
      responseComposer: {
        async composeResponse() {
          return "Dạ mình đã thêm Combo 99K vào giỏ Messenger.";
        },
      },
    });
    const response = await server.inject({
      method: "POST",
      url: "/webhooks/messenger",
      payload: {
        object: "page",
        entry: [
          {
            id: "118976205445198",
            time: 1783323124608,
            messaging: [
              {
                sender: { id: "psid_user_1" },
                recipient: { id: "118976205445198" },
                timestamp: 1783323124608,
                message: { mid: "mid_1", text: "Cho mình 1 Combo 99K" },
              },
            ],
          },
        ],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      received: 1,
      processed: 1,
      skippedDuplicates: 0,
      failed: 0,
    });
    expect(messengerFetchImpl).toHaveBeenCalledTimes(5);
    const messengerRequestBodies = messengerFetchImpl.mock.calls.map((call) =>
      parseMessengerBody(call[1]),
    );
    expect(messengerRequestBodies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sender_action: "mark_seen" }),
        expect.objectContaining({ sender_action: "typing_on" }),
        expect.objectContaining({ sender_action: "typing_off" }),
      ]),
    );
    expect(messengerRequestBodies.at(-2)).toMatchObject({
      message: { text: "Dạ mình đã thêm Combo 99K vào giỏ Messenger." },
    });

    const turns = await server.inject({
      method: "GET",
      url: "/dashboard/sessions/messenger:psid_user_1/turns",
    });
    expect(turns.json().turns.at(-1)).toMatchObject({
      role: "assistant",
      text: "Dạ mình đã thêm Combo 99K vào giỏ Messenger.",
      deliveryStatus: "sent",
      externalMessageId: "messenger_reply_1",
    });

    const events = await server.inject({
      method: "GET",
      url: "/dashboard/events/messenger:psid_user_1",
    });
    expect(events.json().events.at(-1)).toMatchObject({
      type: "assistant_reply_sent",
      payload: { deliveryStatus: "sent" },
    });
    expect(
      events
        .json()
        .events.find(
          (event: { type: string }) => event.type === "cart_changed",
        ),
    ).toMatchObject({
      type: "cart_changed",
      payload: {
        cart: {
          items: [
            expect.objectContaining({
              itemCode: "20751",
              name: "Combo Hợp Gu 99K",
            }),
          ],
        },
      },
    });
  });

  it("does not reprocess a webhook message already imported from Messenger history", async () => {
    const store = new MemoryStore();
    await store.upsertImportedTurn({
      sessionId: "messenger:psid_user_1",
      channel: "messenger",
      role: "user",
      text: "Tin nhắn đã import",
      externalMessageId: "mid_imported",
      externalUserId: "psid_user_1",
      deliveryStatus: "received",
      metadata: null,
      createdAt: "2026-07-08T08:00:00.000Z",
    });
    const messengerFetchImpl = vi.fn();
    const server = buildServer({
      store,
      messengerVerifyToken: "local_verify",
      metaPageId: "118976205445198",
      messengerPageAccessToken: "page_token_local",
      messengerGraphApiBaseUrl: "https://graph.local",
      messengerFetchImpl,
      toolPlanner: new StaticToolPlanner([
        {
          intent: "ordering",
          entities: {},
          toolCalls: [],
          responseClaims: [],
        },
      ]),
    });

    const response = await server.inject({
      method: "POST",
      url: "/webhooks/messenger",
      payload: {
        object: "page",
        entry: [
          {
            id: "118976205445198",
            messaging: [
              {
                sender: { id: "psid_user_1" },
                recipient: { id: "118976205445198" },
                timestamp: 1783323124608,
                message: { mid: "mid_imported", text: "Tin nhắn đã import" },
              },
            ],
          },
        ],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      received: 1,
      processed: 0,
      skippedDuplicates: 1,
      failed: 0,
    });
    expect(messengerFetchImpl).not.toHaveBeenCalled();
    expect(await store.listTurns("messenger:psid_user_1")).toHaveLength(1);
  });

  it("uses Messenger profile name in dashboard session summaries", async () => {
    const messengerFetchImpl = vi.fn(
      async (
        url: Parameters<typeof fetch>[0],
        init?: Parameters<typeof fetch>[1],
      ) => {
        if (hasSenderAction(init)) {
          return new Response(JSON.stringify({ recipient_id: "psid_user_1" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (String(url).includes("/psid_user_1")) {
          return new Response(
            JSON.stringify({
              first_name: "Nguyen",
              last_name: "An",
              profile_pic: "https://graph.local/a.jpg",
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          );
        }
        return new Response(JSON.stringify({ message_id: "reply_1" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    );
    const server = buildServer({
      messengerVerifyToken: "verify",
      metaPageId: "118976205445198",
      messengerPageAccessToken: "page_token",
      metaInboxUrlTemplate:
        "https://business.facebook.com/latest/inbox/all?asset_id={pageId}&selected_item_id={externalUserId}&session={sessionId}",
      messengerGraphApiBaseUrl: "https://graph.local",
      messengerFetchImpl,
    });

    await server.inject({
      method: "POST",
      url: "/webhooks/messenger",
      payload: {
        object: "page",
        entry: [
          {
            id: "118976205445198",
            messaging: [
              {
                sender: { id: "psid_user_1" },
                recipient: { id: "118976205445198" },
                message: { mid: "mid_profile", text: "Hi" },
              },
            ],
          },
        ],
      },
    });

    const sessions = await server.inject({
      method: "GET",
      url: "/dashboard/sessions",
    });
    expect(sessions.json().sessions[0]).toMatchObject({
      sessionId: "messenger:psid_user_1",
      displayName: "Nguyen An",
      externalUserId: "psid_user_1",
      avatarUrl: "https://graph.local/a.jpg",
      deeplink: {
        status: "available",
        url: "https://business.facebook.com/latest/inbox/all?asset_id=118976205445198&selected_item_id=psid_user_1&session=messenger%3Apsid_user_1",
      },
    });
  });

  it("hydrates missing Messenger profile names before returning dashboard sessions", async () => {
    const store = new MemoryStore();
    const dashboard = new DashboardEventBus({
      initialEvents: [
        {
          id: "dash_profile_lookup",
          sessionId: "messenger:psid_needs_name",
          type: "customer_message_received",
          payload: {},
          createdAt: new Date().toISOString(),
        },
      ],
    });
    const messengerFetchImpl = vi.fn(
      async (url: Parameters<typeof fetch>[0]) => {
        if (String(url).includes("/psid_needs_name?")) {
          return new Response(
            JSON.stringify({
              first_name: "Profile",
              last_name: "Lookup",
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
      },
    );
    const server = buildServer({
      store,
      dashboard,
      messengerPageAccessToken: "page_token",
      messengerGraphApiBaseUrl: "https://graph.local",
      messengerFetchImpl,
    });

    const sessions = await server.inject({
      method: "GET",
      url: "/dashboard/sessions",
    });

    expect(sessions.statusCode).toBe(200);
    expect(sessions.json().sessions[0]).toMatchObject({
      sessionId: "messenger:psid_needs_name",
      displayName: "Profile Lookup",
      avatarUrl: "https://graph.local/profile.jpg",
      externalUserId: "psid_needs_name",
    });
    await expect(
      store.getProfile("messenger", "psid_needs_name"),
    ).resolves.toMatchObject({
      displayName: "Profile Lookup",
      avatarUrl: "https://graph.local/profile.jpg",
    });
  });

  it("does not run the agent twice when Meta retries the same webhook message", async () => {
    const messengerFetchImpl = vi.fn(
      async (
        _url: Parameters<typeof fetch>[0],
        init?: Parameters<typeof fetch>[1],
      ) =>
        new Response(
          JSON.stringify(
            hasSenderAction(init)
              ? { recipient_id: "psid_user_1" }
              : { message_id: "messenger_reply_1" },
          ),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
    );
    const server = buildServer({
      messengerVerifyToken: "local_verify",
      metaPageId: "118976205445198",
      messengerPageAccessToken: "page_token_local",
      messengerGraphApiBaseUrl: "https://graph.local",
      messengerFetchImpl,
      toolPlanner: new StaticToolPlanner([
        {
          intent: "ordering",
          entities: {},
          toolCalls: [],
          responseClaims: [],
        },
      ]),
      responseComposer: {
        async composeResponse() {
          return "Dạ KFC hỗ trợ bạn.";
        },
      },
    });
    const payload = {
      object: "page",
      entry: [
        {
          id: "118976205445198",
          messaging: [
            {
              sender: { id: "psid_user_1" },
              recipient: { id: "118976205445198" },
              timestamp: 1783323124608,
              message: { mid: "mid_retry", text: "Cho mình 1 Combo 99K" },
            },
          ],
        },
      ],
    };

    const first = await server.inject({
      method: "POST",
      url: "/webhooks/messenger",
      payload,
    });
    const second = await server.inject({
      method: "POST",
      url: "/webhooks/messenger",
      payload,
    });

    expect(first.json()).toMatchObject({
      received: 1,
      processed: 1,
      skippedDuplicates: 0,
      failed: 0,
    });
    expect(second.json()).toMatchObject({
      received: 1,
      processed: 0,
      skippedDuplicates: 1,
      failed: 0,
    });
    expect(messengerFetchImpl).toHaveBeenCalledTimes(5);

    const turns = await server.inject({
      method: "GET",
      url: "/dashboard/sessions/messenger:psid_user_1/turns",
    });
    expect(turns.json().turns).toHaveLength(2);
  });

  it("records failed webhook delivery when outbound Messenger send fails", async () => {
    const messengerFetchImpl = vi.fn(
      async (
        _url: Parameters<typeof fetch>[0],
        init?: Parameters<typeof fetch>[1],
      ) =>
        new Response(
          JSON.stringify(
            hasSenderAction(init)
              ? { recipient_id: "psid_user_1" }
              : { error: { message: "Meta send failed" } },
          ),
          {
            status: hasSenderAction(init) ? 200 : 500,
            headers: { "Content-Type": "application/json" },
          },
        ),
    );
    const store = new MemoryStore();
    const server = buildServer({
      store,
      messengerVerifyToken: "local_verify",
      metaPageId: "118976205445198",
      messengerPageAccessToken: "page_token_local",
      messengerGraphApiBaseUrl: "https://graph.local",
      messengerFetchImpl,
      toolPlanner: new StaticToolPlanner([
        {
          intent: "ordering",
          entities: {},
          toolCalls: [],
          responseClaims: [],
        },
      ]),
      responseComposer: {
        async composeResponse() {
          return "Dạ KFC hỗ trợ bạn.";
        },
      },
    });

    const response = await server.inject({
      method: "POST",
      url: "/webhooks/messenger",
      payload: {
        object: "page",
        entry: [
          {
            id: "118976205445198",
            messaging: [
              {
                sender: { id: "psid_user_1" },
                recipient: { id: "118976205445198" },
                timestamp: 1783323124608,
                message: {
                  mid: "mid_failed_send",
                  text: "Cho mình 1 Combo 99K",
                },
              },
            ],
          },
        ],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      received: 1,
      processed: 0,
      skippedDuplicates: 0,
      failed: 1,
    });
    expect(
      await store.getWebhookDelivery("messenger", "mid_failed_send"),
    ).toMatchObject({
      status: "failed",
      lastError: "messenger_send_failed",
    });

    const events = await server.inject({
      method: "GET",
      url: "/dashboard/events/messenger:psid_user_1",
    });
    expect(events.json().events.at(-1)).toMatchObject({
      type: "assistant_reply_sent",
      payload: { deliveryStatus: "failed" },
    });
  });

  it("continues replying when Messenger sender actions fail", async () => {
    const messengerFetchImpl = vi.fn(
      async (
        _url: Parameters<typeof fetch>[0],
        init?: Parameters<typeof fetch>[1],
      ) => {
        if (hasSenderAction(init)) {
          return new Response(
            JSON.stringify({ error: { message: "Sender action unavailable" } }),
            {
              status: 500,
              headers: { "Content-Type": "application/json" },
            },
          );
        }
        return new Response(
          JSON.stringify({ message_id: "messenger_reply_1" }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      },
    );
    const store = new MemoryStore();
    const server = buildServer({
      store,
      messengerVerifyToken: "local_verify",
      metaPageId: "118976205445198",
      messengerPageAccessToken: "page_token_local",
      messengerGraphApiBaseUrl: "https://graph.local",
      messengerFetchImpl,
      toolPlanner: new StaticToolPlanner([
        {
          intent: "ordering",
          entities: {},
          toolCalls: [],
          responseClaims: [],
        },
      ]),
      responseComposer: {
        async composeResponse() {
          return "Dạ KFC vẫn hỗ trợ bạn.";
        },
      },
    });

    const response = await server.inject({
      method: "POST",
      url: "/webhooks/messenger",
      payload: {
        object: "page",
        entry: [
          {
            id: "118976205445198",
            messaging: [
              {
                sender: { id: "psid_user_1" },
                recipient: { id: "118976205445198" },
                timestamp: 1783323124608,
                message: {
                  mid: "mid_sender_action_failed",
                  text: "Cho mình 1 Combo 99K",
                },
              },
            ],
          },
        ],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      received: 1,
      processed: 1,
      skippedDuplicates: 0,
      failed: 0,
    });
    expect(
      await store.getWebhookDelivery("messenger", "mid_sender_action_failed"),
    ).toMatchObject({
      status: "processed",
      lastError: null,
    });

    const turns = await server.inject({
      method: "GET",
      url: "/dashboard/sessions/messenger:psid_user_1/turns",
    });
    expect(turns.json().turns.at(-1)).toMatchObject({
      role: "assistant",
      text: "Dạ KFC vẫn hỗ trợ bạn.",
      deliveryStatus: "sent",
    });
  });
});

function parseMessengerBody(
  init?: Parameters<typeof fetch>[1],
): Record<string, unknown> {
  const body = init?.body;
  if (typeof body !== "string") return {};
  return JSON.parse(body) as Record<string, unknown>;
}

function hasSenderAction(init?: Parameters<typeof fetch>[1]): boolean {
  return typeof parseMessengerBody(init)["sender_action"] === "string";
}
