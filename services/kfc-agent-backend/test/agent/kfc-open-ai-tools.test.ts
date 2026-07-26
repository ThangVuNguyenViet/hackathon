import { describe, expect, it } from 'vitest';
import { RunContext, invokeFunctionTool } from '@kfc/openai-agents-runtime';
import {
  createKfcOpenAiAgentsTools,
  createKfcOpenAiTools,
  createKfcToolSession,
  hydrateKfcToolSession,
  type KfcOpenAiAgentRunContext,
  verifiedKfcToolSessionContext,
} from '../../src/agent/kfcOpenAiTools.js';
import { createMockClients } from '../../src/mock/createMockClients.js';
import { toolNames } from '../../src/ordering/toolCatalog.js';
import { controlledCustomerAccess } from '../fixtures/controlledCustomerAccess.js';
import { createTestFixtures } from '../fixtures/testFixtures.js';

function parameterDescription(
  parameters: Record<string, unknown>,
  propertyName: string,
): string | undefined {
  const properties = parameters.properties;
  if (
    typeof properties !== 'object' ||
    properties === null ||
    Array.isArray(properties)
  ) {
    return undefined;
  }
  const property = Reflect.get(properties, propertyName);
  if (typeof property !== 'object' || property === null) return undefined;
  const description = Reflect.get(property, 'description');
  return typeof description === 'string' ? description : undefined;
}

function nestedDescription(
  root: Record<string, unknown>,
  path: readonly string[],
): string | undefined {
  let current: unknown = root;
  for (const propertyName of path) {
    if (
      typeof current !== 'object' ||
      current === null ||
      Array.isArray(current)
    ) {
      return undefined;
    }
    current = Reflect.get(current, propertyName);
  }
  return typeof current === 'string' ? current : undefined;
}

