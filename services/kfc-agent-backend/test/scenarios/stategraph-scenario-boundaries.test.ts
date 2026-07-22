import { fakeModel } from '@langchain/core/testing';
import { describe, expect, it } from 'vitest';
import type {
  AgentTraceSpan,
  AgentTraceSpanInput,
  AgentTracer,
} from '../../src/observability/agentTracing.js';
import { evaluateLiveQualityOutput } from '../../src/evaluation/liveQualityEvaluators.js';
import { projectStateGraphScenarioRun } from '../../src/evaluation/liveQualityStateGraph.js';
import {
  ScenarioRunExecutionError,
  runScenario,
} from '../../src/scenarios/runner.js';
import type { ScenarioScript } from '../../src/scenarios/scenarioScript.js';
import {
  groundedResponseClaims,
  groundedResponseModelReply,
} from '../fixtures/groundedResponse.js';
import { stateRevision } from '../../src/graph/turnSupport.js';
import { liveScenarioCases } from './scenarioCoverageLedger.js';

function oneTurnScript(input: { id: string; text: string }): ScenarioScript {
  const turn = {
    index: 1,
    speaker: 'User' as const,
    text: input.text,
    useCases: ['stategraph-boundary'],
  };
  return {
    id: input.id,
    title: input.id,
    channel: 'kfc',
    goal: 'Exercise one inspectable StateGraph boundary',
    useCases: turn.useCases,
    finalState: 'stategraph_boundary_checked',
    turns: [turn],
    userTurns: [turn],
    expectations: [],
  };
}

function canonicalExpectation(fileName: string, turnIndex: number) {
  const expectation = liveScenarioCases
    .find((scenario) => scenario.fileName === fileName)
    ?.turnExpectations.find((candidate) => candidate.turnIndex === turnIndex);
  if (!expectation) {
    throw new Error(`missing canonical expectation ${fileName}#${turnIndex}`);
  }
  return expectation;
}

interface CapturedTurn {
  input: Omit<AgentTraceSpanInput, 'runType'>;
}

class CapturingSpan implements AgentTraceSpan {
  async startSpan(): Promise<AgentTraceSpan> {
    return this;
  }

  async end(): Promise<void> {}

  async fail(): Promise<void> {}
}

class CapturingTracer implements AgentTracer {
  readonly turns: CapturedTurn[] = [];

  async startTurn(
    input: Omit<AgentTraceSpanInput, 'runType'>,
  ): Promise<AgentTraceSpan> {
    this.turns.push({ input });
    return new CapturingSpan();
  }

  async flush(): Promise<void> {}
}

