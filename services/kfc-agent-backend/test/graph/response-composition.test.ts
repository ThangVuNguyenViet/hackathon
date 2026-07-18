import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { DashboardEventBus } from '../../src/dashboard/eventBus.js';
import type { AgentTurnInput } from '../../src/graph/agentTurnState.js';
import { composeAssistantResponse } from '../../src/graph/responseComposition.js';
import type { AgentGraphState } from '../../src/graph/state.js';
import type { ResponseComposerInput } from '../../src/llm/responseComposer.js';
import { createMockClients } from '../../src/mock/createMockClients.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';
import { createTestFixtures } from '../fixtures/testFixtures.js';

function state(): AgentGraphState {
  return {
    sessionId: 'response-composition',
    customerId: 'customer-1',
    channel: 'kfc',
    latestUserMessage: 'Kiểm tra giúp mình',
    intent: 'order_status',
    userConfirmedOrder: false,
    escalationReasons: [],
    retrievedEvidence: [],
  };
}

function turnInput(responseComposer?: AgentTurnInput['responseComposer']): AgentTurnInput {
  return {
    sessionId: 'response-composition',
    customerId: 'customer-1',
    channel: 'kfc',
    text: 'Kiểm tra giúp mình',
    clients: createMockClients(createTestFixtures()),
    store: new MemoryStore(),
    dashboard: new DashboardEventBus(),
    responseComposer,
  };
}

describe('assistant response composition', () => {
  it('keeps customer-facing prose out of deterministic response paths', async () => {
    const paths = [
      'src/channels/zalo.ts',
      'src/graph/buildGraph.ts',
      'src/graph/naturalLanguageExecution.ts',
      'src/graph/nodes.ts',
      'src/graph/responseComposition.ts',
      'src/graph/structuredActions.ts',
      'src/graph/turnSupport.ts',
      'src/llm/staticToolPlanner.ts',
      'src/llm/toolPlanner.ts',
      'src/llm/toolPlannerBoundedClassifiers.ts',
      'src/llm/toolPlannerClassifiers.ts',
      'src/presentation/channelPresentation.ts',
    ];
    const violations = [];

    for (const path of paths) {
      const source = await readFile(path, 'utf8');
      if (/(?:directResponse|fallbackText|acknowledgementText)\s*:\s*(?:\r?\n\s*)?["'`](?!["'`])/u.test(source)) {
        violations.push(path);
      }
      if (/(?:const|let)\s+responseText\s*=\s*["'`](?!["'`])/u.test(source)) {
        violations.push(path);
      }
    }

    expect(violations).toEqual([]);
  });

  it('always asks the response model to compose from verified outcome state', async () => {
    const composeResponse = vi.fn(async (_input: ResponseComposerInput) => 'Mình đã kiểm tra trạng thái hiện tại.');
    const currentTurnToolTrace = [{
      toolName: 'getOrderStatus' as const,
      arguments: { orderId: 'KFC-1001' },
      ok: true,
      resultSummary: 'created',
      provenance: [],
    }];

    const output = await composeAssistantResponse({
      turnInput: turnInput({ composeResponse }),
      state: state(),
      fallbackText: 'Bản nháp do planner model viết.',
      replyIntent: 'general_reply',
      currentTurnToolTrace,
    });

    expect(composeResponse).toHaveBeenCalledOnce();
    expect(composeResponse.mock.calls[0]?.[0]).toMatchObject({
      replyIntent: 'general_reply',
      fallbackText: 'Bản nháp do planner model viết.',
      state: { toolTrace: currentTurnToolTrace },
    });
    expect(output.responseText).toBe('Mình đã kiểm tra trạng thái hiện tại.');
  });

  it('fails closed when neither a response model nor a model-written draft is available', async () => {
    await expect(composeAssistantResponse({
      turnInput: turnInput(),
      state: state(),
      fallbackText: '',
      replyIntent: 'general_reply',
      currentTurnToolTrace: [],
    })).rejects.toThrow('invalid_genui_response');
  });
});
