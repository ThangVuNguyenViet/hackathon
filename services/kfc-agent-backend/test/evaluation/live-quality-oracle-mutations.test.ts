import { describe, expect, it } from 'vitest';
import { buildLiveQualityDatasetCases } from '../../src/evaluation/liveQualityDataset.js';
import type {
  LiveQualityExperimentOutput,
  LiveQualityEvaluationScore,
  TurnExpectation,
} from '../../src/evaluation/liveQualityContracts.js';
import { LIVE_QUALITY_INVENTORY_VERSION } from '../../src/evaluation/liveQualityContracts.js';
import {
  createLiveQualityExperimentEvaluator,
  evaluateLiveQualityOutput,
} from '../../src/evaluation/liveQualityEvaluators.js';
import type { ToolName, ToolTraceEntry } from '../../src/ordering/types.js';
import { liveScenarioCases } from '../scenarios/scenarioCoverageLedger.js';

const provenance = [
  {
    fixtureMode: 'test_only' as const,
    sourceFile: 'test/evaluation/live-quality-oracle-mutations.test.ts',
  },
];

function expectation(id: string): TurnExpectation {
  const row = liveScenarioCases
    .flatMap(({ turnExpectations }) => turnExpectations)
    .find((candidate) => candidate.id === id);
  if (!row) throw new Error(`missing ledger row ${id}`);
  return structuredClone(row);
}

function entry(
  toolName: ToolName,
  arguments_: Record<string, unknown>,
  options: { ok?: boolean; resultSummary?: string } = {},
): ToolTraceEntry {
  return {
    toolName,
    arguments: arguments_,
    ok: options.ok ?? true,
    resultSummary: options.resultSummary ?? `${toolName}_ok`,
    provenance,
  };
}

function output(input: {
  responseText: string;
  entries: ToolTraceEntry[];
  stateBefore?: Record<string, unknown>;
  stateAfter?: Record<string, unknown>;
  genUi?: unknown;
}): LiveQualityExperimentOutput {
  return {
    responseText: input.responseText,
    executedTools: input.entries,
    observations: [],
    stateBefore: input.stateBefore ?? {},
    stateAfter: input.stateAfter ?? {},
    ...('genUi' in input ? { genUi: input.genUi } : {}),
    durationMs: 100,
    persistence: {
      transcriptRevisionBefore: 0,
      transcriptRevisionAfter: 2,
      eventRevisionBefore: 0,
      eventRevisionAfter: 1,
      eventIdsBefore: [],
      eventIds: ['event-1'],
      eventIdsAfter: ['event-1'],
      checkpointId: 'checkpoint-1',
      checkpointNamespace: '',
      checkpointThreadId: 'agent:["replay_test","run:test"]',
      checkpointVerified: true,
    },
  };
}

function component(
  expected: TurnExpectation,
  observed: LiveQualityExperimentOutput,
  key: LiveQualityEvaluationScore['key'],
  mode: 'text' | 'genui' = 'text',
) {
  return evaluateLiveQualityOutput(expected, observed, mode).find(
    (candidate) => candidate.key === key,
  );
}