describe('KFC OpenAI tools', () => {
  it('keeps domain recovery guidance beside the affected tool contracts', async () => {
    const clients = createMockClients(createTestFixtures());
    const session = await createKfcToolSession(clients, 'kfc:retry_policies');
    const tools = createKfcOpenAiTools({ clients, session });
    expect(
      tools.find((tool) => tool.definition.name === 'searchMenu')?.definition
        .description,
    ).toContain('three total attempts');
    expect(
      tools.find((tool) => tool.definition.name === 'searchMenu')?.definition
        .description,
    ).toContain('do not repeat identical arguments');
    expect(
      tools.find((tool) => tool.definition.name === 'updateCart')?.definition
        .description,
    ).toContain('Never retry after an uncertain execution error');
  });

  it('teaches the model to supply intent rather than relying on backend intent parsing', async () => {
    const clients = createMockClients(createTestFixtures());
    const session = await createKfcToolSession(clients, 'kfc:search_guidance');
    const searchMenu = createKfcOpenAiTools({ clients, session }).find(
      (tool) => tool.definition.name === 'searchMenu',
    );

    expect(searchMenu?.definition.description).toContain('concise');
    expect(searchMenu?.definition.description).toContain('one searchMenu call');
    expect(searchMenu?.definition.description).toContain('same user turn');
    expect(searchMenu?.definition.description).toContain('category');
    expect(searchMenu?.definition.description).toContain('exact item code');
    expect(searchMenu?.definition.description).not.toContain(
      'positive option terms',
    );
    expect(searchMenu?.definition.description).toContain(
      'wording exposed by the selectable option',
    );
    expect(searchMenu?.definition.description).toContain('Absence of a match');
    expect(searchMenu?.definition.description).toContain(
      'Keep search terms in Vietnamese',
    );
    expect(searchMenu?.definition.description).toContain(
      '["không cay", "phô mai"]',
    );
    expect(searchMenu?.definition.description).toContain(
      'matchesAllModifierQueries',
    );
    expect(searchMenu?.definition.description).toContain(
      'category-wide request',
    );
    expect(searchMenu?.definition.description).toContain('leave query empty');
    expect(searchMenu?.definition.description).toContain(
      'filter customer exclusions',
    );
    expect(searchMenu?.definition.parameters.properties).toHaveProperty(
      'modifierQueries',
    );
  });

  it('separates product composition, selectable modifiers, and aggregate recommendation constraints', async () => {
    const clients = createMockClients(createTestFixtures());
    const session = await createKfcToolSession(clients, 'kfc:search_semantics');
    const tools = createKfcOpenAiTools({ clients, session });
    const searchMenu = tools.find(
      (tool) => tool.definition.name === 'searchMenu',
    );
    const propertyDescription = (propertyName: string) =>
      searchMenu
        ? parameterDescription(searchMenu.definition.parameters, propertyName)
        : undefined;

    expect(searchMenu?.definition.description).toContain('product-composition');
    expect(searchMenu?.definition.description).toContain('selectable options');
    expect(searchMenu?.definition.description).toContain(
      'combine returned priceVnd values',
    );
    expect(searchMenu?.definition.description).toContain(
      'total recommendation budget',
    );
    expect(searchMenu?.definition.description).toContain(
      'multiple targeted or category searches',
    );
    expect(searchMenu?.definition.description).toContain(
      'standalone requested component',
    );
    expect(propertyDescription('query')).toContain('composition');
    expect(propertyDescription('query')).toContain(
      'Leave empty for category-wide browsing',
    );
    expect(propertyDescription('modifierQueries')).toContain(
      'selectable option',
    );
    expect(propertyDescription('modifierQueries')).toContain(
      'not product components',
    );
    expect(propertyDescription('modifierQueries')).not.toContain(
      'positive selectable',
    );
    expect(propertyDescription('modifierQueries')).toContain(
      'wording exposed by the selectable option',
    );
    expect(propertyDescription('maxPriceVnd')?.toLowerCase()).toContain(
      'per-item',
    );
    expect(propertyDescription('maxPriceVnd')?.toLowerCase()).toContain(
      'not an aggregate cart limit',
    );
    expect(propertyDescription('partySize')).toContain('ranking evidence');
    expect(propertyDescription('partySize')).toContain(
      'does not guarantee serving size',
    );
  });

  it('defines exact-item selection and cart quantities without confusing portions with embedded pieces', async () => {
    const clients = createMockClients(createTestFixtures());
    const session = await createKfcToolSession(
      clients,
      'kfc:exact_item_and_quantities',
    );
    const tools = createKfcOpenAiTools({ clients, session });
    const searchMenu = tools.find(
      (tool) => tool.definition.name === 'searchMenu',
    );
    const updateCart = tools.find(
      (tool) => tool.definition.name === 'updateCart',
    );
    const quantityDescription = nestedDescription(
      updateCart!.definition.parameters,
      [
        'properties',
        'changes',
        'items',
        'properties',
        'orderedMenuItemQuantity',
        'description',
      ],
    );
    const modifierQuantityDescription = nestedDescription(
      updateCart!.definition.parameters,
      [
        'properties',
        'changes',
        'items',
        'properties',
        'modifiers',
        'items',
        'properties',
        'quantityPerPortion',
        'description',
      ],
    );

    expect(searchMenu?.definition.description).toContain('exact item-name');
    expect(searchMenu?.definition.description).toContain('top exact candidate');
    expect(searchMenu?.definition.description).toContain('getItemDetails');
    expect(updateCart?.definition.description).toContain(
      'purchasing the named menu item',
    );
    expect(updateCart?.definition.description).toContain(
      'never the number of pieces described inside',
    );
    expect(updateCart?.definition.description).toContain('reversible');
    expect(updateCart?.definition.description).toContain(
      'explicitly asks to choose and add',
    );
    expect(updateCart?.definition.description).toContain(
      'without another confirmation',
    );
    expect(updateCart?.definition.description).toContain(
      'one multi-change call',
    );
    expect(updateCart?.definition.description).toContain('quantity 0');
    expect(updateCart?.definition.description).toContain(
      'authoritative current cart',
    );
    expect(quantityDescription).toContain('named menu item');
    expect(quantityDescription).toContain('not the pieces inside');
    expect(modifierQuantityDescription).toContain('per menu portion');
    expect(updateCart?.definition.parameters).not.toHaveProperty(
      'properties.quantity',
    );
    expect(updateCart?.definition.strict).toBe(true);
    expect(JSON.stringify(updateCart?.definition.parameters)).toContain(
      '"required":["itemCode","orderedMenuItemQuantity","modifiers"]',
    );
  });

  it('adapts the model-facing portion quantity fields to the canonical cart contract', async () => {
    const clients = createMockClients(createTestFixtures());
    const session = await createKfcToolSession(
      clients,
      'kfc:model_facing_cart_quantities',
    );
    const updateCart = createKfcOpenAiTools({ clients, session }).find(
      (tool) => tool.definition.name === 'updateCart',
    );

    const result = await updateCart!.execute({
      changes: [
        {
          itemCode: '20751',
          orderedMenuItemQuantity: 1,
          modifiers: [],
        },
      ],
    });

    expect(result).toMatchObject({
      ok: true,
      toolName: 'updateCart',
      value: {
        items: [
          {
            itemCode: '20751',
            description: '3 Miếng Gà Rán + 1 Burger Tôm',
            quantity: 1,
          },
        ],
      },
    });
    expect(session.cart.items[0]?.description).toBe(
      '3 Miếng Gà Rán + 1 Burger Tôm',
    );
  });

  it('scopes every returned modifier fact to its exact option and branch', async () => {
    const clients = createMockClients(createTestFixtures());
    const session = await createKfcToolSession(
      clients,
      'kfc:modifier_fact_scope',
    );
    const getModifierOptions = createKfcOpenAiTools({
      clients,
      session,
    }).find((tool) => tool.definition.name === 'getModifierOptions');

    expect(getModifierOptions?.definition.description).toContain(
      'exact option and branch',
    );
    expect(getModifierOptions?.definition.description).toContain(
      'Do not transfer',
    );
    expect(getModifierOptions?.definition.description).toContain('unknown');
  });

  it('makes availability, serviceability, and modifier-price evidence boundaries explicit', async () => {
    const clients = createMockClients(createTestFixtures());
    const session = await createKfcToolSession(
      clients,
      'kfc:evidence_boundaries',
    );
    const tools = createKfcOpenAiTools({ clients, session });
    const description = (name: string) =>
      tools.find((tool) => tool.definition.name === name)?.definition
        .description;

    expect(description('searchMenu')).toContain(
      'available false means the item cannot currently be ordered',
    );
    expect(description('getItemDetails')).toContain('current availability');
    expect(description('getModifierOptions')).toContain('priceDeltaVnd');
    expect(description('getModifierOptions')).toContain(
      'do not infer a modifier price',
    );
    expect(description('getModifierOptions')).toContain(
      'call this before answering any exact modifier-price question',
    );
    expect(description('findStores')).toContain(
      'does not verify delivery coverage',
    );
    expect(description('quoteFulfillment')?.toLowerCase()).toContain(
      'only a successful quoted result verifies serviceability',
    );
  });

  it('keeps operational guidance beside the tools that need it', async () => {
    const clients = createMockClients(createTestFixtures());
    const session = await createKfcToolSession(
      clients,
      'kfc:tool_local_guidance',
    );
    const tools = createKfcOpenAiTools({ clients, session });
    const description = (name: string) =>
      tools.find((tool) => tool.definition.name === name)?.definition
        .description ?? '';

    expect(description('recommendAddOns')).toContain('current cart');
    expect(description('recommendAddOns')).toContain('does not mean');
    expect(description('checkStoreAvailability')).toContain('exact store');
    expect(description('checkStoreAvailability')).toContain(
      'does not verify delivery fee or ETA',
    );
    expect(description('searchPromotions')).toContain('current');
    expect(description('searchPromotions')).toContain(
      'does not prove that no promotion exists',
    );
    expect(description('quoteFulfillment')).toContain(
      'does not place or confirm an order',
    );
    expect(description('getOrderStatus')).toContain('current order');
    expect(description('getOrderStatus')).toContain(
      'only fields returned by this call',
    );
    expect(description('collectInvoice')).toContain('customer-provided');
    expect(description('collectInvoice')).toContain(
      'does not place or modify the order',
    );
  });

  it('preserves current unavailable evidence in direct search and item details', async () => {
    const fixtures = createTestFixtures();
    const unavailableCode = fixtures.menuItems[0]!.code;
    const clients = createMockClients(fixtures, {
      mockedUpstreamApiProvider: () => ({
        unavailableItemCodes: [unavailableCode],
      }),
    });
    const session = await createKfcToolSession(clients, 'kfc:unavailable_item');
    const tools = createKfcOpenAiTools({ clients, session });
    const searchMenu = tools.find(
      (tool) => tool.definition.name === 'searchMenu',
    );
    const getItemDetails = tools.find(
      (tool) => tool.definition.name === 'getItemDetails',
    );

    const searchResult = await searchMenu!.execute({
      query: fixtures.menuItems[0]!.name,
    });
    const detailResult = await getItemDetails!.execute({
      code: unavailableCode,
    });

    expect(searchResult).toMatchObject({
      ok: true,
      toolName: 'searchMenu',
      value: {
        items: expect.arrayContaining([
          expect.objectContaining({
            code: unavailableCode,
            available: false,
          }),
        ]),
      },
    });
    expect(detailResult).toMatchObject({
      ok: true,
      toolName: 'getItemDetails',
      value: {
        code: unavailableCode,
        available: false,
      },
    });
  });

  it('exposes every canonical tool and keeps fixture commerce state inside the toolbox', async () => {
    const fixtures = createTestFixtures();
    const clients = createMockClients(fixtures);
    const session = await createKfcToolSession(clients, 'kfc:customer_1');
    const tools = createKfcOpenAiTools({ clients, session, fixtures });

    expect(tools.map((tool) => tool.definition.name)).toEqual(toolNames);
    expect(
      tools.every((tool) => tool.definition.parameters.type === 'object'),
    ).toBe(true);
    expect(
      tools.every((tool) => !('anyOf' in tool.definition.parameters)),
    ).toBe(true);

    const updateCart = tools.find(
      (tool) => tool.definition.name === 'updateCart',
    );
    const previewCart = tools.find(
      (tool) => tool.definition.name === 'previewCart',
    );
    const quoteFulfillment = tools.find(
      (tool) => tool.definition.name === 'quoteFulfillment',
    );
    expect(updateCart).toBeDefined();
    expect(previewCart).toBeDefined();
    expect(quoteFulfillment).toBeDefined();
    expect(
      quoteFulfillment!.definition.parameters.properties,
    ).not.toHaveProperty('itemCodes');

    const updateResult = await updateCart!.execute({
      itemCode: '20751',
      quantity: 2,
    });
    const previewResult = await previewCart!.execute({});

    expect(updateResult).toMatchObject({ ok: true, toolName: 'updateCart' });
    expect(previewResult).toMatchObject({
      ok: true,
      toolName: 'previewCart',
      value: {
        id: 'cart_kfc:customer_1',
        items: [{ itemCode: '20751', quantity: 2 }],
      },
    });
    expect(verifiedKfcToolSessionContext(session)).toMatchObject({
      cart: {
        items: [{ itemCode: '20751', quantity: 2 }],
        totalVnd: 198000,
      },
    });

    const quoteResult = await quoteFulfillment!.execute({
      method: 'delivery',
      address: {
        recipientName: 'Nguyễn An',
        phone: '0901234567',
        addressLine: '60 Phạm Văn Nghị',
        provinceCode: null,
        provinceName: 'Hồ Chí Minh',
        communeCode: null,
        communeName: 'Phường Tân Hưng',
        deliveryInstructions: null,
        rawAddress: null,
        legacyDistrictText: 'Quận 7',
      },
    });
    expect(quoteResult).toMatchObject({
      ok: true,
      toolName: 'quoteFulfillment',
      value: {
        status: 'quoted',
        fulfillment: {
          availability: { checkedItemIds: ['20751'] },
        },
      },
    });
  });

  it('applies a verified voucher result to the direct session cart', async () => {
    const clients = createMockClients(createTestFixtures());
    const session = await createKfcToolSession(clients, 'kfc:voucher_state');
    const tools = createKfcOpenAiTools({ clients, session });
    const updateCart = tools.find(
      (tool) => tool.definition.name === 'updateCart',
    );
    const validateVoucher = tools.find(
      (tool) => tool.definition.name === 'validateVoucher',
    );

    await updateCart!.execute({ itemCode: '20751', quantity: 2 });
    const result = await validateVoucher!.execute({
      voucherText: 'KFC50',
      subtotalVnd: 198_000,
    });

    expect(result).toMatchObject({
      ok: true,
      toolName: 'validateVoucher',
      value: {
        ok: true,
        publicCode: 'KFC50',
        discountVnd: 50_000,
      },
    });
    expect(session.cart).toMatchObject({
      subtotalVnd: 198_000,
      discountVnd: 50_000,
      deliveryFeeVnd: 0,
      totalVnd: 148_000,
      voucherCode: 'KFC50',
    });
  });

  it('labels reward catalog eligibility from the verified current points balance', async () => {
    const clients = createMockClients(createTestFixtures());
    const session = await createKfcToolSession(
      clients,
      'kfc:membership_eligibility',
    );
    const tools = createKfcOpenAiTools({
      clients,
      session,
      accessContext: controlledCustomerAccess({
        sessionId: session.sessionId,
        customerId: session.customerId,
      }),
    });
    const listMembershipRewards = tools.find(
      (tool) => tool.definition.name === 'listMembershipRewards',
    );

    const result = await listMembershipRewards!.execute({});

    expect(result).toMatchObject({
      ok: true,
      toolName: 'listMembershipRewards',
      value: {
        currentPoints: 0,
        items: [
          {
            name: 'Mã Giảm 10k',
            pointsCost: 3000,
            canAcquireNow: false,
            pointsShortfall: 3000,
          },
        ],
      },
    });
    expect(listMembershipRewards!.definition.description).toContain(
      'reward catalog',
    );
    expect(listMembershipRewards!.definition.description).toContain(
      'canAcquireNow',
    );
  });

  it('executes direct membership mutations against the fixture provider', async () => {
    const clients = createMockClients(createTestFixtures());
    const session = await createKfcToolSession(
      clients,
      'kfc:membership_mutations',
    );
    const tools = createKfcOpenAiTools({
      clients,
      session,
      accessContext: controlledCustomerAccess({
        sessionId: session.sessionId,
        customerId: session.customerId,
      }),
    });
    const listMembershipWallet = tools.find(
      (tool) => tool.definition.name === 'listMembershipWallet',
    );
    const listMembershipTools = tools.find(
      (tool) => tool.definition.name === 'listMembershipTools',
    );
    const acquireVoucher = tools.find(
      (tool) => tool.definition.name === 'acquireVoucher',
    );
    const redeemReward = tools.find(
      (tool) => tool.definition.name === 'redeemReward',
    );

    expect(acquireVoucher!.definition.parameters.properties).not.toHaveProperty(
      'confirmed',
    );
    expect(redeemReward!.definition.parameters.properties).not.toHaveProperty(
      'confirmed',
    );
    expect(acquireVoucher!.definition.description).not.toContain(
      'preview-only',
    );
    expect(redeemReward!.definition.description).not.toContain('preview-only');
    expect(acquireVoucher!.definition.description).toContain(
      'customer explicitly asks',
    );
    expect(redeemReward!.definition.description).toContain(
      'customer explicitly asks',
    );
    expect(acquireVoucher!.definition.description).toContain(
      'status is completed',
    );
    expect(redeemReward!.definition.description).toContain(
      'status is completed',
    );
    expect(verifiedKfcToolSessionContext(session)).toMatchObject({
      membershipActions: {
        executionMode: 'available',
        acquisitionSupported: true,
        redemptionSupported: true,
      },
    });

    await expect(listMembershipWallet!.execute({})).resolves.toMatchObject({
      ok: true,
      toolName: 'listMembershipWallet',
      value: [
        {
          canRedeemInCurrentRuntime: true,
          redemptionMode: 'available',
        },
      ],
    });
    await expect(
      listMembershipTools!.execute({ sideEffect: 'reward_redemption' }),
    ).resolves.toMatchObject({
      ok: true,
      toolName: 'listMembershipTools',
      value: [
        {
          toolName: 'redeemReward',
          actionableInCurrentRuntime: true,
          executionMode: 'available',
        },
      ],
    });
    await expect(
      acquireVoucher!.execute({ rewardId: 'reward-discount-10k' }),
    ).resolves.toMatchObject({
      ok: true,
      toolName: 'acquireVoucher',
      value: {
        status: 'completed',
        requiresUserConfirmation: false,
        targetId: 'reward-discount-10k',
      },
    });
    await expect(
      redeemReward!.execute({
        voucherId: 'wallet-new-member-25k',
        channel: 'zalo_miniapp',
      }),
    ).resolves.toMatchObject({
      ok: true,
      toolName: 'redeemReward',
      value: {
        status: 'completed',
        requiresUserConfirmation: false,
        targetId: 'wallet-new-member-25k',
      },
    });
    expect(
      await acquireVoucher!.execute({ rewardId: 'reward-discount-10k' }),
    ).not.toHaveProperty('value.customerMessage');
    expect(
      await redeemReward!.execute({
        voucherId: 'wallet-new-member-25k',
        channel: 'zalo_miniapp',
      }),
    ).not.toHaveProperty('value.customerMessage');
  });

  it('persists one queued handoff and reuses it without calling the provider twice', async () => {
    const clients = createMockClients(createTestFixtures());
    const escalate = clients.handoff.escalateToHuman.bind(clients.handoff);
    let providerCalls = 0;
    clients.handoff.escalateToHuman = (...arguments_) => {
      providerCalls += 1;
      return escalate(...arguments_);
    };
    const session = await createKfcToolSession(clients, 'kfc:queued_handoff');
    const handoff = createKfcOpenAiTools({
      clients,
      session,
      accessContext: controlledCustomerAccess({
        sessionId: session.sessionId,
        customerId: session.customerId,
      }),
    }).find((tool) => tool.definition.name === 'handoff');

    await handoff!.execute({
      reasons: ['abnormal_large_order'],
    });
    const repeated = await handoff!.execute({
      reasons: ['customer_follow_up'],
    });

    expect(providerCalls).toBe(1);
    expect(repeated).toMatchObject({
      ok: true,
      toolName: 'handoff',
      value: { escalationId: session.handoff?.escalationId },
    });
    expect(session.handoff).toEqual({
      escalationId: expect.any(String),
      reasons: ['abnormal_large_order'],
    });
    expect(verifiedKfcToolSessionContext(session)).toMatchObject({
      humanSupport: {
        status: 'queued',
        description: 'awaiting a human operator',
      },
    });
    expect(verifiedKfcToolSessionContext(session)).not.toHaveProperty(
      'humanSupport.escalationId',
    );

    const hydrated = hydrateKfcToolSession(
      await createKfcToolSession(clients, 'kfc:hydrated_handoff'),
      { handoff: session.handoff },
    );
    expect(hydrated.handoff).toEqual(session.handoff);
  });

  it('requires an exact supported method from the active payment collection before creating a link', async () => {
    const fixtures = createTestFixtures();
    const clients = createMockClients(fixtures);
    const placeOrder = clients.oms.placeOrder.bind(clients.oms);
    let placeOrderProviderCalls = 0;
    clients.oms.placeOrder = (...arguments_) => {
      placeOrderProviderCalls += 1;
      return placeOrder(...arguments_);
    };
    const session = await createKfcToolSession(
      clients,
      'kfc:direct_payment_authority',
    );
    const tools = createKfcOpenAiTools({
      clients,
      session,
      fixtures,
      accessContext: controlledCustomerAccess({
        sessionId: session.sessionId,
        customerId: session.customerId,
      }),
    });
    const execute = (name: string, arguments_: Record<string, unknown>) =>
      tools.find((tool) => tool.definition.name === name)!.execute(arguments_);

    await execute('updateCart', { itemCode: '20751', quantity: 1 });
    await execute('quoteFulfillment', {
      method: 'delivery',
      address: {
        recipientName: 'Nguyễn An',
        phone: '0901234567',
        addressLine: '60 Phạm Văn Nghị',
        provinceCode: null,
        provinceName: 'Hồ Chí Minh',
        communeCode: null,
        communeName: 'Phường Tân Hưng',
        deliveryInstructions: null,
        rawAddress: null,
        legacyDistrictText: 'Quận 7',
      },
    });
    await execute('previewOrder', {});
    await execute('placeOrder', {});
    const recovered = await execute('placeOrder', {});
    expect(placeOrderProviderCalls).toBe(1);
    expect(recovered).toMatchObject({
      ok: true,
      toolName: 'placeOrder',
      value: { id: session.order?.id },
    });
    const methods = await execute('listPaymentMethods', {
      query: 'ZaloPay',
    });

    await expect(
      execute('createPaymentLink', { methodId: 'guessed_method' }),
    ).resolves.toMatchObject({
      ok: false,
      errorCode: 'unverified_payment_method',
    });
    const methodId = fixtures.paymentMethods.find(
      ({ displayName, supported }) =>
        supported && displayName.includes('ZaloPay'),
    )!.methodId;
    expect(methods).toMatchObject({
      value: {
        items: expect.arrayContaining([
          expect.objectContaining({
            methodId,
            supported: true,
          }),
        ]),
      },
    });
    await expect(
      execute('createPaymentLink', { methodId }),
    ).resolves.toMatchObject({
      ok: true,
      toolName: 'createPaymentLink',
      value: { orderId: session.order?.id, status: 'pending' },
    });
  });

  it('keeps an irreversible factory OMS call on its provider-owned outcome path', async () => {
    const fixtures = createTestFixtures();
    const clients = createMockClients(fixtures);
    const provider = clients.oms.placeOrder.bind(clients.oms);
    const identities: string[] = [];
    const seenContexts: Array<{ aborted: boolean; deadlineAt: number }> = [];
    let calls = 0;
    clients.oms.placeOrder = async (input, context, identity) => {
      calls += 1;
      identities.push(identity.idempotencyKey);
      await new Promise((resolve) => setTimeout(resolve, 20));
      seenContexts.push({
        aborted: context.signal.aborted,
        deadlineAt: context.deadlineAt,
      });
      return provider(input, context, identity);
    };
    const session = await createKfcToolSession(clients, 'kfc:factory_timeout');
    const canonical = createKfcOpenAiTools({ clients, session, fixtures });
    const direct = (name: string, args: Record<string, unknown>) =>
      canonical.find((tool) => tool.definition.name === name)!.execute(args);
    await direct('updateCart', { itemCode: '20751', quantity: 1 });
    await direct('quoteFulfillment', {
      method: 'delivery',
      address: {
        recipientName: 'Nguyễn An',
        phone: '0901234567',
        addressLine: '60 Phạm Văn Nghị',
        provinceCode: null,
        provinceName: 'Hồ Chí Minh',
        communeCode: null,
        communeName: 'Phường Tân Hưng',
        deliveryInstructions: null,
        rawAddress: null,
        legacyDistrictText: 'Quận 7',
      },
    });
    await direct('previewOrder', {});
    const [placeOrder] = createKfcOpenAiAgentsTools(
      canonical.filter((tool) => tool.definition.name === 'placeOrder'),
      { timeoutMs: 1 },
    );
    const context = new RunContext<KfcOpenAiAgentRunContext>({
      toolCalls: [],
      developerMessages: [],
    });
    const result = await invokeFunctionTool({
      tool: placeOrder!,
      runContext: context,
      input: '{}',
    });
    expect(result).toMatchObject({ toolName: 'placeOrder', ok: true });
    expect(calls).toBe(1);
    expect(identities[0]).toContain('kfc:factory_timeout:placeOrder:');
    expect(seenContexts).toEqual([
      { aborted: false, deadlineAt: session.externalCallContext.deadlineAt },
    ]);
    expect(session.order).toBeDefined();
    expect(context.context.toolCalls).toEqual([
      expect.objectContaining({
        name: 'placeOrder',
        result: expect.objectContaining({ ok: true }),
      }),
    ]);
  });

  it('aborts a cooperative factory read without committing late session state', async () => {
    const fixtures = createTestFixtures();
    const clients = createMockClients(fixtures);
    const originalSearch = clients.menu.searchMenu.bind(clients.menu);
    let observedAbort = false;
    let providerStarted = false;
    clients.menu.searchMenu = async (_input, context) => {
      providerStarted = true;
      await new Promise<void>((resolve) => {
        context.signal.addEventListener(
          'abort',
          () => {
            observedAbort = true;
            resolve();
          },
          { once: true },
        );
      });
      return originalSearch(_input, context);
    };
    const session = await createKfcToolSession(
      clients,
      'kfc:factory_read_timeout',
    );
    const [searchMenu] = createKfcOpenAiAgentsTools(
      createKfcOpenAiTools({ clients, session, fixtures }).filter(
        (tool) => tool.definition.name === 'searchMenu',
      ),
      { timeoutMs: 50 },
    );
    const context = new RunContext<KfcOpenAiAgentRunContext>({
      toolCalls: [],
      developerMessages: [],
    });
    const beforeSequence = session.toolCallSequence;
    const result = await invokeFunctionTool({
      tool: searchMenu!,
      runContext: context,
      input: '{"query":"gà"}',
    });
    expect(result).toMatchObject({ errorCode: 'tool_timed_out' });
    expect(providerStarted).toBe(true);
    expect(observedAbort).toBe(true);
    expect(session.toolCallSequence).toBe(beforeSequence);
    expect(context.context.toolCalls).toEqual([
      expect.objectContaining({
        name: 'searchMenu',
        result: expect.objectContaining({ errorCode: 'tool_timed_out' }),
      }),
    ]);
  });

  it('preserves the original session call context after a successful SDK read', async () => {
    const fixtures = createTestFixtures();
    const clients = createMockClients(fixtures);
    const session = await createKfcToolSession(
      clients,
      'kfc:context_preserved',
    );
    const original = session.externalCallContext;
    let previewContext: unknown;
    const preview = clients.cart.previewCart.bind(clients.cart);
    clients.cart.previewCart = async (cart, context) => {
      previewContext = context;
      return preview(cart, context);
    };
    const canonical = createKfcOpenAiTools({ clients, session, fixtures });
    const [search] = createKfcOpenAiAgentsTools(
      canonical.filter((tool) => tool.definition.name === 'searchMenu'),
      { timeoutMs: 50 },
    );
    const context = new RunContext<KfcOpenAiAgentRunContext>({
      toolCalls: [],
      developerMessages: [],
    });
    await expect(
      invokeFunctionTool({
        tool: search!,
        runContext: context,
        input: '{"query":"gà"}',
      }),
    ).resolves.toMatchObject({ ok: true });
    expect(session.externalCallContext).toBe(original);
    await canonical
      .find((tool) => tool.definition.name === 'previewCart')!
      .execute({});
    expect(previewContext).toMatchObject({ deadlineAt: original.deadlineAt });
    expect(session.externalCallContext).toBe(original);
  });
});
