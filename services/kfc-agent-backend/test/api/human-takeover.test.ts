import { fakeModel } from '@langchain/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { buildDemoAdminServer as createServer } from '../fixtures/demoAdminServer.js';
import { DashboardEventBus } from '../../src/dashboard/eventBus.js';
import type { ConversationTurn } from '../../src/domain/types.js';
import type { MonitorSessionIntelligenceJudge } from '../../src/monitor/sessionIntelligence.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';
import {
  groundedResponseModelReply,
  groundedResponseVerifierModel,
} from '../fixtures/groundedResponse.js';
import { signedMessengerWebhook, TEST_META_APP_SECRET } from '../fixtures/signedMessengerWebhook.js';
import { testAgent } from '../fixtures/testAgent.js';

const buildServer = (options: Parameters<typeof createServer>[0] = {}) =>
  createServer({ metaAppSecret: TEST_META_APP_SECRET, ...options });

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
        contextSummary: 'AI tiếp tục hỗ trợ sau khi khách đồng ý.',
        source: 'ai_monitor_judge',
        model: 'gpt-test',
        promptVersion: 'monitor-judge-v1',
      })),
    };
    const deferredTasks: Array<() => Promise<void>> = [];
    const server = buildServer({
      store,
      dashboard,
      monitorJudge,
      defer: (task) => deferredTasks.push(task),
    });

    const resume = await server.inject({
      method: 'POST',
      url: '/dashboard/sessions/messenger%3Apsid_summary_refresh/resume-ai',
      payload: { agentId: 'agent_1' },
    });
    const immediateSessions = await server.inject({
      method: 'GET',
      url: '/dashboard/sessions',
    });
    const immediateSession = immediateSessions.json().sessions.find(
      (candidate: { sessionId: string }) => candidate.sessionId === 'messenger:psid_summary_refresh',
    );

    expect(resume.statusCode).toBe(200);
    expect(monitorJudge.judge).not.toHaveBeenCalled();
    expect(deferredTasks).toHaveLength(1);
    expect(immediateSession.sessionIntelligence).toMatchObject({
      aiAutomationConfidencePercent: 75,
      riskLevel: 'low',
      contextSummary: '',
      reasons: expect.arrayContaining(['ai_resumed']),
      source: 'runtime_rule_fallback',
    });

    await deferredTasks[0]?.();
    const refinedSessions = await server.inject({
      method: 'GET',
      url: '/dashboard/sessions',
    });
    const refinedSession = refinedSessions.json().sessions.find(
      (candidate: { sessionId: string }) => candidate.sessionId === 'messenger:psid_summary_refresh',
    );

    expect(monitorJudge.judge).toHaveBeenCalledOnce();
    expect(refinedSession.sessionIntelligence).toMatchObject({
      contextSummary: 'AI tiếp tục hỗ trợ sau khi khách đồng ý.',
      aiAutomationConfidencePercent: 75,
      riskLevel: 'low',
      reasons: expect.arrayContaining(['ai_resumed']),
      source: 'ai_monitor_judge',
    });
  });

  it('discards a stale cross-request human-join refinement after AI resumes', async () => {
    const store = new MemoryStore();
    const joinDashboard = new DashboardEventBus();
    const resumeDashboard = new DashboardEventBus();
    await store.appendTurn({
      sessionId: 'messenger:psid_monitor_race',
      channel: 'messenger',
      role: 'user',
      text: 'Tiếp tục hỗ trợ mình nhé.',
      externalMessageId: 'mid_monitor_race_user',
      externalUserId: 'psid_monitor_race',
      deliveryStatus: 'received',
      metadata: null,
    });
    await store.appendTurn({
      sessionId: 'messenger:psid_monitor_race',
      channel: 'messenger',
      role: 'assistant',
      text: 'Nhân viên đã ghi nhận.',
      externalMessageId: 'mid_monitor_race_human',
      externalUserId: 'psid_monitor_race',
      deliveryStatus: 'sent',
      metadata: { authorType: 'human_agent', agentId: 'agent_1' },
    });
    const monitorJudge: MonitorSessionIntelligenceJudge = {
      judge: vi.fn(async (input) => ({
        ...input.deterministicFallback,
        contextSummary: input.humanJoined
          ? 'Nhân viên đang xử lý phiên hỗ trợ.'
          : 'AI tiếp tục xử lý phiên hỗ trợ.',
        source: 'ai_monitor_judge',
        model: 'gpt-test',
        promptVersion: 'monitor-judge-v1',
      })),
    };
    const deferredTasks: Array<{
      owner: 'join' | 'resume';
      task: () => Promise<void>;
    }> = [];
    const joinServer = buildServer({
      store,
      dashboard: joinDashboard,
      monitorJudge,
      defer: (task) => deferredTasks.push({ owner: 'join', task }),
    });
    const resumeServer = buildServer({
      store,
      dashboard: resumeDashboard,
      monitorJudge,
      defer: (task) => deferredTasks.push({ owner: 'resume', task }),
    });

    const join = await joinServer.inject({
      method: 'POST',
      url: '/dashboard/sessions/messenger%3Apsid_monitor_race/human-join',
      payload: { agentId: 'agent_1' },
    });
    const resume = await resumeServer.inject({
      method: 'POST',
      url: '/dashboard/sessions/messenger%3Apsid_monitor_race/resume-ai',
      payload: { agentId: 'agent_1' },
    });

    expect(join.statusCode).toBe(200);
    expect(resume.statusCode).toBe(200);
    expect(deferredTasks).toHaveLength(2);

    await deferredTasks.find(({ owner }) => owner === 'resume')?.task();
    await deferredTasks.find(({ owner }) => owner === 'join')?.task();

    const intelligence = resumeDashboard
      .listSessionSummaries()
      .find((summary) => summary.sessionId === 'messenger:psid_monitor_race')
      ?.sessionIntelligence;
    expect(monitorJudge.judge).toHaveBeenCalledTimes(2);
    expect(intelligence).toMatchObject({
      source: 'ai_monitor_judge',
      reasons: expect.arrayContaining(['ai_resumed']),
    });
    expect(intelligence?.reasons).not.toContain('human_joined');
    const staleAiEvents = joinDashboard
      .getEvents('messenger:psid_monitor_race')
      .filter((event) =>
        event.type === 'session_intelligence_updated' &&
        (event.payload.sessionIntelligence as { source?: unknown } | undefined)
          ?.source === 'ai_monitor_judge'
      );
    expect(staleAiEvents).toEqual([]);
  });

  it('can retry the same monitor revision after defer throws synchronously', async () => {
    const store = new MemoryStore();
    await store.appendTurn({
      sessionId: 'messenger:psid_monitor_schedule_retry',
      channel: 'messenger',
      role: 'user',
      text: 'Mình cần hỗ trợ.',
      externalMessageId: 'mid_monitor_schedule_retry',
      externalUserId: 'psid_monitor_schedule_retry',
      deliveryStatus: 'received',
      metadata: null,
    });
    const dashboard = new DashboardEventBus({
      initialEvents: [{
        id: 'dash_monitor_schedule_retry',
        sessionId: 'messenger:psid_monitor_schedule_retry',
        type: 'customer_message_received',
        payload: {},
        createdAt: new Date().toISOString(),
      }],
    });
    const monitorJudge: MonitorSessionIntelligenceJudge = {
      judge: vi.fn(async (input) => ({
        ...input.deterministicFallback,
        contextSummary: 'Khách đang chờ được hỗ trợ.',
        source: 'ai_monitor_judge',
        model: 'gpt-test',
        promptVersion: 'monitor-judge-v1',
      })),
    };
    const deferredTasks: Array<() => Promise<void>> = [];
    let failScheduling = true;
    const server = buildServer({
      store,
      dashboard,
      monitorJudge,
      defer: (task) => {
        if (failScheduling) {
          failScheduling = false;
          throw new Error('waitUntil unavailable');
        }
        deferredTasks.push(task);
      },
    });

    const first = await server.inject({
      method: 'GET',
      url: '/dashboard/sessions',
    });
    const second = await server.inject({
      method: 'GET',
      url: '/dashboard/sessions',
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(deferredTasks).toHaveLength(1);
    expect(monitorJudge.judge).not.toHaveBeenCalled();

    await deferredTasks[0]?.();

    expect(monitorJudge.judge).toHaveBeenCalledOnce();
    expect(
      dashboard
        .listSessionSummaries()
        .find(
          (summary) =>
            summary.sessionId ===
            'messenger:psid_monitor_schedule_retry',
        )
        ?.sessionIntelligence,
    ).toMatchObject({
      contextSummary: 'Khách đang chờ được hỗ trợ.',
      source: 'ai_monitor_judge',
    });
  });

  it('coalesces identical monitor evidence across two request runtimes', async () => {
    const sessionId = 'messenger:psid_monitor_cross_runtime_coalesce';
    const store = new MemoryStore();
    await store.appendTurn({
      sessionId,
      channel: 'messenger',
      role: 'user',
      text: 'Mình cần hỗ trợ.',
      externalMessageId: 'mid_monitor_cross_runtime_coalesce',
      externalUserId: 'psid_monitor_cross_runtime_coalesce',
      deliveryStatus: 'received',
      metadata: null,
    });
    const initialEvent = {
      id: 'dash_monitor_cross_runtime_coalesce',
      sessionId,
      type: 'customer_message_received' as const,
      payload: {},
      createdAt: new Date().toISOString(),
    };
    const firstDashboard = new DashboardEventBus({
      initialEvents: [initialEvent],
    });
    const secondDashboard = new DashboardEventBus({
      initialEvents: [initialEvent],
    });
    let releaseJudge!: () => void;
    const judgeBarrier = new Promise<void>((resolve) => {
      releaseJudge = resolve;
    });
    const monitorJudge: MonitorSessionIntelligenceJudge = {
      judge: vi.fn(async (input) => {
        await judgeBarrier;
        return {
          ...input.deterministicFallback,
          contextSummary: 'Khách đang chờ được hỗ trợ.',
          source: 'ai_monitor_judge',
          model: 'gpt-test',
          promptVersion: 'monitor-judge-v1',
        };
      }),
    };
    const firstTasks: Array<() => Promise<void>> = [];
    const secondTasks: Array<() => Promise<void>> = [];
    const firstServer = buildServer({
      store,
      dashboard: firstDashboard,
      monitorJudge,
      defer: (task) => firstTasks.push(task),
    });
    const secondServer = buildServer({
      store,
      dashboard: secondDashboard,
      monitorJudge,
      defer: (task) => secondTasks.push(task),
    });

    await firstServer.inject({ method: 'GET', url: '/dashboard/sessions' });
    await secondServer.inject({ method: 'GET', url: '/dashboard/sessions' });
    expect(firstTasks).toHaveLength(1);
    expect(secondTasks).toHaveLength(1);

    const firstRefinement = firstTasks[0]!();
    await vi.waitFor(() => {
      expect(monitorJudge.judge).toHaveBeenCalledOnce();
    });
    await secondTasks[0]!();

    expect(monitorJudge.judge).toHaveBeenCalledOnce();
    releaseJudge();
    await firstRefinement;
    expect(
      firstDashboard
        .listSessionSummaries()
        .find((summary) => summary.sessionId === sessionId)
        ?.sessionIntelligence?.source,
    ).toBe('ai_monitor_judge');
    expect(
      secondDashboard
        .getEvents(sessionId)
        .filter((event) =>
          event.type === 'session_intelligence_updated' &&
          (event.payload.sessionIntelligence as { source?: unknown } | undefined)
            ?.source === 'ai_monitor_judge'
        ),
    ).toEqual([]);
  });

  it('reclaims an expired durable monitor lease and fences the late owner', async () => {
    const sessionId = 'messenger:psid_monitor_lease_expiry';
    const store = new MemoryStore();
    await store.appendTurn({
      sessionId,
      channel: 'messenger',
      role: 'user',
      text: 'Mình cần hỗ trợ.',
      externalMessageId: 'mid_monitor_lease_expiry',
      externalUserId: 'psid_monitor_lease_expiry',
      deliveryStatus: 'received',
      metadata: null,
    });
    const initialEvent = {
      id: 'dash_monitor_lease_expiry',
      sessionId,
      type: 'customer_message_received' as const,
      payload: {},
      createdAt: new Date().toISOString(),
    };
    const firstDashboard = new DashboardEventBus({
      initialEvents: [initialEvent],
    });
    const retryDashboard = new DashboardEventBus({
      initialEvents: [initialEvent],
    });
    let releaseFirstJudge!: () => void;
    const firstJudgeBarrier = new Promise<void>((resolve) => {
      releaseFirstJudge = resolve;
    });
    let invocation = 0;
    const monitorJudge: MonitorSessionIntelligenceJudge = {
      judge: vi.fn(async (input) => {
        invocation += 1;
        if (invocation === 1) await firstJudgeBarrier;
        return {
          ...input.deterministicFallback,
          contextSummary: 'Khách đang chờ được hỗ trợ.',
          source: 'ai_monitor_judge',
          model: 'gpt-test',
          promptVersion: 'monitor-judge-v1',
        };
      }),
    };
    const firstTasks: Array<() => Promise<void>> = [];
    const retryTasks: Array<() => Promise<void>> = [];
    const firstServer = buildServer({
      store,
      dashboard: firstDashboard,
      monitorJudge,
      defer: (task) => firstTasks.push(task),
    });
    const retryServer = buildServer({
      store,
      dashboard: retryDashboard,
      monitorJudge,
      defer: (task) => retryTasks.push(task),
    });
    let nowMs = Date.now();
    const now = vi.spyOn(Date, 'now').mockImplementation(() => nowMs);

    try {
      await firstServer.inject({ method: 'GET', url: '/dashboard/sessions' });
      await retryServer.inject({ method: 'GET', url: '/dashboard/sessions' });
      const firstRefinement = firstTasks[0]!();
      await vi.waitFor(() => {
        expect(monitorJudge.judge).toHaveBeenCalledOnce();
      });

      nowMs += 31_000;
      await retryTasks[0]!();

      expect(monitorJudge.judge).toHaveBeenCalledTimes(2);
      expect(
        retryDashboard
          .listSessionSummaries()
          .find((summary) => summary.sessionId === sessionId)
          ?.sessionIntelligence?.source,
      ).toBe('ai_monitor_judge');

      releaseFirstJudge();
      await firstRefinement;

      expect(
        firstDashboard
          .getEvents(sessionId)
          .filter((event) =>
            event.type === 'session_intelligence_updated' &&
            (event.payload.sessionIntelligence as { source?: unknown } | undefined)
              ?.source === 'ai_monitor_judge'
          ),
      ).toEqual([]);
    } finally {
      now.mockRestore();
      releaseFirstJudge();
    }
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
    const pausedCustomerMessage = await server.inject({
      method: 'POST', url: '/chat/kfc/message',
      payload: {
        sessionId: 'kfc:anon_customer_1', customerId: 'anon_customer_1',
        clientMessageId: 'kfc_paused_1', text: 'Có ai đang kiểm tra đơn không?',
      },
    });
    expect(pausedCustomerMessage.statusCode).toBe(200);
    expect(pausedCustomerMessage.json()).toMatchObject({ responseText: '', suppressed: true, agentMode: 'human_paused' });
    const message = await server.inject({
      method: 'POST', url: '/dashboard/sessions/kfc%3Aanon_customer_1/human-message',
      payload: {
        agentId: 'agent_1',
        clientRequestId: 'kfc_human_reply_1',
        text: 'Em đang kiểm tra đơn cho anh/chị.',
      },
    });
    expect(message.statusCode).toBe(200);
    const updates = await server.inject({ method: 'GET', url: '/chat/kfc/sessions/kfc%3Aanon_customer_1/updates' });
    expect(updates.statusCode).toBe(200);
    expect(updates.json()).toMatchObject({
      agentMode: 'human_paused', handoffStatus: 'joined', assignedAgentId: 'agent_1',
      turns: expect.arrayContaining([
        expect.objectContaining({ role: 'user', text: 'Có ai đang kiểm tra đơn không?' }),
        expect.objectContaining({ role: 'assistant', text: 'Em đang kiểm tra đơn cho anh/chị.', metadata: expect.objectContaining({ authorType: 'human_agent' }) }),
      ]),
    });
    const turnId = updates.json().turns.at(-1).id as string;
    const after = await server.inject({ method: 'GET', url: `/chat/kfc/sessions/kfc%3Aanon_customer_1/updates?after=${encodeURIComponent(turnId)}` });
    expect(after.json().turns).toEqual([]);
    const resume = await server.inject({ method: 'POST', url: '/dashboard/sessions/kfc%3Aanon_customer_1/resume-ai', payload: { agentId: 'agent_1' } });
    expect(resume.statusCode).toBe(200);
    expect(resume.json()).toMatchObject({ agentMode: 'ai_active' });
  });

  it('replays a dashboard human-message request without duplicating its turn or provider send', async () => {
    const store = new MemoryStore();
    const messengerFetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ message_id: 'human-provider-message-1' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const server = buildServer({
      store,
      messengerPageAccessToken: 'page_token_local',
      messengerGraphApiBaseUrl: 'https://graph.local',
      messengerFetchImpl,
    });
    await server.inject({
      method: 'POST',
      url: '/dashboard/sessions/messenger%3Apsid_human_retry/human-join',
      payload: { agentId: 'agent_1' },
    });
    const request = {
      method: 'POST' as const,
      url: '/dashboard/sessions/messenger%3Apsid_human_retry/human-message',
      payload: {
        agentId: 'agent_1',
        clientRequestId: 'dashboard-human-retry-1',
        text: 'Em đang kiểm tra giúp anh/chị.',
      },
    };

    const first = await server.inject(request);
    const replay = await server.inject(request);

    expect(first.statusCode).toBe(200);
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toMatchObject({
      turnId: first.json().turnId,
      replayed: true,
    });
    expect(sentTextMessages(messengerFetchImpl)).toHaveLength(1);
    expect(await store.listTurns('messenger:psid_human_retry')).toEqual([
      expect.objectContaining({
        id: first.json().turnId,
        deliveryStatus: 'sent',
        externalMessageId: 'human-provider-message-1',
      }),
    ]);
  });

  it('fails closed on retry after an ambiguous dashboard human-message send', async () => {
    const store = new MemoryStore();
    const messengerFetchImpl = vi.fn(async () => {
      throw new Error('private provider timeout detail');
    });
    const server = buildServer({
      store,
      messengerPageAccessToken: 'page_token_local',
      messengerGraphApiBaseUrl: 'https://graph.local',
      messengerFetchImpl,
    });
    await server.inject({
      method: 'POST',
      url: '/dashboard/sessions/messenger%3Apsid_human_timeout/human-join',
      payload: { agentId: 'agent_1' },
    });
    const request = {
      method: 'POST' as const,
      url: '/dashboard/sessions/messenger%3Apsid_human_timeout/human-message',
      payload: {
        agentId: 'agent_1',
        clientRequestId: 'dashboard-human-timeout-1',
        text: 'Em đang kiểm tra giúp anh/chị.',
      },
    };

    const first = await server.inject(request);
    const replay = await server.inject(request);

    expect(first.statusCode).toBe(502);
    expect(replay.statusCode).toBe(502);
    expect(replay.json()).toMatchObject({
      errorCode: 'non_agent_delivery_outcome_unknown',
    });
    expect(messengerFetchImpl).toHaveBeenCalledTimes(1);
    expect(await store.listTurns('messenger:psid_human_timeout')).toEqual([
      expect.objectContaining({ deliveryStatus: 'outcome_unknown' }),
    ]);
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
    const deferred: Array<() => Promise<void>> = [];
    const messengerFetchImpl = vi.fn(async (_url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
      new Response(JSON.stringify(hasSenderAction(init) ? { recipient_id: 'psid_paused' } : { message_id: 'reply_after_resume' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const model = fakeModel().respond(groundedResponseModelReply({
      customerText: 'Mình đã quay lại hỗ trợ đơn này.',
    }));
    const server = buildServer({
      store,
      messengerVerifyToken: 'local_verify',
      metaPageId: '118976205445198',
      messengerPageAccessToken: 'page_token_local',
      messengerGraphApiBaseUrl: 'https://graph.local',
      messengerFetchImpl,
      defer: (task) => deferred.push(task),
      ...testAgent(model, groundedResponseVerifierModel()),
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
    expect(resume.json()).toMatchObject({
      recoveredUnanswered: false,
      recoveryQueued: true,
    });
    expect(sentTextMessages(messengerFetchImpl)).toHaveLength(0);
    expect(model.callCount).toBe(0);
    while (deferred.length > 0) await deferred.shift()!();

    expect(sentTextMessages(messengerFetchImpl)).toHaveLength(1);
    expect(model.callCount).toBe(1);
    expect(
      model.calls[0]?.messages.map((message) => message.text).join('\n'),
    ).toContain('Có ai xử lý chưa?');

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
    const model = fakeModel()
      .respond(groundedResponseModelReply({
        customerText: 'Mình đã ghi nhận vấn đề giao sai món.',
      }))
      .respond(groundedResponseModelReply({
        customerText: 'Mình tiếp tục hỗ trợ đơn này.',
      }));
    const server = buildServer({
      store,
      messengerVerifyToken: 'local_verify',
      metaPageId: '118976205445198',
      messengerPageAccessToken: 'page_token_local',
      messengerGraphApiBaseUrl: 'https://graph.local',
      messengerFetchImpl,
      ...testAgent(model, groundedResponseVerifierModel()),
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
      payload: {
        agentId: 'agent_1',
        clientRequestId: 'messenger_human_reply_1',
        text: 'Em là nhân viên KFC, em đang kiểm tra đơn sai món cho anh/chị.',
      },
    });
    expect(humanReply.statusCode).toBe(200);
    expect(sentTextMessages(messengerFetchImpl)).toHaveLength(2);
    expect(sentTextMessages(messengerFetchImpl)[1]).toMatchObject({
      message: { text: 'Em là nhân viên KFC, em đang kiểm tra đơn sai món cho anh/chị.' },
    });

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

    expect(model.callCount).toBe(2);
    const resumedPrompt = model.calls[1]?.messages
      .map((message) => message.text)
      .join('\n');
    expect(resumedPrompt).toContain('Tôi bực quá, đồ giao sai hết rồi');
    expect(resumedPrompt).toContain('Có ai xử lý chưa?');
    expect(resumedPrompt).toContain('Ok, tiếp tục giúp tôi');

    const turns = await store.listTurns('messenger:psid_angry');
    expect(turns.map((turn) => turn.text)).toEqual([
      'Tôi bực quá, đồ giao sai hết rồi',
      'Mình đã ghi nhận vấn đề giao sai món.',
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

async function postMessengerText(
  server: { inject(input: { method: string; url: string; payload: unknown; headers?: Record<string, string> }): Promise<unknown> },
  mid: string,
  senderId: string,
  text: string,
): Promise<void> {
  const response = (await server.inject(signedMessengerWebhook({
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
  }))) as { statusCode: number; json(): unknown };

  expect(response.statusCode).toBe(200);
}
