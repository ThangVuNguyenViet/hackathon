import type { CartChange, ExternalClients, MessengerClient, ZaloClient } from '../clients/interfaces.js';
import type { Address, Cart, CartItem, MenuItem, Order, ToolResult } from '../domain/types.js';
import type { GeneratedFixtures } from '../fixtures/schema.js';
import { OrderingDataService } from '../ordering/orderingDataService.js';
import type { FulfillmentMethod, SelectedModifier } from '../ordering/types.js';
import type { MockedUpstreamApiProfile } from './mockedUpstreamProfile.js';
export type { MockedUpstreamApiProfile } from './mockedUpstreamProfile.js';

const mockProviderProvenance = [{
  fixtureMode: 'provider_runtime' as const,
  sourceFile: 'src/mock/createMockClients.ts',
  sourceApi: 'mock-commerce-provider',
}];

function ok<T>(value: T, message = 'ok'): ToolResult<T> {
  return { ok: true, value, message, provenance: mockProviderProvenance };
}

function fail<T>(errorCode: string, message: string): ToolResult<T> {
  return { ok: false, errorCode, message, provenance: mockProviderProvenance };
}

function withMockProvenance<T>(result: ToolResult<T>): ToolResult<T> {
  return { ...result, provenance: result.provenance?.length ? result.provenance : mockProviderProvenance };
}

function toMenuItem(item: MenuItem): MenuItem {
  return {
    code: item.code,
    itemId: item.itemId,
    productCode: item.productCode,
    category: item.category,
    name: item.name,
    description: item.description,
    priceVnd: item.priceVnd,
    originalPriceVnd: item.originalPriceVnd,
    imageUrl: item.imageUrl,
    available: item.available,
    isCustomize: item.isCustomize,
    isQuickCombo: item.isQuickCombo,
    hasModifiers: item.hasModifiers,
    modifierGroups: item.modifierGroups,
  };
}

function priceCart(items: CartItem[], voucherCode: string | null, deliveryFeeVnd = 0, discountVnd = 0): Cart {
  const subtotalVnd = items.reduce((sum, item) => sum + item.quantity * item.unitPriceVnd, 0);
  return {
    id: 'cart_mock',
    items,
    subtotalVnd,
    discountVnd,
    deliveryFeeVnd,
    totalVnd: Math.max(0, subtotalVnd - discountVnd + deliveryFeeVnd),
    voucherCode,
  };
}

function priceItem(basePriceVnd: number, modifiers?: SelectedModifier[]): number {
  return basePriceVnd + (modifiers?.reduce((sum, modifier) => sum + modifier.priceDeltaVnd * modifier.quantity, 0) ?? 0);
}

function normalizeLocationPart(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/đ/g, 'd')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface MockClientOptions {
  channelClients?: {
    messenger: MessengerClient;
    zalo: ZaloClient;
  };
  initialOrders?: Order[];
  savedAddressesProvider?: (
    customerId: string,
  ) => Promise<ToolResult<Address[]>> | ToolResult<Address[]>;
  recentOrderProvider?: (customerId: string) => Promise<ToolResult<Order | null>> | ToolResult<Order | null>;
  favoriteItemsProvider?: (customerId: string) => Promise<ToolResult<MenuItem[]>> | ToolResult<MenuItem[]>;
  orderStatusProvider?: (orderId: string) => Promise<ToolResult<Order>> | ToolResult<Order>;
  paymentStatusProvider?: (
    orderId: string,
  ) => Promise<ToolResult<{ status: 'pending' | 'paid' | 'failed' }>> | ToolResult<{ status: 'pending' | 'paid' | 'failed' }>;
  fulfillmentQuoteProvider?: (
    input: {
      address: Address;
      method: FulfillmentMethod;
      itemCodes: string[];
      storeId: string;
      storeName: string;
    },
  ) => Promise<ToolResult<{ feeVnd: number; etaMinutes: number }>> | ToolResult<{ feeVnd: number; etaMinutes: number }>;
  mockedUpstreamApiProvider?: () => MockedUpstreamApiProfile | undefined;
}

