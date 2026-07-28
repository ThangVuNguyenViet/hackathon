import { describe, expect, it, vi } from 'vitest';
import { createLiveScenarioHttpClient } from '../../src/liveEvidence/liveScenarioHttpClient.js';

describe('live scenario HTTP/D1 client', () => {
  it('forwards exact customer prose and all referenced action identities', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(input), init });
      const path = new URL(String(input)).pathname;
      if (path === '/admin/live-scenarios/chat/kfc/message') {
        return Response.json({
          responseText: 'Mình có một gợi ý.',
          assistantTurnId: 'assistant-turn-1',
          genUi: {
            id: 'attachment-1',
            actions: [{ id: 'recommendation_select:action-1' }],
          },
        });
      }
      if (path.endsWith('/impressions')) {
        return Response.json({ recorded: true });
      }
      return Response.json({
        responseText: 'Đã thêm món.',
        assistantTurnId: 'assistant-turn-2',
      });
    });
    const client = createLiveScenarioHttpClient({
      baseUrl: 'https://worker.example/',
      adminToken: 'admin-secret-value',
      fetchImpl,
    });

    await client.submitUserMessage({
      sessionId: 'kfc:live-run-1',
      customerId: 'live-run-1',
      clientMessageId: 'run-1:user:1',
      text: '  Giữ nguyên khoảng trắng này.  ',
      metadata: { liveScenarioRunId: 'run-1' },
      trace: {
        scenarioId: 'scenario-improvised',
        probeRunId: 'run-1',
      },
    });
    await client.submitAction({
      sessionId: 'kfc:live-run-1',
      customerId: 'live-run-1',
      clientMessageId: 'run-1:action:2',
      assistantTurnId: 'assistant-turn-1',
      attachmentId: 'attachment-1',
      actionId: 'add_items',
      payload: {
        items: [{ itemCode: '41173', quantity: 2 }],
      },
      trace: {
        scenarioId: 'scenario-improvised',
        probeRunId: 'run-1',
      },
    });
    await client.recordRecommendationImpression({
      recommendationId: 'recommendation-1',
      body: {
        schemaVersion: 'kfc-recommendation-event-v1',
        eventId: 'recommendation-impression:attachment-1',
        occurredAt: '2026-07-28T00:00:00.000Z',
        assistantTurnId: 'assistant-turn-1',
        attachmentId: 'attachment-1',
        renderedActions: [{ actionId: 'action-1', position: 1 }],
        cartRevision: 'cart-revision-1',
        actionDigest: 'a'.repeat(64),
      },
    });

    expect(requests.map(({ url }) => new URL(url).pathname)).toEqual([
      '/admin/live-scenarios/chat/kfc/message',
      '/admin/live-scenarios/chat/kfc/genui-action',
      '/v1/recommendations/recommendation-1/impressions',
    ]);
    expect(JSON.parse(String(requests[0]!.init?.body))).toEqual({
      request: {
        sessionId: 'kfc:live-run-1',
        customerId: 'live-run-1',
        clientMessageId: 'run-1:user:1',
        text: '  Giữ nguyên khoảng trắng này.  ',
        metadata: { liveScenarioRunId: 'run-1' },
      },
      trace: {
        scenarioId: 'scenario-improvised',
        probeRunId: 'run-1',
      },
    });
    expect(JSON.parse(String(requests[1]!.init?.body))).toEqual({
      request: {
        sessionId: 'kfc:live-run-1',
        customerId: 'live-run-1',
        clientMessageId: 'run-1:action:2',
        action: {
          assistantTurnId: 'assistant-turn-1',
          attachmentId: 'attachment-1',
          actionId: 'add_items',
          payload: {
            items: [{ itemCode: '41173', quantity: 2 }],
          },
        },
      },
      trace: {
        scenarioId: 'scenario-improvised',
        probeRunId: 'run-1',
      },
    });
    expect(
      new Headers(requests[0]!.init?.headers).get(
        'x-kfc-demo-admin-token',
      ),
    ).toBe('admin-secret-value');
    expect(
      new Headers(requests[1]!.init?.headers).get(
        'x-kfc-demo-admin-token',
      ),
    ).toBe('admin-secret-value');
    expect(JSON.parse(String(requests[2]!.init?.body))).toMatchObject({
      assistantTurnId: 'assistant-turn-1',
      attachmentId: 'attachment-1',
      renderedActions: [{ actionId: 'action-1', position: 1 }],
    });
  });

  it('collects protected D1 and environment evidence without exposing the admin token', async () => {
    const adminToken = 'admin-secret-value';
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(input), init });
      const path = new URL(String(input)).pathname;
      if (path === '/ready') {
        return Response.json({
          release: { gitSha: 'service-commit' },
          proof: {
            versions: {
              agent: { candidateId: 'openai-gpt-4.1-mini' },
              recommendationSanity: { snapshotDigest: 'sanity-digest' },
            },
          },
        });
      }
      if (path.endsWith('/envelope')) {
        return Response.json(
          {
            packState: { state: { toolTrace: [{ toolName: 'searchMenu' }] } },
            recommendations: {
              correlations: {
                recommendationId: 'recommendation-1',
                orderFlowId: 'order-flow-1',
              },
            },
          },
          { status: 409 },
        );
      }
      if (path.endsWith('/inspection')) {
        return Response.json({ technical: { rankerId: 'ranker-1' } });
      }
      return Response.json({
        state: { stage: 'smart_cross_sell_completed' },
        events: [{ eventType: 'decision_completed' }],
      });
    });
    const client = createLiveScenarioHttpClient({
      baseUrl: 'https://worker.example',
      adminToken,
      fetchImpl,
    });

    const environment = await client.environment();
    const evidence = await client.d1Evidence('kfc:live-run-1');

    expect(environment).toMatchObject({
      release: { gitSha: 'service-commit' },
    });
    expect(evidence).toMatchObject({
      proofEnvelope: {
        packState: {
          state: { toolTrace: [{ toolName: 'searchMenu' }] },
        },
      },
      recommendationInspection: {
        technical: { rankerId: 'ranker-1' },
      },
      orderFlowState: {
        state: { stage: 'smart_cross_sell_completed' },
        events: [{ eventType: 'decision_completed' }],
      },
    });
    expect(
      requests
        .filter(({ url }) => new URL(url).pathname.startsWith('/admin/'))
        .every(
          ({ init }) =>
            new Headers(init?.headers).get('x-kfc-demo-admin-token') ===
            adminToken,
        ),
    ).toBe(true);
    expect(JSON.stringify({ environment, evidence })).not.toContain(adminToken);
  });
});
