import {
  LIVE_QUALITY_DATASET_SPLIT,
  LIVE_QUALITY_SYNC_OWNER,
  type LiveScenarioCase,
  type LiveQualityV3TurnExpectation,
  type ScenarioArgumentConstraint,
  type TurnExpectation,
} from '../../src/evaluation/liveQualityContracts.js';
import {
  buildManagedLiveQualityDatasetCases,
  liveQualityCaseFingerprint,
} from '../../src/evaluation/liveQualityDataset.js';
import {
  isPrivateResponseEvidenceTool,
} from '../../src/agent/responseEvidenceContracts.js';
import { liveScenarioCases } from './scenarioCoverageLedger.js';

export const LIVE_QUALITY_V3_CANDIDATE_DATASET_NAME =
  'kfc-live-quality-v3' as const;
export const LIVE_QUALITY_V3_CANDIDATE_SCHEMA_VERSION =
  'kfc-live-quality-v3' as const;
export const LIVE_QUALITY_V3_CANDIDATE_INVENTORY_VERSION =
  '2026-07-20.5' as const;
export const LIVE_QUALITY_V3_CANDIDATE_SOURCE_PATH =
  'services/kfc-agent-backend/test/scenarios/scenarioCoverageLedgerV3Candidate.ts' as const;
export const LIVE_QUALITY_V3_CANDIDATE_DESCRIPTION =
  'Local review candidate derived from the attested v2 ledger. It replaces enum payment aliases with verified opaque method IDs, replaces raw saved-address prehydration with explicit authenticated reads, and verifies exact private arguments through checkpoint-bound SHA-256 digests.';

function expectation(id: string): TurnExpectation {
  const found = liveScenarioCasesV3Candidate
    .flatMap(({ turnExpectations }) => turnExpectations)
    .find((candidate) => candidate.id === id);
  if (!found) throw new Error(`v3_candidate_expectation_missing:${id}`);
  return found;
}

function replaceArgumentConstraints(
  target: TurnExpectation,
  toolName: TurnExpectation['allowedTools'][number],
  constraints: ScenarioArgumentConstraint[],
  argumentEncoding?: 'sha256_digest_only',
): void {
  target.argumentConstraints = [
    ...target.argumentConstraints.filter(
      (entry) => entry.toolName !== toolName,
    ),
    {
      toolName,
      constraints,
      ...(argumentEncoding ? { argumentEncoding } : {}),
    },
  ];
}

function allowStateChanges(
  target: TurnExpectation,
  keys: TurnExpectation['stateTransition']['mayChange'],
): void {
  target.stateTransition.mayChange = [
    ...new Set([
      ...target.stateTransition.mayChange,
      ...keys,
    ]),
  ];
}

