import { describe, expect, it } from 'vitest';
import { RunContext, invokeFunctionTool } from '@kfc/openai-agents-runtime';
import {
  createKfcOpenAiAgentsTools,
  createKfcOpenAiTools as createKfcOpenAiToolsFactory,
  createKfcToolSession,
  hydrateKfcToolSession,
  type CreateKfcOpenAiToolsInput,
  type KfcOpenAiAgentRunContext,
  verifiedKfcToolSessionContext,
} from '../../src/agent/kfcOpenAiTools.js';
import { createMockClients } from '../../src/mock/createMockClients.js';
import { toolNames } from '../../src/ordering/toolCatalog.js';
import { controlledCustomerAccess } from '../fixtures/controlledCustomerAccess.js';
import { createTestFixtures } from '../fixtures/testFixtures.js';

function createKfcOpenAiTools(
  input: Omit<CreateKfcOpenAiToolsInput, 'fixtures'> &
    Partial<Pick<CreateKfcOpenAiToolsInput, 'fixtures'>>,
) {
  return createKfcOpenAiToolsFactory({
    ...input,
    fixtures: input.fixtures ?? createTestFixtures(),
  });
}

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
  it('exposes verified fixture categories and only the approved search filters', async () => {
    const fixtures = createTestFixtures();
    const clients = createMockClients(fixtures);
    const session = await createKfcToolSession(
      clients,
      'kfc:verified_search_contract',
    );
    const searchMenu = createKfcOpenAiTools({
      clients,
      sessionState: { current: session },
      fixtures,
    }).find((tool) => tool.definition.name === 'searchMenu')!;
    const properties = searchMenu.definition.parameters.properties;
    const category = properties.category;
    const verifiedCategories = [
      ...new Set(fixtures.menuItems.map((item) => item.category)),
    ];

    expect(category).toMatchObject({ enum: verifiedCategories });
    expect(properties).toHaveProperty('maxPriceVnd');
    expect(properties).not.toHaveProperty('minPriceVnd');
    expect(properties).not.toHaveProperty('maxPriceExclusiveVnd');
    expect(
      parameterDescription(searchMenu.definition.parameters, 'category'),
    ).toContain('Exact verified menu category value from this enum.');
  });

  it('attaches one result-based argument parser to every canonical tool', async () => {
    const fixtures = createTestFixtures();
    const clients = createMockClients(fixtures);
    const session = await createKfcToolSession(
      clients,
      'kfc:typed_tool_parsers',
    );
    const tools = createKfcOpenAiTools({
      clients,
      sessionState: { current: session },
      fixtures,
    });

    expect(tools.map((tool) => tool.definition.name)).toEqual(toolNames);
    for (const canonicalTool of tools) {
      expect(Reflect.get(canonicalTool, 'parseArguments')).toEqual(
        expect.any(Function),
      );
      expect(canonicalTool.definition).toMatchObject({
        strict: true,
        parameters: {
          type: 'object',
          properties: expect.any(Object),
          required: expect.any(Array),
          additionalProperties: false,
        },
      });
    }
  });

  it('rejects an invented category before executing the SDK search tool', async () => {
    const fixtures = createTestFixtures();
    const clients = createMockClients(fixtures);
    const session = await createKfcToolSession(
      clients,
      'kfc:invented_category',
    );
    const [searchMenu] = createKfcOpenAiAgentsTools(
      createKfcOpenAiTools({
        clients,
        sessionState: { current: session },
        fixtures,
      }).filter((tool) => tool.definition.name === 'searchMenu'),
    );
    const context = new RunContext<KfcOpenAiAgentRunContext>({
      toolCalls: [],
      developerMessages: [],
    });

    await expect(
      invokeFunctionTool({
        tool: searchMenu!,
        runContext: context,
        input: JSON.stringify({
          query: '',
          mode: 'search',
          category: 'combo meal',
        }),
      }),
    ).resolves.toMatchObject({ errorCode: 'invalid_tool_input' });
    expect(context.context.toolCalls).toEqual([
      expect.objectContaining({
        name: 'searchMenu',
        result: expect.objectContaining({
          errorCode: 'invalid_tool_input',
        }),
      }),
    ]);
  });

  it('returns a factual empty search result without agent recovery workflow', async () => {
    const fixtures = createTestFixtures();
    const clients = createMockClients(fixtures);
    const session = await createKfcToolSession(clients, 'kfc:retry_policies');
    const tools = createKfcOpenAiTools({
      clients,
      sessionState: { current: session },
      fixtures,
    });

    const emptySearch = await tools
      .find((tool) => tool.definition.name === 'searchMenu')!
      .execute({
        mode: 'search',
        query: 'definitely-not-in-the-menu',
      });
    expect(emptySearch).toMatchObject({
      ok: true,
      value: { total: 0, items: [] },
    });
    expect(emptySearch).not.toHaveProperty('recovery');
    expect(emptySearch).not.toHaveProperty('availableCategories');
  });

  it('describes searchMenu as a contract rather than a customer workflow', async () => {
    const clients = createMockClients(createTestFixtures());
    const session = await createKfcToolSession(clients, 'kfc:search_guidance');
    const searchMenu = createKfcOpenAiTools({
      clients,
      sessionState: { current: session },
    }).find((tool) => tool.definition.name === 'searchMenu');

    expect(searchMenu?.definition.description).toContain('product names');
    expect(searchMenu?.definition.description).toContain('composition');
    expect(searchMenu?.definition.description).toContain(
      'All supplied filters apply together',
    );
    expect(searchMenu?.definition.description).toContain(
      'A named-product lookup starts with the product name in query',
    );
    expect(searchMenu?.definition.description).toContain(
      'A named product with no other supplied constraint uses query as its only narrowing field',
    );
    expect(searchMenu?.definition.description).toContain(
      'A product-plus-options lookup keeps product terms in query and selectable terms in modifierQueries',
    );
    expect(searchMenu?.definition.description).toContain(
      'Browse one category with its exact category value and an empty query',
    );
    expect(searchMenu?.definition.description).toContain(
      'Reserve query for distinct additional product-text constraints',
    );
    expect(searchMenu?.definition.description).toContain(
      'options that should be selected or whose configurability must be verified',
    );
    expect(searchMenu?.definition.description).toContain(
      'An omitted add-on does not itself require that add-on to exist',
    );
    expect(searchMenu?.definition.description).toContain(
      'Example: “product with selectable option A, leaving add-on B unselected”',
    );
    expect(searchMenu?.definition.description).toContain(
      'query: “product”, modifierQueries: [“option A”]',
    );
    expect(searchMenu?.definition.description).toContain(
      '“add one Named Product” uses query: “Named Product”',
    );
    expect(searchMenu?.definition.description).toContain('query may be empty');
    expect(searchMenu?.definition.description).toContain('exact value');
    expect(searchMenu?.definition.description).toContain('category enum');
    expect(searchMenu?.definition.description).toContain('selectable options');
    expect(searchMenu?.definition.description).toContain(
      'per-item price ceiling',
    );
    expect(searchMenu?.definition.description).toContain('ranking evidence');
    expect(searchMenu?.definition.description).toContain('complete available');
    expect(searchMenu?.definition.description).toContain('verified fixture');
    expect(searchMenu?.definition.description).toContain(
      'zero total describes the supplied filter scope',
    );
    expect(searchMenu?.definition.description).toContain(
      'modifierQueries form an intersection on one item',
    );
    expect(searchMenu?.definition.description).not.toMatch(/\bdo not\b/iu);
    expect(searchMenu?.definition.description).not.toContain('same user turn');
    expect(searchMenu?.definition.description).not.toContain('call updateCart');
    expect(searchMenu?.definition.description).not.toContain('customer asks');
    expect(searchMenu?.definition.description).not.toContain('retry');
    expect(searchMenu?.definition.parameters.properties).toHaveProperty(
      'modifierQueries',
    );
  });

  it('separates product composition, selectable modifiers, and aggregate recommendation constraints', async () => {
    const clients = createMockClients(createTestFixtures());
    const session = await createKfcToolSession(clients, 'kfc:search_semantics');
    const tools = createKfcOpenAiTools({
      clients,
      sessionState: { current: session },
    });
    const searchMenu = tools.find(
      (tool) => tool.definition.name === 'searchMenu',
    );
    const propertyDescription = (propertyName: string) =>
      searchMenu
        ? parameterDescription(searchMenu.definition.parameters, propertyName)
        : undefined;

    expect(propertyDescription('query')).toContain('composition');
    expect(propertyDescription('query')).toContain(
      'Leave empty for category-wide browsing',
    );
    expect(propertyDescription('query')).toContain(
      'For a named product lookup, use the verified or customer-supplied product name',
    );
    expect(propertyDescription('query')).toContain(
      'Omit generic intent nouns that are not product facts',
    );
    expect(propertyDescription('category')).toContain(
      'All supplied fields form one intersection',
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
    expect(propertyDescription('modifierQueries')).toContain(
      'Every entry must match the same item',
    );
    expect(propertyDescription('modifierQueries')).toContain(
      'selected or verified as configurable',
    );
    expect(propertyDescription('modifierQueries')).toContain(
      'leave an add-on unselected',
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
    const tools = createKfcOpenAiTools({
      clients,
      sessionState: { current: session },
    });
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

    expect(updateCart?.definition.description).toContain(
      'absolute requested quantity',
    );
    expect(updateCart?.definition.description).toContain(
      'Items not listed remain unchanged',
    );
    expect(updateCart?.definition.description).toContain('reversible');
    expect(updateCart?.definition.description).toContain('quantity 0');
    expect(updateCart?.definition.description).toContain(
      'authoritative current cart',
    );
    expect(updateCart?.definition.description).not.toContain('customer');
    expect(updateCart?.definition.description).not.toContain('plan');
    expect(updateCart?.definition.description).not.toContain('confirmation');
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
    const sessionState = { current: session };
    const updateCart = createKfcOpenAiTools({ clients, sessionState }).find(
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
    expect(sessionState.current.cart.items[0]?.description).toBe(
      '3 Miếng Gà Rán + 1 Burger Tôm',
    );
  });

  it('sets only listed quantities atomically and removes an item with quantity zero', async () => {
    const fixtures = createTestFixtures();
    fixtures.menuItems.push({
      ...fixtures.menuItems[0]!,
      code: '20752',
      itemId: '20752',
      posItemId: '20752',
      productCode: 'SECOND',
      name: 'Combo thứ hai',
      description: 'Món fixture thứ hai',
    });
    const clients = createMockClients(fixtures);
    const session = await createKfcToolSession(
      clients,
      'kfc:model_facing_cart_changes',
    );
    const sessionState = { current: session };
    const updateCart = createKfcOpenAiTools({ clients, sessionState }).find(
      (tool) => tool.definition.name === 'updateCart',
    )!;

    expect(updateCart.definition.parameters).toMatchObject({
      required: ['changes'],
    });
    expect(updateCart.definition.parameters).not.toHaveProperty(
      'properties.mode',
    );

    await updateCart.execute({
      changes: [
        {
          itemCode: '20751',
          orderedMenuItemQuantity: 1,
          modifiers: [],
        },
      ],
    });
    await updateCart.execute({
      changes: [
        {
          itemCode: '20752',
          orderedMenuItemQuantity: 1,
          modifiers: [],
        },
      ],
    });
    expect(
      sessionState.current.cart.items.map(({ itemCode }) => itemCode),
    ).toEqual(['20751', '20752']);

    const updated = await updateCart.execute({
      changes: [
        {
          itemCode: '20751',
          orderedMenuItemQuantity: 0,
          modifiers: [],
        },
        {
          itemCode: '20752',
          orderedMenuItemQuantity: 2,
          modifiers: [],
        },
      ],
    });

    expect(updated).toMatchObject({
      ok: true,
      value: {
        items: [{ itemCode: '20752', quantity: 2 }],
      },
    });
    expect(sessionState.current.cart.items).toEqual([
      expect.objectContaining({ itemCode: '20752', quantity: 2 }),
    ]);
  });

  it('publishes a new immutable session value after a successful tool result', async () => {
    const clients = createMockClients(createTestFixtures());
    const initialSession = await createKfcToolSession(
      clients,
      'kfc:immutable_tool_session',
    );
    const sessionState = { current: initialSession };
    const updateCart = createKfcOpenAiTools({
      clients,
      sessionState,
    }).find((tool) => tool.definition.name === 'updateCart')!;

    await expect(
      updateCart.execute({
        changes: [
          {
            itemCode: '20751',
            orderedMenuItemQuantity: 1,
            modifiers: [],
          },
        ],
      }),
    ).resolves.toMatchObject({ ok: true, toolName: 'updateCart' });

    expect(sessionState.current).not.toBe(initialSession);
    expect(initialSession.cart.items).toEqual([]);
    expect(sessionState.current.cart.items).toEqual([
      expect.objectContaining({ itemCode: '20751', quantity: 1 }),
    ]);
  });

  it('scopes every returned modifier fact to its exact option and branch', async () => {
    const clients = createMockClients(createTestFixtures());
    const session = await createKfcToolSession(
      clients,
      'kfc:modifier_fact_scope',
    );
    const getModifierOptions = createKfcOpenAiTools({
      clients,
      sessionState: { current: session },
    }).find((tool) => tool.definition.name === 'getModifierOptions');

    expect(getModifierOptions?.definition.description).toContain(
      'exact option and branch',
    );
    expect(getModifierOptions?.definition.description).toContain(
      'do not transfer',
    );
    expect(getModifierOptions?.definition.description).toContain('unknown');
  });

  it('makes availability, serviceability, and modifier-price evidence boundaries explicit', async () => {
    const clients = createMockClients(createTestFixtures());
    const session = await createKfcToolSession(
      clients,
      'kfc:evidence_boundaries',
    );
    const tools = createKfcOpenAiTools({
      clients,
      sessionState: { current: session },
    });
    const description = (name: string) =>
      tools.find((tool) => tool.definition.name === name)?.definition
        .description;

    expect(description('searchMenu')).toContain(
      'available reports whether the item can currently be ordered',
    );
    expect(description('getItemDetails')).toContain('current availability');
    expect(description('getModifierOptions')).toContain('priceDeltaVnd');
    expect(description('getModifierOptions')).toContain(
      'do not infer a modifier price',
    );
    expect(description('findStores')).toContain(
      'do not verify delivery coverage',
    );
    expect(description('quoteFulfillment')?.toLowerCase()).toContain(
      'only a successful quoted result verifies serviceability',
    );
  });

  it('keeps factual evidence limitations beside the tools that need them', async () => {
    const clients = createMockClients(createTestFixtures());
    const session = await createKfcToolSession(
      clients,
      'kfc:tool_local_guidance',
    );
    const tools = createKfcOpenAiTools({
      clients,
      sessionState: { current: session },
    });
    const description = (name: string) =>
      tools.find((tool) => tool.definition.name === name)?.definition
        .description ?? '';

    expect(description('recommendAddOns')).toContain('current cart');
    expect(description('checkStoreAvailability')).toContain('exact store');
    expect(description('checkStoreAvailability')).toContain(
      'does not verify delivery fee or ETA',
    );
    expect(description('searchPromotions')).toContain('current');
    expect(description('searchPromotions')).toContain(
      'supplied query returned no matches',
    );
    expect(description('quoteFulfillment')).toContain(
      'does not place an order',
    );
    expect(description('getOrderStatus')).toContain('current order');
    expect(description('getOrderStatus')).toContain(
      'only fields returned by this call',
    );
    expect(description('collectInvoice')).toContain('supplied invoice fields');
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
    const tools = createKfcOpenAiTools({
      clients,
      sessionState: { current: session },
    });
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
    const sessionState = { current: session };
    const tools = createKfcOpenAiTools({
      clients,
      sessionState,
      fixtures,
    });

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
      changes: [{ itemCode: '20751', orderedMenuItemQuantity: 2 }],
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
    expect(verifiedKfcToolSessionContext(sessionState.current)).toMatchObject({
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
    const sessionState = { current: session };
    const tools = createKfcOpenAiTools({ clients, sessionState });
    const updateCart = tools.find(
      (tool) => tool.definition.name === 'updateCart',
    );
    const validateVoucher = tools.find(
      (tool) => tool.definition.name === 'validateVoucher',
    );

    await updateCart!.execute({
      changes: [{ itemCode: '20751', orderedMenuItemQuantity: 2 }],
    });
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
    expect(sessionState.current.cart).toMatchObject({
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
      sessionState: { current: session },
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
    const sessionState = { current: session };
    const tools = createKfcOpenAiTools({
      clients,
      sessionState,
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
      'completed result',
    );
    expect(redeemReward!.definition.description).toContain('completed result');
    expect(verifiedKfcToolSessionContext(sessionState.current)).toMatchObject({
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
      ok: false,
      toolName: 'acquireVoucher',
      errorCode: 'membership_points_insufficient',
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
    const sessionState = { current: session };
    const handoff = createKfcOpenAiTools({
      clients,
      sessionState,
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
      value: { escalationId: sessionState.current.handoff?.escalationId },
    });
    expect(sessionState.current.handoff).toEqual({
      escalationId: expect.any(String),
      reasons: ['abnormal_large_order'],
    });
    expect(verifiedKfcToolSessionContext(sessionState.current)).toMatchObject({
      humanSupport: {
        status: 'queued',
        description: 'awaiting a human operator',
      },
    });
    expect(
      verifiedKfcToolSessionContext(sessionState.current),
    ).not.toHaveProperty('humanSupport.escalationId');

    const hydrated = hydrateKfcToolSession(
      await createKfcToolSession(clients, 'kfc:hydrated_handoff'),
      { handoff: sessionState.current.handoff },
    );
    expect(hydrated.handoff).toEqual(sessionState.current.handoff);
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
    const sessionState = { current: session };
    const tools = createKfcOpenAiTools({
      clients,
      sessionState,
      fixtures,
      accessContext: controlledCustomerAccess({
        sessionId: session.sessionId,
        customerId: session.customerId,
      }),
    });
    const execute = (name: string, arguments_: Record<string, unknown>) =>
      tools.find((tool) => tool.definition.name === name)!.execute(arguments_);

    await execute('updateCart', {
      changes: [{ itemCode: '20751', orderedMenuItemQuantity: 1 }],
    });
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
      value: { id: sessionState.current.order?.id },
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
      value: { orderId: sessionState.current.order?.id, status: 'pending' },
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
    const sessionState = { current: session };
    const canonical = createKfcOpenAiTools({
      clients,
      sessionState,
      fixtures,
    });
    const direct = (name: string, args: Record<string, unknown>) =>
      canonical.find((tool) => tool.definition.name === name)!.execute(args);
    await direct('updateCart', {
      changes: [{ itemCode: '20751', orderedMenuItemQuantity: 1 }],
    });
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
    expect(sessionState.current.order).toBeDefined();
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
    const sessionState = { current: session };
    const [searchMenu] = createKfcOpenAiAgentsTools(
      createKfcOpenAiTools({
        clients,
        sessionState,
        fixtures,
      }).filter((tool) => tool.definition.name === 'searchMenu'),
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
    expect(sessionState.current).toBe(session);
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
    const canonical = createKfcOpenAiTools({
      clients,
      sessionState: { current: session },
      fixtures,
    });
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
