import { describe, expect, it } from 'vitest';
import type { CurrentTurnResponseEvidence } from '../../src/agent/modelPublicationProjection.js';
import {
  projectCollectionResult,
  projectMenuModifierOptions,
} from '../../src/agent/modelPublicationStateProjection.js';
import type { MenuItem } from '../../src/domain/types.js';
import type { AgentGraphState } from '../../src/graph/state.js';
import type { ToolName, ToolTraceEntry } from '../../src/ordering/types.js';
import { selectCatalogMediaIntent } from '../../src/presentation/catalogMediaIntent.js';

const currentTurnRevision = 'turn-revision';
const authorityDigest = 'authority-digest';

function item(code: string, imageHost = 'static.kfcvietnam.com.vn'): MenuItem {
  return {
    code,
    category: 'Combo',
    categoryId: 'combo',
    name: `Combo ${code}`,
    description: `Description ${code}`,
    priceVnd: 99_000,
    originalPriceVnd: null,
    imageUrl: `https://${imageHost}/images/${code}.png`,
    available: true,
  };
}

function graphState(overrides: Partial<AgentGraphState> = {}): AgentGraphState {
  return {
    sessionId: 'session-media',
    customerId: 'customer-media',
    channel: 'messenger',
    latestUserMessage: 'Gợi ý giúp mình combo phù hợp',
    userConfirmedOrder: false,
    escalationReasons: [],
    retrievedEvidence: [],
    ...overrides,
  };
}

function boundInput(input: {
  toolName: Extract<
    ToolName,
    'searchMenu' | 'getItemDetails' | 'getModifierOptions' | 'recommendAddOns'
  >;
  arguments?: Record<string, unknown>;
  value: unknown;
  state: AgentGraphState;
  cited?: boolean;
}) {
  const toolCallId = `call-${input.toolName}`;
  const evidenceId = `current:${input.toolName}:evidence`;
  const trace: ToolTraceEntry = {
    toolName: input.toolName,
    arguments: input.arguments ?? {},
    ok: true,
    resultSummary: 'verified',
    provenance: [{ fixtureMode: 'provider_runtime' }],
    publicationEvidenceAudit: {
      schemaVersion: 'kfc-tool-trace-publication-audit-v2',
      currentTurnId: 'turn-media',
      traceIndex: 0,
      traceDigest: 'trace-digest',
      argumentsDigest: 'arguments-digest',
      toolCallId,
      toolName: input.toolName,
      executionOutcome: 'success',
      evidenceId,
      evidenceDigest: 'evidence-digest',
      authorityDigest,
      currentTurnRevision,
    },
  };
  const evidence = {
    schemaVersion: 'kfc-current-turn-response-evidence-v1',
    evidenceId,
    toolCallId,
    toolName: input.toolName,
    claimKinds: ['product'],
    value: input.value,
    digest: 'evidence-digest',
    authorityDigest,
    currentTurnRevision,
    privateData: false,
    executionOutcome: 'success',
  } as CurrentTurnResponseEvidence;
  return {
    state: input.state,
    currentTurnToolTrace: [trace],
    currentTurnResponseEvidence: [evidence],
    citedEvidenceIds: input.cited === false ? [] : [evidenceId],
    authorityDigest,
    currentTurnRevision,
  };
}

function activeCollection(
  toolName: 'searchMenu' | 'recommendAddOns',
  items: MenuItem[],
  scope: { scope: 'all' } | { scope: 'filtered'; query: string },
): AgentGraphState {
  const key = `${toolName}:key`;
  const snapshot = {
    key,
    revision: `${toolName}:revision`,
    providerRevision: 'provider-revision',
    result: {
      items,
      total: items.length,
      returned: items.length,
      complete: true,
      scope,
    },
  };
  return graphState({
    activeCollectionKeys: { [toolName]: key },
    verifiedCollections: { [toolName]: { [key]: snapshot } },
    activeMenuCollection: snapshot,
    menuSearchResults: items,
  });
}