function requireSavedAddressCandidate(
  target: TurnExpectation,
): void {
  target.requiredGroups = [
    ['updateCart'],
    ['searchMenu'],
    ['getSavedAddresses'],
  ];
  target.allowedTools = [
    'searchMenu',
    'getSavedAddresses',
    'updateCart',
  ];
  target.forbiddenTools = [
    ...new Set([
      ...(target.forbiddenTools ?? []),
      'quoteFulfillment' as const,
      'placeOrder' as const,
    ]),
  ];
  target.toolCounts = [
    ...target.toolCounts.filter(
      ({ toolName }) => toolName === 'updateCart',
    ),
    { toolName: 'searchMenu', min: 1, max: 1 },
    { toolName: 'getSavedAddresses', min: 1, max: 1 },
  ];
  target.toolOrderGroups = [
    ['searchMenu', 'getSavedAddresses'],
    ['updateCart'],
  ];
  replaceArgumentConstraints(target, 'searchMenu', [
    { path: 'scope', operator: 'equals', value: 'filtered' },
    { path: 'query', operator: 'exists' },
  ]);
  replaceArgumentConstraints(target, 'updateCart', [
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
  ]);
  target.requiredCatalogCodes = ['41141'];
  target.verifiedCatalogArgumentTools = ['updateCart'];
  target.stateTransition = {
    ...target.stateTransition,
    mayChange: [
      ...target.stateTransition.mayChange.filter(
        (key) => ![
          'address',
          'fulfillment',
          'customerContext',
        ].includes(key),
      ),
      'activeMenuCollection',
      'pendingSavedAddressRef',
    ],
    mustNotChange: [
      ...new Set([
        ...target.stateTransition.mustNotChange,
        'address' as const,
        'fulfillment' as const,
        'customerContext' as const,
      ]),
    ],
    pathConstraints: [
      ...target.stateTransition.pathConstraints,
      { path: 'address', operator: 'absent' },
      { path: 'fulfillment', operator: 'absent' },
      { path: 'customerContext.savedAddresses', operator: 'absent' },
      { path: 'pendingSavedAddressRef', operator: 'present' },
      {
        path: 'pendingSavedAddressRef.kind',
        operator: 'equals',
        value: 'saved_address',
      },
    ],
  };
  target.genUi = {
    ...target.genUi,
    required: true,
    allowedWidgetKinds: ['addressFulfillmentCheck'],
    requiredDataPaths: [
      'id',
      'lifecycleStage',
      'widgetKind',
      'status',
      'data',
      'actions',
      'data.cart',
      'data.addressStatus',
    ],
    requiredActions: ['accept_fulfillment'],
  };
  target.claims.required = [
    ...target.claims.required,
    {
      kind: 'grounded_tool_outcome',
      requirementId: `${target.id}:tool-outcome:v3-menu-authority`,
      anyOf: ['searchMenu'],
      expectedOk: true,
      resultSummaryOneOf: [],
      statePaths: ['activeMenuCollection', 'menuSearchResults'],
      genUiPaths: [],
      textAnyOf: [],
    },
    {
      kind: 'grounded_tool_outcome',
      requirementId: `${target.id}:tool-outcome:v3-saved-address`,
      anyOf: ['getSavedAddresses'],
      expectedOk: true,
      resultSummaryOneOf: [],
      statePaths: ['pendingSavedAddressRef'],
      genUiPaths: ['data.addressStatus'],
      textAnyOf: [],
    },
  ];
  target.providerEvidence = {
    ...target.providerEvidence,
    requireToolProvenance: true,
    requireRevisionOrSource: true,
    providerTools: [
      ...new Set([
        ...target.providerEvidence.providerTools,
        'searchMenu' as const,
        'getSavedAddresses' as const,
      ]),
    ],
  };
  target.preconditions = [
    ...new Set([
      ...target.preconditions,
      'catalog_provider_available',
      'saved_address_provider_available',
    ]),
  ];
  target.evidenceBindings = [
    ...new Set([
      ...target.evidenceBindings,
      'verified_catalog_identifiers',
      'authenticated_private_read',
      'opaque_saved_address_reference',
    ]),
  ];
}

function requireOpaqueSavedAddressQuote(
  target: TurnExpectation,
): void {
  target.allowedTools = ['quoteFulfillment'];
  target.forbiddenTools = [
    ...new Set([
      ...(target.forbiddenTools ?? []),
      'getSavedAddresses' as const,
      'updateCart' as const,
      'placeOrder' as const,
    ]),
  ];
  target.toolCounts = [{
    toolName: 'quoteFulfillment',
    min: 1,
    max: 1,
  }];
  replaceArgumentConstraints(target, 'quoteFulfillment', [
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
  ]);
  target.stateTransition = {
    ...target.stateTransition,
    mayChange: [
      ...target.stateTransition.mayChange,
      'pendingSavedAddressRef',
    ],
    mustNotChange: target.stateTransition.mustNotChange.filter(
      (key) => key !== 'cart',
    ),
    pathConstraints: [
      ...target.stateTransition.pathConstraints,
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
    ],
  };
  target.providerEvidence = {
    ...target.providerEvidence,
    requireToolProvenance: true,
    requireRevisionOrSource: true,
    providerTools: ['quoteFulfillment'],
  };
  target.preconditions = [
    ...new Set([
      ...target.preconditions,
      'pending_saved_address_ref_bound',
    ]),
  ];
  target.evidenceBindings = [
    ...new Set([
      ...target.evidenceBindings,
      'opaque_saved_address_reference',
      'verified_ref_principal',
      'verified_state_revision',
    ]),
  ];
}

