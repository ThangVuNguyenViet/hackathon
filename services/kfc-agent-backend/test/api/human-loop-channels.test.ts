import { fakeModel } from "@langchain/core/testing";
import { describe, expect, it, vi } from "vitest";
import { buildDemoAdminServer as createServer } from '../fixtures/demoAdminServer.js';
import {
  groundedResponseModelReply,
  groundedResponseVerifierModel,
} from "../fixtures/groundedResponse.js";
import { signedMessengerWebhook, TEST_META_APP_SECRET } from '../fixtures/signedMessengerWebhook.js';
import { testAgent } from "../fixtures/testAgent.js";

const buildServer = (options: Parameters<typeof createServer>[0] = {}) =>
  createServer({ metaAppSecret: TEST_META_APP_SECRET, ...options });

type Channel = "messenger" | "zalo";
type FetchSpy = ReturnType<typeof vi.fn>;

const customerTurnsBeforeTakeover = [
  "Mình nhận thiếu 1 phần khoai.",
  "Với lại mình đặt gà cay mà giao gà thường.",
  "Đơn gì mà lâu quá vậy, bực mình thật.",
  "Cho mình gặp nhân viên.",
];

function sentTextMessages(fetchImpl: FetchSpy): Array<Record<string, unknown>> {
  return fetchImpl.mock.calls.flatMap(([, init]) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    const message = body.message;
    if (
      typeof message !== "object" ||
      message === null ||
      typeof (message as { text?: unknown }).text !== "string"
    ) {
      return [];
    }
    return [body];
  });
}

