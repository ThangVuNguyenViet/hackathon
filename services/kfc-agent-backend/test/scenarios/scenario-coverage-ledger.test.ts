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
      expect(expectation).toHaveProperty('allowedTools');
      expect(expectation).toHaveProperty('useCaseIds');
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
  expect(liveScenarioCases[8]?.targetWidgetKinds).toBeUndefined();
  expect(liveScenarioCases[8]?.forbiddenWidgetKinds).toEqual(['paymentOrderStatus']);
  const actualUseCases = [...new Set(scripts.flatMap((script) => script.useCases).filter((useCase) => useCase !== 'Filler'))].sort();
  const expectedUseCases = Array.from({ length: 39 }, (_, index) => `UC-${String(index + 1).padStart(2, '0')}`);
  expect(actualUseCases).toEqual(expectedUseCases);

  expect(() => {
    expect(unexpectedScenarioTools(['getOrderStatus'], ['getOrderStatus'], ['placeOrder'])).toEqual([]);
  }).toThrow();
});