describe('live quality oracle mutation sensitivity', () => {
  it('preserves the attested v2 dependency ordering oracle', () => {
    const expected = expectation('04-sau-khi-dat-don.json#11');
    const order = { id: 'KFC-1024' };
    const status = entry('getOrderStatus', { orderId: order.id });
    const handoff = entry('handoff', {
      reasons: ['order_cancellation_after_preparation'],
    });
    const observed = (entries: ToolTraceEntry[]) =>
      output({
        responseText:
          'The order status was checked before support accepted the handoff.',
        entries,
        stateBefore: { order },
        stateAfter: {
          order,
          handoff: {
            escalationId: 'handoff-1',
            reasons: ['order_cancellation_after_preparation'],
          },
        },
      });

    expect(
      component(expected, observed([status, handoff]), 'tool_contract'),
    ).toMatchObject({ score: true });
    expect(
      component(expected, observed([handoff, status]), 'tool_contract'),
    ).toMatchObject({
      score: false,
      comment: expect.stringContaining('missing ordered tool'),
    });
  });

  it('preserves the attested v2 internal-metadata leak oracle', () => {
    const expected = expectation('04-sau-khi-dat-don.json#7');
    const markers = [
      ...(expected.claims.forbidden ?? []),
      ...(expected.messenger.forbiddenText ?? []),
    ];
    expect(markers.length).toBeGreaterThan(0);
    const observed = (responseText: string) =>
      output({
        responseText,
        entries: [],
      });

    expect(
      component(
        expected,
        observed('I cannot change an order after it has been created.'),
        'presentation_contract',
      ),
    ).toMatchObject({ score: true });
    expect(
      component(
        expected,
        observed(
          `I cannot change the order. Internal details: ${markers.join(' ')}`,
        ),
        'presentation_contract',
      ),
    ).toMatchObject({
      score: false,
      comment: expect.stringContaining('forbidden internal marker'),
    });
  });

  it('rejects internal metadata in structured GenUI fields', () => {
    const expected = expectation('08-thanh-toan-loi-va-don-bat-thuong.json#5');
    const handoff = {
      escalationId: 'handoff-1',
      reasons: ['human_review_required'],
    };
    const observed = output({
      responseText: 'Support accepted the handoff.',
      entries: [
        entry('handoff', {
          reasons: ['human_review_required'],
        }),
      ],
      stateAfter: { handoff },
      genUi: {
        id: 'handoff-1',
        lifecycleStage: 'support',
        widgetKind: 'supportHandoff',
        status: 'active',
        data: {
          handoff,
          toolTrace: [{ toolName: 'handoff' }],
        },
        actions: [{ id: 'send_issue_summary' }],
      },
    });

    expect(
      component(expected, observed, 'presentation_contract', 'genui'),
    ).toMatchObject({
      score: false,
      comment: expect.stringContaining(
        'GenUI exposes internal metadata: data.toolTrace',
      ),
    });
  });

  it('treats null GenUI evidence as missing', () => {
    const expected = expectation('08-thanh-toan-loi-va-don-bat-thuong.json#5');
    const handoff = {
      escalationId: 'handoff-1',
      reasons: ['human_review_required'],
    };
    const observed = output({
      responseText: 'Support accepted the handoff.',
      entries: [
        entry('handoff', {
          reasons: ['human_review_required'],
        }),
      ],
      stateAfter: { handoff },
      genUi: {
        id: 'handoff-1',
        lifecycleStage: 'support',
        widgetKind: 'supportHandoff',
        status: 'active',
        data: { handoff: null },
        actions: [{ id: 'send_issue_summary' }],
      },
    });

    expect(
      component(expected, observed, 'grounded_response', 'genui'),
    ).toMatchObject({
      score: false,
      comment: expect.stringContaining('has no GenUI evidence'),
    });
    expect(
      component(expected, observed, 'presentation_contract', 'genui'),
    ).toMatchObject({
      score: false,
      comment: expect.stringContaining('GenUI missing data.handoff'),
    });

    const nullState = output({
      responseText: 'Support accepted the handoff.',
      entries: [
        entry('handoff', {
          reasons: ['human_review_required'],
        }),
      ],
      stateAfter: { handoff: null },
      genUi: {
        id: 'handoff-1',
        lifecycleStage: 'support',
        widgetKind: 'supportHandoff',
        status: 'active',
        data: { handoff },
        actions: [{ id: 'send_issue_summary' }],
      },
    });
    expect(
      component(expected, nullState, 'grounded_response', 'genui'),
    ).toMatchObject({
      score: false,
      comment: expect.stringContaining('has no verified state evidence'),
    });
  });

  it('rejects an all-menu turn that omits its independent promotion outcome', () => {
    const expected = expectation('02-tu-van-combo-va-upsell.json#3');
    const items = [
      { code: '41141', name: 'Burger Gà Zinger', category: 'Burger' },
      { code: '41074', name: 'Pepsi', category: 'Thức Uống' },
    ];
    const observed = output({
      responseText: 'Mình đã hiển thị toàn bộ menu.',
      entries: [entry('searchMenu', { scope: 'all', query: null })],
      stateAfter: {
        menuSearchResults: items,
        activeMenuCollection: {
          result: {
            items,
            total: 2,
            returned: 2,
            complete: true,
            scope: { scope: 'all' },
          },
        },
      },
    });

    expect(component(expected, observed, 'tool_contract')).toMatchObject({
      score: false,
      comment: expect.stringContaining('missing required tool group'),
    });
    expect(component(expected, observed, 'grounded_response')).toMatchObject({
      score: false,
      comment: expect.stringContaining(
        'searchPromotions|explainPromotion|validateVoucher',
      ),
    });
  });

  it('accepts exact active catalog evidence without requiring a duplicate read', () => {
    const expected = expectation('10-so-sanh-mon-va-giai-thich.json#3');
    const items = [
      {
        code: '20698',
        name: 'Combo Burger Zinger',
        priceVnd: 79_000,
        modifierGroups: [],
      },
      {
        code: '20709',
        name: 'Combo Tiêu Tung Chill 85k',
        priceVnd: 85_000,
        modifierGroups: [
          {
            groupId: '60253',
            options: [
              { modifierId: '70027', name: 'Gà Giòn Không Cay' },
              { modifierId: '70036', name: 'Gà Truyền Thống' },
            ],
          },
        ],
      },
    ];
    const observed = output({
      responseText:
        'Chọn combo 20709 với Gà Giòn Không Cay; độ cay của Gà Lắc Tiêu Chanh chưa được xác minh.',
      entries: [],
      stateAfter: {
        menuSearchResults: items,
        activeMenuCollection: {
          key: 'filtered:20698%20or%2020709',
          revision: 'verified-collection-revision',
          providerRevision: 'provider-menu-revision',
          result: {
            items,
            total: 2,
            returned: 2,
            complete: true,
            scope: {
              scope: 'filtered',
              query: '20698 or 20709',
            },
          },
        },
      },
    });

    expect(component(expected, observed, 'tool_contract')).toMatchObject({
      score: true,
    });
    expect(component(expected, observed, 'grounded_response')).toMatchObject({
      score: true,
    });
    expect(component(expected, observed, 'provider_evidence')).toMatchObject({
      score: true,
    });

    const unversioned = structuredClone(observed);
    if (
      typeof unversioned.stateAfter.activeMenuCollection !== 'object' ||
      unversioned.stateAfter.activeMenuCollection === null
    ) {
      throw new Error('active menu fixture is missing');
    }
    Reflect.deleteProperty(
      unversioned.stateAfter.activeMenuCollection,
      'providerRevision',
    );
    for (const key of [
      'tool_contract',
      'grounded_response',
      'provider_evidence',
    ] as const) {
      expect(component(expected, unversioned, key)).toMatchObject({
        score: false,
      });
    }
  });

  it('rejects a filtered category search presented as the complete menu', () => {
    const expected = expectation('02-tu-van-combo-va-upsell.json#3');
    const items = [
      {
        code: '99999',
        name: 'Món Mới',
        category: 'Món Mới',
        categoryId: 'new-items',
      },
    ];
    const observed = output({
      responseText: 'Đây là toàn bộ menu.',
      entries: [
        entry('searchMenu', {
          scope: 'filtered',
          query: 'Món Mới',
        }),
        entry('searchPromotions', { query: 'today' }),
      ],
      stateAfter: {
        menuSearchResults: items,
        activeMenuCollection: {
          result: {
            items,
            total: 20,
            returned: 1,
            complete: false,
            scope: { scope: 'filtered', query: 'Món Mới' },
          },
        },
        promotionContext: { offers: [] },
      },
      genUi: {
        id: 'menu-1',
        lifecycleStage: 'active',
        widgetKind: 'smartMenuPicker',
        status: 'active',
        data: {
          items,
          categories: [
            {
              categoryId: 'new-items',
              label: 'Món Mới',
            },
          ],
          total: 20,
          returned: 1,
          complete: false,
          collection: {
            total: 20,
            returned: 1,
            complete: false,
            scope: { scope: 'filtered', query: 'Món Mới' },
          },
        },
        actions: [{ id: 'add_items' }],
      },
    });

    expect(component(expected, observed, 'tool_contract')).toMatchObject({
      score: false,
      comment: expect.stringContaining('exact contract'),
    });
    expect(component(expected, observed, 'state_transition')).toMatchObject({
      score: false,
      comment: expect.stringContaining('menu collection scope is not all'),
    });
    expect(
      component(expected, observed, 'presentation_contract', 'genui'),
    ).toMatchObject({
      score: false,
      comment: expect.stringContaining(
        'GenUI does not project the complete all-menu collection',
      ),
    });
  });

  it('pins the loose-order value comparison and consented combo conversion', () => {
    const looseOrder = expectation('02-tu-van-combo-va-upsell.json#5');
    const wrongLooseOrder = output({
      responseText: 'Mình đã chuẩn bị các món lẻ.',
      entries: [
        entry('updateCart', {
          changes: [
            { itemCode: '41037', quantity: 2 },
            { itemCode: '41035', quantity: 1 },
            { itemCode: '41074', quantity: 4 },
          ],
        }),
      ],
      stateAfter: {
        cart: {
          items: [
            { itemCode: '41037', quantity: 2 },
            { itemCode: '41035', quantity: 1 },
            { itemCode: '41074', quantity: 4 },
          ],
          totalVnd: 365_000,
        },
      },
    });
    expect(
      component(looseOrder, wrongLooseOrder, 'tool_contract'),
    ).toMatchObject({
      score: false,
      comment: expect.stringContaining('exact contract'),
    });
    expect(
      component(looseOrder, wrongLooseOrder, 'state_transition'),
    ).toMatchObject({
      score: false,
      comment: expect.stringMatching(/quantity|totalVnd/u),
    });

    const conversion = expectation('02-tu-van-combo-va-upsell.json#7');
    const incompleteConversion = output({
      responseText: 'Mình đã đổi sang hai combo.',
      entries: [
        entry('updateCart', {
          changes: [{ itemCode: '20752', quantity: 2 }],
        }),
      ],
      stateBefore: {
        cart: {
          items: [
            { itemCode: '41037', quantity: 3 },
            { itemCode: '41035', quantity: 1 },
            { itemCode: '41074', quantity: 4 },
          ],
          totalVnd: 404_000,
        },
      },
      stateAfter: {
        cart: {
          items: [
            { itemCode: '41037', quantity: 3 },
            { itemCode: '41035', quantity: 1 },
            { itemCode: '41074', quantity: 4 },
            { itemCode: '20752', quantity: 2 },
          ],
          totalVnd: 662_000,
        },
      },
    });
    expect(
      component(conversion, incompleteConversion, 'tool_contract'),
    ).toMatchObject({
      score: false,
      comment: expect.stringContaining('exact contract'),
    });
    expect(
      component(conversion, incompleteConversion, 'state_transition'),
    ).toMatchObject({
      score: false,
      comment: expect.stringMatching(/items|totalVnd/u),
    });

    const retainedLooseItem = output({
      responseText: 'Mình đã đổi sang hai combo.',
      entries: [
        entry('updateCart', {
          changes: [
            { itemCode: '41037', quantity: 0 },
            { itemCode: '41035', quantity: 0 },
            { itemCode: '41074', quantity: 0 },
            { itemCode: '20752', quantity: 2 },
          ],
        }),
      ],
      stateBefore: {
        cart: {
          items: [
            { itemCode: '41037', quantity: 3 },
            { itemCode: '41035', quantity: 1 },
            { itemCode: '41074', quantity: 4 },
          ],
          totalVnd: 404_000,
        },
      },
      stateAfter: {
        cart: {
          items: [
            { itemCode: '20752', quantity: 2 },
            { itemCode: '41074', quantity: 1 },
          ],
          totalVnd: 258_000,
        },
      },
    });
    expect(
      component(conversion, retainedLooseItem, 'tool_contract'),
    ).toMatchObject({ score: true });
    expect(
      component(conversion, retainedLooseItem, 'state_transition'),
    ).toMatchObject({
      score: false,
      comment: expect.stringContaining('cart.items.length'),
    });
  });

  it('accepts semantically equivalent cart evidence in any array order', () => {
    const looseOrder = expectation('02-tu-van-combo-va-upsell.json#5');
    const reversedLooseOrder = output({
      responseText: 'Mình đã chuẩn bị món lẻ và sẽ hỏi trước khi đổi combo.',
      entries: [
        entry('updateCart', {
          changes: [
            { itemCode: '41074', quantity: 4 },
            { itemCode: '41035', quantity: 1 },
            { itemCode: '41037', quantity: 3 },
          ],
        }),
      ],
      stateAfter: {
        cart: {
          items: [
            { itemCode: '41074', quantity: 4 },
            { itemCode: '41035', quantity: 1 },
            { itemCode: '41037', quantity: 3 },
          ],
          totalVnd: 404_000,
        },
      },
    });
    expect(
      component(looseOrder, reversedLooseOrder, 'tool_contract'),
    ).toMatchObject({ score: true });
    expect(
      component(looseOrder, reversedLooseOrder, 'state_transition'),
    ).toMatchObject({ score: true });

    const conversion = expectation('02-tu-van-combo-va-upsell.json#7');
    const reversedConversion = output({
      responseText: 'Mình đã đổi sang hai combo sau khi bạn đồng ý.',
      entries: [
        entry('updateCart', {
          changes: [
            { itemCode: '20752', quantity: 2 },
            { itemCode: '41074', quantity: 0 },
            { itemCode: '41035', quantity: 0 },
            { itemCode: '41037', quantity: 0 },
          ],
        }),
      ],
      stateBefore: {
        cart: {
          items: [
            { itemCode: '41037', quantity: 3 },
            { itemCode: '41035', quantity: 1 },
            { itemCode: '41074', quantity: 4 },
          ],
          totalVnd: 404_000,
        },
      },
      stateAfter: {
        cart: {
          items: [{ itemCode: '20752', quantity: 2 }],
          totalVnd: 258_000,
        },
      },
    });
    expect(
      component(conversion, reversedConversion, 'tool_contract'),
    ).toMatchObject({ score: true });
    expect(
      component(conversion, reversedConversion, 'state_transition'),
    ).toMatchObject({ score: true });

    const upsize = expectation('02-tu-van-combo-va-upsell.json#9');
    const reversedUpsize = output({
      responseText: 'Mình đã nâng bốn Pepsi lên size đại.',
      entries: [
        entry('updateCart', {
          changes: [
            {
              itemCode: '20752',
              quantity: 2,
              modifiers: [
                { groupId: '3', modifierId: '41091', quantity: null },
                { groupId: '2', modifierId: '41091', quantity: null },
              ],
            },
          ],
        }),
      ],
      stateAfter: {
        cart: {
          items: [
            {
              itemCode: '20752',
              quantity: 2,
              unitPriceVnd: 143_000,
              modifiers: [
                { groupId: '3', modifierId: '41091' },
                { groupId: '2', modifierId: '41091' },
              ],
            },
          ],
          totalVnd: 286_000,
        },
      },
    });
    expect(component(upsize, reversedUpsize, 'tool_contract')).toMatchObject({
      score: true,
    });
    expect(component(upsize, reversedUpsize, 'state_transition')).toMatchObject(
      { score: true },
    );
  });

  it('rejects wrong saving arithmetic or conversion before consent', async () => {
    const testCase = buildLiveQualityDatasetCases({
      inventoryVersion: LIVE_QUALITY_INVENTORY_VERSION,
      scenarioCases: liveScenarioCases,
    }).find(
      ({ inputs }) => inputs.caseId === '02-tu-van-combo-va-upsell.json#5:text',
    );
    if (!testCase) throw new Error('scenario 02 value case is missing');
    const evaluator = createLiveQualityExperimentEvaluator([testCase], {
      semanticJudge: {
        async judge({ expectation, responseText }) {
          const requirements = expectation.claims.required.map((claim) => {
            const isValueConsent =
              claim.kind === 'semantic_response' &&
              claim.act === 'recommend_verified_value_conversion_with_consent';
            const passed =
              !isValueConsent ||
              (responseText.includes('404.000') &&
                responseText.includes('258.000') &&
                responseText.includes('146.000') &&
                responseText.includes('chưa đổi') &&
                responseText.includes('muốn đổi'));
            return {
              requirementId: claim.requirementId,
              passed,
              reason: passed
                ? ('satisfied' as const)
                : ('contradicted' as const),
            };
          });
          return {
            passed: requirements.every(({ passed }) => passed),
            requirements,
          };
        },
      },
    });
    const baseOutput = output({
      responseText: '',
      entries: [
        entry('updateCart', {
          changes: [
            { itemCode: '41037', quantity: 3 },
            { itemCode: '41035', quantity: 1 },
            { itemCode: '41074', quantity: 4 },
          ],
        }),
      ],
      stateAfter: {
        cart: {
          items: [
            { itemCode: '41037', quantity: 3 },
            { itemCode: '41035', quantity: 1 },
            { itemCode: '41074', quantity: 4 },
          ],
          totalVnd: 404_000,
        },
      },
    });
    const semanticScore = async (responseText: string) => {
      const scores = await evaluator({
        inputs: { caseId: testCase.inputs.caseId },
        outputs: { ...baseOutput, responseText },
      });
      return scores.find(({ key }) => key === 'semantic_response');
    };

    await expect(
      semanticScore(
        'Món lẻ là 404.000đ; hai combo là 258.000đ, tiết kiệm 146.000đ. Mình chưa đổi; bạn có muốn đổi không?',
      ),
    ).resolves.toMatchObject({ score: 1 });
    await expect(
      semanticScore(
        'Món lẻ là 404.000đ; hai combo là 258.000đ, tiết kiệm 145.000đ. Mình chưa đổi; bạn có muốn đổi không?',
      ),
    ).resolves.toMatchObject({ score: 0 });
    await expect(
      semanticScore(
        'Món lẻ là 404.000đ; hai combo là 258.000đ, tiết kiệm 146.000đ. Mình đã đổi rồi.',
      ),
    ).resolves.toMatchObject({ score: 0 });
  });

  it('rejects a partial or incorrect four-Pepsi upsize', () => {
    const expected = expectation('02-tu-van-combo-va-upsell.json#9');
    const partial = output({
      responseText: 'Đã nâng Pepsi lên size đại.',
      entries: [
        entry('updateCart', {
          changes: [
            {
              itemCode: '20752',
              quantity: 2,
              modifiers: [
                {
                  groupId: '2',
                  modifierId: '41091',
                  quantity: null,
                },
              ],
            },
          ],
        }),
      ],
      stateAfter: {
        cart: {
          items: [
            {
              itemCode: '20752',
              quantity: 2,
              unitPriceVnd: 136_000,
              modifiers: [{ groupId: '2', modifierId: '41091' }],
            },
          ],
          totalVnd: 272_000,
        },
      },
    });
    expect(component(expected, partial, 'tool_contract')).toMatchObject({
      score: false,
      comment: expect.stringContaining('exact contract'),
    });
    expect(component(expected, partial, 'state_transition')).toMatchObject({
      score: false,
      comment: expect.stringMatching(
        /modifiers\.length|unitPriceVnd|modifiers\.1/u,
      ),
    });

    const wrongModifier = output({
      responseText: 'Đã nâng Pepsi lên size đại.',
      entries: [
        entry('updateCart', {
          changes: [
            {
              itemCode: '20752',
              quantity: 2,
              modifiers: [
                { groupId: '2', modifierId: '41091', quantity: null },
                { groupId: '3', modifierId: '41090', quantity: null },
              ],
            },
          ],
        }),
      ],
      stateAfter: {
        cart: {
          items: [
            {
              itemCode: '20752',
              quantity: 2,
              unitPriceVnd: 140_000,
              modifiers: [
                { groupId: '2', modifierId: '41091' },
                { groupId: '3', modifierId: '41090' },
              ],
            },
          ],
          totalVnd: 280_000,
        },
      },
    });
    expect(component(expected, wrongModifier, 'tool_contract')).toMatchObject({
      score: false,
      comment: expect.stringContaining('exact contract'),
    });
    expect(
      component(expected, wrongModifier, 'state_transition'),
    ).toMatchObject({
      score: false,
      comment: expect.stringMatching(/modifierId|unitPriceVnd|totalVnd/u),
    });
  });

  it('rejects catalog recommendations without verified drink evidence or with cart mutation', () => {
    const expected = expectation('02-tu-van-combo-va-upsell.json#1');
    const observed = output({
      responseText: 'Mình có một gợi ý cho nhóm.',
      entries: [
        entry('searchMenu', {
          scope: 'filtered',
          query: 'group meal',
        }),
      ],
      stateBefore: { cart: { items: [] } },
      stateAfter: {
        cart: { items: [{ itemCode: 'fabricated-item' }] },
        menuSearchResults: [
          {
            code: 'food-only',
            categoryId: '20005',
          },
        ],
      },
    });

    expect(component(expected, observed, 'tool_contract')).toMatchObject({
      score: false,
      comment: expect.stringContaining(
        'missing catalog category evidence: 20006',
      ),
    });
    expect(component(expected, observed, 'state_transition')).toMatchObject({
      score: false,
      comment: expect.stringContaining('cart changed outside the mayChange'),
    });
  });

  it('binds the v2 spicy modifier to the exact cart item and group', () => {
    const expected = expectation('01-dat-mon-ro-rang-giao-hang.json#1');
    const observed = (itemCode: string, groupId: string) =>
      output({
        responseText: 'Mình đã cập nhật giỏ hàng.',
        entries: [
          entry('updateCart', {
            changes: [
              {
                itemCode,
                quantity: 1,
                modifiers: [
                  {
                    groupId,
                    modifierId: '70012',
                    quantity: 2,
                  },
                ],
              },
            ],
          }),
        ],
        stateAfter: {
          menuSearchResults: [
            { code: '20702' },
            { code: '41141' },
            { code: '41074' },
          ],
          menuModifierOptions: {
            itemCode: '20702',
            modifierGroups: [
              {
                groupId: '60254',
                options: [{ modifierId: '70012' }],
              },
            ],
          },
        },
      });

    expect(
      component(expected, observed('20702', '60254'), 'tool_contract'),
    ).toMatchObject({ score: true });
    for (const [itemCode, groupId] of [
      ['41141', '60254'],
      ['20702', 'wrong-group'],
    ]) {
      expect(
        component(expected, observed(itemCode, groupId), 'tool_contract'),
      ).toMatchObject({
        score: false,
        comment: expect.stringContaining('20702/60254/70012'),
      });
    }
  });

  it('binds the v2 peach-tea modifier to the exact cart item and group', () => {
    const expected = expectation('07-ca-nhan-hoa-va-loyalty.json#7');
    const observed = (itemCode: string, groupId: string) =>
      output({
        responseText: 'Mình đã đổi thức uống; voucher vẫn chờ xác nhận.',
        entries: [
          entry('updateCart', {
            changes: [
              {
                itemCode,
                quantity: 1,
                modifiers: [
                  {
                    groupId,
                    modifierId: 'MOCK-PEACH-TEA-MODIFIER',
                    quantity: null,
                  },
                ],
              },
            ],
          }),
          entry(
            'acquireVoucher',
            {
              rewardId: 'reward-discount-10k',
              confirmed: false,
            },
            {
              ok: false,
              resultSummary: 'confirmation_required',
            },
          ),
        ],
        stateAfter: {
          menuSearchResults: [{ code: '20698' }],
          menuModifierOptions: {
            itemCode: '20698',
            modifierGroups: [
              {
                groupId: '3',
                options: [
                  {
                    modifierId: 'MOCK-PEACH-TEA-MODIFIER',
                  },
                ],
              },
            ],
          },
        },
      });

    expect(
      component(expected, observed('20698', '3'), 'tool_contract'),
    ).toMatchObject({ score: true });
    for (const [itemCode, groupId] of [
      ['wrong-item', '3'],
      ['20698', 'wrong-group'],
    ]) {
      expect(
        component(expected, observed(itemCode, groupId), 'tool_contract'),
      ).toMatchObject({
        score: false,
        comment: expect.stringContaining('20698/3/MOCK-PEACH-TEA-MODIFIER'),
      });
    }
  });

  it('requires typed unavailable catalog evidence for the shrimp burger', () => {
    const expected = expectation('03-ton-kho-dia-chi-va-cua-hang.json#1');
    const availableItem = {
      code: '41140',
      name: 'Burger Tôm',
      category: 'Burger',
      categoryId: '20001',
      available: true,
    };
    const observed = output({
      responseText: 'Mình đã kiểm tra tình trạng món.',
      entries: [
        entry('searchMenu', {
          scope: 'filtered',
          query: 'Burger Tôm',
        }),
      ],
      stateAfter: {
        menuSearchResults: [availableItem],
        activeMenuCollection: {
          result: {
            items: [availableItem],
            total: 1,
            returned: 1,
            complete: true,
            scope: {
              scope: 'filtered',
              query: 'Burger Tôm',
            },
          },
        },
      },
    });

    expect(component(expected, observed, 'tool_contract')).toMatchObject({
      score: false,
      comment: expect.stringContaining(
        'missing catalog item evidence: 41140 available=false',
      ),
    });
  });

  it('requires item-scoped modifier group evidence for advisory preferences', () => {
    const expected = expectation('11-khau-vi-va-di-ung.json#1');
    const observed = output({
      responseText: 'Có thể chọn Burger Gà Yo không cay và không thêm phô mai.',
      entries: [
        entry('searchMenu', { scope: 'filtered', query: 'burger không cay' }),
        entry('getModifierOptions', { code: '41042' }),
      ],
      stateAfter: {
        menuSearchResults: [
          { code: '41042', available: true },
          { code: '41043', available: true },
        ],
        menuModifierOptions: {
          itemCode: '41042',
          modifierGroups: [
            {
              groupId: 'wrong-group',
              min: 1,
              options: [{ modifierId: '70444', default: false, quantity: 0 }],
            },
            {
              groupId: '60259',
              min: 0,
              options: [{ modifierId: '70049', default: false, quantity: 0 }],
            },
          ],
        },
      },
    });

    expect(component(expected, observed, 'tool_contract')).toMatchObject({
      score: false,
      comment: expect.stringContaining(
        'missing catalog modifier binding: 41042/60258/70444',
      ),
    });
  });

  it('rejects commerce state mutation throughout advisory-only scenarios', () => {
    for (const id of [
      '10-so-sanh-mon-va-giai-thich.json#1',
      '10-so-sanh-mon-va-giai-thich.json#3',
      '11-khau-vi-va-di-ung.json#1',
      '11-khau-vi-va-di-ung.json#3',
    ]) {
      const expected = expectation(id);
      for (const [stateKey, stateValue] of [
        ['cart', { items: [{ itemCode: 'invented-item' }] }],
        ['order', { id: 'invented-order' }],
        ['paymentAttempt', { status: 'pending' }],
        ['fulfillment', { method: 'delivery' }],
      ] as const) {
        const observed = output({
          responseText: 'Mình chỉ tư vấn.',
          entries: [],
          stateBefore: {},
          stateAfter: { [stateKey]: stateValue },
        });

        expect(
          component(expected, observed, 'state_transition'),
          `${id}:${stateKey}`,
        ).toMatchObject({
          score: false,
          comment: expect.stringContaining(
            `${stateKey} changed outside the mayChange`,
          ),
        });
      }
    }
  });

  it('rejects missing invoice, order, and payment state evidence', () => {
    const expected = expectation('01-dat-mon-ro-rang-giao-hang.json#11');
    const observed = output({
      responseText: 'Đã ghi nhận thông tin.',
      entries: [
        entry('collectInvoice', {
          companyName: 'Công ty ABC',
          taxCode: '0312345678',
          email: 'finance@abc.test',
        }),
        entry('previewOrder', {}),
        entry('placeOrder', {}),
        entry('createPaymentLink', { methodId: 'zalopay_wallet' }),
      ],
      stateBefore: {
        selectedPaymentMethod: { methodId: 'zalopay_wallet' },
      },
      stateAfter: {},
    });

    expect(component(expected, observed, 'state_transition')).toMatchObject({
      score: false,
      comment: expect.stringContaining('invoiceRequest failed present'),
    });
  });

  it('keeps legacy planner, deterministic, and phrase fields inert', () => {
    const deterministicAllowed = expectation(
      '03-ton-kho-dia-chi-va-cua-hang.json#3',
    );
    deterministicAllowed.allowDeterministicExecution = true;
    const deterministicForbidden = structuredClone(deterministicAllowed);
    deterministicForbidden.allowDeterministicExecution = false;
    const misleadingPlanner = output({
      responseText: 'Giỏ hàng và giao hàng đã được cập nhật.',
      entries: [],
      stateAfter: {
        cart: { id: 'cart-1' },
        fulfillment: { kind: 'delivery' },
      },
    });
    misleadingPlanner.plannerRecords = [
      {
        toolNames: ['updateCart', 'quoteFulfillment'],
        calls: [
          { toolName: 'updateCart', arguments: { quantity: 1 } },
          {
            toolName: 'quoteFulfillment',
            arguments: { address: { district: 'Quận 7' } },
          },
        ],
        booleanEntities: {},
        catalogCandidateCodes: [],
        catalogModifierOptionNames: [],
        fulfillmentLocations: [{ district: 'Quận 7', city: 'Hồ Chí Minh' }],
      },
    ];

    const allowedScores = evaluateLiveQualityOutput(
      deterministicAllowed,
      misleadingPlanner,
      'text',
    );
    const forbiddenScores = evaluateLiveQualityOutput(
      deterministicForbidden,
      misleadingPlanner,
      'text',
    );
    expect(
      allowedScores.find(({ key }) => key === 'tool_contract'),
    ).toMatchObject({ score: false });
    expect(forbiddenScores.find(({ key }) => key === 'tool_contract')).toEqual(
      allowedScores.find(({ key }) => key === 'tool_contract'),
    );

    const phraseOnly = expectation(
      '08-thanh-toan-loi-va-don-bat-thuong.json#1',
    );
    const groundedClaim = phraseOnly.claims.required.find(
      ({ kind }) => kind === 'grounded_tool_outcome',
    );
    if (!groundedClaim || groundedClaim.kind !== 'grounded_tool_outcome') {
      throw new Error('payment outcome requirement is missing');
    }
    groundedClaim.textAnyOf = ['payment_failed'];
    const phraseOnlyOutput = output({
      responseText: 'payment_failed',
      entries: [],
      stateBefore: {
        order: { id: 'KFC-MOCK-1001' },
        paymentAttempt: { status: 'pending' },
      },
      stateAfter: {
        order: { id: 'KFC-MOCK-1001' },
        paymentAttempt: { status: 'pending' },
      },
    });
    expect(
      component(phraseOnly, phraseOnlyOutput, 'grounded_response'),
    ).toMatchObject({
      score: false,
      comment: expect.stringContaining('has no executed checkPaymentStatus'),
    });
  });

  it('treats null as absent for state path presence contracts', () => {
    const presentExpected = expectation('01-dat-mon-ro-rang-giao-hang.json#11');
    const nullInvoice = output({
      responseText: 'Đã ghi nhận thông tin.',
      entries: [],
      stateAfter: {
        invoiceRequest: null,
        order: { id: 'order-1' },
        paymentAttempt: { status: 'pending' },
      },
    });
    expect(
      component(presentExpected, nullInvoice, 'state_transition'),
    ).toMatchObject({
      score: false,
      comment: expect.stringContaining('invoiceRequest failed present'),
    });

    const absentExpected = structuredClone(
      expectation('05-khieu-nai-va-human-handoff.json#1'),
    );
    absentExpected.stateTransition.pathConstraints = [
      {
        path: 'handoff',
        operator: 'absent',
      },
    ];
    const nullHandoff = output({
      responseText: 'Mình xin lỗi, bạn cho mình thêm chi tiết nhé.',
      entries: [],
      stateBefore: { handoff: null },
      stateAfter: { handoff: null },
    });
    expect(
      component(absentExpected, nullHandoff, 'state_transition'),
    ).toMatchObject({ score: true });
  });

  it('default-denies ungoverned mutable state changes', () => {
    const expected = expectation('09-phuong-thuc-thanh-toan.json#1');
    const observed = output({
      responseText: 'Available payment methods were listed.',
      entries: [
        entry('listPaymentMethods', {
          query: null,
          paymentSurface: null,
        }),
      ],
      stateBefore: {},
      stateAfter: {
        paymentMethodEvidence: [],
        selectedPaymentMethod: {
          methodId: 'unverified-secret-method',
        },
      },
    });

    expect(component(expected, observed, 'state_transition')).toMatchObject({
      score: false,
      comment: expect.stringContaining(
        'selectedPaymentMethod changed outside the mayChange partition',
      ),
    });
  });
});
