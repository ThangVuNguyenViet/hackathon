import { AIMessage } from '@langchain/core/messages';
import { fakeModel } from '@langchain/core/testing';
import { describe, expect, it } from 'vitest';
import { runAgentTurn } from '../../src/agent/kfcAgent.js';
import type { LocalToolEvidenceEvent } from '../../src/agent/localToolEvidence.js';
import { DashboardEventBus } from '../../src/dashboard/eventBus.js';
import { loadGeneratedFixtures } from '../../src/fixtures/loadFixtures.js';
import { createMockClients } from '../../src/mock/createMockClients.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';
import { configuredTestAgent } from '../support/configured-agent-model.js';

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
            minPriceVnd: null,
            maxPriceVnd: null,
            maxPriceExclusiveVnd: null,
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
      agentModelBinding: configuredTestAgent(model),
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
      requestedAt: expect.any(String),
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
      executionStartedAt: expect.any(String),
      completedAt: expect.any(String),
      executionDurationMs: expect.any(Number),
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
        agentModelBinding: configuredTestAgent(model),
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

  it('keeps queued tool request and execution timing distinct and coherent by call ID', async () => {
    const events: LocalToolEvidenceEvent[] = [];
    const model = fakeModel()
      .respondWithTools([
        {
          name: 'searchMenu',
          id: 'queued-call-1',
          args: {
            mode: 'search',
            queries: ['gà'],
            modifierQueries: [],
            category: null,
            minPriceVnd: null,
            maxPriceVnd: null,
            maxPriceExclusiveVnd: null,
            partySize: null,
          },
        },
        {
          name: 'searchMenu',
          id: 'queued-call-2',
          args: {
            mode: 'search',
            queries: ['burger'],
            modifierQueries: [],
            category: null,
            minPriceVnd: null,
            maxPriceVnd: null,
            maxPriceExclusiveVnd: null,
            partySize: null,
          },
        },
      ])
      .respond(new AIMessage('Mình đã kiểm tra cả hai lựa chọn.'));

    await runAgentTurn({
      sessionId: 'queued-live-evidence-session',
      customerId: 'synthetic-customer',
      channel: 'kfc',
      text: 'Tìm cả gà và burger.',
      clients: createMockClients(await loadGeneratedFixtures(process.cwd())),
      store: new MemoryStore(),
      dashboard: new DashboardEventBus(),
      agentModelBinding: configuredTestAgent(model),
      async recordLocalToolEvidence(event) {
        events.push(event);
      },
    });

    for (const callId of ['queued-call-1', 'queued-call-2']) {
      const requested = events.find(
        (event) => event.phase === 'started' && event.callId === callId,
      );
      const completed = events.find(
        (event) => event.phase === 'completed' && event.callId === callId,
      );
      expect(requested).toMatchObject({ requestedAt: expect.any(String) });
      expect(completed).toMatchObject({
        executionStartedAt: expect.any(String),
        completedAt: expect.any(String),
        executionDurationMs: expect.any(Number),
      });
      if (requested?.phase !== 'started' || completed?.phase !== 'completed') {
        throw new Error('missing_tool_lifecycle_evidence');
      }
      expect(
        Date.parse(requested.requestedAt ?? '') <=
          Date.parse(completed.executionStartedAt ?? ''),
      ).toBe(true);
      expect(
        Date.parse(completed.executionStartedAt ?? '') <=
          Date.parse(completed.completedAt),
      ).toBe(true);
    }
  });
});
