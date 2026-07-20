import { describe, expect, it } from 'vitest';
import {
  LIVE_QUALITY_CANONICAL_INVENTORY_DIGEST,
  LIVE_QUALITY_EXPECTED_CASE_COUNT,
  LIVE_QUALITY_EXPECTED_SCENARIO_COUNT,
  LIVE_QUALITY_EXPECTED_TURN_COUNT,
  LIVE_QUALITY_INVENTORY_VERSION,
  SCENARIO_MUTABLE_STATE_KEYS,
} from '../../src/evaluation/liveQualityContracts.js';
import {
  buildLiveQualityDatasetCases,
  liveQualityInventoryDigest,
} from '../../src/evaluation/liveQualityDataset.js';
import {
  evaluateLiveQualityV3Output,
} from '../../src/evaluation/liveQualityEvaluators.js';
import {
  liveQualityV3TurnExpectationSchema,
  turnExpectationSchema,
} from '../../src/evaluation/liveQualitySchemas.js';
import { liveScenarioCases } from '../scenarios/scenarioCoverageLedger.js';
import {
  LIVE_QUALITY_V3_CANDIDATE_DATASET_NAME,
  LIVE_QUALITY_V3_CANDIDATE_INVENTORY_DIGEST,
  LIVE_QUALITY_V3_CANDIDATE_INVENTORY_VERSION,
  LIVE_QUALITY_V3_CANDIDATE_SCHEMA_VERSION,
  LIVE_QUALITY_V3_CANDIDATE_SOURCE_PATH,
  liveQualityV3CandidateCases,
  liveScenarioCasesV3Candidate,
} from '../scenarios/scenarioCoverageLedgerV3Candidate.js';

const canonicalMultiToolRows = [
  '01-dat-mon-ro-rang-giao-hang.json#11',
  '02-tu-van-combo-va-upsell.json#3',
  '04-sau-khi-dat-don.json#11',
  '07-ca-nhan-hoa-va-loyalty.json#5',
  '07-ca-nhan-hoa-va-loyalty.json#7',
  '07-ca-nhan-hoa-va-loyalty.json#9',
] as const;

function expectations(
  scenarios = liveScenarioCasesV3Candidate,
) {
  return scenarios.flatMap(({ turnExpectations }) => turnExpectations);
}

function expectation(id: string) {
  const found = expectations().find((candidate) => candidate.id === id);
  if (!found) throw new Error(`v3_candidate_expectation_missing:${id}`);
  return found;
}