export const liveScenarioCasesV3Candidate: LiveScenarioCase[] =
  structuredClone(liveScenarioCases);

const authenticatedHandoffScenario =
  liveScenarioCasesV3Candidate.find(
    ({ fileName }) =>
      fileName === '05-khieu-nai-va-human-handoff.json',
  );
if (!authenticatedHandoffScenario) {
  throw new Error('v3_candidate_handoff_scenario_missing');
}
authenticatedHandoffScenario.requiresCustomerAccess = true;

const authenticatedSavedAddressScenario =
  liveScenarioCasesV3Candidate.find(
    ({ fileName }) =>
      fileName === '03-ton-kho-dia-chi-va-cua-hang.json',
  );
if (!authenticatedSavedAddressScenario) {
  throw new Error('v3_candidate_saved_address_scenario_missing');
}
authenticatedSavedAddressScenario.requiresCustomerAccess = true;

function activeV3Expectation(
  source: TurnExpectation,
): LiveQualityV3TurnExpectation {
  const {
    allowDeterministicExecution: _allowDeterministicExecution,
    enforceToolOrder: _enforceToolOrder,
    exactArguments: _exactArguments,
    expectedToolOutcomes: _expectedToolOutcomes,
    semanticResponse: _semanticResponse,
    statePathConstraints: _statePathConstraints,
    toolOrder: _toolOrder,
    toolOrderGroups: _toolOrderGroups,
    claims,
    messenger,
    ...active
  } = structuredClone(source);
  void _allowDeterministicExecution;
  void _enforceToolOrder;
  void _exactArguments;
  void _expectedToolOutcomes;
  void _semanticResponse;
  void _statePathConstraints;
  void _toolOrder;
  void _toolOrderGroups;
  return {
    ...active,
    argumentConstraints: active.argumentConstraints.map((constraint) =>
      isPrivateResponseEvidenceTool(constraint.toolName)
        ? {
            ...constraint,
            argumentEncoding: 'sha256_digest_only' as const,
          }
        : constraint),
    claims: {
      required: claims.required.map((claim) => {
        if (claim.kind === 'semantic_response') return claim;
        const {
          textAnyOf: _textAnyOf,
          ...grounded
        } = claim;
        void _textAnyOf;
        return grounded;
      }),
    },
    messenger: {
      projection: messenger.projection,
    },
    responsePrivacy: {
      internalMetadataDisclosure: 'forbidden',
    },
  };
}

const payment = expectation(
  '01-dat-mon-ro-rang-giao-hang.json#11',
);
allowStateChanges(payment, [
  'orderPreview',
  'selectedPaymentMethod',
]);
replaceArgumentConstraints(payment, 'createPaymentLink', [{
  path: 'methodId',
  operator: 'equals_state_path',
  statePath: 'selectedPaymentMethod.methodId',
  stateSource: 'after',
}, {
  path: 'method',
  operator: 'absent',
}]);
replaceArgumentConstraints(payment, 'collectInvoice', [
  {
    path: 'companyName',
    operator: 'equals',
    value: 'Công ty ABC',
  },
  {
    path: 'taxCode',
    operator: 'equals',
    value: '0312345678',
  },
  {
    path: 'email',
    operator: 'equals',
    value: 'finance@abc.test',
  },
], 'sha256_digest_only');

