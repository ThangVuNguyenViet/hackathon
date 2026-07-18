import { describe, expect, it } from 'vitest';
import { contextEvalCases } from '../../src/evaluation/contextEvalCases.js';
import { evaluateContextCase } from '../../src/evaluation/contextEvalRunner.js';
import { createTestFixtures } from '../fixtures/testFixtures.js';
import { createTestResponseComposer } from '../fixtures/testResponseComposer.js';

const contextEvalTestResponseComposer = createTestResponseComposer('Context evaluation model response.');

describe('context eval runner', () => {
  it('runs the stale-cart greeting case through the deterministic target', async () => {
    const testCase = contextEvalCases.find((candidate) => candidate.inputs.caseId === 'ctx-greeting-existing-cart-001');
    expect(testCase).toBeDefined();

    const result = await evaluateContextCase({
      testCase: testCase!,
      fixtures: createTestFixtures(),
      mode: 'deterministic',
      responseComposer: contextEvalTestResponseComposer,
    });

    expect(result.caseId).toBe('ctx-greeting-existing-cart-001');
    expect(result.scores).toMatchObject({
      context_relevance_pass: true,
      forbidden_context_absent: true,
      forbidden_tools_absent: true,
      state_mutation_allowed: true,
    });
    expect(result.output.toolNames).toEqual([]);
    expect(result.output.responseText).not.toContain('Combo Hợp Gu 99K');
  });

  it('runs the broad-menu existing-cart case without leaking the cart into the reply', async () => {
    const testCase = contextEvalCases.find((candidate) => candidate.inputs.caseId === 'ctx-menu-existing-cart-001');
    expect(testCase).toBeDefined();

    const result = await evaluateContextCase({
      testCase: testCase!,
      fixtures: createTestFixtures(),
      mode: 'deterministic',
      responseComposer: contextEvalTestResponseComposer,
    });

    expect(result.scores.context_relevance_pass).toBe(true);
    expect(result.output.toolNames).toEqual(['searchMenu']);
    expect(result.output.responseText.length).toBeGreaterThan(0);
    expect(result.output.responseText.toLowerCase()).not.toContain('giỏ');
  });

  it('passes all golden cases in deterministic mode', async () => {
    const results = await Promise.all(
      contextEvalCases.map((testCase) =>
        evaluateContextCase({
          testCase,
          fixtures: createTestFixtures(),
          mode: 'deterministic',
          responseComposer: testCase.inputs.caseId === 'ctx-reorder-confirmed-previous-order-001'
            ? createTestResponseComposer('Please provide the địa chỉ for this reordered cart.', true)
            : contextEvalTestResponseComposer,
        }),
      ),
    );

    expect(results.map((result) => [result.caseId, result.scores.context_relevance_pass])).toEqual(
      contextEvalCases.map((testCase) => [testCase.inputs.caseId, true]),
    );
  });

  it('requires an OpenAI API key for live mode', async () => {
    const testCase = contextEvalCases.find((candidate) => candidate.inputs.caseId === 'ctx-greeting-existing-cart-001');
    expect(testCase).toBeDefined();

    await expect(
      evaluateContextCase({
        testCase: testCase!,
        fixtures: createTestFixtures(),
        mode: 'live',
        openAiApiKey: '',
      }),
    ).rejects.toThrow('OPENAI_API_KEY is required for live context eval mode');
  });

  it('runs live mode through one OpenAI planner response without oracle context metadata', async () => {
    const testCase = contextEvalCases.find((candidate) => candidate.inputs.caseId === 'ctx-greeting-continue-cart-001');
    expect(testCase).toBeDefined();
    let responsesCalls = 0;
    let plannerCalls = 0;
    let classifierCalls = 0;
    let composerCalls = 0;
    let firstPlannerState: { cart?: unknown } | undefined;
    const fetchImpl: typeof fetch = async (_url, init) => {
      responsesCalls += 1;
      const bodyText = String(init?.body ?? '');
      const isPlannerRequest = bodyText.includes('outputSchema');
      const isClassifierRequest = bodyText.includes('pending actions');
      if (isPlannerRequest) plannerCalls += 1;
      else if (isClassifierRequest) classifierCalls += 1;
      else composerCalls += 1;
      if (isPlannerRequest && !firstPlannerState) {
        firstPlannerState = JSON.parse(JSON.parse(bodyText).input).state;
      }
      const output_text = isClassifierRequest
        ? JSON.stringify({ reorder: 'unrelated' })
        : isPlannerRequest
        ? JSON.stringify({
            intent: 'unclear',
            contextPolicy: { cart: 'active', recentTurns: 'active' },
            entities: {},
            toolCalls: [],
            responseClaims: [],
            directResponse: 'Mình tiếp tục hỗ trợ đơn này. Bạn gửi giúp mình địa chỉ giao hàng nhé?',
          })
        : 'Mình tiếp tục hỗ trợ đơn này. Bạn gửi giúp mình địa chỉ giao hàng nhé?';
      return new Response(JSON.stringify({ output_text }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };

    const result = await evaluateContextCase({
      testCase: testCase!,
      fixtures: createTestFixtures(),
      mode: 'live',
      openAiApiKey: 'test-key',
      fetchImpl,
    });

    expect(responsesCalls).toBe(2);
    expect(plannerCalls).toBe(1);
    expect(classifierCalls).toBe(0);
    expect(composerCalls).toBe(1);
    expect(firstPlannerState?.cart).toBeUndefined();
    expect(result.output.toolNames).toEqual([]);
    expect(result.output.responseText).toContain('địa chỉ');
  });
});
