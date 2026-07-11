import { describe, expect, it, vi } from 'vitest';
import { buildServer } from '../../src/api/server.js';
import { DashboardEventBus } from '../../src/dashboard/eventBus.js';
import type { ConversationTurn } from '../../src/domain/types.js';
import { StaticToolPlanner, type ToolPlanner, type ToolPlannerInput, type ToolPlannerOutput } from '../../src/llm/toolPlanner.js';
import type { MonitorSessionIntelligenceJudge } from '../../src/monitor/sessionIntelligence.js';
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

function hasSenderAction(init?: Parameters<typeof fetch>[1]): boolean {
  const body = JSON.parse(String(init?.body ?? '{}')) as { sender_action?: unknown };
  return typeof body.sender_action === 'string';
}

describe('human takeover session control', () => {
  it('refreshes an existing AI summary when AI resumes ownership', async () => {
    const store = new MemoryStore();
    await store.appendTurn({
      sessionId: 'messenger:psid_summary_refresh',
      channel: 'messenger',
      role: 'user',
      text: 'Tiếp tục hỗ trợ mình nhé.',
      externalMessageId: 'mid_summary_refresh',
      externalUserId: 'psid_summary_refresh',
      deliveryStatus: 'received',
      metadata: null,
    });
    await store.appendTurn({
      sessionId: 'messenger:psid_summary_refresh',
      channel: 'messenger',
      role: 'assistant',
      text: 'Nhân viên đã kiểm tra và bàn giao lại cho AI.',
      externalMessageId: 'mid_human_summary_refresh',
      externalUserId: 'psid_summary_refresh',
      deliveryStatus: 'sent',
      metadata: { authorType: 'human_agent', agentId: 'agent_1' },
    });
    const dashboard = new DashboardEventBus({
      initialEvents: [{
        id: 'dash_existing_intelligence',
        sessionId: 'messenger:psid_summary_refresh',
        type: 'session_intelligence_updated',
        payload: {
          sessionIntelligence: {
            schemaVersion: 1,
            orderStage: 'collecting_info',
            aiAutomationConfidencePercent: 0,
            riskLevel: 'high',
            priorityRank: 19,
            contextSummary: 'Phiên hỗ trợ có nhân viên tham gia.',
            evaluatedCustomerTurnCount: 1,
            reasons: ['human_joined', 'awaiting_customer_info'],
            evidence: {
              dashboardEventTypes: ['session_updated'],
              toolNames: [],
              escalationReasons: [],
              safetyGateReasons: [],
            },
            source: 'ai_monitor_judge',
            model: 'gpt-test',
            promptVersion: 'monitor-judge-v1',
            updatedAt: '2026-07-11T00:00:00.000Z',
          },
        },
        createdAt: '2026-07-11T00:00:00.000Z',
      }],
    });
    const monitorJudge: MonitorSessionIntelligenceJudge = {
      judge: vi.fn(async (input) => ({
        ...input.deterministicFallback,
        contextSummary: 'Khách yêu cầu gặp nhân viên, sau đó đồng ý tiếp tục.',
        source: 'ai_monitor_judge',
        model: 'gpt-test',
        promptVersion: 'monitor-judge-v1',
      })),
    };
    const server = buildServer({ store, dashboard, monitorJudge });

    const resume = await server.inject({
      method: 'POST',
      url: '/dashboard/sessions/messenger%3Apsid_summary_refresh/resume-ai',
      payload: { agentId: 'agent_1' },
    });
    const sessions = await server.inject({ method: 'GET', url: '/dashboard/sessions' });
    const session = sessions.json().sessions.find(
      (candidate: { sessionId: string }) => candidate.sessionId === 'messenger:psid_summary_refresh',
    );

    expect(resume.statusCode).toBe(200);
    expect(monitorJudge.judge).toHaveBeenCalledOnce();
    expect(session.sessionIntelligence).toMatchObject({
      contextSummary: 'AI đã tiếp quản lại phiên hỗ trợ. Sau đó đồng ý tiếp tục.',
      aiAutomationConfidencePercent: 75,
      riskLevel: 'low',
      reasons: expect.arrayContaining(['ai_resumed']),
      source: 'ai_monitor_judge',
    });
  });

  it('uses deterministic intelligence for human control transitions', async () => {
    const monitorJudge: MonitorSessionIntelligenceJudge = {
      judge: vi.fn(async () => {
        throw new Error('control transitions must not wait for the LLM judge');
      }),
    };
    const server = buildServer({ monitorJudge });

    const join = await server.inject({
      method: 'POST',
      url: '/dashboard/sessions/messenger%3Apsid_fast_control/human-join',
      payload: { agentId: 'agent_1' },
    });
    const resume = await server.inject({
      method: 'POST',
      url: '/dashboard/sessions/messenger%3Apsid_fast_control/resume-ai',
      payload: { agentId: 'agent_1' },
    });

    expect(join.statusCode).toBe(200);
    expect(resume.statusCode).toBe(200);
    expect(monitorJudge.judge).not.toHaveBeenCalled();
  });

  it('supports first-party KFC join, human messages, cursor updates, and AI resume', async () => {
    const server = buildServer();
    const join = await server.inject({ method: 'POST', url: '/dashboard/sessions/kfc%3Aanon_customer_1/human-join', payload: { agentId: 'agent_1' } });
    expect(join.statusCode).toBe(200);
    expect(join.json()).toMatchObject({ agentMode: 'human_paused', assignedAgentId: 'agent_1' });
    const message = await server.inject({
      method: 'POST', url: '/dashboard/sessions/kfc%3Aanon_customer_1/human-message',
      payload: { agentId: 'agent_1', text: 'Em đang kiểm tra đơn cho anh/chị.' },
    });
    expect(message.statusCode).toBe(200);
    const updates = await server.inject({ method: 'GET', url: '/chat/kfc/sessions/kfc%3Aanon_customer_1/updates' });
    expect(updates.statusCode).toBe(200);
    expect(updates.json()).toMatchObject({
      agentMode: 'human_paused', handoffStatus: 'joined', assignedAgentId: 'agent_1',
      turns: [expect.objectContaining({ role: 'assistant', text: 'Em đang kiểm tra đơn cho anh/chị.', metadata: expect.objectContaining({ authorType: 'human_agent' }) })],
    });
    const turnId = updates.json().turns[0].id as string;
    const after = await server.inject({ method: 'GET', url: `/chat/kfc/sessions/kfc%3Aanon_customer_1/updates?after=${encodeURIComponent(turnId)}` });
    expect(after.json().turns).toEqual([]);
    const resume = await server.inject({ method: 'POST', url: '/dashboard/sessions/kfc%3Aanon_customer_1/resume-ai', payload: { agentId: 'agent_1' } });
    expect(resume.statusCode).toBe(200);
    expect(resume.json()).toMatchObject({ agentMode: 'ai_active' });
  });

  it('records a skipped assistant reply while a session is human paused', async () => {
    const store = new MemoryStore();
    const messengerFetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ recipient_id: 'psid_paused' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const server = buildServer({
      store,
      messengerVerifyToken: 'local_verify',
      metaPageId: '118976205445198',
      messengerPageAccessToken: 'page_token_local',
      messengerGraphApiBaseUrl: 'https://graph.local',
      messengerFetchImpl,
    });

    await server.inject({
      method: 'POST',
      url: '/dashboard/sessions/messenger%3Apsid_paused/human-join',
      payload: { agentId: 'agent_1' },
    });

    await postMessengerText(server, 'mid_paused_1', 'psid_paused', 'Có ai xử lý chưa?');

    expect(sentTextMessages(messengerFetchImpl)).toHaveLength(0);
    const delivery = await store.getWebhookDelivery('messenger', 'mid_paused_1');
    expect(delivery).toMatchObject({ status: 'processed', lastError: null });

    const events = await server.inject({ method: 'GET', url: '/dashboard/events/messenger%3Apsid_paused' });
    const dashboardEvents = events.json().events as Array<{ type: string; payload: Record<string, unknown> }>;
    expect(dashboardEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'assistant_reply_skipped',
          payload: expect.objectContaining({
            reason: 'human_paused',
            agentMode: 'human_paused',
            agentId: 'agent_1',
            externalMessageId: 'mid_paused_1',
          }),
        }),
      ]),
    );
  });

  it('replies to the latest unanswered paused inbound when AI resumes', async () => {
    const store = new MemoryStore();
    const messengerFetchImpl = vi.fn(async (_url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
      new Response(JSON.stringify(hasSenderAction(init) ? { recipient_id: 'psid_paused' } : { message_id: 'reply_after_resume' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const planner = new CapturingToolPlanner([
      {
        intent: 'unclear',
        entities: {},
        toolCalls: [],
        responseClaims: [],
        directResponse: 'Mình đã quay lại hỗ trợ đơn này.',
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

    await server.inject({
      method: 'POST',
      url: '/dashboard/sessions/messenger%3Apsid_paused/human-join',
      payload: { agentId: 'agent_1' },
    });
    await postMessengerText(server, 'mid_paused_2', 'psid_paused', 'Có ai xử lý chưa?');
    expect(sentTextMessages(messengerFetchImpl)).toHaveLength(0);

    const resume = await server.inject({
      method: 'POST',
      url: '/dashboard/sessions/messenger%3Apsid_paused/resume-ai',
      payload: { agentId: 'agent_1' },
    });

    expect(resume.statusCode).toBe(200);
    expect(sentTextMessages(messengerFetchImpl)).toHaveLength(1);
    expect(planner.inputs).toHaveLength(1);
    expect(planner.inputs[0]?.state.latestUserMessage).toBe('Có ai xử lý chưa?');

    const turns = await store.listTurns('messenger:psid_paused');
    expect(turns.map((turn) => turn.text)).toEqual(['Có ai xử lý chưa?', 'Mình đã quay lại hỗ trợ đơn này.']);
    expect(turns.at(-1)).toMatchObject({
      role: 'assistant',
      deliveryStatus: 'sent',
      externalMessageId: 'reply_after_resume',
    });
  });

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
    const resumedSnapshots = (await store.listEvents('messenger:psid_angry')).filter(
      (event) => event.sourceType === 'graph:verified_state',
    );
    expect(resumedSnapshots.at(-1)?.payload.verifiedState).not.toHaveProperty('handoff');

    await postMessengerText(server, 'mid_angry_3', 'psid_angry', 'Ok, tiếp tục giúp tôi');
    expect(sentTextMessages(messengerFetchImpl)).toHaveLength(3);

    expect(planner.inputs).toHaveLength(2);
    expect(planner.inputs[1]?.state.handoff).toBeUndefined();
    expect(planner.inputs[1]?.recentTurns.map((turn) => turn.text)).toEqual([
      'Tôi bực quá, đồ giao sai hết rồi',
      'Mình đã ghi nhận yêu cầu và sẽ chuyển nhân viên KFC hỗ trợ.',
      'Có ai xử lý chưa?',
      'Em là nhân viên KFC, em đang kiểm tra đơn sai món cho anh/chị.',
      'Ok, tiếp tục giúp tôi',
    ]);

    const turns = await store.listTurns('messenger:psid_angry');
    expect(turns.map((turn) => turn.text)).toEqual([
      'Tôi bực quá, đồ giao sai hết rồi',
      'Mình đã ghi nhận yêu cầu và sẽ chuyển nhân viên KFC hỗ trợ.',
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
    const dashboardEvents = events.json().events as Array<{ type: string; payload: Record<string, unknown> }>;
    expect(dashboardEvents).toEqual(
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
    expect(
      dashboardEvents
        .filter((event) => event.type === 'session_intelligence_updated')
        .map((event) => event.payload.sessionIntelligence),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          aiAutomationConfidencePercent: 0,
          riskLevel: 'high',
          reasons: expect.arrayContaining(['human_joined']),
        }),
        expect.objectContaining({
          reasons: expect.arrayContaining(['ai_resumed']),
        }),
      ]),
    );
    const finalIntelligence = dashboardEvents
      .filter((event) => event.type === 'session_intelligence_updated')
      .at(-1)?.payload.sessionIntelligence as { reasons?: string[] };
    expect(finalIntelligence.reasons).not.toContain('handoff_required');
  });
});

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