export function createMockClients(fixtures: GeneratedFixtures, options: MockClientOptions = {}): ExternalClients {
  const data = new OrderingDataService(fixtures);
  let handoffSequence = 0;
  const menuByCode = new Map(fixtures.menuItems.map((item) => [item.code, toMenuItem(item)]));
  const storeById = new Map(fixtures.stores.map((store) => [store.storeId, store]));
  const orders = new Map<string, Order>();
  const fulfillmentQuoteByStoreAndMethod = new Map(
    fixtures.fulfillmentQuotes.map((quote) => [`${quote.storeId}:${quote.method}`, quote]),
  );
  for (const order of options.initialOrders ?? []) {
    orders.set(order.id, order);
  }
  const currentMockedUpstreamProfile = (): MockedUpstreamApiProfile | undefined =>
    options.mockedUpstreamApiProvider?.();
  const catalogRevision = `fixture:${JSON.stringify(fixtures.menuItems.map((item) => [item.code, item.priceVnd, item.available]))}`;
  const providerRevision = (): string => `mock:${JSON.stringify(currentMockedUpstreamProfile() ?? {})}`;
  const currentUnavailableItemCodes = (): Set<string> =>
    new Set(currentMockedUpstreamProfile()?.unavailableItemCodes ?? []);
  const applyCurrentMenuAvailability = <T extends MenuItem>(item: T): T =>
    currentUnavailableItemCodes().has(item.code)
      ? { ...item, available: false }
      : item;
  const channelClients = options.channelClients ?? {
    messenger: {
      async sendText() {
        return fail('channel_client_not_configured', 'Messenger delivery must be provided by a live channel client');
      },
      async sendSenderAction() {
        return fail('channel_client_not_configured', 'Messenger delivery must be provided by a live channel client');
      },
      async getProfile() {
        return fail('channel_client_not_configured', 'Messenger profile lookup must be provided by a live channel client');
      },
    },
    zalo: {
      async sendText() {
        return fail('channel_client_not_configured', 'Zalo delivery must be provided by a live channel client');
      },
      async getProfile() {
        return fail('channel_client_not_configured', 'Zalo profile lookup must be provided by a live channel client');
      },
    },
  };
  const repriceCart = (items: CartItem[], voucherCode: string | null, deliveryFeeVnd = 0): Cart => {
    const subtotalVnd = items.reduce((sum, item) => sum + item.quantity * item.unitPriceVnd, 0);
    if (!voucherCode) return priceCart(items, null, deliveryFeeVnd, 0);

    const validation = data.validateVoucherInput({ inputCodeOrText: voucherCode, subtotalVnd });
    if (!validation.ok) return priceCart(items, null, deliveryFeeVnd, 0);
    return priceCart(items, validation.publicCode, deliveryFeeVnd, validation.discountVnd);
  };
  const resolveModifiers = (change: CartChange): ToolResult<SelectedModifier[]> => {
    if (!change.modifiers?.length) return ok([]);
    const tree = data.getModifierTree(change.itemCode);
    if (!tree) return fail('modifiers_not_found', `No modifier tree found for ${change.itemCode}`);

    type ModifierGroup = (typeof tree.modifierGroups)[number];
    type ParentSelection = { groupId: string; modifierId: string };
    const indexedGroups = new Map<string, { group: ModifierGroup; parent?: ParentSelection }>();
    const visitGroups = (groups: ModifierGroup[], parent?: ParentSelection): void => {
      for (const group of groups) {
        indexedGroups.set(group.groupId, { group, parent });
        for (const option of group.options) {
          visitGroups(option.modifierGroups, { groupId: group.groupId, modifierId: option.modifierId });
        }
      }
    };
    visitGroups(tree.modifierGroups);

    type RequestedModifier = NonNullable<CartChange['modifiers']>[number];
    const resolved: SelectedModifier[] = [];
    const resolvedByKey = new Map<string, SelectedModifier>();
    const explicitKeys = new Set<string>();
    let resolutionFailure: ToolResult<SelectedModifier[]> | undefined;

    const resolveSelection = (
      groupId: string,
      modifierId: string,
      requested?: RequestedModifier,
    ): boolean => {
      const indexed = indexedGroups.get(groupId);
      const group = indexed?.group;
      const option = group?.options.find((candidate) => candidate.modifierId === modifierId);
      if (!group || !option) {
        resolutionFailure = fail('invalid_modifier', `Modifier ${modifierId} is not verified for ${change.itemCode}`);
        return false;
      }
      if (
        (requested?.groupName !== undefined && requested.groupName !== group.name) ||
        (requested?.modifierName !== undefined && requested.modifierName !== option.name) ||
        (requested?.priceDeltaVnd !== undefined && requested.priceDeltaVnd !== option.priceDeltaVnd)
      ) {
        resolutionFailure = fail('invalid_modifier_evidence', `Modifier evidence does not match ${modifierId}`);
        return false;
      }

      const selectionKey = `${group.groupId}:${option.modifierId}`;
      if (requested && explicitKeys.has(selectionKey)) {
        resolutionFailure = fail('duplicate_modifier', `Modifier ${modifierId} was selected more than once`);
        return false;
      }
      if (requested) explicitKeys.add(selectionKey);

      if (indexed.parent && !resolveSelection(indexed.parent.groupId, indexed.parent.modifierId)) {
        return false;
      }

      const fixtureQuantity = typeof option.quantity === 'number' && option.quantity > 0
        ? option.quantity
        : undefined;
      const fixedGroupQuantity =
        typeof group.min === 'number' &&
        group.min > 0 &&
        group.min === group.max
          ? group.min
          : undefined;
      const quantity = requested?.quantity ?? fixtureQuantity ?? fixedGroupQuantity;
      if (!quantity || !Number.isInteger(quantity) || quantity <= 0) {
        resolutionFailure = fail('invalid_modifier_quantity', `Modifier quantity is required for ${modifierId}`);
        return false;
      }

      const existing = resolvedByKey.get(selectionKey);
      if (existing) {
        if (requested?.quantity !== undefined && requested.quantity !== existing.quantity) {
          resolutionFailure = fail('invalid_modifier_quantity', `Modifier quantity conflicts for ${modifierId}`);
          return false;
        }
        return true;
      }

      const conflictingSelection = resolved.find((selection) =>
        selection.groupId === group.groupId && selection.modifierId !== option.modifierId,
      );
      if (conflictingSelection && group.max === 1) {
        resolutionFailure = fail('modifier_parent_conflict', `Modifier group ${group.groupId} has conflicting selections`);
        return false;
      }

      const selection: SelectedModifier = {
        groupId: group.groupId,
        groupName: group.name,
        modifierId: option.modifierId,
        modifierName: option.name,
        quantity,
        priceDeltaVnd: option.priceDeltaVnd,
      };
      resolved.push(selection);
      resolvedByKey.set(selectionKey, selection);
      return true;
    };

    for (const modifier of change.modifiers) {
      if (!resolveSelection(modifier.groupId, modifier.modifierId, modifier)) {
        return resolutionFailure ?? fail('invalid_modifier', `Modifier ${modifier.modifierId} could not be resolved`);
      }
    }

    const selectedKeys = new Set(resolvedByKey.keys());
    const selectedByGroup = new Map<string, SelectedModifier[]>();
    for (const modifier of resolved) {
      const groupSelections = selectedByGroup.get(modifier.groupId) ?? [];
      groupSelections.push(modifier);
      selectedByGroup.set(modifier.groupId, groupSelections);
    }
    for (const [groupId, selections] of selectedByGroup) {
      const indexed = indexedGroups.get(groupId)!;
      const selectedQuantity = selections.reduce((sum, selection) => sum + selection.quantity, 0);
      if (typeof indexed.group.min === 'number' && selectedQuantity < indexed.group.min) {
        return fail('modifier_min_not_met', `Modifier group ${groupId} requires at least ${indexed.group.min}`);
      }
      if (typeof indexed.group.max === 'number' && selectedQuantity > indexed.group.max) {
        return fail('modifier_max_exceeded', `Modifier group ${groupId} allows at most ${indexed.group.max}`);
      }
      if (indexed.parent && !selectedKeys.has(`${indexed.parent.groupId}:${indexed.parent.modifierId}`)) {
        return fail('modifier_parent_missing', `Nested modifier group ${groupId} requires its verified parent selection`);
      }
    }
    return ok(resolved);
  };
  const applyCartChanges = async (cart: Cart, changes: CartChange[]): Promise<ToolResult<Cart>> => {
    const unavailableItemCodes = currentUnavailableItemCodes();
    const unavailableAddition = changes.find(
      (change) => change.quantity > 0 && unavailableItemCodes.has(change.itemCode),
    );
    if (unavailableAddition) {
      return fail('item_unavailable', `Item ${unavailableAddition.itemCode} is unavailable in the current mocked upstream API response`);
    }

    const resolvedModifiersByChange = new Map<CartChange, SelectedModifier[]>();
    for (const change of changes) {
      if (!Number.isInteger(change.quantity) || change.quantity < 0) {
        return fail('invalid_quantity', `Invalid quantity for ${change.itemCode}`);
      }
      const item = menuByCode.get(change.itemCode);
      if (!item) return fail('item_not_found', `No menu item found for ${change.itemCode}`);
      if (!item.available) return fail('item_unavailable', `${item.name} is unavailable`);
      const modifierResolution = resolveModifiers(change);
      if (!modifierResolution.ok) {
        return fail(modifierResolution.errorCode ?? 'invalid_modifier', modifierResolution.message);
      }
      resolvedModifiersByChange.set(change, modifierResolution.value ?? []);
    }

    let nextItems = [...cart.items];
    for (const change of changes) {
      const item = menuByCode.get(change.itemCode)!;
      const modifiers = resolvedModifiersByChange.get(change) ?? [];
      nextItems = nextItems.filter((cartItem) => cartItem.itemCode !== change.itemCode);
      if (change.quantity > 0) {
        nextItems.push({
          itemCode: change.itemCode,
          name: item.name,
          quantity: change.quantity,
          unitPriceVnd: priceItem(item.priceVnd, modifiers),
          ...(modifiers.length ? { modifiers } : {}),
          imageUrl: item.imageUrl,
          category: item.category,
        });
      }
    }
    return ok({ ...repriceCart(nextItems, cart.voucherCode, cart.deliveryFeeVnd), id: cart.id });
  };
  const resolveStore = (address: Address, itemCodes: string[] = [], method: FulfillmentMethod = 'delivery') => {
    const exactMatches = data.searchStores({
      query: [address.line1, address.district, address.city].filter(Boolean).join(' '),
    });
    const normalizedLine1 = normalizeLocationPart(address.line1);
    const rankedExactMatches = exactMatches
      .map((store) => {
        const normalizedName = normalizeLocationPart(store.name.replace(/^KFC\s+/i, ''));
        const normalizedAddress = normalizeLocationPart(store.address);
        const score = normalizedName === normalizedLine1
          ? 4
          : normalizedName.includes(normalizedLine1)
            ? 3
            : normalizedAddress.includes(normalizedLine1)
              ? 2
              : 1;
        return { store, score };
      })
      .sort((left, right) => right.score - left.score);
    const uniquelyRankedStore = rankedExactMatches.length > 0 && (
      rankedExactMatches.length === 1 || rankedExactMatches[0]!.score > rankedExactMatches[1]!.score
    )
      ? rankedExactMatches[0]!.store
      : undefined;
    const serviceAreaMatches = fixtures.fulfillmentServiceAreas.filter((area) =>
      area.method === method &&
      area.districts.some((district) => normalizeLocationPart(district) === normalizeLocationPart(address.district)) &&
      area.cities.some((city) => normalizeLocationPart(city) === normalizeLocationPart(address.city)),
    );
    const serviceAreaStore = serviceAreaMatches.length === 1
      ? storeById.get(serviceAreaMatches[0]!.storeId)
      : undefined;
    const candidates = uniquelyRankedStore
      ? [uniquelyRankedStore]
      : serviceAreaStore
        ? [serviceAreaStore]
        : [];
    const matched = candidates[0];
    if (!matched) return undefined;
    if (itemCodes.length === 0) return matched;
    return data.checkItemsAvailable({
      storeId: matched.storeId,
      disposition: method === 'pickup' ? 'pickup' : 'delivery',
      itemIds: itemCodes,
    }).ok
      ? matched
      : undefined;
  };

  return {
    confirmationAuthority: {
      environment: 'sandbox',
      scenarioId: 'mock-commerce',
      catalogObservationId: catalogRevision,
      catalogObservationHash: catalogRevision,
      providerRevision: providerRevision(),
      async revalidate(binding) {
        return binding.environment === 'sandbox' &&
          binding.scenarioId === 'mock-commerce' &&
          binding.catalogObservationId === catalogRevision &&
          binding.catalogObservationHash === catalogRevision &&
          binding.providerRevision === providerRevision()
          ? { ok: true }
          : { ok: false, reason: 'Mock commerce binding changed' };
      },
    },
    menu: {
      async getPlanningContext(input) {
        try {
          const context = data.getMenuPlanningContext(input);
          const unavailableItemCodes = currentUnavailableItemCodes();
          return ok({
            ...context,
            candidates: context.candidates.map((candidate) =>
              unavailableItemCodes.has(candidate.code)
                ? {
                    ...candidate,
                    available: false,
                    ...(candidate.fulfillmentAvailability
                      ? {
                          fulfillmentAvailability: {
                            ...candidate.fulfillmentAvailability,
                            available: false,
                            reason: 'excluded' as const,
                          },
                        }
                      : {}),
                  }
                : candidate,
            ),
          });
        } catch (error) {
          return fail(
            'invalid_menu_planning_context',
            error instanceof Error ? error.message : 'Menu planning context could not be built',
          );
        }
      },
      async searchMenu(query) {
        return ok(data.searchMenu(query).map(toMenuItem).map(applyCurrentMenuAvailability));
      },
      async getItemDetails(code) {
        const item = data.getMenuItem(code);
        return item ? ok(applyCurrentMenuAvailability(toMenuItem(item))) : fail('item_not_found', `No menu item found for ${code}`);
      },
      async getModifierOptions(code) {
        const tree = data.getModifierTree(code);
        return tree ? ok(tree) : fail('modifiers_not_found', `No modifier tree found for ${code}`);
      },
    },
    cart: {
      async createCart(sessionId) {
        return ok({
          id: `cart_${sessionId}`,
          items: [],
          subtotalVnd: 0,
          discountVnd: 0,
          deliveryFeeVnd: 0,
          totalVnd: 0,
          voucherCode: null,
        });
      },
      applyChanges: applyCartChanges,
      async updateCart(cart, itemCode, quantity, modifiers) {
        return applyCartChanges(cart, [{ itemCode, quantity, modifiers }]);
      },
      async previewCart(cart) {
        return ok({ ...repriceCart(cart.items, cart.voucherCode, cart.deliveryFeeVnd), id: cart.id });
      },
    },
    recommendation: {
      async recommendAddOns() {
        return ok(data.recommendAddOns().map(toMenuItem));
      },
      async recommendEquivalentCombo(cart) {
        return ok(data.recommendEquivalentCombo(
          cart.items.map((item) => ({ itemCode: item.itemCode, quantity: item.quantity })),
        ) ?? null);
      },
    },
    promotion: {
      async searchPromotions(query) {
        return ok(data.searchPromotionOffers({ query }));
      },
      async explainPromotion(offerId) {
        const offer = data.explainPromotion(offerId);
        return offer ? ok(offer) : fail('promotion_not_found', `No promotion found for ${offerId}`);
      },
      async validateVoucher(cart, voucherCode) {
        const validation = data.validateVoucherInput({ inputCodeOrText: voucherCode, subtotalVnd: cart.subtotalVnd });
        if (!validation.ok) return fail(validation.reason, 'Voucher could not be validated from public fixture data');
        return ok(
          { ...priceCart(cart.items, validation.publicCode, cart.deliveryFeeVnd, validation.discountVnd), id: cart.id },
          'voucher_applied',
        );
      },
      async validateVoucherInput(cart, inputCodeOrText) {
        return ok(data.validateVoucherInput({ inputCodeOrText, subtotalVnd: cart.subtotalVnd }));
      },
    },
    membership: {
      async getProfile() {
        const profile = data.getMembershipProfile();
        return profile ? ok(profile) : fail('membership_profile_not_found', 'No membership profile snapshot fixture is available');
      },
      async listRewards(input) {
        return ok(data.listMembershipRewards(input.query));
      },
      async listWallet(input) {
        return ok(data.listMembershipWallet(input.status));
      },
      async getPointHistory(input) {
        const history = data.getMembershipPointHistory(input.days);
        return history ? ok(history) : fail('membership_point_history_not_found', 'No membership point history fixture is available');
      },
      async listTools(input) {
        return ok(data.listMembershipTools(input.sideEffect));
      },
      async acquireVoucher(input) {
        if (!input.confirmed) {
          const preview = data.acquireMembershipVoucher(input);
          return preview
            ? fail('confirmation_required', preview.message)
            : fail('membership_reward_not_found', `No membership reward found for ${input.rewardId}`);
        }
        const result = data.acquireMembershipVoucher(input);
        return result ? ok(result, 'voucher_acquired') : fail('membership_reward_not_found', `No membership reward found for ${input.rewardId}`);
      },
      async redeemReward(input) {
        if (!input.confirmed) {
          const preview = data.redeemMembershipReward(input);
          return preview
            ? fail('confirmation_required', preview.message)
            : fail('membership_voucher_not_found', `No membership voucher found for ${input.voucherId}`);
        }
        const result = data.redeemMembershipReward(input);
        return result ? ok(result, 'reward_redeemed') : fail('membership_voucher_not_found', `No membership voucher found for ${input.voucherId}`);
      },
    },
    inventory: {
      async checkInventory(storeId, itemCodes, disposition) {
        const unavailableItemCodes = currentUnavailableItemCodes();
        if (disposition) {
          const availability = data.checkItemsAvailable({ storeId, disposition, itemIds: itemCodes });
          const unavailable = new Set([
            ...availability.unavailableItemIds,
            ...availability.blockedTimeslotItemIds,
            ...unavailableItemCodes,
          ]);
          return ok(Object.fromEntries(itemCodes.map((code) => [code, !unavailable.has(code)])));
        }

        const pickup = data.checkItemsAvailable({ storeId, disposition: 'pickup', itemIds: itemCodes });
        const delivery = data.checkItemsAvailable({ storeId, disposition: 'delivery', itemIds: itemCodes });
        const unavailable = new Set([
          ...pickup.unavailableItemIds,
          ...pickup.blockedTimeslotItemIds,
          ...delivery.unavailableItemIds,
          ...delivery.blockedTimeslotItemIds,
          ...unavailableItemCodes,
        ]);
        return ok(Object.fromEntries(itemCodes.map((code) => [code, !unavailable.has(code)])));
      },
    },
    storeLocator: {
      async assignStore(address: Address, _itemCodes: string[]) {
        const store = resolveStore(address, _itemCodes, 'delivery');
        if (!store) return fail('store_not_found', 'No store matched the requested fulfillment address');
        return ok({ storeId: store.storeId });
      },
      async findStores(input) {
        return ok(
          data.searchStores(input).map((store) => ({
            storeId: store.storeId,
            name: store.name,
            address: store.address,
            city: store.city,
          })),
        );
      },
    },
    fulfillment: {
      async getPlanningContext(input) {
        try {
          return ok(data.getFulfillmentPlanningContext(input));
        } catch (error) {
          return fail(
            'invalid_fulfillment_planning_context',
            error instanceof Error ? error.message : 'Fulfillment planning context could not be built',
          );
        }
      },
      async quoteFulfillment(input) {
        const store = resolveStore(input.address, [], input.method);
        if (!store) return fail('store_not_found', 'No store matched the requested fulfillment address');
        const mockedProfile = currentMockedUpstreamProfile();
        const mockedUnavailableItemCodes = new Set(mockedProfile?.unavailableItemCodes ?? []);
        if (input.itemCodes.some((itemCode) => mockedUnavailableItemCodes.has(itemCode))) {
          return fail('items_unavailable', 'One or more items are unavailable in the current mocked upstream API response');
        }
        const availability = data.checkItemsAvailable({
          storeId: store.storeId,
          disposition: input.method === 'pickup' ? 'pickup' : 'delivery',
          itemIds: input.itemCodes,
        });
        if (!availability.ok) return fail('items_unavailable', 'One or more items are unavailable for this store/disposition');
        const mockedQuote =
          typeof mockedProfile?.deliveryFeeVnd === 'number' &&
          Number.isInteger(mockedProfile.deliveryFeeVnd) &&
          mockedProfile.deliveryFeeVnd >= 0 &&
          typeof mockedProfile.deliveryEtaMinutes === 'number' &&
          Number.isInteger(mockedProfile.deliveryEtaMinutes) &&
          mockedProfile.deliveryEtaMinutes > 0
            ? ok(
                {
                  feeVnd: mockedProfile.deliveryFeeVnd,
                  etaMinutes: mockedProfile.deliveryEtaMinutes,
                },
                'mocked_upstream_api_quote',
              )
            : undefined;
        const quote = withMockProvenance(mockedQuote ?? (options.fulfillmentQuoteProvider
          ? await options.fulfillmentQuoteProvider({
              address: input.address,
              method: input.method,
              itemCodes: input.itemCodes,
              storeId: store.storeId,
              storeName: store.name,
            })
          : (() => {
              const fixtureQuote = fulfillmentQuoteByStoreAndMethod.get(`${store.storeId}:${input.method}`);
              return fixtureQuote
                ? ok({ feeVnd: fixtureQuote.feeVnd, etaMinutes: fixtureQuote.etaMinutes }, 'fixture_fulfillment_quote')
                : fail<{ feeVnd: number; etaMinutes: number }>(
                    'fulfillment_quote_unavailable',
                    'No fulfillment quote fixture matched the verified store and method',
                  );
          })()));
        if (!quote.ok) {
          return fail(quote.errorCode ?? 'fulfillment_quote_unavailable', quote.message);
        }
        return ok({
          method: input.method,
          disposition: input.method === 'pickup' ? 'pickup' : 'delivery',
          storeId: store.storeId,
          storeName: store.name,
          feeVnd: quote.value!.feeVnd,
          etaMinutes: quote.value!.etaMinutes,
          availability,
        });
      },
    },
    content: {
      async searchContent(kind, query) {
        return ok(data.searchContent(kind, query));
      },
      async answerAllergenQuestion(query) {
        return ok(data.getAllergenEvidence(query));
      },
    },
    invoice: {
      async collectInvoice(input) {
        if (!input.companyName || !input.taxCode || !input.email) {
          return fail('invoice_fields_missing', 'Company name, tax code, and email are required for invoice requests');
        }
        return ok({ companyName: input.companyName, taxCode: input.taxCode, email: input.email });
      },
    },
    oms: {
      async previewOrder(input) {
        return ok({
          id: 'KFC-MOCK-PREVIEW',
          cart: input.cart,
          status: 'previewed',
          paymentStatus: 'not_started',
          assignedStoreId: input.storeId,
          createdAt: new Date('2026-07-07T00:00:00.000Z').toISOString(),
        });
      },
      async placeOrder(input) {
        if (!input.userConfirmed) {
          return fail('confirmation_required', 'User confirmation is required before order placement');
        }

        const order: Order = { ...input.preview, id: 'KFC-MOCK-1001', status: 'created', paymentStatus: 'pending' };
        orders.set(order.id, order);
        return ok(order, 'order_created');
      },
      async getOrderStatus(orderId) {
        if (options.orderStatusProvider) return withMockProvenance(await options.orderStatusProvider(orderId));
        const order = orders.get(orderId);
        return order ? ok(order) : fail('order_not_found', `Order ${orderId} was not found`);
      },
      async cancelOrder(orderId) {
        const order = orders.get(orderId);
        if (!order) return fail('order_not_found', `Order ${orderId} was not found`);

        const cancelled: Order = { ...order, status: 'cancelled' };
        orders.set(orderId, cancelled);
        return ok(cancelled, 'order_cancelled');
      },
    },
    payment: {
      async listMethods(input) {
        return ok(data.listPaymentMethods(input));
      },
      async createPaymentLink(order, method) {
        const paymentMethod = data.getPaymentMethodForLink(method);
        if (!paymentMethod || !paymentMethod.supported) {
          const label = paymentMethod?.displayName ?? method;
          return fail(
            'payment_method_unsupported',
            `${label} is not listed in KFC Vietnam website checkout payment methods`,
          );
        }
        if (method === 'cod') return ok({ url: 'cod://pay-on-delivery', status: 'pending' });
        return ok({ url: `https://pay.mock/${method}/${order.id}`, status: 'pending' });
      },
      async checkPaymentStatus(orderId) {
        if (options.paymentStatusProvider) {
          return withMockProvenance(await options.paymentStatusProvider(orderId));
        }
        return fail('payment_failed', 'Mock payment is configured to fail until retried or changed to COD');
      },
    },
    delivery: {
      async quoteDelivery() {
        return ok({ feeVnd: 18000, etaMinutes: 25 });
      },
    },
    customer: {
      async getSavedAddresses(customerId) {
        if (options.savedAddressesProvider) return withMockProvenance(await options.savedAddressesProvider(customerId));
        return ok([]);
      },
      async getRecentOrder(customerId) {
        if (options.recentOrderProvider) return withMockProvenance(await options.recentOrderProvider(customerId));
        return ok(null);
      },
      async getFavoriteItems(customerId) {
        if (options.favoriteItemsProvider) return withMockProvenance(await options.favoriteItemsProvider(customerId));
        return ok([]);
      },
    },
    loyalty: {
      async lookupLoyalty() {
        return ok({ points: 120 });
      },
    },
    handoff: {
      async escalateToHuman(sessionId, reasons) {
        handoffSequence += 1;
        return ok({ escalationId: `handoff_${sessionId}_${handoffSequence}_${reasons.join('_')}` });
      },
    },
    feedback: {
      async recordFeedback(sessionId, _message) {
        return ok({ feedbackId: `feedback_${sessionId}` });
      },
    },
    messenger: channelClients.messenger,
    zalo: channelClients.zalo,
  };
}
