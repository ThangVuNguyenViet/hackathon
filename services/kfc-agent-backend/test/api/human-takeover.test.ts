import { describe, expect, it, vi } from 'vitest';
import { buildServer } from '../../src/api/server.js';
import type { ConversationTurn } from '../../src/domain/types.js';
import { StaticToolPlanner, type ToolPlanner, type ToolPlannerInput, type ToolPlannerOutput } from '../../src/llm/toolPlanner.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';

type FetchSpy = ReturnType<typeof vi.fn>;

function sentTextMessages(fetchImpl: FetchSpy): Array<Record<string, unknown>> {
  return fetchImpl.mock.calls.flatMap(([, init]) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    const message = body.message;
    if (typeof message !== 'object' || message === null || typeof (message as { text?: unknown }).text !== 'string') {
      return [];
    }
    return [body];
  });
}

describe('human takeover session control', () => {
  it('pauses AI replies during human takeover and resumes with takeover transcript context', async () => {
    const store = new MemoryStore();
    const messengerFetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ message_id: `reply_${messengerFetchImpl.mock.calls.length}` }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const planner = new CapturingToolPlanner([
      {
        intent: 'handoff',
        entities: {},
        toolCalls: [{ toolName: 'handoff', arguments: { reasons: ['angry_customer', 'human_requested'] } }],
        responseClaims: [],
        directResponse: 'Mình sẽ chuyển nhân viên hỗ trợ ngay.',
      },
      {
        intent: 'unclear',
        entities: {},
        toolCalls: [],
        responseClaims: [],
        directResponse: 'Mình tiếp tục hỗ trợ đơn này.',
      },
    ]);
    const server = buildServer({
      store,
      messengerVerifyToken: 'local_verify',
      metaPageId: '118976205445198',
      messengerPageAccessToken: 'page_token_local',
      messengerGraphApiBaseUrl: 'https://graph.local',
      messengerFetchImpl,
      toolPlanner: planner,
      responseComposer: {
        async composeResponse(input) {
          return input.fallbackText;
        },
      },
    });

    await postMessengerText(server, 'mid_angry_1', 'psid_angry', 'Tôi bực quá, đồ giao sai hết rồi');
    expect(sentTextMessages(messengerFetchImpl)).toHaveLength(1);

    const join = await server.inject({
      method: 'POST',
      url: '/dashboard/sessions/messenger%3Apsid_angry/human-join',
      payload: { agentId: 'agent_1' },
    });
    expect(join.statusCode).toBe(200);
    expect(join.json()).toMatchObject({ sessionId: 'messenger:psid_angry', agentMode: 'human_paused' });

    await postMessengerText(server, 'mid_angry_2', 'psid_angry', 'Có ai xử lý chưa?');
    expect(sentTextMessages(messengerFetchImpl)).toHaveLength(1);

    const humanReply = await server.inject({
      method: 'POST',
      url: '/dashboard/sessions/messenger%3Apsid_angry/human-message',
      payload: { agentId: 'agent_1', text: 'Em là nhân viên KFC, em đang kiểm tra đơn sai món cho anh/chị.' },
    });
    expect(humanReply.statusCode).toBe(200);
    expect(sentTextMessages(messengerFetchImpl)).toHaveLength(2);

    const resume = await server.inject({
      method: 'POST',
      url: '/dashboard/sessions/messenger%3Apsid_angry/resume-ai',
      payload: { agentId: 'agent_1' },
    });
    expect(resume.statusCode).toBe(200);
    expect(resume.json()).toMatchObject({ sessionId: 'messenger:psid_angry', agentMode: 'ai_active' });

    await postMessengerText(server, 'mid_angry_3', 'psid_angry', 'Ok, tiếp tục giúp tôi');
    expect(sentTextMessages(messengerFetchImpl)).toHaveLength(3);

    expect(planner.inputs).toHaveLength(2);
    expect(planner.inputs[1]?.recentTurns.map((turn) => turn.text)).toEqual([
      'Tôi bực quá, đồ giao sai hết rồi',
      'Mình sẽ chuyển nhân viên hỗ trợ ngay.',
      'Có ai xử lý chưa?',
      'Em là nhân viên KFC, em đang kiểm tra đơn sai món cho anh/chị.',
      'Ok, tiếp tục giúp tôi',
    ]);

    const turns = await store.listTurns('messenger:psid_angry');
    expect(turns.map((turn) => turn.text)).toEqual([
      'Tôi bực quá, đồ giao sai hết rồi',
      'Mình sẽ chuyển nhân viên hỗ trợ ngay.',
      'Có ai xử lý chưa?',
      'Em là nhân viên KFC, em đang kiểm tra đơn sai món cho anh/chị.',
      'Ok, tiếp tục giúp tôi',
      'Mình tiếp tục hỗ trợ đơn này.',
    ]);
    expect(turns[3]).toMatchObject({
      role: 'assistant',
      deliveryStatus: 'sent',
      metadata: { authorType: 'human_agent', agentId: 'agent_1' },
    });

    const events = await server.inject({ method: 'GET', url: '/dashboard/events/messenger%3Apsid_angry' });
    expect(events.json().events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'handoff_required' }),
        expect.objectContaining({
          type: 'session_updated',
          payload: expect.objectContaining({ updateType: 'human_joined', agentMode: 'human_paused' }),
        }),
        expect.objectContaining({
          type: 'session_updated',
          payload: expect.objectContaining({ updateType: 'ai_resumed', agentMode: 'ai_active' }),
        }),
      ]),
    );
  });
});

class CapturingToolPlanner implements ToolPlanner {
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

async function postMessengerText(
  server: { inject(input: { method: string; url: string; payload: unknown }): Promise<unknown> },
  mid: string,
  senderId: string,
  text: string,
): Promise<void> {
  const response = (await server.inject({
    method: 'POST',
    url: '/webhooks/messenger',
    payload: {
      object: 'page',
      entry: [
        {
          id: '118976205445198',
          messaging: [
            {
              sender: { id: senderId },
              recipient: { id: '118976205445198' },
              timestamp: 1783323124608,
              message: { mid, text },
            },
          ],
        },
      ],
    },
  })) as { statusCode: number; json(): unknown };

  expect(response.statusCode).toBe(200);
}
