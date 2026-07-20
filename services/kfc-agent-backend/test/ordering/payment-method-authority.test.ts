import { describe, expect, it } from 'vitest';
import type { GeneratedPaymentMethod } from '../../src/fixtures/schema.js';
import type { AgentGraphState } from '../../src/graph/state.js';
import {
  OPAQUE_PROVIDER_ID_MAX_LENGTH,
  opaqueProviderIdSchema,
} from '../../src/domain/opaqueProviderId.js';
import {
  activeSupportedPaymentMethod,
  paymentMethodAuthorityMatchesCurrentProvider,
  prepareModelAuthoredPaymentSelection,
  stateAfterPaymentApprovalRejection,
} from '../../src/ordering/paymentMethodAuthority.js';
import type { CommerceAuthorityRevisions } from '../../src/ordering/types.js';

function method(
  methodId: string,
  supported = true,
  supportStatus: GeneratedPaymentMethod['supportStatus'] = supported
    ? 'listed_supported'
    : 'not_listed_in_policy',
): GeneratedPaymentMethod {
  return {
    methodId,
    displayName: `Rotated method ${methodId}`,
    category: 'digital_wallet',
    supported,
    supportStatus,
    paymentSurface: 'rotating-provider-checkout',
    evidenceText: 'Provider-returned payment evidence',
    sourceUrl: 'https://payments.example.test/policy',
    sourceFile: 'fixtures/rotating-payment-provider.json',
    notes: '',
    provenance: {
      sourceFile: 'fixtures/rotating-payment-provider.json',
      sourceUrl: 'https://payments.example.test/policy',
      fixtureMode: 'public_crawl_seed',
    },
  };
}

function state(input: {
  activeKey?: string;
  storedKey?: string;
  items?: GeneratedPaymentMethod[];
  complete?: boolean;
  returned?: number;
  total?: number;
}): Pick<
  AgentGraphState,
  'activeCollectionKeys' | 'verifiedCollections'
> {
  const storedKey = input.storedKey ?? 'payment:current';
  return {
    activeCollectionKeys: input.activeKey
      ? { listPaymentMethods: input.activeKey }
      : {},
    verifiedCollections: {
      listPaymentMethods: {
        [storedKey]: {
          key: storedKey,
          revision: 'collection-revision-7',
          providerRevision: 'provider-revision-11',
          result: {
            items: input.items ?? [],
            total: input.total ?? input.items?.length ?? 0,
            returned: input.returned ?? input.items?.length ?? 0,
            complete: input.complete ?? true,
            scope: { scope: 'all' },
          },
        },
      },
    },
  };
}

function revisions(
  providerRevision = 'provider-revision-11',
): CommerceAuthorityRevisions {
  return {
    cartRevision: 'cart-revision',
    fulfillmentRevision: 'fulfillment-revision',
    paymentRevision: 'payment-revision',
    collectionRevision: 'all-collections-revision',
    providerRevision,
  };
}

function graphState(
  input: Parameters<typeof state>[0],
): AgentGraphState {
  return {
    sessionId: 'payment-model-selection',
    customerId: 'payment-model-customer',
    channel: 'kfc',
    latestUserMessage: '',
    userConfirmedOrder: false,
    escalationReasons: [],
    retrievedEvidence: [],
    toolTrace: [],
    ...state(input),
  };
}

