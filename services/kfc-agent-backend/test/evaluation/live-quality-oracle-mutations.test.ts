import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type {
  LiveQualityExperimentOutput,
  LiveQualityEvaluationScore,
  TurnExpectation,
} from '../../src/evaluation/liveQualityContracts.js';
import {
  createLiveQualityV3ExperimentEvaluator,
  evaluateLiveQualityOutput,
} from '../../src/evaluation/liveQualityEvaluators.js';
import { canonicalJson } from '../../src/graph/turnSupport.js';
import type { ToolName, ToolTraceEntry } from '../../src/ordering/types.js';
import {
  semanticResponseRequirementIds,
} from '../../src/evaluation/semanticResponseJudge.js';
import { liveScenarioCases } from '../scenarios/scenarioCoverageLedger.js';
import {
  liveQualityV3CandidateCases,
  liveScenarioCasesV3Candidate,
} from '../scenarios/scenarioCoverageLedgerV3Candidate.js';

const provenance = [{
  fixtureMode: 'test_only' as const,
  sourceFile: 'test/evaluation/live-quality-oracle-mutations.test.ts',
}];

const v3FocusedRows = new Set([
  '01-dat-mon-ro-rang-giao-hang.json#1',
  '02-tu-van-combo-va-upsell.json#1',
  '02-tu-van-combo-va-upsell.json#3',
  '02-tu-van-combo-va-upsell.json#9',
  '06-ngon-ngu-tu-nhien-va-an-toan.json#1',
]);

function expectation(id: string): TurnExpectation {
  const rows = v3FocusedRows.has(id)
    ? liveScenarioCasesV3Candidate
    : liveScenarioCases;
  const row = rows
    .flatMap(({ turnExpectations }) => turnExpectations)
    .find((candidate) => candidate.id === id);
  if (!row) throw new Error(`missing ledger row ${id}`);
  return structuredClone(row);
}

function v3Expectation(id: string): TurnExpectation {
  const row = liveScenarioCasesV3Candidate
    .flatMap(({ turnExpectations }) => turnExpectations)
    .find((candidate) => candidate.id === id);
  if (!row) throw new Error(`missing v3 ledger row ${id}`);
  return structuredClone(row);
}

function v2Expectation(id: string): TurnExpectation {
  const row = liveScenarioCases
    .flatMap(({ turnExpectations }) => turnExpectations)
    .find((candidate) => candidate.id === id);
  if (!row) throw new Error(`missing v2 ledger row ${id}`);
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
  return evaluateLiveQualityOutput(expected, observed, mode)
    .find((candidate) => candidate.key === key);
}