const guestDeliveryQuote = expectation(
  '01-dat-mon-ro-rang-giao-hang.json#3',
);
replaceArgumentConstraints(guestDeliveryQuote, 'quoteFulfillment', [
  {
    path: 'address.label',
    operator: 'equals',
    value: 'Chung cư Sunrise City',
  },
  {
    path: 'address.line1',
    operator: 'equals',
    value:
      'Chung cư Sunrise City, 23 Nguyễn Hữu Thọ, phường Tân Hưng',
  },
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
  {
    path: 'method',
    operator: 'equals',
    value: 'delivery',
  },
], 'sha256_digest_only');
guestDeliveryQuote.stateTransition = {
  ...guestDeliveryQuote.stateTransition,
  mayChange: [
    'cart',
    'address',
    'addressDraft',
    'fulfillment',
    'pendingSavedAddressRef',
  ],
  mustChange: ['fulfillment'],
  mustNotChange: [
    'orderPreview',
    'order',
    'paymentAttempt',
    'handoff',
    'menuSearchResults',
    'activeMenuCollection',
    'menuItemDetail',
    'menuModifierOptions',
    'promotionContext',
    'promotionOffers',
    'customerContext',
    'paymentMethodEvidence',
    'selectedPaymentMethod',
    'contentEvidence',
    'invoiceRequest',
  ],
  pathConstraints: [
    { path: 'cart.id', operator: 'unchanged' },
    { path: 'cart.items', operator: 'unchanged' },
    { path: 'cart.subtotalVnd', operator: 'unchanged' },
    { path: 'cart.discountVnd', operator: 'unchanged' },
    { path: 'cart.voucherCode', operator: 'unchanged' },
    { path: 'cart.deliveryFeeVnd', operator: 'changed' },
    { path: 'cart.totalVnd', operator: 'changed' },
    { path: 'address', operator: 'present' },
    { path: 'addressDraft', operator: 'absent' },
    { path: 'fulfillment', operator: 'present' },
    { path: 'pendingSavedAddressRef', operator: 'absent' },
    { path: 'orderPreview', operator: 'absent' },
    { path: 'order', operator: 'absent' },
    { path: 'paymentAttempt', operator: 'absent' },
    { path: 'handoff', operator: 'absent' },
  ],
};

const statusBeforeHandoff = expectation(
  '04-sau-khi-dat-don.json#11',
);
replaceArgumentConstraints(statusBeforeHandoff, 'getOrderStatus', [{
  path: 'orderId',
  operator: 'equals_state_path',
  statePath: 'order.id',
  stateSource: 'before',
}], 'sha256_digest_only');

const withdrawCancellationHandoff = expectation(
  '04-sau-khi-dat-don.json#13',
);
withdrawCancellationHandoff.allowedTools = ['resolveHandoff'];
withdrawCancellationHandoff.allowEmptyTools = false;
withdrawCancellationHandoff.requiredGroups = [['resolveHandoff']];
withdrawCancellationHandoff.forbiddenTools = [
  ...new Set([
    ...(withdrawCancellationHandoff.forbiddenTools ?? []),
    'handoff' as const,
  ]),
];
withdrawCancellationHandoff.toolCounts = [{
  toolName: 'resolveHandoff',
  min: 1,
  max: 1,
}];
withdrawCancellationHandoff.toolOrder = ['resolveHandoff'];
withdrawCancellationHandoff.toolOrderGroups = [['resolveHandoff']];
replaceArgumentConstraints(
  withdrawCancellationHandoff,
  'resolveHandoff',
  [{
    path: 'escalationId',
    operator: 'equals_state_path',
    statePath: 'handoff.escalationId',
    stateSource: 'before',
  }],
);
withdrawCancellationHandoff.stateTransition = {
  mayChange: ['handoff'],
  mustChange: ['handoff'],
  mustNotChange: [
    'cart',
    'address',
    'addressDraft',
    'fulfillment',
    'orderPreview',
    'order',
    'paymentAttempt',
    'menuSearchResults',
    'activeMenuCollection',
    'menuItemDetail',
    'menuModifierOptions',
    'pendingSavedAddressRef',
    'promotionContext',
    'promotionOffers',
    'customerContext',
    'paymentMethodEvidence',
    'selectedPaymentMethod',
    'contentEvidence',
    'invoiceRequest',
  ],
  pathConstraints: [
    { path: 'handoff', operator: 'absent' },
  ],
};
withdrawCancellationHandoff.claims.required = [
  {
    kind: 'grounded_tool_outcome',
    requirementId:
      `${withdrawCancellationHandoff.id}:tool-outcome:v3-resolve-handoff`,
    anyOf: ['resolveHandoff'],
    expectedOk: true,
    resultSummaryOneOf: [],
    statePaths: [],
    genUiPaths: [],
    textAnyOf: [],
  },
  ...withdrawCancellationHandoff.claims.required,
];
withdrawCancellationHandoff.providerEvidence = {
  requireToolProvenance: true,
  requireRevisionOrSource: true,
  providerTools: ['resolveHandoff'],
  acceptedFailedTools: [],
};
withdrawCancellationHandoff.preconditions = [
  ...new Set([
    ...withdrawCancellationHandoff.preconditions,
    'active_verified_handoff',
    'handoff_resolution_provider_available',
  ]),
];
withdrawCancellationHandoff.evidenceBindings = [
  ...new Set([
    ...withdrawCancellationHandoff.evidenceBindings,
    'active_handoff_escalation_id',
    'authenticated_approval_receipt',
  ]),
];

