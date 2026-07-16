import { join } from 'node:path';
import { expect, it } from 'vitest';
import { loadScenarioScript } from '../../src/scenarios/scenarioScript.js';
import {
  SCENARIO_COVERAGE_LEDGER_VERSION,
  liveScenarioCases,
  unexpectedScenarioTools,
} from './scenarioCoverageLedger.js';

const scenariosRoot = join(process.cwd(), '../../ai-talent-tracks/fnb/conversations');

it('maps the versioned closed-world ledger exactly once to every scenario turn and UC-01 through UC-39', async () => {
  expect(SCENARIO_COVERAGE_LEDGER_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/);
  expect(liveScenarioCases.map(({ fileName }) => fileName)).toEqual([
    '01-dat-mon-ro-rang-giao-hang.json',
    '02-tu-van-combo-va-upsell.json',
    '03-ton-kho-dia-chi-va-cua-hang.json',
    '04-sau-khi-dat-don.json',
    '05-khieu-nai-va-human-handoff.json',
    '06-ngon-ngu-tu-nhien-va-an-toan.json',
    '07-ca-nhan-hoa-va-loyalty.json',
    '08-thanh-toan-loi-va-don-bat-thuong.json',
    '09-phuong-thuc-thanh-toan.json',
  ]);

  const scripts = await Promise.all(
    liveScenarioCases.map((scenarioCase) => loadScenarioScript(join(scenariosRoot, scenarioCase.fileName))),
  );
  for (const [index, scenarioCase] of liveScenarioCases.entries()) {
    const script = scripts[index]!;
    const ledgerIndexes = scenarioCase.turnExpectations.map(({ turnIndex }) => turnIndex);
    expect(new Set(ledgerIndexes).size, `${scenarioCase.fileName} has duplicate ledger rows`).toBe(ledgerIndexes.length);
    expect(
      scenarioCase.turnExpectations.map(({ turnIndex, useCaseIds }) => ({ turnIndex, useCaseIds })),
      `${scenarioCase.fileName} has unmapped turns or mismatched turn-level use cases`,
    ).toEqual(
      script.userTurns.map(({ index: turnIndex, useCases: useCaseIds }) => ({ turnIndex, useCaseIds })),
    );
    expect(
      scenarioCase.turnExpectations.every((expectation) => Object.keys(expectation).length > 1),
      `${scenarioCase.fileName} contains a ledger row without a machine oracle`,
    ).toBe(true);
    for (const expectation of scenarioCase.turnExpectations) {
      const scriptedTurn = script.userTurns.find((turn) => turn.index === expectation.turnIndex);
      expect(expectation.id).toBe(`${scenarioCase.fileName}#${expectation.turnIndex}`);
      expect(expectation.input).toBe(scriptedTurn?.text);
      expect(expectation).toHaveProperty('allowedTools');
      expect(expectation).toHaveProperty('useCaseIds');
      expect(expectation.preconditions.length).toBeGreaterThan(0);
      expect(expectation.evidenceBindings).toEqual(expect.arrayContaining(['scenario_id', 'turn_index', 'checkpoint_namespace']));
      if (expectation.providerEvidence.requireToolProvenance) {
        expect(expectation.evidenceBindings).toEqual(expect.arrayContaining(['catalog_observation', 'provider_revision']));
      }
      expect(expectation.stateTransition.mayChange.filter(
        (key) => expectation.stateTransition.mustNotChange.includes(key),
      )).toEqual([]);
      expect(expectation.stateTransition.mustChange.every(
        (key) => expectation.stateTransition.mayChange.includes(key) && !expectation.stateTransition.mustNotChange.includes(key),
      )).toBe(true);
      expect(expectation.claims).toEqual({ required: expect.any(Array), forbidden: expect.any(Array) });
      expect(expectation.claims.required.every((predicate) =>
        predicate.kind === 'safe_customer_response' || predicate.kind === 'grounded_tool_outcome')).toBe(true);
      for (const predicate of expectation.claims.required) {
        if (predicate.kind !== 'grounded_tool_outcome') continue;
        expect(predicate.anyOf.length).toBeGreaterThan(0);
        expect(predicate.statePaths.length + predicate.genUiPaths.length).toBeGreaterThan(0);
        expect(predicate.textAnyOf.length).toBeGreaterThan(0);
      }
      expect(expectation.genUi).toEqual(expect.objectContaining({
        required: expect.any(Boolean), allowedWidgetKinds: expect.any(Array), requiredDataPaths: expect.any(Array),
        requiredActions: expect.any(Array), forbiddenActions: expect.any(Array),
      }));
      expect(expectation.messenger.projection).toBe('semantic_parity');
      expect(expectation.persistenceEvidence).toEqual({
        transcriptDelta: 2, contiguousEvents: true, checkpointRequired: true,
      });
      expect(expectation.latency.maxTurnMs).toBeGreaterThan(0);
      expect(expectation.toolOrderGroups).toEqual(expectation.requiredGroups ?? []);
      expect(expectation.claims.required.length).toBeGreaterThan(0);
      expect(expectation.artifacts).toEqual(expect.arrayContaining(['transcript', 'tool_trace', 'checkpoint', 'messenger_projection']));
      if (expectation.providerEvidence.requireToolProvenance) expect(expectation.artifacts).toContain('provider_evidence');
      expect(expectation.providerEvidence.providerTools.every((toolName) => expectation.allowedTools.includes(toolName))).toBe(true);
      expect(expectation.providerEvidence.providerTools).not.toContain('handoff');
      const requiredTools = expectation.requiredGroups?.flat() ?? [];
      expect(
        requiredTools.filter((toolName) => !expectation.allowedTools.includes(toolName)),
        `${scenarioCase.fileName} turn ${expectation.turnIndex} requires a tool outside its allowed set`,
      ).toEqual([]);
      expect(
        expectation.allowedTools.filter((toolName) => expectation.forbiddenTools?.includes(toolName)),
        `${scenarioCase.fileName} turn ${expectation.turnIndex} both allows and forbids a tool`,
      ).toEqual([]);
    }
  }

  expect(scripts.slice(0, 8).reduce((total, script) => total + script.userTurns.length, 0)).toBe(44);
  expect(liveScenarioCases.reduce((total, scenarioCase) => total + scenarioCase.turnExpectations.length, 0)).toBe(46);
  expect(new Set(liveScenarioCases.flatMap((scenarioCase) => scenarioCase.turnExpectations.map((row) => row.id))).size).toBe(46);
  expect(liveScenarioCases[8]?.targetWidgetKinds).toBeUndefined();
  expect(liveScenarioCases[8]?.forbiddenWidgetKinds).toEqual(['paymentOrderStatus']);
  const optionalExecutionPrerequisites = [
    ['01-dat-mon-ro-rang-giao-hang.json', 11, 'checkStoreAvailability'],
    ['02-tu-van-combo-va-upsell.json', 5, 'getModifierOptions'],
    ['02-tu-van-combo-va-upsell.json', 9, 'previewCart'],
    ['03-ton-kho-dia-chi-va-cua-hang.json', 1, 'searchMenu'],
    ['04-sau-khi-dat-don.json', 15, 'searchMenu'],
    ['04-sau-khi-dat-don.json', 15, 'previewCart'],
  ] as const;
  for (const [fileName, turnIndex, toolName] of optionalExecutionPrerequisites) {
    const row = liveScenarioCases.find((candidate) => candidate.fileName === fileName)?.turnExpectations.find((candidate) => candidate.turnIndex === turnIndex);
    expect(row?.allowedTools).toContain(toolName);
    expect((row?.requiredGroups ?? []).flat()).not.toContain(toolName);
    expect(row?.toolCounts.find((constraint) => constraint.toolName === toolName)?.min).toBe(0);
  }
  const unavailableItemRow = liveScenarioCases[2]!.turnExpectations[0]!;
  expect(unavailableItemRow.providerEvidence.requireToolProvenance).toBe(false);
  expect(unavailableItemRow.argumentConstraints).not.toContainEqual(expect.objectContaining({ toolName: 'searchMenu' }));
  const actualUseCases = [...new Set(scripts.flatMap((script) => script.useCases).filter((useCase) => useCase !== 'Filler'))].sort();
  const expectedUseCases = Array.from({ length: 39 }, (_, index) => `UC-${String(index + 1).padStart(2, '0')}`);
  expect(actualUseCases).toEqual(expectedUseCases);

  expect(() => {
    expect(unexpectedScenarioTools(['getOrderStatus'], ['getOrderStatus'], ['placeOrder'])).toEqual([]);
  }).toThrow();
});
