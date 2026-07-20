import { readFileSync } from 'node:fs';
import {
  AIMessage,
  HumanMessage,
} from '@langchain/core/messages';
import { describe, expect, it } from 'vitest';
import {
  prepareStructuredCustomerAction,
  structuredResponseContext,
  structuredResponseMessages,
} from '../../src/agent/structuredCustomerAction.js';
import {
  buildModelPublicationBundle,
  issueModelPublicationAuthority,
} from '../../src/agent/modelPublicationProjection.js';
import {
  resolveModelPresentationContext,
} from '../../src/agent/agentPresentationContext.js';
import {
  createTrustedCustomerActionEnvelope,
  type CustomerCommand,
  type TrustedCustomerActionEnvelope,
} from '../../src/domain/customerCommand.js';
import type {
  Cart,
  MenuItem,
  Order,
} from '../../src/domain/types.js';
import { kfcGenUiVerifiedStateRevision } from '../../src/genui/kfcGenUi.js';
import type { AgentGraphState } from '../../src/graph/state.js';
import type { GeneratedPaymentMethod } from '../../src/fixtures/schema.js';
import type {
  SelectedPaymentMethodAuthority,
} from '../../src/domain/opaqueProviderId.js';
import { classifyToolSideEffect } from '../../src/ordering/toolExecutor.js';

const envelopeDigest = 'a'.repeat(64);

function menuItem(
  code: string,
  overrides: Partial<MenuItem> = {},
): MenuItem {
  return {
    code,
    category: 'Combo',
    name: `Menu item ${code}`,
    description: 'Verified menu item',
    priceVnd: 99_000,
    originalPriceVnd: null,
    imageUrl: `https://example.test/${code}.jpg`,
    available: true,
    isCustomize: false,
    hasModifiers: false,
    ...overrides,
    categoryId: overrides.categoryId ?? 'test-combo',
  };
}

function cart(): Cart {
  return {
    id: 'cart-1',
    items: [{
      itemCode: 'existing',
      name: 'Existing item',
      quantity: 1,
      unitPriceVnd: 99_000,
      modifiers: [{
        groupId: 'size',
        groupName: 'Size',
        modifierId: 'large',
        modifierName: 'Large',
        quantity: 2,
        priceDeltaVnd: 10_000,
      }],
    }],
    subtotalVnd: 119_000,
    discountVnd: 0,
    deliveryFeeVnd: 18_000,
    totalVnd: 137_000,
    voucherCode: null,
  };
}

function state(
  overrides: Partial<AgentGraphState> = {},
): AgentGraphState {
  return {
    sessionId: 'structured-action-session',
    customerId: 'structured-action-customer',
    channel: 'kfc',
    latestUserMessage: '',
    userConfirmedOrder: false,
    escalationReasons: [],
    retrievedEvidence: [],
    toolTrace: [],
    ...overrides,
  };
}

function withVerifiedMenu(
  items: MenuItem[],
  overrides: Partial<AgentGraphState> = {},
): AgentGraphState {
  const collectionKey = 'menu:all';
  return state({
    menuSearchResults: items,
    activeCollectionKeys: { searchMenu: collectionKey },
    verifiedCollections: {
      searchMenu: {
        [collectionKey]: {
          key: collectionKey,
          revision: 'menu-revision-1',
          providerRevision: 'provider-revision-1',
          result: {
            items,
            total: items.length,
            returned: items.length,
            complete: true,
            scope: { scope: 'all' },
          },
        },
      },
    },
    ...overrides,
  });
}

function paymentMethod(
  methodId: string,
  supported = true,
): GeneratedPaymentMethod {
  return {
    methodId,
    displayName: `Provider method ${methodId}`,
    category: 'digital_wallet',
    supported,
    supportStatus: supported
      ? 'listed_supported'
      : 'not_listed_in_policy',
    paymentSurface: 'provider-checkout',
    evidenceText: 'Verified provider payment method',
    sourceUrl: 'https://payments.example.test/methods',
    sourceFile: 'fixtures/provider-payment-methods.json',
    notes: '',
    provenance: {
      sourceFile: 'fixtures/provider-payment-methods.json',
      sourceUrl: 'https://payments.example.test/methods',
      fixtureMode: 'public_crawl_seed',
    },
  };
}