const initialOrder = expectation(
  '01-dat-mon-ro-rang-giao-hang.json#1',
);
allowStateChanges(initialOrder, [
  'activeMenuCollection',
  'menuItemDetail',
  'menuModifierOptions',
]);
initialOrder.allowedTools = [
  'searchMenu',
  'getItemDetails',
  'getModifierOptions',
  'updateCart',
];
initialOrder.toolCounts = [
  { toolName: 'searchMenu', min: 0 },
  { toolName: 'getItemDetails', min: 0 },
  { toolName: 'getModifierOptions', min: 0 },
  ...initialOrder.toolCounts,
];
initialOrder.requiredCatalogModifierIds = ['70012'];
initialOrder.verifiedCatalogArgumentTools = ['updateCart'];
initialOrder.providerEvidence.providerTools = [
  'searchMenu',
  'getItemDetails',
  'getModifierOptions',
  'updateCart',
];

const unavailableItem = expectation(
  '03-ton-kho-dia-chi-va-cua-hang.json#1',
);
unavailableItem.allowedTools = ['searchMenu'];
unavailableItem.requiredGroups = [['searchMenu']];
unavailableItem.allowEmptyTools = false;
unavailableItem.requiredCatalogItemEvidence = [{
  code: '41140',
  available: false,
}];
unavailableItem.toolCounts = [{
  toolName: 'searchMenu',
  min: 1,
  max: 1,
}];
replaceArgumentConstraints(unavailableItem, 'searchMenu', [
  { path: 'scope', operator: 'equals', value: 'filtered' },
  { path: 'query', operator: 'exists' },
]);
allowStateChanges(unavailableItem, ['activeMenuCollection']);
unavailableItem.claims.required = [
  ...unavailableItem.claims.required,
  {
    kind: 'grounded_tool_outcome',
    requirementId: `${unavailableItem.id}:tool-outcome:v3-menu-availability`,
    anyOf: ['searchMenu'],
    expectedOk: true,
    resultSummaryOneOf: [],
    statePaths: ['activeMenuCollection', 'menuSearchResults'],
    genUiPaths: ['data.items'],
    textAnyOf: [],
  },
];
unavailableItem.providerEvidence = {
  requireToolProvenance: true,
  requireRevisionOrSource: true,
  providerTools: ['searchMenu'],
  acceptedFailedTools: [],
};
unavailableItem.preconditions = [
  ...new Set([
    ...unavailableItem.preconditions,
    'catalog_provider_available',
  ]),
];
unavailableItem.evidenceBindings = [
  ...new Set([
    ...unavailableItem.evidenceBindings,
    'verified_catalog_identifiers',
  ]),
];

const recommendation = expectation(
  '02-tu-van-combo-va-upsell.json#1',
);
allowStateChanges(recommendation, ['activeMenuCollection']);
recommendation.requiredCatalogCategoryIds = ['20006'];
recommendation.claims.required = [
  ...recommendation.claims.required,
  {
    kind: 'semantic_response',
    requirementId: `${recommendation.id}:semantic:v3-drink`,
    act: 'recommend_verified_food_and_drink_for_group_budget',
    description:
      'Recommend verified food and drink options for four people within the stated budget without mutating the cart.',
  },
];