describe('opaque payment method authority', () => {
  it('accepts an arbitrary rotated id from the exact active provider snapshot', () => {
    const rotatedId = 'provider-method-2026-07-20-a91f';

    expect(activeSupportedPaymentMethod(state({
      activeKey: 'payment:current',
      items: [method(rotatedId)],
    }), rotatedId)).toEqual({
      method: method(rotatedId),
      methodId: rotatedId,
      collectionKey: 'payment:current',
      collectionRevision: 'collection-revision-7',
      providerRevision: 'provider-revision-11',
    });
  });

  it.each([
    {
      name: 'missing active collection',
      currentState: state({ items: [method('rotated')] }),
      methodId: 'rotated',
    },
    {
      name: 'stale collection key',
      currentState: state({
        activeKey: 'payment:new',
        storedKey: 'payment:old',
        items: [method('rotated')],
      }),
      methodId: 'rotated',
    },
    {
      name: 'absent method id',
      currentState: state({
        activeKey: 'payment:current',
        items: [method('other')],
      }),
      methodId: 'rotated',
    },
    {
      name: 'incomplete provider collection',
      currentState: state({
        activeKey: 'payment:current',
        items: [method('rotated')],
        complete: false,
      }),
      methodId: 'rotated',
    },
    {
      name: 'collection count mismatch',
      currentState: state({
        activeKey: 'payment:current',
        items: [method('rotated')],
        returned: 2,
      }),
      methodId: 'rotated',
    },
    {
      name: 'unsupported method id',
      currentState: state({
        activeKey: 'payment:current',
        items: [method('rotated', false)],
      }),
      methodId: 'rotated',
    },
    {
      name: 'supported flag contradicts not-listed policy status',
      currentState: state({
        activeKey: 'payment:current',
        items: [method('rotated', true, 'not_listed_in_policy')],
      }),
      methodId: 'rotated',
    },
    {
      name: 'supported flag contradicts separate-channel status',
      currentState: state({
        activeKey: 'payment:current',
        items: [method('rotated', true, 'separate_channel_only')],
      }),
      methodId: 'rotated',
    },
    {
      name: 'duplicate selected method id',
      currentState: state({
        activeKey: 'payment:current',
        items: [method('rotated'), method('rotated')],
      }),
      methodId: 'rotated',
    },
    {
      name: 'duplicate unrelated method id makes the snapshot malformed',
      currentState: state({
        activeKey: 'payment:current',
        items: [
          method('rotated'),
          method('duplicate-other'),
          method('duplicate-other'),
        ],
      }),
      methodId: 'rotated',
    },
    {
      name: 'display name instead of the opaque id',
      currentState: state({
        activeKey: 'payment:current',
        items: [method('rotated')],
      }),
      methodId: 'Rotated method rotated',
    },
    {
      name: 'common alias instead of the opaque id',
      currentState: state({
        activeKey: 'payment:current',
        items: [method('provider-zalo-wallet-v4')],
      }),
      methodId: 'zalopay',
    },
    {
      name: 'case variant of the opaque id',
      currentState: state({
        activeKey: 'payment:current',
        items: [method('Provider-Method-A')],
      }),
      methodId: 'provider-method-a',
    },
  ])('rejects $name', ({ currentState, methodId }) => {
    expect(
      activeSupportedPaymentMethod(currentState, methodId),
    ).toBeUndefined();
  });

  it.each([
    {
      name: 'current provider revision changed',
      mutate: (
        currentState: ReturnType<typeof state>,
      ) => ({
        currentState,
        currentRevisions: revisions('provider-revision-12'),
      }),
    },
    {
      name: 'active collection key changed',
      mutate: (
        currentState: ReturnType<typeof state>,
      ) => {
        currentState.activeCollectionKeys = {
          listPaymentMethods: 'payment:refreshed',
        };
        return {
          currentState,
          currentRevisions: revisions(),
        };
      },
    },
    {
      name: 'active collection revision changed',
      mutate: (
        currentState: ReturnType<typeof state>,
      ) => {
        const snapshot =
          currentState.verifiedCollections?.listPaymentMethods?.[
            'payment:current'
          ];
        if (!snapshot) throw new Error('payment snapshot missing');
        currentState.verifiedCollections = {
          listPaymentMethods: {
            'payment:current': {
              ...snapshot,
              revision: 'collection-revision-8',
            },
          },
        };
        return {
          currentState,
          currentRevisions: revisions(),
        };
      },
    },
    {
      name: 'exact method disappeared without a valid snapshot refresh',
      mutate: (
        currentState: ReturnType<typeof state>,
      ) => {
        const snapshot =
          currentState.verifiedCollections?.listPaymentMethods?.[
            'payment:current'
          ];
        if (!snapshot) throw new Error('payment snapshot missing');
        currentState.verifiedCollections = {
          listPaymentMethods: {
            'payment:current': {
              ...snapshot,
              result: {
                ...snapshot.result,
                items: [],
                total: 0,
                returned: 0,
              },
            },
          },
        };
        return {
          currentState,
          currentRevisions: revisions(),
        };
      },
    },
  ])(
    'invalidates a captured method authority when $name',
    ({ mutate }) => {
      const currentState = state({
        activeKey: 'payment:current',
        items: [method('opaque-current-method')],
      });
      const authority = activeSupportedPaymentMethod(
        currentState,
        'opaque-current-method',
      );
      if (!authority) throw new Error('payment authority missing');
      const changed = mutate(currentState);

      expect(
        paymentMethodAuthorityMatchesCurrentProvider(
          changed.currentState,
          authority,
          changed.currentRevisions,
        ),
      ).toBe(false);
    },
  );

  it('accepts a captured arbitrary opaque id only while its exact snapshot remains current', () => {
    const currentState = state({
      activeKey: 'payment:current',
      items: [method('opaque.provider/id:2026-07-20:α91f')],
    });
    const authority = activeSupportedPaymentMethod(
      currentState,
      'opaque.provider/id:2026-07-20:α91f',
    );
    if (!authority) throw new Error('payment authority missing');

    expect(
      paymentMethodAuthorityMatchesCurrentProvider(
        currentState,
        authority,
        revisions(),
      ),
    ).toBe(true);
  });

  it.each([
    'ví.điện-tử/α?provider=opaque#版本',
    `provider:${'x'.repeat(1_024)}:tail`,
    'x'.repeat(OPAQUE_PROVIDER_ID_MAX_LENGTH),
    '🧾'.repeat(OPAQUE_PROVIDER_ID_MAX_LENGTH / 2),
    'provider\u0085method',
    '\u180eprovider',
  ])('preserves and authorizes the exact opaque id %s', (methodId) => {
    const currentState = state({
      activeKey: 'payment:current',
      items: [method(methodId)],
    });

    expect(
      activeSupportedPaymentMethod(currentState, methodId),
    ).toMatchObject({
      methodId,
      method: { methodId },
    });
  });

  it.each([
    '',
    '   ',
    ' leading-space',
    'trailing-space ',
    'x'.repeat(OPAQUE_PROVIDER_ID_MAX_LENGTH + 1),
    ...[
      '\u0009',
      '\u000a',
      '\u000d',
      '\u0020',
      '\u0085',
      '\u00a0',
      '\u1680',
      '\u2000',
      '\u200a',
      '\u2028',
      '\u2029',
      '\u202f',
      '\u205f',
      '\u3000',
      '\ufeff',
    ].flatMap((space) => [`${space}provider`, `provider${space}`]),
  ])('rejects an out-of-contract provider id without normalizing it', (
    methodId,
  ) => {
    expect(opaqueProviderIdSchema.safeParse(methodId).success).toBe(false);
    expect(activeSupportedPaymentMethod(state({
      activeKey: 'payment:current',
      items: [method(methodId)],
    }), methodId)).toBeUndefined();
  });

  it.each([
    '\ud800',
    '\udc00',
    `provider-${'\ud800'}-method`,
    `provider-${'\udc00'}-method`,
  ])('rejects the ill-formed UTF-16 provider id %j', (methodId) => {
    expect(opaqueProviderIdSchema.safeParse(methodId).success).toBe(false);
    expect(activeSupportedPaymentMethod(state({
      activeKey: 'payment:current',
      items: [method(methodId)],
    }), methodId)).toBeUndefined();
  });

  it.each([
    ['collection key', ' payment:current', 'collection-revision-7', 'provider-revision-11'],
    ['collection revision', 'payment:current', ' collection-revision-7', 'provider-revision-11'],
    ['provider revision', 'payment:current', 'collection-revision-7', 'provider-revision-11 '],
  ] as const)(
    'rejects a %s authority token that would require normalization',
    (_field, collectionKey, collectionRevision, providerRevision) => {
      const currentState = state({
        activeKey: collectionKey,
        storedKey: collectionKey,
        items: [method('opaque-current-method')],
      });
      const snapshot =
        currentState.verifiedCollections?.listPaymentMethods?.[collectionKey];
      if (!snapshot) throw new Error('payment snapshot missing');
      snapshot.revision = collectionRevision;
      snapshot.providerRevision = providerRevision;

      expect(
        activeSupportedPaymentMethod(
          currentState,
          'opaque-current-method',
        ),
      ).toBeUndefined();
    },
  );

  it('prepares the exact active tuple from a typed model payment tool call', () => {
    const methodId =
      `ví.điện-tử/α?provider=opaque#${'長'.repeat(512)}`;
    const currentState = graphState({
      activeKey: 'payment:current',
      items: [method(methodId)],
    });

    const prepared = prepareModelAuthoredPaymentSelection(
      currentState,
      {
        toolName: 'createPaymentLink',
        arguments: { methodId },
      },
    );

    expect(prepared).toEqual({
      ...currentState,
      selectedPaymentMethod: {
        methodId,
        collectionKey: 'payment:current',
        collectionRevision: 'collection-revision-7',
        providerRevision: 'provider-revision-11',
      },
    });
    expect(currentState.selectedPaymentMethod).toBeUndefined();
  });

  it.each([
    {
      name: 'missing active collection',
      currentState: graphState({
        items: [method('opaque-method')],
      }),
      methodId: 'opaque-method',
    },
    {
      name: 'incomplete active collection',
      currentState: graphState({
        activeKey: 'payment:current',
        items: [method('opaque-method')],
        complete: false,
      }),
      methodId: 'opaque-method',
    },
    {
      name: 'missing exact id',
      currentState: graphState({
        activeKey: 'payment:current',
        items: [method('different-method')],
      }),
      methodId: 'opaque-method',
    },
    {
      name: 'ambiguous duplicate exact id',
      currentState: graphState({
        activeKey: 'payment:current',
        items: [method('opaque-method'), method('opaque-method')],
      }),
      methodId: 'opaque-method',
    },
    {
      name: 'unsupported exact id',
      currentState: graphState({
        activeKey: 'payment:current',
        items: [method('opaque-method', false)],
      }),
      methodId: 'opaque-method',
    },
    {
      name: 'alias instead of exact id',
      currentState: graphState({
        activeKey: 'payment:current',
        items: [method('provider-zalo-wallet-v4')],
      }),
      methodId: 'zalopay',
    },
  ])('rejects a model payment proposal with $name', ({
    currentState,
    methodId,
  }) => {
    expect(prepareModelAuthoredPaymentSelection(
      currentState,
      {
        toolName: 'createPaymentLink',
        arguments: { methodId },
      },
    )).toBeUndefined();
    expect(currentState.selectedPaymentMethod).toBeUndefined();
  });

  it('clears only an unstructured rejected payment proposal', () => {
    const selectedState = {
      ...graphState({
        activeKey: 'payment:current',
        items: [method('opaque-method')],
      }),
      selectedPaymentMethod: {
        methodId: 'opaque-method',
        collectionKey: 'payment:current',
        collectionRevision: 'collection-revision-7',
        providerRevision: 'provider-revision-11',
      },
    };

    expect(stateAfterPaymentApprovalRejection(
      selectedState,
      { toolName: 'createPaymentLink' },
      false,
    ).selectedPaymentMethod).toBeUndefined();
    expect(stateAfterPaymentApprovalRejection(
      selectedState,
      { toolName: 'createPaymentLink' },
      true,
    )).toBe(selectedState);
    expect(stateAfterPaymentApprovalRejection(
      selectedState,
      { toolName: 'placeOrder' },
      false,
    )).toBe(selectedState);
  });
});