function paymentSelection(
  methodId: string,
): SelectedPaymentMethodAuthority {
  return {
    methodId,
    collectionKey: 'payment-methods:active',
    collectionRevision: 'payment-collection-revision-1',
    providerRevision: 'payment-provider-revision-1',
  };
}

function withVerifiedPaymentMethods(
  methods: GeneratedPaymentMethod[],
): AgentGraphState {
  const collectionKey = 'payment-methods:active';
  return state({
    paymentMethodEvidence: methods,
    activeCollectionKeys: { listPaymentMethods: collectionKey },
    verifiedCollections: {
      listPaymentMethods: {
        [collectionKey]: {
          key: collectionKey,
          revision: 'payment-collection-revision-1',
          providerRevision: 'payment-provider-revision-1',
          result: {
            items: methods,
            total: methods.length,
            returned: methods.length,
            complete: true,
            scope: { scope: 'all' },
          },
        },
      },
    },
  });
}

function envelope(
  authoritativeState: AgentGraphState,
  command: CustomerCommand,
  verifiedRevision = kfcGenUiVerifiedStateRevision(authoritativeState),
): TrustedCustomerActionEnvelope {
  return createTrustedCustomerActionEnvelope({
    source: 'kfc_genui_action',
    assistantTurnId: 'assistant-turn-1',
    attachmentId: 'attachment-1',
    actionDigest: envelopeDigest,
    verifiedRevision,
    lifecycle: 'one_shot',
    command,
  });
}

function fulfillmentReadyState(
  overrides: Partial<AgentGraphState> = {},
): AgentGraphState {
  return state({
    cart: cart(),
    address: {
      label: 'Home',
      line1: '23 Nguyen Huu Tho',
      district: 'District 7',
      city: 'Ho Chi Minh City',
    },
    fulfillment: {
      method: 'delivery',
      disposition: 'delivery',
      storeId: 'store-1',
      storeName: 'KFC District 7',
      feeVnd: 18_000,
      etaMinutes: 25,
      availability: {
        ok: true,
        checkedItemIds: ['existing'],
        unavailableItemIds: [],
        blockedTimeslotItemIds: [],
        source: {
          fixtureMode: 'test_only',
          sourceFile: 'structured-customer-action.test.ts',
        },
      },
    },
    ...overrides,
  });
}

function modifierReadyState(): AgentGraphState {
  const currentCart = cart();
  currentCart.items[0]!.modifiers = [
    {
      groupId: 'size',
      groupName: 'Size',
      modifierId: 'large',
      modifierName: 'Large',
      quantity: 1,
      priceDeltaVnd: 10_000,
    },
    {
      groupId: 'sauce',
      groupName: 'Sauce',
      modifierId: 'chili',
      modifierName: 'Chili',
      quantity: 1,
      priceDeltaVnd: 0,
    },
  ];
  return state({
    cart: currentCart,
    menuModifierOptions: {
      itemCode: 'existing',
      itemId: 'existing',
      productCode: 'existing',
      name: 'Existing item',
      modifierGroups: [
        {
          groupId: 'size',
          name: 'Size',
          min: 1,
          max: 1,
          depth: 0,
          options: [
            {
              modifierId: 'large',
              name: 'Large',
              priceDeltaVnd: 10_000,
              default: true,
              quantity: 1,
              posItemId: 'large',
              imageName: '',
              modifierGroups: [],
            },
            {
              modifierId: 'medium',
              name: 'Medium',
              priceDeltaVnd: 5_000,
              default: false,
              quantity: 1,
              posItemId: 'medium',
              imageName: '',
              modifierGroups: [],
            },
          ],
        },
        {
          groupId: 'sauce',
          name: 'Sauce',
          min: 1,
          max: 1,
          depth: 0,
          options: [{
            modifierId: 'chili',
            name: 'Chili',
            priceDeltaVnd: 0,
            default: true,
            quantity: 1,
            posItemId: 'chili',
            imageName: '',
            modifierGroups: [],
          }],
        },
      ],
      provenance: {
        sourceFile: 'verified-modifiers.json',
        fixtureMode: 'current_api',
      },
    },
  });
}