const allMenu = expectation(
  '02-tu-van-combo-va-upsell.json#3',
);
allowStateChanges(allMenu, [
  'activeMenuCollection',
  'promotionOffers',
]);
replaceArgumentConstraints(allMenu, 'searchMenu', [
  { path: 'scope', operator: 'equals', value: 'all' },
  { path: 'query', operator: 'equals', value: null },
]);
allMenu.stateTransition.pathConstraints.push(
  {
    path: 'activeMenuCollection.result.scope.scope',
    operator: 'equals',
    value: 'all',
  },
  {
    path: 'activeMenuCollection.result.complete',
    operator: 'equals',
    value: true,
  },
);
allMenu.genUi = {
  ...allMenu.genUi,
  required: true,
  requireCompleteMenuCollection: true,
  allowedWidgetKinds: [
    ...new Set([
      ...allMenu.genUi.allowedWidgetKinds,
      'smartMenuPicker' as const,
    ]),
  ],
  requiredDataPaths: [
    ...new Set([
      ...allMenu.genUi.requiredDataPaths,
      'data.items',
      'data.categories',
      'data.total',
      'data.returned',
      'data.complete',
      'data.collection.scope',
    ]),
  ],
  requiredActions: [
    ...new Set([...allMenu.genUi.requiredActions, 'add_items']),
  ],
};

allowStateChanges(
  expectation('02-tu-van-combo-va-upsell.json#5'),
  ['menuItemDetail'],
);
allowStateChanges(
  expectation('02-tu-van-combo-va-upsell.json#7'),
  ['menuModifierOptions'],
);
allowStateChanges(
  expectation('04-sau-khi-dat-don.json#15'),
  ['activeMenuCollection'],
);

const upsize = expectation(
  '02-tu-van-combo-va-upsell.json#9',
);
replaceArgumentConstraints(upsize, 'updateCart', [
  { path: 'changes.length', operator: 'equals', value: 1 },
  { path: 'changes.0.itemCode', operator: 'equals', value: '20752' },
  { path: 'changes.0.quantity', operator: 'equals', value: 2 },
  { path: 'changes.0.modifiers.length', operator: 'equals', value: 2 },
  { path: 'changes.0.modifiers.0.groupId', operator: 'equals', value: '2' },
  {
    path: 'changes.0.modifiers.0.modifierId',
    operator: 'equals',
    value: '41091',
  },
  {
    path: 'changes.0.modifiers.0.quantity',
    operator: 'equals',
    value: null,
  },
  { path: 'changes.0.modifiers.1.groupId', operator: 'equals', value: '3' },
  {
    path: 'changes.0.modifiers.1.modifierId',
    operator: 'equals',
    value: '41091',
  },
  {
    path: 'changes.0.modifiers.1.quantity',
    operator: 'equals',
    value: null,
  },
]);
upsize.stateTransition.pathConstraints.push(
  {
    path: 'cart.items.0.unitPriceVnd',
    operator: 'equals',
    value: 143_000,
  },
  {
    path: 'cart.items.0.modifiers.length',
    operator: 'equals',
    value: 2,
  },
  {
    path: 'cart.items.0.modifiers.1.modifierId',
    operator: 'equals',
    value: '41091',
  },
  { path: 'cart.totalVnd', operator: 'equals', value: 286_000 },
);

requireSavedAddressCandidate(
  expectation('03-ton-kho-dia-chi-va-cua-hang.json#3'),
);
requireOpaqueSavedAddressQuote(
  expectation('03-ton-kho-dia-chi-va-cua-hang.json#5'),
);

const typoInterpretation = expectation(
  '06-ngon-ngu-tu-nhien-va-an-toan.json#1',
);
allowStateChanges(typoInterpretation, ['activeMenuCollection']);
typoInterpretation.allowedTools = ['searchMenu'];
typoInterpretation.requiredGroups = [['searchMenu']];
typoInterpretation.forbiddenTools = ['updateCart', 'placeOrder'];
typoInterpretation.toolCounts = [{
  toolName: 'searchMenu',
  min: 1,
}];
typoInterpretation.toolOrder = ['searchMenu'];
typoInterpretation.toolOrderGroups = [['searchMenu']];
replaceArgumentConstraints(typoInterpretation, 'searchMenu', [{
  path: 'query',
  operator: 'exists',
}]);
typoInterpretation.stateTransition = {
  ...typoInterpretation.stateTransition,
  mayChange: typoInterpretation.stateTransition.mayChange.filter(
    (key) => key !== 'cart',
  ),
  mustChange: typoInterpretation.stateTransition.mustChange.filter(
    (key) => key !== 'cart',
  ),
  mustNotChange: [
    ...new Set([
      ...typoInterpretation.stateTransition.mustNotChange,
      'cart' as const,
    ]),
  ],
};
typoInterpretation.claims.required = [
  {
    kind: 'semantic_response',
    requirementId: `${typoInterpretation.id}:semantic:v3-clarification`,
    act: 'clarify_interpreted_order_before_mutation',
    description:
      'Present the interpreted food and drink candidates for confirmation without adding anything to the cart.',
  },
  {
    kind: 'grounded_tool_outcome',
    requirementId: `${typoInterpretation.id}:tool-outcome:1`,
    anyOf: ['searchMenu'],
    expectedOk: true,
    resultSummaryOneOf: [],
    statePaths: ['menuSearchResults'],
    genUiPaths: ['data.items'],
    textAnyOf: [],
  },
];
typoInterpretation.providerEvidence = {
  requireToolProvenance: true,
  requireRevisionOrSource: true,
  providerTools: ['searchMenu'],
  acceptedFailedTools: [],
};