describe('current-turn catalog media intent', () => {
  it.each([
    [{ scope: 'all' } as const, { purpose: 'recommend' }, 'full menu'],
    [
      { scope: 'filtered', query: 'có combo nào' } as const,
      { purpose: 'recommend' },
      'broad query',
    ],
    [
      { scope: 'filtered', query: 'combo' } as const,
      { purpose: 'recommend' },
      'category query',
    ],
    [
      { scope: 'filtered', query: 'combo cay cho hai người' } as const,
      {},
      'missing purpose',
    ],
    [
      { scope: 'filtered', query: 'combo' } as const,
      { purpose: 'browse' },
      'browse purpose',
    ],
  ])('keeps %s search text-only for %s', async (scope, arguments_, _case) => {
    const items = [item('1'), item('2')];
    const state = activeCollection('searchMenu', items, scope);

    const intent = await selectCatalogMediaIntent(
      boundInput({
        toolName: 'searchMenu',
        arguments: arguments_,
        value: projectCollectionResult(
          'searchMenu',
          state.activeMenuCollection!.result,
        ),
        state,
      }),
    );

    expect(intent).toMatchObject({
      toolName: 'searchMenu',
      outcome: 'text_only',
      activeVerifiedRevision: 'searchMenu:revision',
    });
    expect(
      intent && 'media' in intent ? intent.media : undefined,
    ).toBeUndefined();
  });

  it('selects at most three focused recommendation results in verified order', async () => {
    const items = [item('1'), item('2'), item('3'), item('4')];
    const state = activeCollection('searchMenu', items, {
      scope: 'filtered',
      query: 'combo cay cho hai người',
    });

    const intent = await selectCatalogMediaIntent(
      boundInput({
        toolName: 'searchMenu',
        arguments: { purpose: 'recommend' },
        value: state.activeMenuCollection!.result,
        state,
      }),
    );

    expect(intent).toMatchObject({
      toolName: 'searchMenu',
      outcome: 'selected',
      media: [
        { key: 'catalog:1:0', title: 'Combo 1' },
        { key: 'catalog:2:1', title: 'Combo 2' },
        { key: 'catalog:3:2', title: 'Combo 3' },
      ],
    });
  });

  it('skips unverified images before applying the three-image limit', async () => {
    const items = [
      item('untrusted', 'example.test'),
      item('verified-1'),
      item('verified-2'),
      item('verified-3'),
      item('verified-4'),
    ];
    const state = activeCollection('searchMenu', items, {
      scope: 'filtered',
      query: 'combo cay cho nhóm bốn người',
    });

    const intent = await selectCatalogMediaIntent(
      boundInput({
        toolName: 'searchMenu',
        arguments: { purpose: 'recommend' },
        value: state.activeMenuCollection!.result,
        state,
      }),
    );

    expect(intent).toMatchObject({
      outcome: 'selected',
      media: [
        { key: 'catalog:verified-1:1' },
        { key: 'catalog:verified-2:2' },
        { key: 'catalog:verified-3:3' },
      ],
    });
  });

  it('selects the exact current item detail image only', async () => {
    const detail = item('detail');
    const state = graphState({
      menuItemDetail: detail,
      menuSearchResults: [item('stale')],
    });

    const intent = await selectCatalogMediaIntent(
      boundInput({
        toolName: 'getItemDetails',
        value: detail,
        state,
      }),
    );

    expect(intent).toMatchObject({
      outcome: 'selected',
      media: [{ key: 'catalog:detail:0', title: 'Combo detail' }],
    });
  });

  it('selects only the modifier parent item image', async () => {
    const parent = item('parent');
    const state = activeCollection('searchMenu', [item('other'), parent], {
      scope: 'filtered',
      query: 'parent',
    });
    state.menuModifierOptions = {
      itemCode: parent.code,
      itemId: parent.code,
      productCode: parent.code,
      name: parent.name,
      modifierGroups: [],
      provenance: {
        fixtureMode: 'current_api',
        sourceFile: 'catalog-media-intent.test.ts',
      },
    };

    const intent = await selectCatalogMediaIntent(
      boundInput({
        toolName: 'getModifierOptions',
        value: projectMenuModifierOptions(state.menuModifierOptions),
        state,
      }),
    );

    expect(intent).toMatchObject({
      outcome: 'selected',
      media: [{ key: 'catalog:parent:0', title: 'Combo parent' }],
    });
  });

  it('selects at most three verified add-ons in result order', async () => {
    const items = [
      item('addon-1'),
      item('addon-2'),
      item('addon-3'),
      item('addon-4'),
    ];
    const state = activeCollection('recommendAddOns', items, {
      scope: 'filtered',
      query: 'cart-current',
    });

    const intent = await selectCatalogMediaIntent(
      boundInput({
        toolName: 'recommendAddOns',
        value: state.activeMenuCollection!.result,
        state,
      }),
    );

    expect(intent).toMatchObject({
      outcome: 'selected',
      media: [
        { key: 'catalog:addon-1:0' },
        { key: 'catalog:addon-2:1' },
        { key: 'catalog:addon-3:2' },
      ],
    });
  });

  it.each<
    [
      string,
      {
        cited?: boolean;
        noTrace?: boolean;
        stale?: boolean;
        untrusted?: boolean;
      },
    ]
  >([
    ['uncited response', { cited: false }],
    ['no current trace', { noTrace: true }],
    ['stale active result', { stale: true }],
    ['no trusted media', { untrusted: true }],
  ])('does not select media for %s', async (_case, variant) => {
    const verifiedItems = [item('verified')];
    const state = activeCollection(
      'searchMenu',
      variant.untrusted ? [item('untrusted', 'example.test')] : verifiedItems,
      { scope: 'filtered', query: 'combo cay' },
    );
    const input = boundInput({
      toolName: 'searchMenu',
      arguments: { purpose: 'recommend' },
      value: variant.stale
        ? activeCollection('searchMenu', [item('stale')], {
            scope: 'filtered',
            query: 'old',
          }).activeMenuCollection!.result
        : state.activeMenuCollection!.result,
      state,
      cited: variant.cited !== false,
    });
    if (variant.noTrace) input.currentTurnToolTrace = [];

    const intent = await selectCatalogMediaIntent(input);

    expect(intent?.outcome ?? 'absent').not.toBe('selected');
  });
});
