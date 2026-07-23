import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { defaultAgentTurnDeadlineMs } from '../../src/agent/agentExternalCallScope.js';
import { ADVISORY_SCENARIO_CATALOG } from '../../src/evaluation/advisoryCriteria.js';
import { TOOL_NAMES } from '../../src/ordering/types.js';
import { loadScenarioScript } from '../../src/scenarios/scenarioScript.js';
import {
  SCENARIO_COVERAGE_LEDGER_VERSION,
  liveToolCoverageClassification,
  liveScenarioCases,
  unexpectedScenarioTools,
} from './scenarioCoverageLedger.js';

const scenariosRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../ai-talent-tracks/fnb/conversations',
);

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
    '10-so-sanh-mon-va-giai-thich.json',
    '11-khau-vi-va-di-ung.json',
  ]);

  const scripts = await Promise.all(
    liveScenarioCases.map((scenarioCase) =>
      loadScenarioScript(resolve(scenariosRoot, scenarioCase.fileName)),
    ),
  );
  for (const [index, scenarioCase] of liveScenarioCases.entries()) {
    const script = scripts[index]!;
    const ledgerIndexes = scenarioCase.turnExpectations.map(
      ({ turnIndex }) => turnIndex,
    );
    expect(
      new Set(ledgerIndexes).size,
      `${scenarioCase.fileName} has duplicate ledger rows`,
    ).toBe(ledgerIndexes.length);
    expect(
      scenarioCase.turnExpectations.map(({ turnIndex, useCaseIds }) => ({
        turnIndex,
        useCaseIds,
      })),
      `${scenarioCase.fileName} has unmapped turns or mismatched turn-level use cases`,
    ).toEqual(
      script.userTurns.map(({ index: turnIndex, useCases: useCaseIds }) => ({
        turnIndex,
        useCaseIds,
      })),
    );
    expect(
      scenarioCase.turnExpectations.every(
        (expectation) => Object.keys(expectation).length > 1,
      ),
      `${scenarioCase.fileName} contains a ledger row without a machine oracle`,
    ).toBe(true);
    for (const expectation of scenarioCase.turnExpectations) {
      const scriptedTurn = script.userTurns.find(
        (turn) => turn.index === expectation.turnIndex,
      );
      expect(expectation.id).toBe(
        `${scenarioCase.fileName}#${expectation.turnIndex}`,
      );
      expect(expectation.input).toBe(scriptedTurn?.text);
      expect(expectation).toHaveProperty('allowedTools');
      expect(expectation).toHaveProperty('useCaseIds');
      expect(expectation.preconditions.length).toBeGreaterThan(0);
      expect(expectation.evidenceBindings).toEqual(
        expect.arrayContaining([
          'scenario_id',
          'turn_index',
          'checkpoint_namespace',
        ]),
      );
      if (expectation.providerEvidence.requireToolProvenance) {
        expect(expectation.evidenceBindings).toEqual(
          expect.arrayContaining(['catalog_observation', 'provider_revision']),
        );
      }
      expect(
        expectation.stateTransition.mayChange.filter((key) =>
          expectation.stateTransition.mustNotChange.includes(key),
        ),
      ).toEqual([]);
      expect(
        expectation.stateTransition.mustChange.every(
          (key) =>
            expectation.stateTransition.mayChange.includes(key) &&
            !expectation.stateTransition.mustNotChange.includes(key),
        ),
      ).toBe(true);
      expect(expectation.claims).toEqual({
        required: expect.any(Array),
        forbidden: expect.any(Array),
      });
      expect(
        expectation.claims.required.every(
          (predicate) =>
            predicate.kind === 'semantic_response' ||
            predicate.kind === 'grounded_tool_outcome',
        ),
      ).toBe(true);
      for (const predicate of expectation.claims.required) {
        if (predicate.kind !== 'grounded_tool_outcome') continue;
        expect(predicate.anyOf.length).toBeGreaterThan(0);
        expect(
          predicate.statePaths.length + predicate.genUiPaths.length,
        ).toBeGreaterThan(0);
        expect(predicate.textAnyOf.length).toBeGreaterThan(0);
      }
      expect(
        expectation.claims.required.filter(
          ({ kind }) => kind === 'grounded_tool_outcome',
        ),
      ).toHaveLength(expectation.requiredGroups?.length ?? 0);
      const requirementIds = expectation.claims.required.map(
        ({ requirementId }) => requirementId,
      );
      expect(new Set(requirementIds).size).toBe(requirementIds.length);
      expect(expectation.genUi).toEqual(
        expect.objectContaining({
          required: expect.any(Boolean),
          allowedWidgetKinds: expect.any(Array),
          requiredDataPaths: expect.any(Array),
          requiredActions: expect.any(Array),
          forbiddenActions: expect.any(Array),
        }),
      );
      expect(expectation.messenger.projection).toBe('semantic_parity');
      expect(expectation.persistenceEvidence).toEqual({
        transcriptDelta: 2,
        contiguousEvents: true,
        checkpointRequired: true,
        checkpointReadable: true,
      });
      expect(expectation.latency.maxTurnMs).toBeGreaterThan(0);
      expect(expectation.toolOrderGroups).toEqual(
        expectation.enforceToolOrder === false
          ? []
          : (expectation.requiredGroups ?? []),
      );
      expect(expectation.claims.required.length).toBeGreaterThan(0);
      expect(expectation.artifacts).toEqual(
        expect.arrayContaining([
          'transcript',
          'tool_trace',
          'checkpoint',
          'messenger_projection',
        ]),
      );
      if (expectation.providerEvidence.requireToolProvenance)
        expect(expectation.artifacts).toContain('provider_evidence');
      expect(
        expectation.providerEvidence.providerTools.every((toolName) =>
          expectation.allowedTools.includes(toolName),
        ),
      ).toBe(true);
      expect(expectation.providerEvidence.providerTools).not.toContain(
        'handoff',
      );
      const requiredTools = expectation.requiredGroups?.flat() ?? [];
      expect(
        requiredTools.filter(
          (toolName) => !expectation.allowedTools.includes(toolName),
        ),
        `${scenarioCase.fileName} turn ${expectation.turnIndex} requires a tool outside its allowed set`,
      ).toEqual([]);
      expect(
        expectation.allowedTools.filter((toolName) =>
          expectation.forbiddenTools?.includes(toolName),
        ),
        `${scenarioCase.fileName} turn ${expectation.turnIndex} both allows and forbids a tool`,
      ).toEqual([]);
    }
  }

  expect(liveScenarioCases[8]?.targetWidgetKinds).toBeUndefined();
  expect(liveScenarioCases[8]?.forbiddenWidgetKinds).toEqual([
    'paymentOrderStatus',
  ]);
  const allTurns = liveScenarioCases.flatMap(
    ({ turnExpectations }) => turnExpectations,
  );
  expect(defaultAgentTurnDeadlineMs).toBe(30_000);
  expect(new Set(allTurns.map(({ latency }) => latency.maxTurnMs))).toEqual(
    new Set([10_000]),
  );
  expect(Object.keys(liveToolCoverageClassification).sort()).toEqual(
    [...TOOL_NAMES].sort(),
  );
  expect(
    Object.entries(liveToolCoverageClassification)
      .filter(
        ([, classification]) =>
          classification === 'optional_live_deterministic_covered',
      )
      .map(([toolName]) => toolName)
      .sort(),
  ).toEqual(['findStores', 'getItemDetails', 'previewCart']);
  const optionalExecutionPrerequisites = [
    ['01-dat-mon-ro-rang-giao-hang.json', 11, 'checkStoreAvailability'],
    ['02-tu-van-combo-va-upsell.json', 5, 'getModifierOptions'],
    ['02-tu-van-combo-va-upsell.json', 9, 'previewCart'],
    ['04-sau-khi-dat-don.json', 15, 'searchMenu'],
    ['04-sau-khi-dat-don.json', 15, 'previewCart'],
  ] as const;
  for (const [
    fileName,
    turnIndex,
    toolName,
  ] of optionalExecutionPrerequisites) {
    const row = liveScenarioCases
      .find((candidate) => candidate.fileName === fileName)
      ?.turnExpectations.find((candidate) => candidate.turnIndex === turnIndex);
    expect(row?.allowedTools).toContain(toolName);
    expect(row?.requiredGroups?.flat()).not.toContain(toolName);
    expect(
      row?.toolCounts.find((constraint) => constraint.toolName === toolName)
        ?.min,
    ).toBe(0);
  }
  const optionalFindStores = liveScenarioCases
    .find(({ fileName }) => fileName === '03-ton-kho-dia-chi-va-cua-hang.json')!
    .turnExpectations.find(({ turnIndex }) => turnIndex === 9)!;
  expect(optionalFindStores.allowEmptyTools).toBe(true);
  expect(optionalFindStores.toolCounts).toContainEqual({
    toolName: 'findStores',
    min: 0,
  });
  expect(optionalFindStores.providerEvidence.requireToolProvenance).toBe(false);
  expect(optionalFindStores.providerEvidence.providerTools).toEqual([]);
  const advisoryByFile = new Map(
    liveScenarioCases.map((scenario) => [scenario.fileName, scenario.advisory]),
  );
  for (const fileName of [
    '02-tu-van-combo-va-upsell.json',
    '03-ton-kho-dia-chi-va-cua-hang.json',
    '10-so-sanh-mon-va-giai-thich.json',
    '11-khau-vi-va-di-ung.json',
  ]) {
    expect(advisoryByFile.get(fileName)).toMatchObject({
      role: 'core',
      judgmentPolicy: 'warning',
    });
  }
  expect(
    advisoryByFile.get('02-tu-van-combo-va-upsell.json')?.phaseEndTurnIndex,
  ).toBe(9);
  expect(
    advisoryByFile.get('03-ton-kho-dia-chi-va-cua-hang.json')
      ?.phaseEndTurnIndex,
  ).toBe(1);
  for (const fileName of [
    '06-ngon-ngu-tu-nhien-va-an-toan.json',
    '07-ca-nhan-hoa-va-loyalty.json',
  ]) {
    expect(advisoryByFile.get(fileName)).toMatchObject({
      role: 'supporting',
      judgmentPolicy: 'evidence_only',
    });
  }
  for (const [fileName, metadata] of Object.entries(
    ADVISORY_SCENARIO_CATALOG,
  )) {
    expect(
      liveScenarioCases.find((scenario) => scenario.fileName === fileName)
        ?.advisory,
      `${fileName} must consume the shared advisory criterion catalog`,
    ).toBe(metadata);
  }
  const advisoryCriteria = liveScenarioCases.flatMap(
    ({ advisory }) => advisory?.criteria ?? [],
  );
  expect(advisoryCriteria.length).toBeGreaterThan(0);
  expect(new Set(advisoryCriteria.map(({ id }) => id)).size).toBe(
    advisoryCriteria.length,
  );
  expect(
    advisoryCriteria.every(
      ({ id, description }) => id.length > 0 && description.length > 0,
    ),
  ).toBe(true);

  const row = (fileName: string, turnIndex: number) =>
    liveScenarioCases
      .find((scenario) => scenario.fileName === fileName)!
      .turnExpectations.find((turn) => turn.turnIndex === turnIndex)!;
  expect(row('02-tu-van-combo-va-upsell.json', 1)).toMatchObject({
    requiredGroups: [['searchMenu', 'getItemDetails', 'getModifierOptions']],
    enforceToolOrder: false,
    requiredCatalogCategoryIds: ['20006'],
  });
  expect(row('02-tu-van-combo-va-upsell.json', 3)).toMatchObject({
    genUi: expect.objectContaining({ requireCompleteMenuCollection: true }),
    stateTransition: expect.objectContaining({
      pathConstraints: expect.arrayContaining([
        {
          path: 'activeMenuCollection.result.complete',
          operator: 'equals',
          value: true,
        },
      ]),
    }),
  });
  expect(row('02-tu-van-combo-va-upsell.json', 5)).toMatchObject({
    semanticResponse: [
      expect.objectContaining({
        act: 'recommend_verified_value_conversion_with_consent',
      }),
    ],
    stateTransition: expect.objectContaining({
      pathConstraints: expect.arrayContaining([
        { path: 'cart.items.length', operator: 'equals', value: 3 },
        { path: 'cart.totalVnd', operator: 'equals', value: 404_000 },
      ]),
    }),
  });
  expect(
    row('02-tu-van-combo-va-upsell.json', 5).argumentConstraints,
  ).toContainEqual(
    expect.objectContaining({
      toolName: 'updateCart',
      constraints: expect.arrayContaining([
        { path: 'changes.0.itemCode', operator: 'equals', value: '41037' },
        { path: 'changes.0.quantity', operator: 'equals', value: 3 },
      ]),
    }),
  );
  expect(row('02-tu-van-combo-va-upsell.json', 7)).toMatchObject({
    semanticResponse: [
      expect.objectContaining({
        act: 'apply_verified_value_conversion_after_consent',
      }),
    ],
    stateTransition: expect.objectContaining({
      pathConstraints: expect.arrayContaining([
        { path: 'cart.items.length', operator: 'equals', value: 1 },
        { path: 'cart.items.0.itemCode', operator: 'equals', value: '20752' },
        { path: 'cart.items.0.quantity', operator: 'equals', value: 2 },
        { path: 'cart.totalVnd', operator: 'equals', value: 258_000 },
      ]),
    }),
  });
  expect(
    row('02-tu-van-combo-va-upsell.json', 9).stateTransition.pathConstraints,
  ).toEqual(
    expect.arrayContaining([
      { path: 'cart.items.length', operator: 'equals', value: 1 },
      { path: 'cart.totalVnd', operator: 'equals', value: 286_000 },
    ]),
  );
  expect(row('03-ton-kho-dia-chi-va-cua-hang.json', 1)).toMatchObject({
    requiredGroups: [['searchMenu', 'getItemDetails']],
    requiredCatalogItemEvidence: [{ code: '41140', available: false }],
    forbiddenTools: expect.arrayContaining([
      'updateCart',
      'quoteFulfillment',
      'placeOrder',
    ]),
  });
  expect(row('06-ngon-ngu-tu-nhien-va-an-toan.json', 1)).toMatchObject({
    requiredGroups: [['searchMenu'], ['updateCart']],
    allowedTools: ['searchMenu', 'updateCart'],
    stateTransition: expect.objectContaining({
      mayChange: expect.arrayContaining(['activeMenuCollection']),
    }),
  });
  expect(row('06-ngon-ngu-tu-nhien-va-an-toan.json', 3)).toMatchObject({
    requiredGroups: [['searchMenu', 'getItemDetails'], ['getModifierOptions']],
    allowedTools: ['searchMenu', 'getItemDetails', 'getModifierOptions'],
  });
  expect(
    row('06-ngon-ngu-tu-nhien-va-an-toan.json', 3).allowedTools,
  ).not.toEqual(
    expect.arrayContaining(['searchContentPolicy', 'answerAllergenQuestion']),
  );
  for (const turnIndex of [1, 3]) {
    expect(
      row('10-so-sanh-mon-va-giai-thich.json', turnIndex).forbiddenTools,
    ).toEqual(
      expect.arrayContaining([
        'updateCart',
        'previewOrder',
        'placeOrder',
        'createPaymentLink',
        'checkPaymentStatus',
      ]),
    );
    expect(row('11-khau-vi-va-di-ung.json', turnIndex).forbiddenTools).toEqual(
      expect.arrayContaining([
        'updateCart',
        'previewOrder',
        'placeOrder',
        'createPaymentLink',
        'checkPaymentStatus',
      ]),
    );
    for (const fileName of [
      '10-so-sanh-mon-va-giai-thich.json',
      '11-khau-vi-va-di-ung.json',
    ]) {
      expect(row(fileName, turnIndex).stateTransition.mustNotChange).toEqual(
        expect.arrayContaining([
          'cart',
          'order',
          'paymentAttempt',
          'fulfillment',
        ]),
      );
      expect(row(fileName, turnIndex).stateTransition.pathConstraints).toEqual(
        expect.arrayContaining([
          { path: 'cart', operator: 'unchanged' },
          { path: 'order', operator: 'unchanged' },
          { path: 'paymentAttempt', operator: 'unchanged' },
          { path: 'fulfillment', operator: 'unchanged' },
        ]),
      );
    }
  }
  expect(row('10-so-sanh-mon-va-giai-thich.json', 1)).toMatchObject({
    requiredCatalogItemEvidence: [
      { code: '20698', priceVnd: 79_000 },
      { code: '20709', priceVnd: 85_000 },
    ],
  });
  expect(
    row('10-so-sanh-mon-va-giai-thich.json', 3).requiredCatalogModifierEvidence,
  ).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        itemCode: '20709',
        groupId: '60253',
        modifierId: '70027',
      }),
      expect.objectContaining({
        itemCode: '20709',
        groupId: '60253',
        modifierId: '70036',
      }),
    ]),
  );
  expect(
    row('11-khau-vi-va-di-ung.json', 1).requiredCatalogModifierEvidence,
  ).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        itemCode: '41042',
        groupId: '60258',
        modifierId: '70444',
      }),
      expect.objectContaining({
        itemCode: '41043',
        groupId: '60259',
        modifierId: '70049',
        groupMin: 0,
        default: false,
        quantity: 0,
      }),
    ]),
  );
  expect(row('11-khau-vi-va-di-ung.json', 3)).toMatchObject({
    requiredGroups: [['searchContentPolicy', 'answerAllergenQuestion']],
  });

  const actualUseCases = [
    ...new Set(
      scripts
        .flatMap((script) => script.useCases)
        .filter((useCase) => useCase !== 'Filler'),
    ),
  ].sort();
  const expectedUseCases = Array.from(
    { length: 39 },
    (_, index) => `UC-${String(index + 1).padStart(2, '0')}`,
  );
  expect(actualUseCases).toEqual(expectedUseCases);

  expect(() => {
    expect(
      unexpectedScenarioTools(
        ['getOrderStatus'],
        ['getOrderStatus'],
        ['placeOrder'],
      ),
    ).toEqual([]);
  }).toThrow();
});