const membershipOverview = expectation(
  '07-ca-nhan-hoa-va-loyalty.json#5',
);
allowStateChanges(membershipOverview, ['activeMenuCollection']);
membershipOverview.allowedTools = [
  ...new Set([
    ...membershipOverview.allowedTools,
    'searchMenu' as const,
  ]),
];
membershipOverview.toolCounts = [
  ...membershipOverview.toolCounts,
  { toolName: 'searchMenu', min: 1, max: 1 },
];
membershipOverview.requiredCatalogCodes = ['20698'];
membershipOverview.verifiedCatalogArgumentTools = ['updateCart'];
membershipOverview.providerEvidence.providerTools = [
  ...new Set([
    ...membershipOverview.providerEvidence.providerTools,
    'searchMenu' as const,
  ]),
];
replaceArgumentConstraints(membershipOverview, 'searchMenu', [
  { path: 'scope', operator: 'equals', value: 'filtered' },
  { path: 'query', operator: 'exists' },
]);

const deferredMembershipAction = expectation(
  '07-ca-nhan-hoa-va-loyalty.json#7',
);
allowStateChanges(deferredMembershipAction, ['menuModifierOptions']);
deferredMembershipAction.requiredGroups = [
  ['getModifierOptions'],
  ['updateCart'],
];
deferredMembershipAction.allowedTools = [
  'getModifierOptions',
  'updateCart',
];
deferredMembershipAction.forbiddenTools = [
  'acquireVoucher',
  'redeemReward',
  'placeOrder',
];
deferredMembershipAction.toolCounts = [
  { toolName: 'getModifierOptions', min: 1, max: 1 },
  { toolName: 'updateCart', min: 1, max: 1 },
];
deferredMembershipAction.toolOrder = [
  'getModifierOptions',
  'updateCart',
];
deferredMembershipAction.toolOrderGroups = [
  ['getModifierOptions'],
  ['updateCart'],
];
deferredMembershipAction.argumentConstraints =
  deferredMembershipAction.argumentConstraints.filter(
    ({ toolName }) => toolName === 'updateCart',
  );