function previewOrder(currentCart: Cart): Order {
  return {
    id: 'preview-1',
    cart: currentCart,
    status: 'previewed',
    paymentStatus: 'not_started',
    assignedStoreId: 'store-1',
    createdAt: '2026-07-20T00:00:00.000Z',
  };
}

describe('trusted structured customer action preparation', () => {
  it('maps an exact cart update and preserves verified cart modifiers', () => {
    const currentState = state({
      cart: cart(),
      latestUserMessage: 'Do not change anything in my cart.',
    });
    const trustedEnvelope = envelope(currentState, {
      kind: 'cart_update',
      itemCode: 'existing',
      quantity: 3,
    });

    const prepared = prepareStructuredCustomerAction({
      envelope: trustedEnvelope,
      revisionValidated: false,
      state: currentState,
    });

    expect(prepared).toEqual({
      kind: 'execute',
      call: {
        toolName: 'updateCart',
        arguments: {
          changes: [{
            itemCode: 'existing',
            quantity: 3,
            modifiers: [{
              groupId: 'size',
              modifierId: 'large',
              quantity: 2,
            }],
          }],
        },
      },
      afterTool: 'respond',
    });
  });

  it('prepares one atomic batch update from verified collection authority', () => {
    const currentState = withVerifiedMenu(
      [menuItem('new-item')],
      { cart: cart() },
    );
    const trustedEnvelope = envelope(currentState, {
      kind: 'cart_batch_update',
      items: [
        { itemCode: 'existing', quantity: 2 },
        { itemCode: 'new-item', quantity: 1 },
      ],
    });

    expect(prepareStructuredCustomerAction({
      envelope: trustedEnvelope,
      revisionValidated: false,
      state: currentState,
    })).toEqual({
      kind: 'execute',
      call: {
        toolName: 'updateCart',
        arguments: {
          changes: [
            {
              itemCode: 'existing',
              quantity: 2,
              modifiers: [{
                groupId: 'size',
                modifierId: 'large',
                quantity: 2,
              }],
            },
            {
              itemCode: 'new-item',
              quantity: 1,
              modifiers: [],
            },
          ],
        },
      },
      afterTool: 'respond',
    });
  });

  it('does not let contradictory customer text alter typed action lowering', () => {
    const authorityState = state({
      cart: cart(),
      latestUserMessage: 'Add three of this item.',
    });
    const contradictoryState = {
      ...authorityState,
      latestUserMessage: 'Actually remove every item and cancel.',
    };
    const trustedEnvelope = envelope(authorityState, {
      kind: 'cart_update',
      itemCode: 'existing',
      quantity: 3,
    });

    const fromAuthorityText = prepareStructuredCustomerAction({
      envelope: trustedEnvelope,
      revisionValidated: false,
      state: authorityState,
    });
    const fromContradictoryText = prepareStructuredCustomerAction({
      envelope: trustedEnvelope,
      revisionValidated: false,
      state: contradictoryState,
    });

    expect(fromContradictoryText).toEqual(fromAuthorityText);
  });

  it('guards the lowering source against customer-text and phrase routing', () => {
    const source = readFileSync(
      'src/agent/structuredCustomerAction.ts',
      'utf8',
    );

    expect(source).not.toContain('latestUserMessage');
    expect(source).not.toContain('normalizeGenUiActionToText');
    expect(source).not.toMatch(/\bRegExp\b/u);
    expect(source).not.toMatch(/\.(?:match|matchAll|replace|search|test)\s*\(/u);
  });

  it('rejects an envelope whose verified-state revision is stale', () => {
    const originalState = state({ cart: cart() });
    const changedState = state({
      cart: {
        ...cart(),
        totalVnd: 999_000,
      },
    });

    expect(prepareStructuredCustomerAction({
      envelope: envelope(originalState, { kind: 'edit_cart' }),
      revisionValidated: false,
      state: changedState,
    })).toEqual({
      kind: 'reject',
      errorCode: 'structured_action_verified_state_stale',
    });
  });

  it.each([
    ['unavailable', { available: false }],
    ['customizable', { isCustomize: true }],
  ] satisfies Array<[string, Partial<MenuItem>]>)(
    'rejects a verified menu item that is %s',
    (_label, itemOverrides) => {
      const currentState = withVerifiedMenu([
        menuItem('blocked-item', itemOverrides),
      ]);

      expect(prepareStructuredCustomerAction({
        envelope: envelope(currentState, {
          kind: 'cart_update',
          itemCode: 'blocked-item',
          quantity: 1,
        }),
        revisionValidated: false,
        state: currentState,
      })).toEqual({
        kind: 'reject',
        errorCode: 'structured_action_cart_item_unverified',
      });
    },
  );

  it('projects edit-cart and accepted-fulfillment presentation state only', () => {
    const currentState = fulfillmentReadyState({
      trustedPresentation: {
        preferredSurface: 'fulfillment',
      },
    });

    const editCart = prepareStructuredCustomerAction({
      envelope: envelope(currentState, { kind: 'edit_cart' }),
      revisionValidated: false,
      state: currentState,
    });
    const acceptFulfillment = prepareStructuredCustomerAction({
      envelope: envelope(currentState, { kind: 'accept_fulfillment' }),
      revisionValidated: false,
      state: currentState,
    });

    expect(editCart).toMatchObject({
      kind: 'present',
      state: {
        trustedPresentation: {
          preferredSurface: 'cart',
        },
      },
    });
    expect(acceptFulfillment).toMatchObject({
      kind: 'present',
      state: {
        trustedPresentation: {
          fulfillmentAccepted: true,
          preferredSurface: undefined,
        },
      },
    });
    expect(currentState.trustedPresentation).toEqual({
      preferredSurface: 'fulfillment',
    });
  });

  it('requires the graph-owned claim boundary for saved-address refs', () => {
    const currentState = fulfillmentReadyState();

    expect(prepareStructuredCustomerAction({
      envelope: envelope(currentState, {
        kind: 'accept_fulfillment',
        savedAddressRef: {
          id: '00000000-0000-4000-8000-000000000001',
          kind: 'saved_address',
        },
      }),
      revisionValidated: false,
      state: currentState,
    })).toEqual({
      kind: 'reject',
      errorCode: 'structured_action_saved_address_ref_unresolved',
    });
  });

  it('previews once, then prepares irreversible placeOrder for interruption', () => {
    const initialState = fulfillmentReadyState();
    const trustedEnvelope = envelope(initialState, { kind: 'confirm_order' });
    const previewPreparation = prepareStructuredCustomerAction({
      envelope: trustedEnvelope,
      revisionValidated: false,
      state: initialState,
    });

    expect(previewPreparation).toEqual({
      kind: 'execute',
      call: {
        toolName: 'previewOrder',
        arguments: {},
      },
      afterTool: 'prepare',
    });

    const previewedState = {
      ...initialState,
      orderPreview: previewOrder(initialState.cart!),
    };
    const placePreparation = prepareStructuredCustomerAction({
      envelope: trustedEnvelope,
      revisionValidated: true,
      state: previewedState,
    });

    expect(placePreparation).toEqual({
      kind: 'execute',
      call: {
        toolName: 'placeOrder',
        arguments: {},
      },
      afterTool: 'respond',
    });
    expect(classifyToolSideEffect('placeOrder', {})).toBe('irreversible');
  });

  it('lowers an exact verified modifier selection and preserves other groups', () => {
    const currentState = modifierReadyState();
    const command = {
      kind: 'modifier_selection' as const,
      itemCode: 'existing',
      groupId: 'size',
      modifierId: 'medium',
    };

    expect(prepareStructuredCustomerAction({
      envelope: envelope(currentState, command),
      revisionValidated: false,
      state: currentState,
    })).toEqual({
      kind: 'execute',
      call: {
        toolName: 'updateCart',
        arguments: {
          changes: [{
            itemCode: 'existing',
            quantity: 1,
            modifiers: [
              {
                groupId: 'sauce',
                modifierId: 'chili',
                quantity: 1,
              },
              {
                groupId: 'size',
                modifierId: 'medium',
                quantity: 1,
              },
            ],
          }],
        },
      },
      afterTool: 'respond',
    });
  });

  it('binds response composition to the exact selected typed action', () => {
    const currentState = withVerifiedMenu([menuItem('selected-item')]);
    const trustedEnvelope = envelope(currentState, {
      kind: 'cart_update',
      itemCode: 'selected-item',
      quantity: 2,
    });

    expect(
      structuredResponseContext(trustedEnvelope, 'tool_succeeded'),
    ).toEqual({
      command: {
        kind: 'cart_update',
        itemCode: 'selected-item',
        quantity: 2,
      },
      outcome: 'tool_succeeded',
    });
  });

  it('excludes historical structured-action pseudo turns from response history', async () => {
    const currentState = state({
      latestUserMessage: 'An ordinary earlier customer message.',
      recentTurns: [
        {
          id: 'synthetic-action-turn',
          sessionId: 'structured-action-session',
          channel: 'kfc',
          role: 'user',
          text: 'SYNTHETIC_ACTION_PROSE',
          externalMessageId: 'synthetic-action-message',
          externalUserId: 'structured-action-customer',
          deliveryStatus: 'received',
          metadata: {
            rawEvent: {
              source: 'kfc_genui_action',
              schemaVersion: 'kfc-genui-v1',
              assistantTurnId: 'structured-action-assistant',
              verifiedRevision: 'b'.repeat(64),
              actionDigest: 'a'.repeat(64),
            },
          },
          createdAt: '2026-07-20T00:00:00.000Z',
        },
        {
          id: 'ordinary-user-turn',
          sessionId: 'structured-action-session',
          channel: 'kfc',
          role: 'user',
          text: 'An ordinary earlier customer message.',
          externalMessageId: 'ordinary-message',
          externalUserId: 'structured-action-customer',
          deliveryStatus: 'received',
          metadata: null,
          createdAt: '2026-07-20T00:00:01.000Z',
        },
      ],
    });
    const trustedEnvelope = envelope(currentState, { kind: 'edit_cart' });
    const currentUserTurn = currentState.recentTurns?.at(-1);
    if (!currentUserTurn || currentUserTurn.role !== 'user') {
      throw new Error('test_current_user_turn_missing');
    }
    const authority = await issueModelPublicationAuthority({
      state: currentState,
      currentUserTurn,
    });
    const messages = structuredResponseMessages({
      envelope: trustedEnvelope,
      outcome: 'presentation_ready',
      selectedActionResponseReference: {
        schemaVersion: 'kfc-selected-action-response-reference-v1',
        actionDigest: trustedEnvelope.actionDigest,
        selection: {
          entityIds: [],
          verifiedRevision: trustedEnvelope.verifiedRevision,
        },
        effect: {
          effectId: 'presentation:edit-cart',
          outcome: 'presentation_ready',
          verifiedRevision: trustedEnvelope.verifiedRevision,
        },
        assertion: 'outcome_acknowledged',
      },
      presentationContext: resolveModelPresentationContext({
        channel: currentState.channel,
      }),
      publicationBundle: await buildModelPublicationBundle({
        state: currentState,
        authority,
      }),
      state: currentState,
      messages: [
        new HumanMessage({
          id: 'conversation:synthetic-action-turn',
          content: 'SYNTHETIC_ACTION_PROSE',
        }),
        new HumanMessage({
          id: 'conversation:ordinary-user-turn',
          content: 'An ordinary earlier customer message.',
        }),
        new AIMessage({
          id: 'conversation:ordinary-assistant-turn',
          content: 'An ordinary earlier assistant response.',
        }),
      ],
    });

    expect(messages.map(({ id }) => id))
      .not.toContain('conversation:synthetic-action-turn');
    expect(messages.map(({ id }) => id))
      .toContain('conversation:ordinary-user-turn');
    expect(messages.map(({ id }) => id))
      .toContain('conversation:ordinary-assistant-turn');
    const prompt = messages.map(({ text }) => text).join('\n');
    expect(prompt).not.toContain('SYNTHETIC_ACTION_PROSE');
    expect(prompt).toContain(
      '"presentationMode":"structured_companion"',
    );
  });

  it('rejects stale or unlisted modifier selections before execution', () => {
    const currentState = modifierReadyState();
    const command = {
      kind: 'modifier_selection' as const,
      itemCode: 'existing',
      groupId: 'size',
      modifierId: 'unknown',
    };
    expect(prepareStructuredCustomerAction({
      envelope: envelope(currentState, command),
      revisionValidated: false,
      state: currentState,
    })).toEqual({
      kind: 'reject',
      errorCode: 'structured_action_modifier_unverified',
    });
    expect(prepareStructuredCustomerAction({
      envelope: envelope(
        currentState,
        { ...command, modifierId: 'medium' },
        'b'.repeat(64),
      ),
      revisionValidated: false,
      state: currentState,
    })).toEqual({
      kind: 'reject',
      errorCode: 'structured_action_verified_state_stale',
    });
  });

  it('allows a structurally new cart after a prior submitted order', () => {
    const previousCart = cart();
    const nextCart = {
      ...cart(),
      id: 'cart-2',
      items: cart().items.map((item) => ({ ...item, quantity: 2 })),
    };
    const currentState = fulfillmentReadyState({
      cart: nextCart,
      order: {
        ...previewOrder(previousCart),
        id: 'submitted-order-1',
        status: 'created',
      },
    });

    expect(prepareStructuredCustomerAction({
      envelope: envelope(currentState, { kind: 'confirm_order' }),
      revisionValidated: false,
      state: currentState,
    })).toEqual({
      kind: 'execute',
      call: {
        toolName: 'previewOrder',
        arguments: {},
      },
      afterTool: 'prepare',
    });
  });

  it('selects an arbitrary exact method from the active verified collection', () => {
    const methodId = 'provider-method-rotation-2026-07-20-a91f';
    const currentState = withVerifiedPaymentMethods([
      paymentMethod(methodId),
    ]);

    const prepared = prepareStructuredCustomerAction({
      envelope: envelope(currentState, {
        kind: 'select_payment_method',
        selection: paymentSelection(methodId),
      }),
      revisionValidated: false,
      state: currentState,
    });

    expect(prepared).toMatchObject({
      kind: 'present',
      state: { selectedPaymentMethod: paymentSelection(methodId) },
    });
    expect(currentState.selectedPaymentMethod).toBeUndefined();
  });

  it.each([
    {
      name: 'an alias rather than the exact id',
      methods: [paymentMethod('provider-zalo-wallet-v4')],
      selected: 'zalopay',
    },
    {
      name: 'an unsupported exact id',
      methods: [paymentMethod('provider-wallet-disabled', false)],
      selected: 'provider-wallet-disabled',
    },
    {
      name: 'a duplicate exact id',
      methods: [
        paymentMethod('provider-wallet-duplicate'),
        paymentMethod('provider-wallet-duplicate'),
      ],
      selected: 'provider-wallet-duplicate',
    },
  ])('rejects payment selection from $name', ({
    methods,
    selected,
  }) => {
    const currentState = withVerifiedPaymentMethods(methods);
    expect(prepareStructuredCustomerAction({
      envelope: envelope(currentState, {
        kind: 'select_payment_method',
        selection: paymentSelection(selected),
      }),
      revisionValidated: false,
      state: currentState,
    })).toEqual({
      kind: 'reject',
      errorCode: 'structured_action_payment_method_unverified',
    });
  });

  it.each([
    ['collection key', { collectionKey: 'payment-methods:stale' }],
    ['collection revision', {
      collectionRevision: 'payment-collection-revision-stale',
    }],
    ['provider revision', {
      providerRevision: 'payment-provider-revision-stale',
    }],
  ] as const)(
    'rejects a payment selection with stale %s authority',
    (_name, drift) => {
      const methodId = 'opaque-method-authority';
      const currentState = withVerifiedPaymentMethods([
        paymentMethod(methodId),
      ]);

      expect(prepareStructuredCustomerAction({
        envelope: envelope(currentState, {
          kind: 'select_payment_method',
          selection: {
            ...paymentSelection(methodId),
            ...drift,
          },
        }),
        revisionValidated: false,
        state: currentState,
      })).toEqual({
        kind: 'reject',
        errorCode: 'structured_action_payment_method_unverified',
      });
    },
  );

  it('continues payment only from the exact current selected authority tuple', () => {
    const methodId = 'ví.điện-tử/α?provider=opaque';
    const currentState = withVerifiedPaymentMethods([
      paymentMethod(methodId),
    ]);
    currentState.order = previewOrder(cart());
    currentState.selectedPaymentMethod = paymentSelection(methodId);
    const continueEnvelope = envelope(
      currentState,
      { kind: 'continue_payment' },
    );

    expect(prepareStructuredCustomerAction({
      envelope: continueEnvelope,
      revisionValidated: false,
      state: currentState,
    })).toEqual({
      kind: 'execute',
      call: {
        toolName: 'createPaymentLink',
        arguments: { methodId },
      },
      afterTool: 'respond',
    });

    currentState.selectedPaymentMethod = {
      ...paymentSelection(methodId),
      providerRevision: 'payment-provider-revision-rotated',
    };
    expect(prepareStructuredCustomerAction({
      envelope: envelope(currentState, { kind: 'continue_payment' }),
      revisionValidated: false,
      state: currentState,
    })).toEqual({
      kind: 'reject',
      errorCode: 'structured_action_payment_state_invalid',
    });
  });

  it('continues an existing payment URL only for its exact bound order', () => {
    const currentOrder = previewOrder(cart());
    const paymentUrl =
      `https://pay.example/orders/${currentOrder.id}`;
    const boundState = state({
      order: currentOrder,
      paymentAttempt: {
        orderId: currentOrder.id,
        method: 'zalopay_wallet',
        status: 'pending',
        paymentUrl,
      },
    });

    expect(prepareStructuredCustomerAction({
      envelope: envelope(boundState, { kind: 'continue_payment' }),
      revisionValidated: false,
      state: boundState,
    })).toEqual({
      kind: 'present',
      state: boundState,
    });

    const mismatchedState = {
      ...boundState,
      paymentAttempt: {
        ...boundState.paymentAttempt!,
        orderId: 'different-order',
      },
    };
    expect(prepareStructuredCustomerAction({
      envelope: envelope(
        mismatchedState,
        { kind: 'continue_payment' },
      ),
      revisionValidated: false,
      state: mismatchedState,
    })).toEqual({
      kind: 'reject',
      errorCode: 'structured_action_payment_state_invalid',
    });
  });

  it('keeps only the payment action that is executable without durable order authority', () => {
    const currentState = state({
      paymentAttempt: {
        method: 'zalopay_wallet',
        status: 'pending',
      },
    });

    expect(prepareStructuredCustomerAction({
      envelope: envelope(currentState, {
        kind: 'change_payment_method',
      }),
      revisionValidated: false,
      state: currentState,
    })).toEqual({
      kind: 'execute',
      call: {
        toolName: 'listPaymentMethods',
        arguments: {
          query: null,
          paymentSurface: null,
        },
      },
      afterTool: 'respond',
    });
    expect(prepareStructuredCustomerAction({
      envelope: envelope(currentState, { kind: 'continue_payment' }),
      revisionValidated: false,
      state: currentState,
    })).toEqual({
      kind: 'reject',
      errorCode: 'structured_action_payment_state_invalid',
    });
    expect(prepareStructuredCustomerAction({
      envelope: envelope(currentState, { kind: 'track_order' }),
      revisionValidated: false,
      state: currentState,
    })).toEqual({
      kind: 'reject',
      errorCode: 'structured_action_order_required',
    });
  });

  it('fails closed for an under-bound support request', () => {
    const currentState = fulfillmentReadyState({
      escalationReasons: ['verified-support-reason'],
    });

    expect(prepareStructuredCustomerAction({
      envelope: envelope(currentState, { kind: 'request_support' }),
      revisionValidated: false,
      state: currentState,
    })).toEqual({
      kind: 'reject',
      errorCode: 'structured_action_support_reasons_under_bound',
    });
  });
});
