import { describe, expect, it } from 'vitest';
import { evaluateGenUiProof, type GenUiProofManifest, type GenUiScenarioExpectation } from '../../src/evaluation/genUiProofEvaluator.js';

const expectations: GenUiScenarioExpectation[] = [
  {
    scenarioId: '01-ordering',
    requiredWidgetKinds: ['addressFulfillmentCheck', 'orderReviewConfirm'],
    turns: [
      {
        turnIndex: 1,
        text: 'Giao den Quan 7',
        useCases: ['UC-01'],
        expectedWidgetKind: 'addressFulfillmentCheck',
      },
      {
        turnIndex: 3,
        text: 'Giao den dia chi nay',
        useCases: ['UC-17'],
        expectedWidgetKind: 'orderReviewConfirm',
      },
    ],
  },
];

function manifest(overrides: Partial<GenUiProofManifest> = {}): GenUiProofManifest {
  return {
    runId: 'run-1',
    generatedAt: '2026-07-11T00:00:00.000Z',
    liveAi: true,
    passed: true,
    artifactRoot: '/tmp/proof',
    screenshots: [
      { scenario: '01-ordering', turnIndex: 1, widgetKind: 'addressFulfillmentCheck', path: '/tmp/01.png', exists: true },
      { scenario: '01-ordering', turnIndex: 3, widgetKind: 'orderReviewConfirm', path: '/tmp/03.png', exists: true },
    ],
    dashboardTelemetry: [
      {
        sessionId: 'kfc:anon_customer_integration_01-ordering_1',
        turns: [
          { role: 'user', text: 'Giao den Quan 7', widgetKind: null },
          { role: 'assistant', text: 'Mình đã kiểm tra giao hàng.', widgetKind: 'addressFulfillmentCheck' },
          { role: 'user', text: 'Giao den dia chi nay', widgetKind: null },
          { role: 'assistant', text: 'Bạn kiểm tra đơn trước khi đặt.', widgetKind: 'orderReviewConfirm' },
        ],
      },
    ],
    ...overrides,
  };
}

describe('GenUI proof evaluator', () => {
  it('passes a complete scenario with matching widgets and screenshots', () => {
    const result = evaluateGenUiProof(manifest(), expectations);

    expect(result.passed).toBe(true);
    expect(result.scenarios[0]?.scores).toMatchObject({
      widgetCorrectness: 1,
      lifecycleCoverage: 1,
      screenshotCompleteness: 1,
      forbiddenHandoff: 1,
      conciseWidgetResponses: 1,
    });
  });

  it('evaluates only the declared scenario for a filtered live proof', () => {
    const result = evaluateGenUiProof(
      manifest({ logs: ['scenarioFilter=01-ordering'] }),
      [
        ...expectations,
        {
          scenarioId: '02-menu',
          requiredWidgetKinds: ['smartMenuPicker'],
          turns: [
            {
              turnIndex: 1,
              text: 'Goi y combo',
              useCases: ['UC-02'],
              expectedWidgetKind: 'smartMenuPicker',
            },
          ],
        },
      ],
    );

    expect(result.scenarioCount).toBe(1);
    expect(result.scenarios[0]?.scenarioId).toBe('01-ordering');
    expect(result.passed).toBe(true);
  });

  it('reports wrong widgets, forbidden handoff, missing lifecycle, and missing screenshots', () => {
    const broken = manifest({
      screenshots: [
        { scenario: '01-ordering', turnIndex: 1, widgetKind: 'addressFulfillmentCheck', path: '/tmp/01.png', exists: true },
        { scenario: '01-ordering', turnIndex: 3, widgetKind: 'orderReviewConfirm', path: '/tmp/03.png', exists: false },
      ],
      dashboardTelemetry: [
        {
          sessionId: 'kfc:anon_customer_integration_01-ordering_1',
          turns: [
            { role: 'user', text: 'Giao den Quan 7', widgetKind: null },
            { role: 'assistant', text: 'Mình chuyển nhân viên.', widgetKind: 'supportHandoff' },
            { role: 'user', text: 'Giao den dia chi nay', widgetKind: null },
            { role: 'assistant', text: 'Bạn kiểm tra đơn.', widgetKind: null },
          ],
        },
      ],
    });

    const result = evaluateGenUiProof(broken, expectations);

    expect(result.passed).toBe(false);
    expect(result.scenarios[0]?.scores).toMatchObject({
      widgetCorrectness: 0,
      lifecycleCoverage: 0,
      screenshotCompleteness: 0,
      forbiddenHandoff: 0,
    });
    expect(result.scenarios[0]?.failures).toEqual(
      expect.arrayContaining([
        expect.stringContaining('expected addressFulfillmentCheck'),
        expect.stringContaining('missing required widget'),
        expect.stringContaining('missing screenshot'),
        expect.stringContaining('forbidden supportHandoff'),
      ]),
    );
  });
});
