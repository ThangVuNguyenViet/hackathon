import { describe, expect, it } from 'vitest';
import {
  contextExperimentScoreKeys,
  createContextExperimentEvaluator,
  createContextExperimentTarget,
  parseContextExperimentArgs,
  scoresToEvaluationResults,
  validateContextExperimentPrerequisites,
} from '../../src/evaluation/contextLangsmithExperiment.js';
import { contextEvalCases } from '../../src/evaluation/contextEvalCases.js';
import { createTestFixtures } from '../fixtures/testFixtures.js';

describe('context LangSmith experiment adapter', () => {
  it('runs a passing greeting case through the deterministic target', async () => {
    const target = createContextExperimentTarget({
      fixtures: createTestFixtures(),
      mode: 'deterministic',
    });

    const testCase = contextEvalCases[0];
    if (!testCase) throw new Error('Missing greeting context evaluation case');
    const result = await target(testCase.inputs);

    expect(result.caseId).toBe('ctx-greeting-existing-cart-001');
    expect(result.responseText).not.toContain('Combo Hợp Gu 99K');
    expect(result.toolNames).toEqual([]);
  });

  it('runs a menu case with its required tool through the deterministic target', async () => {
    const target = createContextExperimentTarget({
      fixtures: createTestFixtures(),
      mode: 'deterministic',
    });

    const menuCase = contextEvalCases.find((testCase) => testCase.inputs.caseId === 'ctx-menu-existing-cart-001');
    if (!menuCase) throw new Error('Missing menu context evaluation case');
    const result = await target(menuCase.inputs);

    expect(result.caseId).toBe('ctx-menu-existing-cart-001');
    expect(result.toolNames).toEqual(['searchMenu']);
  });

  it('grades forbidden context and tools as failed native scores', async () => {
    const evaluator = createContextExperimentEvaluator();
    const testCase = contextEvalCases[0];
    if (!testCase) throw new Error('Missing context evaluation case');
    const evaluation = await evaluator({
      inputs: testCase.inputs,
      outputs: {
        caseId: testCase.inputs.caseId,
        caseCategory: testCase.inputs.caseCategory,
        responseText: 'Mình vẫn giữ Combo Hợp Gu 99K trong giỏ hàng.',
        toolNames: ['updateCart'],
        beforeState: { cartItems: [{ itemCode: '20751', quantity: 1 }], orderId: null, paymentUrl: null },
        afterState: { cartItems: [{ itemCode: '20751', quantity: 2 }], orderId: null, paymentUrl: null },
      },
    });

    const results = evaluation;
    const passResult = results.find((result) => result.key === 'context_relevance_pass');
    const forbiddenToolsResult = results.find((result) => result.key === 'forbidden_tools_absent');

    expect(passResult).toMatchObject({ score: 0, value: false });
    expect(forbiddenToolsResult).toMatchObject({ score: 0, value: false });
  });

  it('rejects an unknown dataset case id', async () => {
    const target = createContextExperimentTarget({
      fixtures: createTestFixtures(),
      mode: 'deterministic',
    });

    await expect(target({ caseId: 'unknown-context-case' })).rejects.toThrow(
      'Unknown context evaluation case: unknown-context-case',
    );
  });

  it('converts every boolean evaluator dimension into numeric and boolean values', () => {
    const results = scoresToEvaluationResults({
      context_relevance_pass: true,
      forbidden_context_absent: false,
      required_behavior_present: true,
      forbidden_tools_absent: false,
      required_tools_present: true,
      state_mutation_allowed: true,
    });

    expect(results.map((result) => result.key)).toEqual(contextExperimentScoreKeys);
    expect(results.map((result) => result.score)).toEqual([1, 0, 1, 0, 1, 1]);
    expect(results.map((result) => result.value)).toEqual([true, false, true, false, true, true]);
  });

  it('parses deterministic mode by default and supports explicit live mode', () => {
    expect(parseContextExperimentArgs([])).toMatchObject({ mode: 'deterministic' });
    expect(parseContextExperimentArgs(['--mode', 'live'])).toMatchObject({ mode: 'live' });
    expect(() => parseContextExperimentArgs(['--mode', 'invalid'])).toThrow('Unsupported mode: invalid');
  });

  it('validates credentials and dataset availability before running', () => {
    expect(() => validateContextExperimentPrerequisites({ apiKey: '', datasetExists: true })).toThrow(
      'LANGSMITH_API_KEY is required for the context experiment',
    );
    expect(() => validateContextExperimentPrerequisites({ apiKey: 'test-key', datasetExists: false })).toThrow(
      'LangSmith dataset not found: kfc-context-relevance-golden-v1',
    );
    expect(() => validateContextExperimentPrerequisites({ apiKey: 'test-key', datasetExists: true })).not.toThrow();
  });
});
