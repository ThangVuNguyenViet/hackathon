import { describe, expect, it } from 'vitest';
import type { LiveScenarioAdvisoryMetadata } from '../../src/evaluation/liveQualityContracts.js';
import type { ScenarioRunResult } from '../../src/scenarios/runner.js';
import type { ScenarioScript } from '../../src/scenarios/scenarioScript.js';
import { buildScenarioOutcomeEvidence } from './scenarioOutcomeEvidence.js';

function script(input: {
  id: string;
  finalState: string;
  turns: Array<{ index: number; text: string; useCases: string[] }>;
  expectations?: string[];
}): ScenarioScript {
  const userTurns = input.turns.map((turn) => ({
    ...turn,
    speaker: 'User' as const,
  }));
  return {
    id: input.id,
    title: input.id,
    channel: 'kfc',
    goal: 'exercise outcome projection',
    useCases: [...new Set(userTurns.flatMap(({ useCases }) => useCases))],
    finalState: input.finalState,
    turns: userTurns,
    userTurns,
    expectations: input.expectations ?? [],
  };
}

function result(input: {
  turns: Array<{
    index: number;
    user: string;
    assistant: string;
    eventIds?: string[];
    genUi?: {
      widgetKind: 'smartMenuPicker' | 'cartBuilder';
      actions: Array<{ id: string; value?: string }>;
      data?: Record<string, unknown>;
    };
  }>;
  tools?: Array<{
    turnIndex: number;
    toolName: 'searchMenu' | 'updateCart';
    arguments?: Record<string, unknown>;
    ok: boolean;
    resultSummary: string;
  }>;
  events?: Array<{
    id: string;
    type: 'session_updated' | 'cart_changed';
    payload: Record<string, unknown>;
  }>;
}): ScenarioRunResult {
  const toolTraceByTurn =
    input.tools?.map((entry) => ({
      turnIndex: entry.turnIndex,
      entries: [
        {
          toolName: entry.toolName,
          arguments: entry.arguments ?? {},
          ok: entry.ok,
          resultSummary: entry.resultSummary,
          provenance: [],
        },
      ],
    })) ?? [];
  return {
    finalState: 'runtime-final-state-must-not-drive-expectations',
    coveredUseCases: [],
    dashboardEvents: (input.events ?? []).map((event) => ({
      ...event,
      sessionId: 'replay_test',
      createdAt: '2026-07-22T00:00:00.000Z',
    })),
    escalationReasons: [],
    transcript: [],
    eventsBeforeFinalUserTurn: [],
    toolTrace: toolTraceByTurn.flatMap(({ entries }) => entries),
    toolTraceByTurn,
    turnEvidence: input.turns.map((turn) => ({
      turnIndex: turn.index,
      input: turn.user,
      durationMs: 1,
      transcriptRevisionBefore: 0,
      transcriptRevisionAfter: 2,
      eventRevisionBefore: 0,
      eventRevisionAfter: turn.eventIds?.length ?? 0,
      eventIdsBefore: [],
      eventIds: turn.eventIds ?? [],
      eventIdsAfter: turn.eventIds ?? [],
      checkpointId: 'checkpoint',
      checkpointNamespace: '',
      checkpointThreadId: 'thread',
      checkpointVerified: true,
      assistantText: turn.assistant,
      ...(turn.genUi
        ? {
            genUi: {
              id: `widget-${turn.index}`,
              lifecycleStage: 'advisory',
              widgetKind: turn.genUi.widgetKind,
              status: 'active',
              title: 'Advice',
              data: turn.genUi.data ?? {},
              actions: turn.genUi.actions.map((action) => ({
                ...action,
                label: action.id,
              })),
            },
          }
        : {}),
      approvalRequested: false,
      approvalResumes: [],
      stateBefore: {},
      stateAfter: {},
    })),
    persistedEvents: [],
  };
}

const advisory = (
  phaseEndTurnIndex: number,
  criteria: string[],
): LiveScenarioAdvisoryMetadata => ({
  role: 'core',
  phaseEndTurnIndex,
  judgmentPolicy: 'warning',
  criteria: criteria.map((description, index) => ({
    id: `criterion-${index + 1}`,
    description,
  })),
});

