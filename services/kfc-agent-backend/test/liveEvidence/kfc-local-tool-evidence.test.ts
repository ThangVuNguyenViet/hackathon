import { AIMessage } from '@langchain/core/messages';
import { fakeModel } from '@langchain/core/testing';
import { describe, expect, it } from 'vitest';
import { runAgentTurn } from '../../src/agent/kfcAgent.js';
import type { LocalToolEvidenceEvent } from '../../src/liveEvidence/liveScenarioSession.js';
import { DashboardEventBus } from '../../src/dashboard/eventBus.js';
import { loadGeneratedFixtures } from '../../src/fixtures/loadFixtures.js';
import { createMockClients } from '../../src/mock/createMockClients.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';

describe('KFC local live-evidence hook', () => {
  it('reports complete model-facing tool arguments and results without changing the neutral kernel', async () => {
    const events: LocalToolEvidenceEvent[] = [];
    const model = fakeModel()
      .respondWithTools([
        {
          name: 'searchMenu',
          id: 'tool-call-1',
          args: {
            mode: 'search',
            queries: ['pesi'],
            modifierQueries: [],
            category: null,
            maxPriceVnd: null,
            partySize: null,
          },
        },
      ])
      .respond(new AIMessage('Mình đã tìm thấy Pepsi cho bạn.'));

    const output = await runAgentTurn({
      sessionId: 'live-evidence-session',
      customerId: 'synthetic-customer',
      channel: 'kfc',
      text: 'Tìm Pepsi giúp mình.',
      clients: createMockClients(await loadGeneratedFixtures(process.cwd())),
      store: new MemoryStore(),
      dashboard: new DashboardEventBus(),
      agentModel: model,
      async recordLocalToolEvidence(event) {
        events.push(event);
      },
    });

    expect(output.responseText).toBe('Mình đã tìm thấy Pepsi cho bạn.');
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      phase: 'started',
      callId: 'tool-call-1',
      toolName: 'searchMenu',
      arguments: {
        mode: 'search',
        queries: ['pesi'],
      },
      startedAt: expect.any(String),
    });
    expect(events[1]).toMatchObject({
      phase: 'completed',
      callId: 'tool-call-1',
      toolName: 'searchMenu',
      arguments: {
        mode: 'search',
        queries: ['pesi'],
        modifierQueries: [],
      },
      rawResult: {
        toolName: 'searchMenu',
        ok: true,
        value: {
          returned: expect.any(Number),
          complete: true,
          items: expect.arrayContaining([
            expect.objectContaining({
              code: '41074',
              name: 'Pepsi (Tiêu Chuẩn)',
            }),
          ]),
        },
      },
      modelFacingResult: {
        toolName: 'searchMenu',
        ok: true,
        value: {
          returned: expect.any(Number),
          complete: true,
          items: expect.arrayContaining([
            expect.objectContaining({
              code: '41074',
              name: 'Pepsi (Tiêu Chuẩn)',
            }),
          ]),
        },
      },
      startedAt: expect.any(String),
      completedAt: expect.any(String),
      durationMs: expect.any(Number),
    });
  });

  it('records adapter-level invalid tool arguments before execution and records the resulting error', async () => {
    const events: LocalToolEvidenceEvent[] = [];
    const model = fakeModel()
      .respondWithTools([
        {
          name: 'searchMenu',
          id: 'invalid-tool-call',
          args: { queries: 'not-an-array' },
        },
      ])
      .respond(new AIMessage('Mình chưa thể thực hiện yêu cầu đó.'));

    await expect(
      runAgentTurn({
        sessionId: 'invalid-live-evidence-session',
        customerId: 'synthetic-customer',
        channel: 'kfc',
        text: 'Tìm món giúp mình.',
        clients: createMockClients(await loadGeneratedFixtures(process.cwd())),
        store: new MemoryStore(),
        dashboard: new DashboardEventBus(),
        agentModel: model,
        async recordLocalToolEvidence(event) {
          events.push(event);
        },
      }),
    ).resolves.toMatchObject({
      responseText: 'Mình chưa thể thực hiện yêu cầu đó.',
    });

    expect(events).toEqual([
      expect.objectContaining({
        phase: 'started',
        callId: 'invalid-tool-call',
        toolName: 'searchMenu',
        arguments: { queries: 'not-an-array' },
      }),
      expect.objectContaining({
        phase: 'failed',
        callId: 'invalid-tool-call',
        toolName: 'searchMenu',
        arguments: { queries: 'not-an-array' },
        error: expect.anything(),
      }),
    ]);
  });
});