replaceArgumentConstraints(
  deferredMembershipAction,
  'getModifierOptions',
  [{
    path: 'code',
    operator: 'equals',
    value: '20698',
  }],
);
deferredMembershipAction.stateTransition = {
  ...deferredMembershipAction.stateTransition,
  mayChange: deferredMembershipAction.stateTransition.mayChange.filter(
    (key) => ![
      'customerContext',
      'promotionContext',
    ].includes(key),
  ),
  mustNotChange: [
    ...new Set([
      ...deferredMembershipAction.stateTransition.mustNotChange,
      'customerContext' as const,
      'promotionContext' as const,
    ]),
  ],
};
deferredMembershipAction.claims.required = [
  {
    kind: 'grounded_tool_outcome',
    requirementId:
      `${deferredMembershipAction.id}:tool-outcome:v3-modifier-options`,
    anyOf: ['getModifierOptions'],
    expectedOk: true,
    resultSummaryOneOf: [],
    statePaths: ['menuModifierOptions'],
    genUiPaths: [],
    textAnyOf: [],
  },
  deferredMembershipAction.claims.required.find(
    (claim) =>
      claim.kind === 'grounded_tool_outcome' &&
      claim.anyOf.includes('updateCart'),
  )!,
  {
    kind: 'semantic_response',
    requirementId: `${deferredMembershipAction.id}:semantic:v3-membership-confirmation`,
    act: 'request_membership_action_confirmation_without_execution',
    description:
      'Confirm the requested cart change, but ask for explicit authenticated approval before acquiring or redeeming any membership benefit.',
  },
];
deferredMembershipAction.providerEvidence = {
  requireToolProvenance: true,
  requireRevisionOrSource: true,
  providerTools: ['getModifierOptions', 'updateCart'],
  acceptedFailedTools: [],
};
deferredMembershipAction.requiredCatalogModifierIds = [
  'MOCK-PEACH-TEA-MODIFIER',
];
deferredMembershipAction.verifiedCatalogArgumentTools = ['updateCart'];
deferredMembershipAction.preconditions = [
  ...new Set([
    ...deferredMembershipAction.preconditions,
    'membership_write_requires_authenticated_approval',
  ]),
];

const approvedMembershipActions = expectation(
  '07-ca-nhan-hoa-va-loyalty.json#9',
);
replaceArgumentConstraints(approvedMembershipActions, 'acquireVoucher', [{
  path: 'rewardId',
  operator: 'equals',
  value: 'reward-discount-10k',
}, {
  path: 'confirmed',
  operator: 'absent',
}], 'sha256_digest_only');
replaceArgumentConstraints(approvedMembershipActions, 'redeemReward', [
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
]);
approvedMembershipActions.preconditions = [
  ...new Set([
    ...approvedMembershipActions.preconditions,
    'authenticated_sequential_approval_resumes',
  ]),
];
approvedMembershipActions.evidenceBindings = [
  ...new Set([
    ...approvedMembershipActions.evidenceBindings,
    'approval_receipt',
    'approval_action_digest',
  ]),
];

const authenticatedHandoff = expectation(
  '05-khieu-nai-va-human-handoff.json#7',
);
authenticatedHandoff.preconditions = [
  ...new Set([
    ...authenticatedHandoff.preconditions,
    'authenticated_handoff_write_scope',
  ]),
];
authenticatedHandoff.evidenceBindings = [
  ...new Set([
    ...authenticatedHandoff.evidenceBindings,
    'approval_receipt',
    'approval_action_digest',
  ]),
];

const fullLiveQualityV3CandidateCases =
  buildManagedLiveQualityDatasetCases({
    identity: {
      datasetName: LIVE_QUALITY_V3_CANDIDATE_DATASET_NAME,
      schemaVersion: LIVE_QUALITY_V3_CANDIDATE_SCHEMA_VERSION,
      sourcePath: LIVE_QUALITY_V3_CANDIDATE_SOURCE_PATH,
      managedBy: LIVE_QUALITY_SYNC_OWNER,
      split: LIVE_QUALITY_DATASET_SPLIT,
    },
    inventoryVersion: LIVE_QUALITY_V3_CANDIDATE_INVENTORY_VERSION,
    scenarioCases: liveScenarioCasesV3Candidate,
  });

export const liveQualityV3CandidateCases =
  fullLiveQualityV3CandidateCases.map((testCase) => {
    const outputs = {
      expectation: activeV3Expectation(testCase.outputs.expectation),
    };
    const {
      fingerprint: _fingerprint,
      ...managedMetadata
    } = testCase.metadata;
    void _fingerprint;
    const fingerprint = liveQualityCaseFingerprint({
      inputs: testCase.inputs,
      outputs,
      metadata: managedMetadata,
      split: testCase.split,
    });
    return {
      ...testCase,
      outputs,
      metadata: {
        ...managedMetadata,
        fingerprint,
      },
    };
  });

// Pin only after the candidate's structural review. No sync code accepts this
// identity, and no remote dataset is created or mutated by importing it.
export const LIVE_QUALITY_V3_CANDIDATE_INVENTORY_DIGEST =
  '62036883be7e603d19fb08096b6e4931e00c11cc038b62a13d6f12c6e78a9c50';