describe('scenario outcome evidence projection', () => {
  it('trims Scenario 03 evidence to its configured first-turn advisory phase', () => {
    const scenarioScript = script({
      id: '03-ton-kho-dia-chi-va-cua-hang',
      finalState: 'needs_customer_decision',
      turns: [
        { index: 1, text: 'Burger Tôm còn không?', useCases: ['UC-06'] },
        { index: 3, text: 'Thêm Zinger đi.', useCases: ['UC-07'] },
      ],
      expectations: ['This script prose must not become judge criteria.'],
    });
    const run = result({
      turns: [
        {
          index: 1,
          user: 'Burger Tôm còn không?',
          assistant: 'Burger Tôm hiện không có; giao hàng vẫn chưa xác định.',
          eventIds: ['event-1'],
        },
        {
          index: 3,
          user: 'Thêm Zinger đi.',
          assistant: 'Đã thêm Zinger.',
          eventIds: ['event-2'],
        },
      ],
      tools: [
        {
          turnIndex: 1,
          toolName: 'searchMenu',
          ok: true,
          resultSummary: 'item_unavailable',
        },
        {
          turnIndex: 3,
          toolName: 'updateCart',
          ok: true,
          resultSummary: 'cart_updated',
        },
      ],
      events: [
        {
          id: 'event-1',
          type: 'session_updated',
          payload: { updateType: 'catalog_read' },
        },
        { id: 'event-2', type: 'cart_changed', payload: { totalVnd: 79_000 } },
      ],
    });

    const evidence = buildScenarioOutcomeEvidence(
      scenarioScript,
      run,
      advisory(1, ['Keep delivery coverage unresolved.']),
    );

    expect(evidence.turns).toEqual([
      { role: 'user', text: 'Burger Tôm còn không?' },
      {
        role: 'assistant',
        text: 'Burger Tôm hiện không có; giao hàng vẫn chưa xác định.',
      },
    ]);
    expect(evidence.toolTrace).toEqual([
      {
        toolName: 'searchMenu',
        status: 'succeeded',
        resultSummary: 'item_unavailable',
      },
    ]);
    expect(evidence.monitorEvents.map(({ type }) => type)).toEqual([
      'session_updated',
    ]);
    expect(evidence.expectations).toEqual([
      'Keep delivery coverage unresolved.',
    ]);
    expect(evidence.finalState).toBe('needs_customer_decision');
    expect(JSON.stringify(evidence)).not.toContain('script prose');
    expect(JSON.stringify(evidence)).not.toContain('cart_updated');
  });

  it('omits raw tool arguments and redacts private identifiers and credentials', () => {
    const scenarioScript = script({
      id: 'privacy-probe',
      finalState: 'advice_complete',
      turns: [
        {
          index: 1,
          text: 'customerId: customer-123 token=secret-token',
          useCases: ['privacy'],
        },
      ],
    });
    const run = result({
      turns: [
        {
          index: 1,
          user: 'customerId: customer-123 token=secret-token',
          assistant: 'Authorization: Bearer assistant-secret',
          eventIds: ['private-event'],
          genUi: {
            widgetKind: 'smartMenuPicker',
            actions: [{ id: 'choose', value: 'customerId=widget-secret' }],
            data: { apiKey: 'widget-api-key' },
          },
        },
      ],
      tools: [
        {
          turnIndex: 1,
          toolName: 'searchMenu',
          arguments: { apiKey: 'raw-api-key', customerId: 'customer-123' },
          ok: true,
          resultSummary: 'access_token=tool-secret result ready',
        },
      ],
      events: [
        {
          id: 'private-event',
          type: 'session_updated',
          payload: {
            sessionId: 'private-session',
            authorization: 'Bearer monitor-secret',
            updateType: 'catalog_read',
          },
        },
      ],
    });

    const evidence = buildScenarioOutcomeEvidence(
      scenarioScript,
      run,
      advisory(1, ['Protect private values.']),
    );
    const serialized = JSON.stringify(evidence);

    expect(serialized).not.toContain('customer-123');
    expect(serialized).not.toContain('secret-token');
    expect(serialized).not.toContain('assistant-secret');
    expect(serialized).not.toContain('raw-api-key');
    expect(serialized).not.toContain('tool-secret');
    expect(serialized).not.toContain('private-session');
    expect(serialized).not.toContain('monitor-secret');
    expect(serialized).not.toContain('widget-secret');
    expect(serialized).not.toContain('widget-api-key');
    expect(serialized).toContain('[REDACTED]');
  });

  it('projects the full configured Scenario 02 phase in deterministic order', () => {
    const turns = [1, 3, 5, 7, 9].map((index) => ({
      index,
      text: `user-${index}`,
      useCases: [`UC-${index}`],
    }));
    const scenarioScript = script({
      id: '02-tu-van-combo-va-upsell',
      finalState: 'cart_ready',
      turns,
    });
    const run = result({
      turns: turns.map(({ index }) => ({
        index,
        user: `user-${index}`,
        assistant: `assistant-${index}`,
        ...(index === 3
          ? {
              genUi: {
                widgetKind: 'smartMenuPicker' as const,
                actions: [{ id: 'add_items' }],
              },
            }
          : {}),
      })),
      tools: [
        {
          turnIndex: 1,
          toolName: 'searchMenu',
          ok: true,
          resultSummary: 'recommendations_ready',
        },
        {
          turnIndex: 9,
          toolName: 'updateCart',
          ok: true,
          resultSummary: 'cart_updated',
        },
      ],
    });

    const evidence = buildScenarioOutcomeEvidence(
      scenarioScript,
      run,
      advisory(9, [
        'Recommend within budget.',
        'Preserve consent before conversion.',
      ]),
    );

    expect(evidence.turns).toHaveLength(10);
    expect(evidence.turns.map(({ text }) => text)).toEqual([
      'user-1',
      'assistant-1',
      'user-3',
      'assistant-3',
      'user-5',
      'assistant-5',
      'user-7',
      'assistant-7',
      'user-9',
      'assistant-9',
    ]);
    expect(evidence.toolTrace.map(({ toolName }) => toolName)).toEqual([
      'searchMenu',
      'updateCart',
    ]);
    expect(evidence.genUiAttachments).toEqual([
      {
        widgetKind: 'smartMenuPicker',
        actionIds: ['add_items'],
      },
    ]);
    expect(evidence.useCases).toEqual(['UC-1', 'UC-3', 'UC-5', 'UC-7', 'UC-9']);
  });
});