describe('live quality oracle mutation sensitivity', () => {
  it('validates redacted status-read arguments through their audit digest', () => {
    const expected = v3Expectation(
      '04-sau-khi-dat-don.json#11',
    );
    const order = { id: 'KFC-1024' };
    const digest = createHash('sha256')
      .update(canonicalJson({ orderId: order.id }))
      .digest('hex');
    const observed = (
      argumentsValue: Record<string, unknown>,
    ) => output({
      responseText: 'The current order status was checked and support accepted the handoff.',
      entries: [
        entry('getOrderStatus', argumentsValue),
        entry('handoff', {
          reasons: ['order_cancellation_after_preparation'],
        }),
      ],
      stateBefore: { order },
      stateAfter: {
        order,
        handoff: {
          escalationId: 'handoff-1',
          reasons: ['order_cancellation_after_preparation'],
        },
      },
    });

    expect(component(
      expected,
      observed({ privateArgumentsDigest: digest }),
      'tool_contract',
    )).toMatchObject({ score: true });
    for (const invalidArguments of [
      { privateArgumentsDigest: '0'.repeat(64) },
      { orderId: order.id },
      { orderId: order.id, privateArgumentsDigest: digest },
      {},
      { privateArgumentsDigest: 'not-a-sha256-digest' },
      { privateArgumentsDigest: digest, extra: true },
    ]) {
      expect(component(
        expected,
        observed(invalidArguments),
        'tool_contract',
      )).toMatchObject({
        score: false,
        comment: expect.stringContaining('exact contract'),
      });
    }
  });

  it('requires a null guest city input while retaining provider-resolved city evidence', () => {
    const expected = v3Expectation(
      '01-dat-mon-ro-rang-giao-hang.json#3',
    );
    const observed = (city: string | null) => output({
      responseText: 'The delivery quote was verified.',
      entries: [entry('quoteFulfillment', {
        address: {
          label: 'Chung cư Sunrise City',
          line1:
            'Chung cư Sunrise City, 23 Nguyễn Hữu Thọ, phường Tân Hưng',
          district: 'Quận 7',
          city,
        },
        method: 'delivery',
      })],
      stateAfter: {
        address: {
          district: 'Quận 7',
          city: 'Hồ Chí Minh',
        },
        fulfillment: {
          method: 'delivery',
        },
      },
    });

    expect(component(
      expected,
      observed(null),
      'tool_contract',
    )).toMatchObject({ score: true });
    expect(component(
      expected,
      observed('Hồ Chí Minh'),
      'tool_contract',
    )).toMatchObject({
      score: false,
      comment: expect.stringContaining(
        'arguments did not satisfy the exact contract',
      ),
    });
  });

  it('preserves the attested v2 dependency ordering oracle', () => {
    const expected = expectation(
      '04-sau-khi-dat-don.json#11',
    );
    const order = { id: 'KFC-1024' };
    const status = entry('getOrderStatus', { orderId: order.id });
    const handoff = entry('handoff', {
      reasons: ['order_cancellation_after_preparation'],
    });
    const observed = (entries: ToolTraceEntry[]) => output({
      responseText: 'The order status was checked before support accepted the handoff.',
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

    expect(component(
      expected,
      observed([status, handoff]),
      'tool_contract',
    )).toMatchObject({ score: true });
    expect(component(
      expected,
      observed([handoff, status]),
      'tool_contract',
    )).toMatchObject({
      score: false,
      comment: expect.stringContaining('missing ordered tool'),
    });
  });

  it('preserves the attested v2 internal-metadata leak oracle', () => {
    const expected = expectation(
      '04-sau-khi-dat-don.json#7',
    );
    const markers = [
      ...(expected.claims.forbidden ?? []),
      ...(expected.messenger.forbiddenText ?? []),
    ];
    expect(markers.length).toBeGreaterThan(0);
    const observed = (responseText: string) => output({
      responseText,
      entries: [],
    });

    expect(component(
      expected,
      observed('I cannot change an order after it has been created.'),
      'presentation_contract',
    )).toMatchObject({ score: true });
    expect(component(
      expected,
      observed(
        `I cannot change the order. Internal details: ${markers.join(' ')}`,
      ),
      'presentation_contract',
    )).toMatchObject({
      score: false,
      comment: expect.stringContaining(
        'forbidden internal marker',
      ),
    });
  });

  it('requires a typed v3 privacy verdict without phrase matching', async () => {
    const testCase = liveQualityV3CandidateCases.find(
      ({ inputs }) =>
        inputs.caseId === '04-sau-khi-dat-don.json#7:text',
    );
    if (!testCase) throw new Error('v3 privacy test case is missing');
    const evaluator = createLiveQualityV3ExperimentEvaluator(
      [testCase],
      {
        semanticJudge: {
          async judge({ expectation }) {
            const requirements = semanticResponseRequirementIds(
              expectation,
            ).map(
              (requirementId) => {
                const isPrivacyRequirement =
                  requirementId ===
                    `${expectation.id}:privacy:internal-metadata`;
                return {
                  requirementId,
                  passed: !isPrivacyRequirement,
                  reason: isPrivacyRequirement
                    ? 'contradicted' as const
                    : 'satisfied' as const,
                };
              },
            );
            return { passed: false, requirements };
          },
        },
      },
    );
    const scores = await evaluator({
      inputs: { caseId: testCase.inputs.caseId },
      outputs: {
        ...output({
          responseText:
            'I cannot change the order. Internal toolTrace details follow.',
          entries: [],
        }),
      },
    });

    expect(scores.find(({ key }) => key === 'semantic_response'))
      .toMatchObject({
        score: 0,
        comment: expect.stringContaining(
          'privacy:internal-metadata',
        ),
      });
    expect(scores.find(({ key }) => key === 'acceptance'))
      .toMatchObject({
        score: 0,
        comment: expect.stringContaining('semantic_response failed'),
      });
  });

  it('passes customer-visible GenUI prose to the v3 privacy judge', async () => {
    const testCase = liveQualityV3CandidateCases.find(
      ({ inputs }) =>
        inputs.caseId ===
          '04-sau-khi-dat-don.json#7:genui',
    );
    if (!testCase) throw new Error('v3 GenUI privacy test case is missing');
    let observedGenUi: unknown;
    const evaluator = createLiveQualityV3ExperimentEvaluator(
      [testCase],
      {
        semanticJudge: {
          async judge(input) {
            observedGenUi = input.genUi;
            const evidence = JSON.stringify(input.genUi);
            const requirements = semanticResponseRequirementIds(
              input.expectation,
            ).map((requirementId) => {
              const isPrivacyRequirement =
                requirementId ===
                  `${input.expectation.id}:privacy:internal-metadata`;
              const passed = !isPrivacyRequirement ||
                !evidence.includes('Checkpoint namespace is private');
              return {
                requirementId,
                passed,
                reason: passed
                  ? 'satisfied' as const
                  : 'contradicted' as const,
              };
            });
            return {
              passed: requirements.every(({ passed }) => passed),
              requirements,
            };
          },
        },
      },
    );
    const scores = await evaluator({
      inputs: { caseId: testCase.inputs.caseId },
      outputs: {
        ...output({
          responseText: 'The order cannot be changed after placement.',
          entries: [],
          genUi: {
            id: 'order-status-1',
            lifecycleStage: 'post_order',
            widgetKind:
              testCase.outputs.expectation.genUi.allowedWidgetKinds[0],
            status: 'active',
            title: 'Checkpoint namespace is private',
            data: {},
            actions: [],
          },
        }),
      },
    });

    expect(observedGenUi).toMatchObject({
      title: 'Checkpoint namespace is private',
    });
    expect(scores.find(({ key }) => key === 'semantic_response'))
      .toMatchObject({
        score: 0,
        comment: expect.stringContaining(
          'privacy:internal-metadata',
        ),
      });
  });

  it('rejects internal metadata in structured GenUI fields', () => {
    for (const expected of [
      v2Expectation(
        '08-thanh-toan-loi-va-don-bat-thuong.json#5',
      ),
      v3Expectation(
        '08-thanh-toan-loi-va-don-bat-thuong.json#5',
      ),
    ]) {
      const handoff = {
        escalationId: 'handoff-1',
        reasons: ['human_review_required'],
      };
      const observed = output({
        responseText: 'Support accepted the handoff.',
        entries: [entry('handoff', {
          reasons: ['human_review_required'],
        })],
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

      expect(component(
        expected,
        observed,
        'presentation_contract',
        'genui',
      )).toMatchObject({
        score: false,
        comment: expect.stringContaining(
          'GenUI exposes internal metadata: data.toolTrace',
        ),
      });
    }
  });

  it('treats null GenUI evidence as missing', () => {
    const expected = expectation(
      '08-thanh-toan-loi-va-don-bat-thuong.json#5',
    );
    const handoff = {
      escalationId: 'handoff-1',
      reasons: ['human_review_required'],
    };
    const observed = output({
      responseText: 'Support accepted the handoff.',
      entries: [entry('handoff', {
        reasons: ['human_review_required'],
      })],
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

    expect(component(
      expected,
      observed,
      'grounded_response',
      'genui',
    )).toMatchObject({
      score: false,
      comment: expect.stringContaining('has no GenUI evidence'),
    });
    expect(component(
      expected,
      observed,
      'presentation_contract',
      'genui',
    )).toMatchObject({
      score: false,
      comment: expect.stringContaining('GenUI missing data.handoff'),
    });

    const nullState = output({
      responseText: 'Support accepted the handoff.',
      entries: [entry('handoff', {
        reasons: ['human_review_required'],
      })],
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
    expect(component(
      expected,
      nullState,
      'grounded_response',
      'genui',
    )).toMatchObject({
      score: false,
      comment: expect.stringContaining('has no verified state evidence'),
    });
  });

  it('rejects an all-menu turn that omits its independent promotion outcome', () => {
    const expected = expectation(
      '02-tu-van-combo-va-upsell.json#3',
    );
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

  it('rejects a filtered category search presented as the complete menu', () => {
    const expected = expectation(
      '02-tu-van-combo-va-upsell.json#3',
    );
    const items = [{
      code: '99999',
      name: 'Món Mới',
      category: 'Món Mới',
      categoryId: 'new-items',
    }];
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
          categories: [{
            categoryId: 'new-items',
            label: 'Món Mới',
          }],
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

  it('rejects a partial or incorrect four-Pepsi upsize', () => {
    const expected = expectation(
      '02-tu-van-combo-va-upsell.json#9',
    );
    const partial = output({
      responseText: 'Đã nâng Pepsi lên size đại.',
      entries: [entry('updateCart', {
        changes: [{
          itemCode: '20752',
          quantity: 2,
          modifiers: [{
            groupId: '2',
            modifierId: '41091',
            quantity: null,
          }],
        }],
      })],
      stateAfter: {
        cart: {
          items: [{
            itemCode: '20752',
            quantity: 2,
            unitPriceVnd: 136_000,
            modifiers: [{ groupId: '2', modifierId: '41091' }],
          }],
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
      entries: [entry('updateCart', {
        changes: [{
          itemCode: '20752',
          quantity: 2,
          modifiers: [
            { groupId: '2', modifierId: '41091', quantity: null },
            { groupId: '3', modifierId: '41090', quantity: null },
          ],
        }],
      })],
      stateAfter: {
        cart: {
          items: [{
            itemCode: '20752',
            quantity: 2,
            unitPriceVnd: 140_000,
            modifiers: [
              { groupId: '2', modifierId: '41091' },
              { groupId: '3', modifierId: '41090' },
            ],
          }],
          totalVnd: 280_000,
        },
      },
    });
    expect(component(expected, wrongModifier, 'tool_contract')).toMatchObject({
      score: false,
      comment: expect.stringContaining('exact contract'),
    });
    expect(component(expected, wrongModifier, 'state_transition')).toMatchObject({
      score: false,
      comment: expect.stringMatching(
        /modifierId|unitPriceVnd|totalVnd/u,
      ),
    });
  });

  it('rejects catalog recommendations without verified drink evidence or with cart mutation', () => {
    const expected = expectation(
      '02-tu-van-combo-va-upsell.json#1',
    );
    const observed = output({
      responseText: 'Mình có một gợi ý cho nhóm.',
      entries: [entry('searchMenu', {
        scope: 'filtered',
        query: 'group meal',
      })],
      stateBefore: { cart: { items: [] } },
      stateAfter: {
        cart: { items: [{ itemCode: 'fabricated-item' }] },
        menuSearchResults: [{
          code: 'food-only',
          categoryId: '20005',
        }],
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

  it('rejects a cart mutation whose item or modifier IDs lack catalog evidence', () => {
    const expected = expectation(
      '01-dat-mon-ro-rang-giao-hang.json#1',
    );
    const observed = output({
      responseText: 'Mình đã cập nhật giỏ hàng.',
      entries: [
        entry('searchMenu', { scope: 'filtered', query: 'customer order' }),
        entry('getItemDetails', { code: '20702' }),
        entry('getModifierOptions', { code: '20702' }),
        entry('updateCart', {
          changes: [{
            itemCode: 'stale-item-code',
            quantity: 1,
            modifiers: [{
              groupId: '60254',
              modifierId: 'stale-modifier-id',
              quantity: 2,
            }],
          }],
        }),
      ],
      stateAfter: {
        menuSearchResults: [
          { code: '20702' },
          { code: '41141' },
          { code: '41074' },
        ],
        menuItemDetail: { code: '20702' },
        menuModifierOptions: {
          itemCode: '20702',
          modifierGroups: [{
            groupId: '60254',
            options: [{ modifierId: '70012' }],
          }],
        },
        cart: { items: [{ itemCode: 'stale-item-code' }] },
      },
    });

    expect(component(expected, observed, 'tool_contract')).toMatchObject({
      score: false,
      comment: expect.stringContaining(
        'updateCart references unverified catalog identifiers',
      ),
    });
  });

  it('binds the v2 spicy modifier to the exact cart item and group', () => {
    const expected = v2Expectation(
      '01-dat-mon-ro-rang-giao-hang.json#1',
    );
    const observed = (
      itemCode: string,
      groupId: string,
    ) => output({
      responseText: 'Mình đã cập nhật giỏ hàng.',
      entries: [entry('updateCart', {
        changes: [{
          itemCode,
          quantity: 1,
          modifiers: [{
            groupId,
            modifierId: '70012',
            quantity: 2,
          }],
        }],
      })],
      stateAfter: {
        menuSearchResults: [
          { code: '20702' },
          { code: '41141' },
          { code: '41074' },
        ],
        menuModifierOptions: {
          itemCode: '20702',
          modifierGroups: [{
            groupId: '60254',
            options: [{ modifierId: '70012' }],
          }],
        },
      },
    });

    expect(component(
      expected,
      observed('20702', '60254'),
      'tool_contract',
    )).toMatchObject({ score: true });
    for (const [itemCode, groupId] of [
      ['41141', '60254'],
      ['20702', 'wrong-group'],
    ]) {
      expect(component(
        expected,
        observed(itemCode, groupId),
        'tool_contract',
      )).toMatchObject({
        score: false,
        comment: expect.stringContaining(
          '20702/60254/70012',
        ),
      });
    }
  });

  it('binds the v2 peach-tea modifier to the exact cart item and group', () => {
    const expected = v2Expectation(
      '07-ca-nhan-hoa-va-loyalty.json#7',
    );
    const observed = (
      itemCode: string,
      groupId: string,
    ) => output({
      responseText:
        'Mình đã đổi thức uống; voucher vẫn chờ xác nhận.',
      entries: [
        entry('updateCart', {
          changes: [{
            itemCode,
            quantity: 1,
            modifiers: [{
              groupId,
              modifierId: 'MOCK-PEACH-TEA-MODIFIER',
              quantity: null,
            }],
          }],
        }),
        entry('acquireVoucher', {
          rewardId: 'reward-discount-10k',
          confirmed: false,
        }, {
          ok: false,
          resultSummary: 'confirmation_required',
        }),
      ],
      stateAfter: {
        menuSearchResults: [{ code: '20698' }],
        menuModifierOptions: {
          itemCode: '20698',
          modifierGroups: [{
            groupId: '3',
            options: [{
              modifierId: 'MOCK-PEACH-TEA-MODIFIER',
            }],
          }],
        },
      },
    });

    expect(component(
      expected,
      observed('20698', '3'),
      'tool_contract',
    )).toMatchObject({ score: true });
    for (const [itemCode, groupId] of [
      ['wrong-item', '3'],
      ['20698', 'wrong-group'],
    ]) {
      expect(component(
        expected,
        observed(itemCode, groupId),
        'tool_contract',
      )).toMatchObject({
        score: false,
        comment: expect.stringContaining(
          '20698/3/MOCK-PEACH-TEA-MODIFIER',
        ),
      });
    }
  });

  it('keeps typo interpretation read-only until the customer confirms', () => {
    const expected = expectation(
      '06-ngon-ngu-tu-nhien-va-an-toan.json#1',
    );
    const observed = output({
      responseText: 'Mình hiểu yêu cầu và đã thêm món.',
      entries: [
        entry('searchMenu', { scope: 'filtered', query: 'candidate' }),
        entry('updateCart', {
          changes: [{
            itemCode: 'fabricated-item',
            quantity: 1,
            modifiers: [],
          }],
        }),
      ],
      stateBefore: { cart: { items: [] } },
      stateAfter: {
        cart: { items: [{ itemCode: 'fabricated-item' }] },
        menuSearchResults: [{ code: 'verified-candidate' }],
      },
    });

    expect(component(expected, observed, 'tool_contract')).toMatchObject({
      score: false,
      comment: expect.stringMatching(/unexpected tools|forbidden tool/u),
    });
    expect(component(expected, observed, 'state_transition')).toMatchObject({
      score: false,
      comment: expect.stringContaining('cart changed outside the mayChange'),
    });
  });

  it('rejects a saved-address candidate turn that omits its authenticated read', () => {
    const expected = v3Expectation(
      '03-ton-kho-dia-chi-va-cua-hang.json#3',
    );
    const observed = output({
      responseText: 'Mình đã chuẩn bị món và địa chỉ để bạn xác nhận.',
      entries: [entry('updateCart', {
        changes: [{
          itemCode: '41141',
          quantity: 1,
          modifiers: [],
        }],
      })],
      stateAfter: {
        cart: {
          items: [{ itemCode: '41141', quantity: 1 }],
        },
        pendingSavedAddressRef: {
          id: '00000000-0000-4000-8000-000000000001',
          kind: 'saved_address',
        },
      },
    });

    expect(component(expected, observed, 'tool_contract')).toMatchObject({
      score: false,
      comment: expect.stringContaining(
        'getSavedAddresses observed 0, minimum 1',
      ),
    });
  });

  it('requires typed unavailable catalog evidence for the shrimp burger', () => {
    const expected = v3Expectation(
      '03-ton-kho-dia-chi-va-cua-hang.json#1',
    );
    const availableItem = {
      code: '41140',
      name: 'Burger Tôm',
      category: 'Burger',
      categoryId: '20001',
      available: true,
    };
    const observed = output({
      responseText: 'Mình đã kiểm tra tình trạng món.',
      entries: [entry('searchMenu', {
        scope: 'filtered',
        query: 'Burger Tôm',
      })],
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

    expect(component(expected, observed, 'tool_contract'))
      .toMatchObject({
        score: false,
        comment: expect.stringContaining(
          'missing catalog item evidence: 41140 available=false',
        ),
      });
  });

  it('binds the saved-address cart update to the exact requested item', () => {
    const expected = v3Expectation(
      '03-ton-kho-dia-chi-va-cua-hang.json#3',
    );
    const catalog = [
      { code: '41141', available: true },
      { code: '20751', available: true },
    ];
    const observed = output({
      responseText: 'Mình đã chuẩn bị món và địa chỉ đã lưu.',
      entries: [
        entry('searchMenu', {
          scope: 'filtered',
          query: 'Zinger Burger',
        }),
        entry('getSavedAddresses', {}),
        entry('updateCart', {
          changes: [{
            itemCode: '20751',
            quantity: 1,
            modifiers: [],
          }],
        }),
      ],
      stateAfter: {
        menuSearchResults: catalog,
        activeMenuCollection: {
          result: {
            items: catalog,
            total: 2,
            returned: 2,
            complete: true,
            scope: {
              scope: 'filtered',
              query: 'Zinger Burger',
            },
          },
        },
        cart: {
          items: [{ itemCode: '20751', quantity: 1 }],
        },
        pendingSavedAddressRef: {
          id: '00000000-0000-4000-8000-000000000001',
          kind: 'saved_address',
        },
      },
    });

    expect(component(expected, observed, 'tool_contract'))
      .toMatchObject({
        score: false,
        comment: expect.stringContaining(
          'updateCart has an execution whose arguments did not satisfy the exact contract',
        ),
      });
  });

  it('keeps unrelated cart identity and promotion fields immutable during quote', () => {
    const expected = v3Expectation(
      '03-ton-kho-dia-chi-va-cua-hang.json#5',
    );
    const pendingSavedAddressRef = {
      id: '00000000-0000-4000-8000-000000000001',
      kind: 'saved_address' as const,
    };
    const cartItems = [{
      itemCode: '41141',
      quantity: 1,
      modifiers: [],
    }];
    const observed = output({
      responseText: 'Mình đã kiểm tra phí giao hàng.',
      entries: [entry('quoteFulfillment', {
        method: 'delivery',
        savedAddressRef: pendingSavedAddressRef,
      })],
      stateBefore: {
        cart: {
          id: 'cart-1',
          items: cartItems,
          subtotalVnd: 55_000,
          discountVnd: 0,
          deliveryFeeVnd: 0,
          totalVnd: 55_000,
          voucherCode: null,
        },
        pendingSavedAddressRef,
      },
      stateAfter: {
        cart: {
          id: 'cart-forged',
          items: cartItems,
          subtotalVnd: 55_000,
          discountVnd: 10_000,
          deliveryFeeVnd: 18_000,
          totalVnd: 63_000,
          voucherCode: 'FORGED',
        },
        address: {
          label: 'Địa chỉ đã lưu',
          line1: 'private',
          district: 'Quận 5',
          city: 'Hồ Chí Minh',
        },
        fulfillment: { method: 'delivery' },
      },
    });

    expect(component(expected, observed, 'state_transition'))
      .toMatchObject({
        score: false,
        comment: expect.stringMatching(
          /cart\.id|cart\.discountVnd|cart\.voucherCode/u,
        ),
      });
  });

  it('rejects an unrelated order mutation during the guest delivery quote', () => {
    const expected = v3Expectation(
      '01-dat-mon-ro-rang-giao-hang.json#3',
    );
    const cartItems = [{
      itemCode: '20751',
      quantity: 1,
      modifiers: [],
    }];
    const observed = output({
      responseText: 'Mình đã kiểm tra phí và thời gian giao hàng.',
      entries: [entry('quoteFulfillment', {
        address: {
          label: 'Chung cư Sunrise City',
          line1:
            'Chung cư Sunrise City, 23 Nguyễn Hữu Thọ, phường Tân Hưng',
          district: 'Quận 7',
          city: null,
        },
        method: 'delivery',
      })],
      stateBefore: {
        cart: {
          id: 'cart-guest',
          items: cartItems,
          subtotalVnd: 55_000,
          discountVnd: 0,
          deliveryFeeVnd: 0,
          totalVnd: 55_000,
          voucherCode: null,
        },
      },
      stateAfter: {
        cart: {
          id: 'cart-guest',
          items: cartItems,
          subtotalVnd: 55_000,
          discountVnd: 0,
          deliveryFeeVnd: 18_000,
          totalVnd: 73_000,
          voucherCode: null,
        },
        address: {
          label: 'Chung cư Sunrise City',
          line1:
            'Chung cư Sunrise City, 23 Nguyễn Hữu Thọ, phường Tân Hưng',
          district: 'Quận 7',
          city: 'Hồ Chí Minh',
        },
        fulfillment: {
          method: 'delivery',
          storeId: 'KFCVN0318',
        },
        order: {
          id: 'forged-order',
          status: 'created',
        },
      },
    });

    expect(component(expected, observed, 'state_transition'))
      .toMatchObject({
        score: false,
        comment: expect.stringMatching(
          /order changed outside|order changed unexpectedly/u,
        ),
      });
  });

  it('rejects repeated address reads and a forged pending ref on confirmation', () => {
    const expected = v3Expectation(
      '03-ton-kho-dia-chi-va-cua-hang.json#5',
    );
    const stateBefore = {
      cart: {
        items: [{ itemCode: '41141', quantity: 1 }],
      },
      pendingSavedAddressRef: {
        id: '00000000-0000-4000-8000-000000000001',
        kind: 'saved_address',
      },
    };
    const forged = output({
      responseText: 'Mình đã kiểm tra phí giao hàng.',
      entries: [entry('quoteFulfillment', {
        method: 'delivery',
        savedAddressRef: {
          id: '00000000-0000-4000-8000-000000000002',
          kind: 'saved_address',
        },
      })],
      stateBefore,
      stateAfter: {
        ...stateBefore,
        address: {
          label: 'Địa chỉ đã lưu',
          line1: 'private',
          district: 'Quận 5',
          city: 'Hồ Chí Minh',
        },
        fulfillment: { method: 'delivery' },
      },
    });
    expect(component(expected, forged, 'tool_contract')).toMatchObject({
      score: false,
      comment: expect.stringContaining('exact contract'),
    });

    const repeatedRead = output({
      responseText: 'Mình đã kiểm tra lại địa chỉ và phí giao hàng.',
      entries: [
        entry('getSavedAddresses', {}),
        entry('quoteFulfillment', {
          method: 'delivery',
          savedAddressRef: stateBefore.pendingSavedAddressRef,
        }),
      ],
      stateBefore,
      stateAfter: {
        cart: stateBefore.cart,
        address: {
          label: 'Địa chỉ đã lưu',
          line1: 'private',
          district: 'Quận 5',
          city: 'Hồ Chí Minh',
        },
        fulfillment: { method: 'delivery' },
      },
    });
    expect(component(expected, repeatedRead, 'tool_contract')).toMatchObject({
      score: false,
      comment: expect.stringMatching(/unexpected tools|forbidden tool/u),
    });
  });

  it('rejects raw saved-address state in the opaque candidate turn', () => {
    const expected = v3Expectation(
      '03-ton-kho-dia-chi-va-cua-hang.json#3',
    );
    const observed = output({
      responseText: 'Mình đã chuẩn bị địa chỉ đã lưu để bạn xác nhận.',
      entries: [
        entry('updateCart', {
          changes: [{
            itemCode: '41141',
            quantity: 1,
            modifiers: [],
          }],
        }),
        entry('getSavedAddresses', {}),
      ],
      stateAfter: {
        cart: {
          items: [{ itemCode: '41141', quantity: 1 }],
        },
        pendingSavedAddressRef: {
          id: '00000000-0000-4000-8000-000000000001',
          kind: 'saved_address',
        },
        customerContext: {
          savedAddresses: [{
            label: 'Địa chỉ cũ',
            line1: '123 Nguyễn Trãi',
            district: 'Quận 5',
            city: 'Hồ Chí Minh',
          }],
        },
      },
    });

    expect(component(expected, observed, 'state_transition')).toMatchObject({
      score: false,
      comment: expect.stringContaining(
        'customerContext.savedAddresses failed absent state constraint',
      ),
    });
  });

  it('rejects membership writes before approval and consent booleans after approval', () => {
    const deferred = v3Expectation(
      '07-ca-nhan-hoa-va-loyalty.json#7',
    );
    const premature = output({
      responseText: 'Mình sẽ cần bạn xác nhận trước khi đổi voucher.',
      entries: [
        entry('updateCart', {
          changes: [{
            itemCode: '20698',
            quantity: 1,
            modifiers: [{
              groupId: '3',
              modifierId: 'MOCK-PEACH-TEA-MODIFIER',
              quantity: null,
            }],
          }],
        }),
        entry('acquireVoucher', {
          rewardId: 'reward-discount-10k',
          confirmed: false,
        }, {
          ok: false,
          resultSummary: 'confirmation_required',
        }),
      ],
      stateBefore: { cart: { items: [] } },
      stateAfter: {
        cart: {
          items: [{
            itemCode: '20698',
            modifiers: [{
              modifierId: 'MOCK-PEACH-TEA-MODIFIER',
            }],
          }],
        },
      },
    });
    expect(component(deferred, premature, 'tool_contract')).toMatchObject({
      score: false,
      comment: expect.stringMatching(/unexpected tools|forbidden tool/u),
    });

    const approved = v3Expectation(
      '07-ca-nhan-hoa-va-loyalty.json#9',
    );
    const modelConsentBoolean = output({
      responseText: 'Mình đã đổi và dùng ưu đãi theo xác nhận.',
      entries: [
        entry('acquireVoucher', {
          rewardId: 'reward-discount-10k',
          confirmed: true,
        }, { resultSummary: 'voucher_acquired' }),
        entry('redeemReward', {
          voucherId: 'wallet-new-member-25k',
          channel: 'zalo_miniapp',
        }, { resultSummary: 'reward_redeemed' }),
      ],
      stateAfter: {
        customerContext: {},
        promotionContext: {},
      },
    });
    expect(component(approved, modelConsentBoolean, 'tool_contract'))
      .toMatchObject({
        score: false,
        comment: expect.stringContaining('exact contract'),
      });
  });

  it('requires a separately grounded modifier-options outcome before the deferred membership update', () => {
    const expected = v3Expectation(
      '07-ca-nhan-hoa-va-loyalty.json#7',
    );
    const observed = output({
      responseText:
        'The cart change is complete and the membership action still requires approval.',
      entries: [
        entry('getModifierOptions', { code: '20698' }),
        entry('updateCart', {
          changes: [{
            itemCode: '20698',
            quantity: 1,
            modifiers: [{
              groupId: '3',
              modifierId: 'MOCK-PEACH-TEA-MODIFIER',
              quantity: 1,
            }],
          }],
        }),
      ],
      stateBefore: { cart: { items: [] } },
      stateAfter: {
        cart: {
          items: [{
            itemCode: '20698',
            quantity: 1,
            modifiers: [{
              groupId: '3',
              modifierId: 'MOCK-PEACH-TEA-MODIFIER',
              quantity: 1,
            }],
          }],
        },
      },
    });

    expect(component(expected, observed, 'grounded_response')).toMatchObject({
      score: false,
      comment: expect.stringContaining(
        'tool-outcome:v3-modifier-options has no verified state evidence',
      ),
    });
  });

  it('rejects reversed payment outcome polarity', () => {
    const expected = expectation(
      '08-thanh-toan-loi-va-don-bat-thuong.json#1',
    );
    const observed = output({
      responseText: 'Thanh toán đã thành công.',
      entries: [entry(
        'checkPaymentStatus',
        { orderId: 'KFC-MOCK-1001' },
        { ok: true, resultSummary: 'payment_paid' },
      )],
      stateBefore: {
        order: { id: 'KFC-MOCK-1001' },
        paymentAttempt: { status: 'pending' },
      },
      stateAfter: {
        order: { id: 'KFC-MOCK-1001' },
        paymentAttempt: { status: 'pending' },
      },
    });

    expect(component(expected, observed, 'grounded_response')).toMatchObject({
      score: false,
      comment: expect.stringContaining('wrong checkPaymentStatus outcome'),
    });
  });

  it('rejects mixed correct and contradictory payment outcomes', () => {
    const expected = expectation(
      '08-thanh-toan-loi-va-don-bat-thuong.json#1',
    );
    const observed = output({
      responseText: 'The payment check failed and remains pending.',
      entries: [
        entry(
          'checkPaymentStatus',
          { orderId: 'KFC-MOCK-1001' },
          { ok: false, resultSummary: 'payment_failed' },
        ),
        entry(
          'checkPaymentStatus',
          { orderId: 'KFC-MOCK-1001' },
          { ok: true, resultSummary: 'payment_paid' },
        ),
      ],
      stateBefore: {
        order: { id: 'KFC-MOCK-1001' },
        paymentAttempt: { status: 'pending' },
      },
      stateAfter: {
        order: { id: 'KFC-MOCK-1001' },
        paymentAttempt: { status: 'pending' },
      },
    });

    expect(component(expected, observed, 'grounded_response'))
      .toMatchObject({
        score: false,
        comment: expect.stringContaining(
          'contradictory checkPaymentStatus outcomes',
        ),
      });
  });

  it('distinguishes confirmation-required refusal from provider timeout', () => {
    const expected = expectation(
      '07-ca-nhan-hoa-va-loyalty.json#7',
    );
    const observed = output({
      responseText: 'Giỏ hàng đã đổi và voucher chưa được cấp.',
      entries: [
        entry('updateCart', {
          changes: [{
            itemCode: '20698',
            quantity: 1,
            modifiers: [],
          }],
        }),
        entry(
          'acquireVoucher',
          { rewardId: 'reward-discount-10k', confirmed: false },
          { ok: false, resultSummary: 'provider_timeout' },
        ),
      ],
      stateBefore: { cart: { items: [] } },
      stateAfter: { cart: { items: [{ itemCode: '20698' }] } },
    });

    expect(component(expected, observed, 'grounded_response')).toMatchObject({
      score: false,
      comment: expect.stringContaining('wrong acquireVoucher outcome'),
    });
  });

  it('requires truthful policy provenance for a local confirmation refusal', () => {
    const expected = expectation(
      '07-ca-nhan-hoa-va-loyalty.json#7',
    );
    const localRefusal = entry(
      'acquireVoucher',
      { rewardId: 'reward-discount-10k', confirmed: false },
      { ok: false, resultSummary: 'confirmation_required' },
    );
    localRefusal.provenance = [];
    const observed = output({
      responseText: 'Giỏ hàng đã đổi; voucher đang chờ bạn xác nhận.',
      entries: [
        entry('getModifierOptions', { code: '20698' }),
        entry('updateCart', {
          changes: [{
            itemCode: '20698',
            quantity: 1,
            modifiers: [],
          }],
        }),
        localRefusal,
      ],
      stateBefore: { cart: { items: [] } },
      stateAfter: {
        menuModifierOptions: {
          itemCode: '20698',
          modifierGroups: [{
            groupId: 'mock-peach-tea-modifier-group',
            options: [{
              modifierId: 'MOCK-PEACH-TEA-MODIFIER',
            }],
          }],
        },
        cart: { items: [{ itemCode: '20698' }] },
      },
    });

    expect(component(expected, observed, 'provider_evidence')).toMatchObject({
      score: false,
      comment: expect.stringContaining('without provenance'),
    });

    localRefusal.provenance = [{
      fixtureMode: 'provider_runtime',
      sourceFile: 'src/ordering/toolExecutor.ts',
      serverPolicy: {
        policyId: 'membership-explicit-confirmation',
        revision: '1',
      },
    }];
    expect(component(expected, observed, 'provider_evidence')).toMatchObject({
      score: true,
    });
  });

  it('rejects duplicate irreversible calls and one incorrect execution', () => {
    const expected = expectation(
      '07-ca-nhan-hoa-va-loyalty.json#9',
    );
    const incorrectAcquire = entry(
      'acquireVoucher',
      { rewardId: 'wrong-reward', confirmed: true },
      { resultSummary: 'voucher_acquired' },
    );
    const observed = output({
      responseText: 'Đã đổi mã và dùng ưu đãi.',
      entries: [
        incorrectAcquire,
        incorrectAcquire,
        entry(
          'redeemReward',
          {
            voucherId: 'wallet-new-member-25k',
            channel: 'zalo_miniapp',
            confirmed: true,
          },
          { resultSummary: 'reward_redeemed' },
        ),
      ],
      stateBefore: { cart: { id: 'cart-1' } },
      stateAfter: { cart: { id: 'cart-1' } },
    });

    expect(component(expected, observed, 'tool_contract')).toMatchObject({
      score: false,
      comment: expect.stringMatching(/maximum 1|exact contract/u),
    });
  });

  it('requires provider evidence for both confirmed membership mutations', () => {
    const expected = expectation(
      '07-ca-nhan-hoa-va-loyalty.json#9',
    );
    const observed = output({
      responseText: 'Đã đổi mã.',
      entries: [entry(
        'acquireVoucher',
        { rewardId: 'reward-discount-10k', confirmed: true },
        { resultSummary: 'voucher_acquired' },
      )],
      stateBefore: { cart: { id: 'cart-1' } },
      stateAfter: { cart: { id: 'cart-1' } },
    });

    expect(component(expected, observed, 'provider_evidence')).toMatchObject({
      score: false,
      comment: expect.stringContaining(
        'required provider work is missing: redeemReward',
      ),
    });
  });

  it('rejects missing invoice, order, and payment state evidence', () => {
    const expected = expectation(
      '01-dat-mon-ro-rang-giao-hang.json#11',
    );
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
    misleadingPlanner.plannerRecords = [{
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
    }];

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
    expect(
      forbiddenScores.find(({ key }) => key === 'tool_contract'),
    ).toEqual(
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
    const presentExpected = expectation(
      '01-dat-mon-ro-rang-giao-hang.json#11',
    );
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

    const absentExpected = structuredClone(expectation(
      '05-khieu-nai-va-human-handoff.json#1',
    ));
    absentExpected.stateTransition.pathConstraints = [{
      path: 'handoff',
      operator: 'absent',
    }];
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
    const expected = expectation(
      '09-phuong-thuc-thanh-toan.json#1',
    );
    const observed = output({
      responseText: 'Available payment methods were listed.',
      entries: [entry('listPaymentMethods', {
        query: null,
        paymentSurface: null,
      })],
      stateBefore: {},
      stateAfter: {
        paymentMethodEvidence: [],
        selectedPaymentMethod: {
          methodId: 'unverified-secret-method',
        },
      },
    });

    expect(component(expected, observed, 'state_transition'))
      .toMatchObject({
        score: false,
        comment: expect.stringContaining(
          'selectedPaymentMethod changed outside the mayChange partition',
        ),
      });
  });
});