describe('local live-quality v3 candidate', () => {
  it('keeps the attested v2 inventory unchanged', () => {
    const v2Cases = buildLiveQualityDatasetCases({
      inventoryVersion: LIVE_QUALITY_INVENTORY_VERSION,
      scenarioCases: liveScenarioCases,
    });

    expect(v2Cases).toHaveLength(92);
    expect(liveQualityInventoryDigest(v2Cases))
      .toBe(LIVE_QUALITY_CANONICAL_INVENTORY_DIGEST);
  });

  it('requires v2 forbidden-marker arrays while v3 omits them explicitly', () => {
    const v2 = liveScenarioCases[0]!.turnExpectations[0]!;
    expect(() => turnExpectationSchema.parse(v2)).not.toThrow();

    const missingClaimsForbidden = structuredClone(v2) as unknown as {
      claims: { forbidden?: string[] };
    };
    delete missingClaimsForbidden.claims.forbidden;
    const claimsResult = turnExpectationSchema.safeParse(
      missingClaimsForbidden,
    );
    expect(claimsResult.success).toBe(false);
    if (claimsResult.success) throw new Error('missing V2 claims.forbidden accepted');
    expect(claimsResult.error.issues.map(({ path }) => path))
      .toContainEqual(['claims', 'forbidden']);

    const missingMessengerForbiddenText = structuredClone(v2) as unknown as {
      messenger: { forbiddenText?: string[] };
    };
    delete missingMessengerForbiddenText.messenger.forbiddenText;
    const messengerResult = turnExpectationSchema.safeParse(
      missingMessengerForbiddenText,
    );
    expect(messengerResult.success).toBe(false);
    if (messengerResult.success) {
      throw new Error('missing V2 messenger.forbiddenText accepted');
    }
    expect(messengerResult.error.issues.map(({ path }) => path))
      .toContainEqual(['messenger', 'forbiddenText']);

    expect(() => liveQualityV3TurnExpectationSchema.parse(
      liveQualityV3CandidateCases[0]!.outputs.expectation,
    )).not.toThrow();
  });

  it('pins a local 9-scenario, 46-turn, 92-case candidate identity', () => {
    expect(liveScenarioCasesV3Candidate)
      .toHaveLength(LIVE_QUALITY_EXPECTED_SCENARIO_COUNT);
    expect(expectations()).toHaveLength(LIVE_QUALITY_EXPECTED_TURN_COUNT);
    expect(liveQualityV3CandidateCases)
      .toHaveLength(LIVE_QUALITY_EXPECTED_CASE_COUNT);
    expect(liveQualityInventoryDigest(liveQualityV3CandidateCases))
      .toBe(LIVE_QUALITY_V3_CANDIDATE_INVENTORY_DIGEST);
    expect(new Set(liveQualityV3CandidateCases.map(
      ({ metadata }) => metadata.datasetName,
    ))).toEqual(new Set([LIVE_QUALITY_V3_CANDIDATE_DATASET_NAME]));
    expect(new Set(liveQualityV3CandidateCases.map(
      ({ metadata }) => metadata.schemaVersion,
    ))).toEqual(new Set([LIVE_QUALITY_V3_CANDIDATE_SCHEMA_VERSION]));
    expect(new Set(liveQualityV3CandidateCases.map(
      ({ metadata }) => metadata.inventoryVersion,
    ))).toEqual(new Set([LIVE_QUALITY_V3_CANDIDATE_INVENTORY_VERSION]));
    expect(new Set(liveQualityV3CandidateCases.map(
      ({ metadata }) => metadata.sourcePath,
    ))).toEqual(new Set([LIVE_QUALITY_V3_CANDIDATE_SOURCE_PATH]));
  });

  it('omits v2 compatibility evidence and rejects planner records', () => {
    for (const testCase of liveQualityV3CandidateCases) {
      expect(() => liveQualityV3TurnExpectationSchema.parse(
        testCase.outputs.expectation,
      )).not.toThrow();
    }
    const serialized = JSON.stringify(liveQualityV3CandidateCases);
    for (const legacyField of [
      'plannerRecords',
      'allowDeterministicExecution',
      'enforceToolOrder',
      'exactArguments',
      'expectedToolOutcomes',
      'semanticResponse',
      'statePathConstraints',
      'toolOrder',
      'toolOrderGroups',
      'textAnyOf',
      'forbiddenText',
      '"forbidden":',
    ]) {
      expect(serialized).not.toContain(legacyField);
    }

    expect(() => evaluateLiveQualityV3Output(
      liveQualityV3CandidateCases[0]!.outputs.expectation,
      {
        responseText: 'generic response',
        plannerRecords: [{
          toolNames: ['updateCart'],
          calls: [{
            toolName: 'updateCart',
            arguments: { changes: [] },
          }],
          booleanEntities: {},
          catalogCandidateCodes: ['fabricated'],
          catalogModifierOptionNames: [],
          fulfillmentLocations: [],
        }],
        executedTools: [],
        stateBefore: {},
        stateAfter: {},
        durationMs: 1,
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
          checkpointThreadId: 'agent:["v3","case"]',
          checkpointVerified: true,
        },
      },
      'text',
    )).toThrow(/plannerRecords|unrecognized/iu);
  });

  it('changes only the reviewed v3 turn contracts', () => {
    const v2ById = new Map(expectations(liveScenarioCases).map(
      (candidate) => [candidate.id, candidate],
    ));
    const changed = expectations().flatMap((candidate) =>
      JSON.stringify(candidate) === JSON.stringify(v2ById.get(candidate.id))
        ? []
        : [candidate.id]);

    expect(changed).toEqual([
      '01-dat-mon-ro-rang-giao-hang.json#1',
      '01-dat-mon-ro-rang-giao-hang.json#3',
      '01-dat-mon-ro-rang-giao-hang.json#11',
      '02-tu-van-combo-va-upsell.json#1',
      '02-tu-van-combo-va-upsell.json#3',
      '02-tu-van-combo-va-upsell.json#5',
      '02-tu-van-combo-va-upsell.json#7',
      '02-tu-van-combo-va-upsell.json#9',
      '03-ton-kho-dia-chi-va-cua-hang.json#1',
      '03-ton-kho-dia-chi-va-cua-hang.json#3',
      '03-ton-kho-dia-chi-va-cua-hang.json#5',
      '04-sau-khi-dat-don.json#11',
      '04-sau-khi-dat-don.json#13',
      '04-sau-khi-dat-don.json#15',
      '05-khieu-nai-va-human-handoff.json#7',
      '06-ngon-ngu-tu-nhien-va-an-toan.json#1',
      '07-ca-nhan-hoa-va-loyalty.json#5',
      '07-ca-nhan-hoa-va-loyalty.json#7',
      '07-ca-nhan-hoa-va-loyalty.json#9',
    ]);
  });

  it('binds payment to the verified opaque method authority', () => {
    const payment = expectation(
      '01-dat-mon-ro-rang-giao-hang.json#11',
    );
    expect(payment.argumentConstraints.find(
      ({ toolName }) => toolName === 'createPaymentLink',
    )).toEqual({
      toolName: 'createPaymentLink',
      constraints: [{
        path: 'methodId',
        operator: 'equals_state_path',
        statePath: 'selectedPaymentMethod.methodId',
        stateSource: 'after',
      }, {
        path: 'method',
        operator: 'absent',
      }],
    });
  });

  it('separates guest address input from provider-resolved location evidence', () => {
    const initialOrder = expectation(
      '01-dat-mon-ro-rang-giao-hang.json#1',
    );
    const deliveryQuote = expectation(
      '01-dat-mon-ro-rang-giao-hang.json#3',
    );
    const payment = expectation(
      '01-dat-mon-ro-rang-giao-hang.json#11',
    );

    expect(deliveryQuote.argumentConstraints.find(
      ({ toolName }) => toolName === 'quoteFulfillment',
    )).toEqual({
      toolName: 'quoteFulfillment',
      constraints: [
        {
          path: 'address.district',
          operator: 'equals',
          value: 'Quận 7',
        },
        {
          path: 'address.city',
          operator: 'equals',
          value: null,
        },
      ],
    });
    expect(deliveryQuote.requiredFulfillmentLocation).toEqual({
      district: 'Quận 7',
      city: 'Hồ Chí Minh',
    });
    expect(deliveryQuote.stateTransition.mustNotChange)
      .toEqual(expect.arrayContaining([
        'order',
        'paymentAttempt',
        'handoff',
      ]));
    expect(deliveryQuote.stateTransition.pathConstraints)
      .toEqual(expect.arrayContaining([
        { path: 'cart.id', operator: 'unchanged' },
        { path: 'cart.items', operator: 'unchanged' },
        { path: 'cart.subtotalVnd', operator: 'unchanged' },
        { path: 'cart.discountVnd', operator: 'unchanged' },
        { path: 'cart.voucherCode', operator: 'unchanged' },
        { path: 'cart.deliveryFeeVnd', operator: 'changed' },
        { path: 'cart.totalVnd', operator: 'changed' },
        { path: 'order', operator: 'absent' },
        { path: 'paymentAttempt', operator: 'absent' },
        { path: 'handoff', operator: 'absent' },
      ]));
    expect(initialOrder.stateTransition.mayChange).toEqual(
      expect.arrayContaining([
        'activeMenuCollection',
        'menuItemDetail',
        'menuModifierOptions',
      ]),
    );
    expect(payment.stateTransition.mayChange).toEqual(
      expect.arrayContaining([
        'orderPreview',
        'selectedPaymentMethod',
      ]),
    );
  });

  it('limits item and modifier projections to the tools that own them', () => {
    const itemDetail = expectation(
      '02-tu-van-combo-va-upsell.json#5',
    );
    const modifierOptions = expectation(
      '02-tu-van-combo-va-upsell.json#7',
    );

    expect(itemDetail.stateTransition.mayChange)
      .toContain('menuItemDetail');
    expect(modifierOptions.allowedTools).not.toContain('getItemDetails');
    expect(modifierOptions.stateTransition.mayChange)
      .toContain('menuModifierOptions');
    expect(modifierOptions.stateTransition.mayChange)
      .not.toContain('menuItemDetail');
  });

  it('reads a saved address once then quotes the exact opaque ref', () => {
    const unavailable = expectation(
      '03-ton-kho-dia-chi-va-cua-hang.json#1',
    );
    const selection = expectation(
      '03-ton-kho-dia-chi-va-cua-hang.json#3',
    );
    const confirmation = expectation(
      '03-ton-kho-dia-chi-va-cua-hang.json#5',
    );

    expect(unavailable.allowedTools).toEqual(['searchMenu']);
    expect(unavailable.requiredGroups).toEqual([['searchMenu']]);
    expect(unavailable.allowEmptyTools).toBe(false);
    expect(unavailable.requiredCatalogCodes).toEqual(['41140']);
    expect(unavailable.requiredCatalogItemEvidence).toEqual([{
      code: '41140',
      available: false,
    }]);
    expect(unavailable.forbiddenTools).toEqual(expect.arrayContaining([
      'updateCart',
      'quoteFulfillment',
      'placeOrder',
    ]));
    expect(unavailable.claims.required).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'grounded_tool_outcome',
        anyOf: ['searchMenu'],
        statePaths: ['activeMenuCollection', 'menuSearchResults'],
        genUiPaths: ['data.items'],
      }),
    ]));

    expect(selection.allowedTools).toEqual([
      'searchMenu',
      'getSavedAddresses',
      'updateCart',
    ]);
    expect(selection.requiredGroups).toEqual([
      ['updateCart'],
      ['searchMenu'],
      ['getSavedAddresses'],
    ]);
    expect(selection.toolCounts).toContainEqual({
      toolName: 'searchMenu',
      min: 1,
      max: 1,
    });
    expect(selection.toolCounts).toContainEqual({
      toolName: 'getSavedAddresses',
      min: 1,
      max: 1,
    });
    expect(selection.providerEvidence.providerTools)
      .toEqual(expect.arrayContaining([
        'searchMenu',
        'getSavedAddresses',
      ]));
    expect(selection.requiredCatalogCodes).toEqual(['41141']);
    expect(selection.verifiedCatalogArgumentTools)
      .toEqual(['updateCart']);
    expect(selection.argumentConstraints).toContainEqual({
      toolName: 'updateCart',
      constraints: [
        { path: 'changes.length', operator: 'equals', value: 1 },
        {
          path: 'changes.0.itemCode',
          operator: 'equals',
          value: '41141',
        },
        { path: 'changes.0.quantity', operator: 'equals', value: 1 },
        {
          path: 'changes.0.modifiers.length',
          operator: 'equals',
          value: 0,
        },
      ],
    });
    expect(selection.claims.required).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'grounded_tool_outcome',
        anyOf: ['searchMenu'],
        expectedOk: true,
        statePaths: ['activeMenuCollection', 'menuSearchResults'],
      }),
      expect.objectContaining({
        kind: 'grounded_tool_outcome',
        anyOf: ['getSavedAddresses'],
        expectedOk: true,
        statePaths: ['pendingSavedAddressRef'],
      }),
    ]));
    expect(selection.forbiddenTools).toEqual(expect.arrayContaining([
      'quoteFulfillment',
      'placeOrder',
    ]));
    expect(selection.stateTransition.pathConstraints).toEqual(
      expect.arrayContaining([
        { path: 'address', operator: 'absent' },
        { path: 'fulfillment', operator: 'absent' },
        {
          path: 'customerContext.savedAddresses',
          operator: 'absent',
        },
        { path: 'pendingSavedAddressRef', operator: 'present' },
        {
          path: 'pendingSavedAddressRef.kind',
          operator: 'equals',
          value: 'saved_address',
        },
      ]),
    );
    expect(selection.genUi).toMatchObject({
      required: true,
      allowedWidgetKinds: ['addressFulfillmentCheck'],
      requiredDataPaths: expect.arrayContaining([
        'data.cart',
        'data.addressStatus',
      ]),
      requiredActions: ['accept_fulfillment'],
    });

    expect(confirmation.allowedTools).toEqual(['quoteFulfillment']);
    expect(confirmation.forbiddenTools).toEqual(expect.arrayContaining([
      'getSavedAddresses',
      'updateCart',
      'placeOrder',
    ]));
    expect(confirmation.argumentConstraints).toContainEqual({
      toolName: 'quoteFulfillment',
      constraints: [
        { path: 'method', operator: 'equals', value: 'delivery' },
        { path: 'address', operator: 'absent' },
        {
          path: 'savedAddressRef.id',
          operator: 'equals_state_path',
          statePath: 'pendingSavedAddressRef.id',
          stateSource: 'before',
        },
        {
          path: 'savedAddressRef.kind',
          operator: 'equals',
          value: 'saved_address',
        },
      ],
    });
    expect(confirmation.stateTransition.pathConstraints).toEqual(
      expect.arrayContaining([
        { path: 'cart.items', operator: 'unchanged' },
        { path: 'cart.subtotalVnd', operator: 'unchanged' },
        { path: 'cart.id', operator: 'unchanged' },
        { path: 'cart.discountVnd', operator: 'unchanged' },
        { path: 'cart.voucherCode', operator: 'unchanged' },
        { path: 'cart.deliveryFeeVnd', operator: 'changed' },
        { path: 'cart.totalVnd', operator: 'changed' },
        { path: 'address', operator: 'present' },
        { path: 'fulfillment', operator: 'present' },
        { path: 'pendingSavedAddressRef', operator: 'absent' },
      ]),
    );
  });

  it('graduates focused quality contracts without adding turns', () => {
    const initialOrder = expectation(
      '01-dat-mon-ro-rang-giao-hang.json#1',
    );
    expect(initialOrder.requiredCatalogCodes).toEqual([
      '20702',
      '41141',
      '41074',
    ]);
    expect(initialOrder.requiredCatalogModifierIds).toEqual(['70012']);
    expect(initialOrder.verifiedCatalogArgumentTools)
      .toEqual(['updateCart']);

    const recommendation = expectation(
      '02-tu-van-combo-va-upsell.json#1',
    );
    expect(recommendation.requiredCatalogCategoryIds).toEqual(['20006']);
    expect(recommendation.stateTransition.mustNotChange)
      .toContain('cart');

    const allMenu = expectation(
      '02-tu-van-combo-va-upsell.json#3',
    );
    expect(allMenu.argumentConstraints).toContainEqual({
      toolName: 'searchMenu',
      constraints: [
        { path: 'scope', operator: 'equals', value: 'all' },
        { path: 'query', operator: 'equals', value: null },
      ],
    });
    expect(allMenu.requiredGroups).toEqual([
      ['searchMenu'],
      ['searchPromotions', 'explainPromotion', 'validateVoucher'],
    ]);
    expect(allMenu.stateTransition.mustNotChange).toContain('cart');
    expect(allMenu.genUi).toMatchObject({
      required: true,
      requireCompleteMenuCollection: true,
      requiredActions: expect.arrayContaining(['add_items']),
    });

    const upsize = expectation(
      '02-tu-van-combo-va-upsell.json#9',
    );
    expect(upsize.argumentConstraints.find(
      ({ toolName }) => toolName === 'updateCart',
    )?.constraints).toContainEqual({
      path: 'changes.0.modifiers.1.modifierId',
      operator: 'equals',
      value: '41091',
    });
    expect(upsize.stateTransition.pathConstraints).toContainEqual({
      path: 'cart.totalVnd',
      operator: 'equals',
      value: 286_000,
    });

    const typo = expectation(
      '06-ngon-ngu-tu-nhien-va-an-toan.json#1',
    );
    expect(typo.requiredGroups).toEqual([['searchMenu']]);
    expect(typo.allowedTools).toEqual(['searchMenu']);
    expect(typo.toolCounts).toEqual([{
      toolName: 'searchMenu',
      min: 1,
    }]);
    expect(typo.claims.required).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'semantic_response',
        act: 'clarify_interpreted_order_before_mutation',
      }),
      expect.objectContaining({
        kind: 'grounded_tool_outcome',
        anyOf: ['searchMenu'],
      }),
    ]));
    expect(typo.providerEvidence.providerTools).toEqual(['searchMenu']);
    expect(typo.stateTransition.mustNotChange).toContain('cart');
  });

  it('removes model-authored consent booleans from membership writes', () => {
    const overview = expectation(
      '07-ca-nhan-hoa-va-loyalty.json#5',
    );
    expect(overview.allowedTools).toContain('searchMenu');
    expect(overview.requiredCatalogCodes).toEqual(['20698']);
    expect(overview.verifiedCatalogArgumentTools)
      .toEqual(['updateCart']);

    const deferred = expectation(
      '07-ca-nhan-hoa-va-loyalty.json#7',
    );
    expect(deferred.requiredGroups).toEqual([
      ['getModifierOptions'],
      ['updateCart'],
    ]);
    expect(deferred.allowedTools).toEqual([
      'getModifierOptions',
      'updateCart',
    ]);
    expect(deferred.requiredCatalogModifierIds).toEqual([
      'MOCK-PEACH-TEA-MODIFIER',
    ]);
    expect(deferred.verifiedCatalogArgumentTools)
      .toEqual(['updateCart']);
    expect(deferred.forbiddenTools).toEqual(expect.arrayContaining([
      'acquireVoucher',
      'redeemReward',
      'placeOrder',
    ]));
    expect(deferred.claims.required).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'grounded_tool_outcome',
        anyOf: ['getModifierOptions'],
        statePaths: ['menuModifierOptions'],
      }),
      expect.objectContaining({
        kind: 'grounded_tool_outcome',
        anyOf: ['updateCart'],
      }),
      expect.objectContaining({
        kind: 'semantic_response',
        act: 'request_membership_action_confirmation_without_execution',
      }),
    ]));

    const approved = expectation(
      '07-ca-nhan-hoa-va-loyalty.json#9',
    );
    expect(approved.argumentConstraints).toContainEqual({
      toolName: 'acquireVoucher',
      constraints: [{
        path: 'rewardId',
        operator: 'equals',
        value: 'reward-discount-10k',
      }, {
        path: 'confirmed',
        operator: 'absent',
      }],
    });
    expect(approved.argumentConstraints).toContainEqual({
      toolName: 'redeemReward',
      constraints: [
        {
          path: 'voucherId',
          operator: 'equals',
          value: 'wallet-new-member-25k',
        },
        {
          path: 'channel',
          operator: 'equals',
          value: 'zalo_miniapp',
        },
        {
          path: 'confirmed',
          operator: 'absent',
        },
      ],
    });
    for (const toolName of ['acquireVoucher', 'redeemReward'] as const) {
      const constraints = approved.argumentConstraints.find(
        (candidate) => candidate.toolName === toolName,
      )?.constraints;
      expect(constraints).toContainEqual({
        path: 'confirmed',
        operator: 'absent',
      });
      expect(constraints).not.toContainEqual(expect.objectContaining({
        path: 'confirmed',
        operator: 'equals',
      }));
    }
  });

  it('retains all v2 semantic obligations and explicitly strengthens them', () => {
    const semanticObligations = expectations().flatMap(
      ({ claims }) => claims.required.filter(
        ({ kind }) => kind === 'semantic_response',
      ),
    );
    const multiToolRows = expectations().filter(
      ({ requiredGroups }) => (requiredGroups?.length ?? 0) > 1,
    ).map(({ id }) => id);

    expect(semanticObligations).toHaveLength(19);
    expect(semanticObligations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        act: 'recommend_verified_food_and_drink_for_group_budget',
      }),
      expect.objectContaining({
        act: 'clarify_interpreted_order_before_mutation',
      }),
      expect.objectContaining({
        act: 'request_membership_action_confirmation_without_execution',
      }),
    ]));
    expect(multiToolRows).toEqual([
      ...canonicalMultiToolRows,
      '03-ton-kho-dia-chi-va-cua-hang.json#3',
    ].sort());

    expect(liveQualityV3CandidateCases.every(
      ({ outputs }) =>
        outputs.expectation.responsePrivacy
          .internalMetadataDisclosure === 'forbidden',
    )).toBe(true);
  });

  it('authorizes every active state path within its typed change partition', () => {
    const mutableRoots = new Set<string>(
      SCENARIO_MUTABLE_STATE_KEYS,
    );
    const contradictions = expectations().flatMap((row) => {
      const mayChange = new Set<string>(
        row.stateTransition.mayChange,
      );
      return row.stateTransition.pathConstraints.flatMap((constraint) => {
        const root = constraint.path.split('.')[0] ?? '';
        return (
          mutableRoots.has(root) &&
          ['changed', 'present', 'equals'].includes(constraint.operator) &&
          !mayChange.has(root)
        )
          ? [`${row.id}:${constraint.path}`]
          : [];
      });
    });

    expect(contradictions).toEqual([]);
  });

  it('requires authenticated handoff authority for scenario 05', () => {
    const scenario = liveScenarioCasesV3Candidate.find(
      ({ fileName }) =>
        fileName === '05-khieu-nai-va-human-handoff.json',
    );
    const handoff = expectation(
      '05-khieu-nai-va-human-handoff.json#7',
    );

    expect(scenario?.requiresCustomerAccess).toBe(true);
    expect(handoff.preconditions)
      .toContain('authenticated_handoff_write_scope');
    expect(handoff.evidenceBindings).toEqual(expect.arrayContaining([
      'approval_receipt',
      'approval_action_digest',
    ]));
  });

  it('requires provider-verified withdrawal of the active scenario 04 handoff', () => {
    const resolution = expectation(
      '04-sau-khi-dat-don.json#13',
    );

    expect(resolution.allowedTools).toEqual(['resolveHandoff']);
    expect(resolution.requiredGroups).toEqual([['resolveHandoff']]);
    expect(resolution.toolCounts).toEqual([{
      toolName: 'resolveHandoff',
      min: 1,
      max: 1,
    }]);
    expect(resolution.argumentConstraints).toContainEqual({
      toolName: 'resolveHandoff',
      constraints: [{
        path: 'escalationId',
        operator: 'equals_state_path',
        statePath: 'handoff.escalationId',
        stateSource: 'before',
      }],
    });
    expect(resolution.stateTransition).toMatchObject({
      mayChange: ['handoff'],
      mustChange: ['handoff'],
      pathConstraints: [
        { path: 'handoff', operator: 'absent' },
      ],
    });
    expect(resolution.providerEvidence).toEqual({
      requireToolProvenance: true,
      requireRevisionOrSource: true,
      providerTools: ['resolveHandoff'],
      acceptedFailedTools: [],
    });
    expect(resolution.preconditions).toEqual(expect.arrayContaining([
      'active_verified_handoff',
      'handoff_resolution_provider_available',
    ]));
    expect(resolution.evidenceBindings).toEqual(expect.arrayContaining([
      'active_handoff_escalation_id',
      'authenticated_approval_receipt',
    ]));
  });

  it('requires authenticated private-read authority for scenario 03', () => {
    const scenario = liveScenarioCasesV3Candidate.find(
      ({ fileName }) =>
        fileName === '03-ton-kho-dia-chi-va-cua-hang.json',
    );
    const savedAddress = expectation(
      '03-ton-kho-dia-chi-va-cua-hang.json#3',
    );

    expect(scenario?.requiresCustomerAccess).toBe(true);
    expect(savedAddress.preconditions)
      .toContain('saved_address_provider_available');
    expect(savedAddress.evidenceBindings).toEqual(expect.arrayContaining([
      'authenticated_private_read',
      'opaque_saved_address_reference',
    ]));
  });
});