function responseFor(channel: Channel, userId: string, callCount: number): Response {
  return channel === "messenger"
    ? new Response(JSON.stringify({ message_id: `messenger_reply_${callCount}` }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    : new Response(JSON.stringify({ error: 0, message_id: `zalo_reply_${callCount}` }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
}

async function postCustomer(
  server: { inject(input: { method: string; url: string; payload: unknown; headers?: Record<string, string> }): Promise<unknown> },
  channel: Channel,
  userId: string,
  externalMessageId: string,
  text: string,
): Promise<void> {
  const response = (await server.inject(
    channel === "messenger"
      ? signedMessengerWebhook({
            object: "page",
            entry: [
              {
                id: "118976205445198",
                messaging: [
                  {
                    sender: { id: userId },
                    recipient: { id: "118976205445198" },
                    timestamp: 1783323124608,
                    message: { mid: externalMessageId, text },
                  },
                ],
              },
            ],
        })
      : {
          method: "POST",
          url: "/webhooks/zalo",
          payload: {
            event_name: "user_send_text",
            sender: { id: userId },
            recipient: { id: "oa_local" },
            message: { msg_id: externalMessageId, text },
            timestamp: 1783323124608,
          },
        },
  )) as { statusCode: number };

  expect(response.statusCode).toBe(200);
}

describe.each<Channel>(["messenger", "zalo"])(
  "human loop channel proof: %s",
  (channel) => {
    it("runs customer turns through human takeover, human reply, and AI resume", async () => {
      const userId = `${channel}_human_loop_user`;
      const sessionId = `${channel}:${userId}`;
      const fetchImpl = vi.fn(async (_url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
        const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
        if (channel === "messenger" && typeof body.sender_action === "string") {
          return new Response(JSON.stringify({ recipient_id: userId }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return responseFor(channel, userId, fetchImpl.mock.calls.length);
      });
      const model = fakeModel();
      for (const customerText of [
        "Mình đã ghi nhận thiếu món.",
        "Mình đã ghi nhận giao sai món.",
        "Mình xin lỗi vì đơn giao chậm.",
        "Mình đã ghi nhận yêu cầu gặp nhân viên.",
        "Mình tiếp tục hỗ trợ đơn này.",
      ]) {
        model.respond(groundedResponseModelReply({ customerText }));
      }
      const server = buildServer({
        metaPageId: "118976205445198",
        messengerVerifyToken: "local_verify",
        messengerPageAccessToken: "page_token_local",
        messengerGraphApiBaseUrl: "https://graph.local",
        messengerFetchImpl: fetchImpl,
        zaloOaId: "oa_local",
        zaloAccessToken: "zalo_token_local",
        zaloApiBaseUrl: "https://zalo.local",
        zaloFetchImpl: fetchImpl,
        ...testAgent(model, groundedResponseVerifierModel()),
      });

      for (const [index, text] of customerTurnsBeforeTakeover.entries()) {
        await postCustomer(server, channel, userId, `${channel}_before_takeover_${index + 1}`, text);
      }

      const join = await server.inject({
        method: "POST",
        url: `/dashboard/sessions/${encodeURIComponent(sessionId)}/human-join`,
        payload: { agentId: "agent_1" },
      });
      expect(join).toMatchObject({ statusCode: 200 });

      const repliesBeforePausedTurn = sentTextMessages(fetchImpl).length;
      await postCustomer(server, channel, userId, `${channel}_paused_1`, "Có ai xử lý chưa?");
      expect(sentTextMessages(fetchImpl)).toHaveLength(repliesBeforePausedTurn);

      const pausedEvents = await server.inject({
        method: "GET",
        url: `/dashboard/events/${encodeURIComponent(sessionId)}`,
      });
      expect(
        (pausedEvents as { json(): { events: Array<{ type: string; payload: Record<string, unknown> }> } }).json().events,
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "assistant_reply_skipped",
            payload: expect.objectContaining({ reason: "human_paused", channel }),
          }),
        ]),
      );

      const humanReply = await server.inject({
        method: "POST",
        url: `/dashboard/sessions/${encodeURIComponent(sessionId)}/human-message`,
        payload: {
          agentId: "agent_1",
          clientRequestId: `${channel}_human_reply_1`,
          text: "Em là nhân viên KFC, em đang kiểm tra đơn cho anh/chị.",
        },
      });
      expect(humanReply).toMatchObject({ statusCode: 200 });
      expect(sentTextMessages(fetchImpl)).toHaveLength(repliesBeforePausedTurn + 1);

      const resume = await server.inject({
        method: "POST",
        url: `/dashboard/sessions/${encodeURIComponent(sessionId)}/resume-ai`,
        payload: { agentId: "agent_1" },
      });
      expect(resume).toMatchObject({ statusCode: 200 });

      const afterResumeEvents = await server.inject({
        method: "GET",
        url: `/dashboard/events/${encodeURIComponent(sessionId)}`,
      });
      const sessionEvents = (afterResumeEvents as { json(): { events: Array<{ type: string; payload: Record<string, unknown> }> } }).json().events;
      const latestIntelligence = sessionEvents
        .filter((event) => event.type === "session_intelligence_updated")
        .at(-1)?.payload.sessionIntelligence as Record<string, unknown> | undefined;
      expect(latestIntelligence).toMatchObject({ riskLevel: "low" });
      expect(latestIntelligence?.reasons).not.toContain("handoff_required");

      await postCustomer(server, channel, userId, `${channel}_after_resume_1`, "Ok, tiếp tục giúp tôi");
      expect(sentTextMessages(fetchImpl)).toHaveLength(repliesBeforePausedTurn + 2);
      const finalPrompt = model.calls.at(-1)?.messages
        .map((message) => message.text)
        .join("\n");
      expect(finalPrompt).toContain("Có ai xử lý chưa?");
      expect(finalPrompt).toContain("Ok, tiếp tục giúp tôi");

      const turns = await server.inject({
        method: "GET",
        url: `/dashboard/sessions/${encodeURIComponent(sessionId)}/turns`,
      });
      const transcript = (turns as { json(): { turns: Array<Record<string, unknown>> } }).json().turns;
      expect(transcript).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ role: "assistant", metadata: { authorType: "human_agent", agentId: "agent_1" } }),
          expect.objectContaining({ role: "user", text: "Có ai xử lý chưa?" }),
          expect.objectContaining({ role: "user", text: "Ok, tiếp tục giúp tôi" }),
        ]),
      );
    });
  },
);
