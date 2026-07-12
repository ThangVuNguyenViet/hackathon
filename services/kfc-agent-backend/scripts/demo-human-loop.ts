import { buildServer } from "../src/api/server.js";
import { StaticToolPlanner } from "../src/llm/toolPlanner.js";

const sessionId = "messenger:demo_human_loop";
const customerId = "demo_human_loop";

const server = buildServer({
  metaPageId: "118976205445198",
  messengerVerifyToken: "local_verify",
  messengerPageAccessToken: "page_token_local",
  messengerGraphApiBaseUrl: "https://graph.local",
  messengerFetchImpl: async (_url, init) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    if (typeof body["sender_action"] === "string") {
      return new Response(JSON.stringify({ recipient_id: customerId }), { status: 200 });
    }
    return new Response(JSON.stringify({ message_id: `demo_reply_${Date.now()}` }), { status: 200 });
  },
  toolPlanner: new StaticToolPlanner([
    {
      intent: "handoff",
      entities: {},
      toolCalls: [{ toolName: "handoff", arguments: { reasons: ["angry_customer", "human_requested"] } }],
      responseClaims: [],
      directResponse: "Mình sẽ chuyển bạn đến nhân viên hỗ trợ ngay.",
    },
    {
      intent: "unclear",
      entities: {},
      toolCalls: [],
      responseClaims: [],
      directResponse: "Mình tiếp tục hỗ trợ đơn này.",
    },
  ]),
  responseComposer: {
    async composeResponse(input) {
      return input.fallbackText;
    },
  },
});

async function customerMessage(messageId: string, text: string): Promise<void> {
  const response = await server.inject({
    method: "POST",
    url: "/webhooks/messenger",
    payload: {
      object: "page",
      entry: [{
        id: "118976205445198",
        messaging: [{
          sender: { id: customerId },
          recipient: { id: "118976205445198" },
          timestamp: 1783323124608,
          message: { mid: messageId, text },
        }],
      }],
    },
  });
  if (response.statusCode !== 200) throw new Error(`customer message failed: ${response.statusCode}`);
}

async function snapshot(step: string): Promise<void> {
  const response = await server.inject({ method: "GET", url: "/dashboard/sessions" });
  const session = response.json().sessions.find((candidate: { sessionId: string }) => candidate.sessionId === sessionId);
  console.log(JSON.stringify({
    step,
    agentMode: session?.agentMode ?? null,
    intelligence: session?.sessionIntelligence ?? null,
  }));
}

await customerMessage("demo_warning_1", "Tôi bực quá, cho mình gặp nhân viên.");
await snapshot("warning_escalation");

const join = await server.inject({
  method: "POST",
  url: `/dashboard/sessions/${encodeURIComponent(sessionId)}/human-join`,
  payload: { agentId: "agent_demo" },
});
console.log(JSON.stringify({ step: "human_joined", response: join.json() }));

await customerMessage("demo_paused_1", "Có ai xử lý chưa?");
const humanMessage = await server.inject({
  method: "POST",
  url: `/dashboard/sessions/${encodeURIComponent(sessionId)}/human-message`,
  payload: { agentId: "agent_demo", text: "Em là nhân viên KFC, em đang kiểm tra đơn cho anh/chị." },
});
console.log(JSON.stringify({ step: "human_reply", response: humanMessage.json() }));

const resume = await server.inject({
  method: "POST",
  url: `/dashboard/sessions/${encodeURIComponent(sessionId)}/resume-ai`,
  payload: { agentId: "agent_demo" },
});
console.log(JSON.stringify({ step: "ai_resumed", response: resume.json() }));
await snapshot("ai_handling_after_resume");

await customerMessage("demo_after_resume_1", "Ok, tiếp tục giúp tôi.");
const turns = await server.inject({
  method: "GET",
  url: `/dashboard/sessions/${encodeURIComponent(sessionId)}/turns`,
});
console.log(JSON.stringify({
  step: "post_resume_ai_reply",
  transcript: turns.json().turns.slice(-4).map((turn: { role: string; text: string; metadata?: unknown | undefined }) => ({
    role: turn.role,
    text: turn.text,
    metadata: turn.metadata ?? null,
  })),
}));
