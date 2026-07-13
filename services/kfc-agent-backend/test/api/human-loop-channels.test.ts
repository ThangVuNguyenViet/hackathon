import { describe, expect, it, vi } from "vitest";
import { buildServer } from "../../src/api/server.js";
import {
  StaticToolPlanner,
  type ToolPlanner,
  type ToolPlannerInput,
  type ToolPlannerOutput,
} from "../../src/llm/toolPlanner.js";

type Channel = "messenger" | "zalo";
type FetchSpy = ReturnType<typeof vi.fn>;

const scenario05UserTurns = [
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
  server: { inject(input: { method: string; url: string; payload: unknown }): Promise<unknown> },
  channel: Channel,
  userId: string,
  externalMessageId: string,
  text: string,
): Promise<void> {
  const response = (await server.inject(
    channel === "messenger"
      ? {
          method: "POST",
          url: "/webhooks/messenger",
          payload: {
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
          },
        }
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

class CapturingToolPlanner implements ToolPlanner {
  readonly supportsMultiStep = false;
  readonly inputs: ToolPlannerInput[] = [];
  private readonly staticPlanner: StaticToolPlanner;

  constructor(outputs: ToolPlannerOutput[]) {
    this.staticPlanner = new StaticToolPlanner(outputs);
  }

  async plan(input: ToolPlannerInput): Promise<ToolPlannerOutput> {
    this.inputs.push(input);
    return this.staticPlanner.plan(input);
  }
}

describe.each<Channel>(["messenger", "zalo"])(
  "human loop channel proof: %s",
  (channel) => {
    it("runs scenario 05 through warning, human takeover, human reply, and AI resume", async () => {
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
      const planner = new CapturingToolPlanner([
        {
          intent: "complaint",
          entities: {},
          toolCalls: [],
          responseClaims: [],
          directResponse: "Mình đã ghi nhận thiếu món.",
        },
        {
          intent: "complaint",
          entities: {},
          toolCalls: [],
          responseClaims: [],
          directResponse: "Mình đã ghi nhận giao sai món.",
        },
        {
          intent: "complaint",
          entities: {},
          toolCalls: [],
          responseClaims: [],
          directResponse: "Mình xin lỗi vì đơn giao chậm.",
        },
        {
          intent: "handoff",
          entities: {},
          toolCalls: [
            {
              toolName: "handoff",
              arguments: { reasons: ["missing_item", "wrong_item", "late_delivery", "angry_customer", "human_requested"] },
            },
          ],
          responseClaims: [],
          directResponse: "Mình sẽ chuyển bạn đến nhân viên hỗ trợ ngay.",
        },
        {
          intent: "unclear",
          entities: {},
          toolCalls: [],
          responseClaims: [],
          directResponse: "Mình tiếp tục hỗ trợ bạn.",
        },
        {
          intent: "unclear",
          entities: {},
          toolCalls: [],
          responseClaims: [],
          directResponse: "Mình tiếp tục hỗ trợ đơn này.",
        },
      ]);
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
        toolPlanner: planner,
        responseComposer: {
          async composeResponse(input) {
            return input.fallbackText;
          },
        },
      });

      for (const [index, text] of scenario05UserTurns.entries()) {
        await postCustomer(server, channel, userId, `${channel}_scenario05_${index + 1}`, text);
      }

      const handoffEvents = await server.inject({
        method: "GET",
        url: `/dashboard/events/${encodeURIComponent(sessionId)}`,
      });
      expect(handoffEvents).toMatchObject({ statusCode: 200 });
      expect(
        (handoffEvents as { json(): { events: Array<{ type: string }> } }).json().events,
      ).toEqual(expect.arrayContaining([expect.objectContaining({ type: "handoff_required" })]));

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
        payload: { agentId: "agent_1", text: "Em là nhân viên KFC, em đang kiểm tra đơn cho anh/chị." },
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
      expect(planner.inputs.at(-1)?.recentTurns.map((turn) => turn.text)).toEqual(
        expect.arrayContaining([
          "Có ai xử lý chưa?",
          "Ok, tiếp tục giúp tôi",
        ]),
      );

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