describe('offline StateGraph scenario boundaries', () => {
  it('executes an advertised safe call exactly and never synthesizes the missing mutation', async () => {
    const claims = groundedResponseClaims({
      evidenceReferences: [
        {
          evidenceId: 'menu_search_results',
          claimKinds: ['product'],
        },
      ],
    });
    const model = fakeModel()
      .respondWithTools([
        {
          name: 'searchMenu',
          args: { scope: 'filtered', query: 'Pepsi' , purpose: 'browse'},
        },
      ])
      .respond(
        groundedResponseModelReply({
          customerText: 'Verified catalog options are available.',
          ...claims,
        }),
      );
    const script = oneTurnScript({
      id: 'offline-no-synthesis',
      text: canonicalExpectation('01-dat-mon-ro-rang-giao-hang.json', 1).input,
    });

    const result = await runScenario(script, {
      agentModel: model,
    });
    const output = projectStateGraphScenarioRun(result, 'text')[0]!;
    const scores = evaluateLiveQualityOutput(
      canonicalExpectation('01-dat-mon-ro-rang-giao-hang.json', 1),
      output,
      'text',
    );

    expect(result.toolTrace.map(({ toolName }) => toolName)).toEqual([
      'searchMenu',
    ]);
    expect(result.toolTrace[0]?.arguments).toEqual({
      scope: 'filtered',
      query: 'Pepsi',
    });
    expect(result.cart).toBeUndefined();
    expect(result.order).toBeUndefined();
    expect(
      result.persistedEvents.map(({ sourceType }) => sourceType),
    ).not.toEqual(
      expect.arrayContaining([
        'cart_changed',
        'order_created',
        'payment_link_created',
        'voucher_applied',
      ]),
    );
    expect(scores.find(({ key }) => key === 'tool_contract')).toMatchObject({
      score: false,
      comment: expect.stringMatching(
        /unexpected tools|missing required tool group/u,
      ),
    });
  });

  it('retains completed dialogue and the rejected assistant response on failure', async () => {
    const script = oneTurnScript({
      id: 'offline-rejected-response-evidence',
      text: 'Tell me something unsupported.',
    });
    const model = fakeModel().respond(
      groundedResponseModelReply({
        customerText:
          'This rejected assistant response remains diagnostic evidence.',
        hasUnsupportedFactualClaim: true,
      }),
    );

    const error = await runScenario(script, {
      agentModel: model,
    }).catch((failure: unknown) => failure);

    expect(error).toBeInstanceOf(ScenarioRunExecutionError);
    expect(error).toMatchObject({
      message: 'agent_response_claim_unsupported',
      evidence: {
        completedTurns: [],
        failedTurn: {
          turnIndex: 1,
          input: 'Tell me something unsupported.',
          errorCode: 'agent_response_claim_unsupported',
          assistantText:
            'This rejected assistant response remains diagnostic evidence.',
          currentTurnToolTrace: [],
        },
      },
    });
  });

  it('forwards exact scenario, run, session, and tag correlation', async () => {
    const tracer = new CapturingTracer();
    const script = oneTurnScript({
      id: 'offline-trace-correlation',
      text: 'Show a safe response.',
    });
    const model = fakeModel().respond(
      groundedResponseModelReply({
        customerText: 'How can I help?',
      }),
    );

    await runScenario(script, {
      agentModel: model,
      tracer,
      traceRunId: 'offline-probe-run-1',
    });

    expect(tracer.turns).toHaveLength(1);
    expect(tracer.turns[0]?.input).toMatchObject({
      name: 'agent_turn',
      inputs: {
        sessionId: 'replay_offline-trace-correlation',
        customerId: 'scenario_customer',
        channel: 'kfc',
        latestUserMessagePresent: true,
        latestUserMessageLength: script.userTurns[0]!.text.length,
        latestUserMessageDigest: await stateRevision(script.userTurns[0]!.text),
        metadataPresent: false,
        metadataDigest: await stateRevision(null),
      },
      metadata: {
        session_id: 'replay_offline-trace-correlation',
        scenarioId: 'offline-trace-correlation',
        probeRunId: 'offline-probe-run-1',
      },
      tags: [
        'kfc-agent-turn',
        'session:replay_offline-trace-correlation',
        'scenario:offline-trace-correlation',
      ],
    });
    const serializedTraceInput = JSON.stringify(tracer.turns[0]?.input);
    expect(serializedTraceInput).not.toContain(script.userTurns[0]!.text);
    expect(serializedTraceInput).not.toContain('rawEvent');
  });

  it('projects one complete multi-category menu and promotion read without cart mutation', async () => {
    const claims = groundedResponseClaims({
      evidenceReferences: [
        {
          evidenceId: 'menu_search_results',
          claimKinds: ['product'],
        },
      ],
    });
    const model = fakeModel()
      .respondWithTools([
        {
          name: 'searchMenu',
          args: { scope: 'all', query: null, purpose: 'browse' },
        },
        {
          name: 'searchPromotions',
          args: { scope: 'all', query: null },
        },
      ])
      .respond(
        groundedResponseModelReply({
          customerText: 'The verified menu and promotion options are ready.',
          ...claims,
        }),
      );

    const result = await runScenario(
      oneTurnScript({
        id: 'offline-complete-menu',
        text: canonicalExpectation('02-tu-van-combo-va-upsell.json', 3).input,
      }),
      {
        agentModel: model,
      },
    );

    const state = result.finalAgentState;
    const collection = state?.activeMenuCollection?.result;
    const genUi = result.turnEvidence[0]?.genUi;
    const categories = new Map(
      collection?.items.map(({ categoryId, category }) => [
        categoryId,
        { categoryId, label: category },
      ]),
    );

    expect(result.toolTrace.map(({ toolName }) => toolName)).toEqual([
      'searchMenu',
      'searchPromotions',
    ]);
    expect(result.toolTrace[0]?.arguments).toEqual({
      scope: 'all',
      query: null,
    });
    expect(result.cart).toBeUndefined();
    expect(collection).toMatchObject({
      scope: { scope: 'all' },
      complete: true,
      total: collection?.items.length,
      returned: collection?.items.length,
    });
    expect(categories.size).toBeGreaterThanOrEqual(2);
    expect(genUi).toMatchObject({
      widgetKind: 'smartMenuPicker',
      data: {
        items: collection?.items,
        categories: [...categories.values()],
        total: collection?.items.length,
        returned: collection?.items.length,
        complete: true,
      },
    });
  });

  it('projects exact modifier authority without updating the cart', async () => {
    const model = fakeModel()
      .respondWithTools([
        {
          name: 'searchMenu',
          args: { scope: 'all', query: null, purpose: 'browse' },
        },
      ])
      .respondWithTools([
        {
          name: 'getModifierOptions',
          args: { code: '20752' },
        },
      ])
      .respond(
        groundedResponseModelReply({
          customerText: 'The verified customization options are ready.',
        }),
      );

    const result = await runScenario(
      oneTurnScript({
        id: 'offline-modifier-authority',
        text: 'Show customization choices for combo 20752.',
      }),
      {
        agentModel: model,
      },
    );

    const modifierTree = result.finalAgentState?.menuModifierOptions;
    const genUi = result.turnEvidence[0]?.genUi;
    const actionIds = genUi?.actions.map(({ id }) => id) ?? [];

    expect(result.toolTrace.map(({ toolName }) => toolName)).toEqual([
      'searchMenu',
      'getModifierOptions',
    ]);
    expect(result.toolTrace[1]?.arguments).toEqual({ code: '20752' });
    expect(
      result.toolTrace.some(({ toolName }) => toolName === 'updateCart'),
    ).toBe(false);
    expect(result.cart).toBeUndefined();
    expect(modifierTree).toMatchObject({ itemCode: '20752' });
    expect(genUi).toMatchObject({
      widgetKind: 'modifierPicker',
      data: {
        modifierTree: { itemCode: '20752' },
      },
    });
    expect(actionIds.length).toBeGreaterThan(0);
    expect(new Set(actionIds).size).toBe(actionIds.length);
    expect(actionIds.every((id) => id.startsWith('customize_item:'))).toBe(
      true,
    );
  });
});
