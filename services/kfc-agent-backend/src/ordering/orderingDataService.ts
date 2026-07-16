import type {
  GeneratedContentPage,
  GeneratedFixtures,
  GeneratedMembershipPointHistorySnapshot,
  GeneratedMembershipProfileSnapshot,
  GeneratedMembershipRewardOffer,
  GeneratedMembershipToolDefinition,
  GeneratedMembershipWalletVoucher,
  GeneratedMenuItem,
  GeneratedMenuModifier,
  GeneratedPaymentMethod,
  GeneratedPromotionVoucherOffer,
  GeneratedStore,
  GeneratedStoreAvailability,
} from '../fixtures/schema.js';
import { loadGeneratedFixtures } from '../fixtures/loadFixtures.js';
import type { MenuModifierGroup } from '../domain/types.js';
import type {
  ContentEvidence,
  ComboConversionProposal,
  Disposition,
  FulfillmentPlanningContext,
  FulfillmentPlanningContextInput,
  ItemAvailabilityResult,
  MenuPlanningCandidate,
  MenuPlanningContext,
  MenuPlanningContextInput,
  MenuPlanningModifierGroup,
  MenuPlanningModifierRequirement,
  MembershipActionResult,
  MenuComposition,
  PaymentLinkMethod,
  PromotionValidationResult,
  SourceProvenance,
} from './types.js';
import {
  normalizeSearchText,
  tokens,
  searchableTokens,
  includesAll,
  matchingLocationAlias,
  modifierSearchText,
  uniqueSearchTokens,
  tokenSet,
  lowestPriceExactQuantityPlan,
  flattenPlanningModifierGroups,
  relevantPlanningModifierGroups,
  menuSearchRelevance,
  storeProvenance,
  availabilityProvenance,
  offerProvenance,
  paymentMethodProvenance,
  membershipProvenance,
  menuProvenance,
  contentKind,
  toMenuModifierGroups,
} from './orderingDataPlanning.js';

export interface StoreSearchInput {
  query?: string;
  city?: string;
  district?: string;
}

export interface AvailabilityInput {
  storeId: string;
  disposition: Disposition;
  itemIds: string[];
}

export interface PromotionSearchInput {
  query: string;
  subtotalVnd?: number;
  channel?: string;
}

export interface VoucherValidationInput {
  inputCodeOrText: string;
  subtotalVnd: number;
}

export interface OrderingDataServiceOptions {
  currentDate?: string;
}

type MenuItemWithProvenance = Omit<GeneratedMenuItem, 'provenance'> & {
  provenance: SourceProvenance;
  hasModifiers: boolean;
  modifierGroups?: MenuModifierGroup[];
};
type StoreWithProvenance = Omit<GeneratedStore, 'provenance'> & { provenance: SourceProvenance };
type DispositionAvailability = GeneratedStoreAvailability[Disposition];

function menuItemWithModifierData(
  item: GeneratedMenuItem,
  modifier: GeneratedMenuModifier | undefined,
  includeModifierGroups: boolean,
): MenuItemWithProvenance {
  return {
    ...item,
    provenance: menuProvenance(item),
    hasModifiers: Boolean(modifier?.modifierGroups.length),
    ...(includeModifierGroups && modifier
      ? { modifierGroups: toMenuModifierGroups(modifier.modifierGroups) }
      : {}),
  };
}

function defaultCurrentDate(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function parseFixtureDate(value: string): string | undefined {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;
}

function minimumOrderVnd(value: GeneratedPromotionVoucherOffer['minimumOrderVnd']): number {
  return typeof value === 'number' ? value : 0;
}

function matchesOfferText(offer: GeneratedPromotionVoucherOffer, query: string): boolean {
  return includesAll(
    `${offer.campaign} ${offer.offerName} ${offer.offerType} ${offer.partnerBrand} ${offer.appliesTo} ${offer.evidenceText} ${offer.publicCode}`,
    query,
  );
}

function matchesOfferChannel(offer: GeneratedPromotionVoucherOffer, channel?: string): boolean {
  if (!channel) return true;
  if (!offer.channel.trim()) return true;
  return includesAll(offer.channel, channel);
}

function missingAvailabilitySource(storeId: string): SourceProvenance {
  return {
    fixtureMode: 'public_crawl_seed',
    sourceFile: 'fixtures/generated/store-availability.json',
    sourceApi: `https://api.kfcvietnam.com.vn/stores/${storeId}/{disposition}/{endpoint}`,
  };
}

function menuComposition(item: GeneratedMenuItem): MenuComposition | undefined {
  const composition = item.orderingMetadata?.unitComposition;
  if (!composition) return undefined;
  return {
    friedChickenPieces: composition.friedChickenPieces ?? 0,
    standardPepsi: composition.standardPepsi ?? 0,
  };
}

export class OrderingDataService {
  private readonly menuByCode: Map<string, GeneratedMenuItem>;
  private readonly menuByItemId: Map<string, GeneratedMenuItem>;
  private readonly modifierByItemId: Map<string, GeneratedMenuModifier>;
  private readonly storesById: Map<string, GeneratedStore>;
  private readonly availabilityByStoreId: Map<string, GeneratedStoreAvailability>;
  private readonly offersById: Map<string, GeneratedPromotionVoucherOffer>;
  private readonly membershipRewardsById: Map<string, GeneratedMembershipRewardOffer>;
  private readonly membershipWalletById: Map<string, GeneratedMembershipWalletVoucher>;
  private readonly paymentMethodByLinkMethod: Map<PaymentLinkMethod, GeneratedPaymentMethod | undefined>;
  private readonly currentDate: string;

  constructor(
    private readonly fixtures: GeneratedFixtures,
    options: OrderingDataServiceOptions = {},
  ) {
    this.menuByCode = new Map(fixtures.menuItems.map((item) => [item.code, item]));
    this.menuByItemId = new Map(fixtures.menuItems.map((item) => [item.itemId, item]));
    this.modifierByItemId = new Map(fixtures.menuModifiers.map((modifier) => [modifier.itemId, modifier]));
    this.storesById = new Map(fixtures.stores.map((store) => [store.storeId, store]));
    this.availabilityByStoreId = new Map(fixtures.storeAvailability.map((availability) => [availability.storeId, availability]));
    this.offersById = new Map(fixtures.promotionVoucherOffers.map((offer) => [offer.offerId, offer]));
    this.membershipRewardsById = new Map(fixtures.membershipRewardOffers.map((offer) => [offer.rewardId, offer]));
    this.membershipWalletById = new Map(fixtures.membershipWalletVouchers.map((voucher) => [voucher.voucherId, voucher]));
    this.paymentMethodByLinkMethod = new Map<PaymentLinkMethod, GeneratedPaymentMethod | undefined>([
      ['cod', fixtures.paymentMethods.find((method) => method.methodId === 'cash_on_delivery')],
      ['card', fixtures.paymentMethods.find((method) => method.methodId === 'visa_master_card')],
      ['zalopay', fixtures.paymentMethods.find((method) => method.methodId === 'zalopay_wallet')],
      ['momo', fixtures.paymentMethods.find((method) => method.methodId === 'momo_wallet')],
    ]);
    this.currentDate = options.currentDate ?? defaultCurrentDate();
  }

  searchMenu(query: string): MenuItemWithProvenance[] {
    if (!query.trim()) {
      return this.fixtures.menuItems.map((item) =>
        menuItemWithModifierData(item, this.modifierByItemId.get(item.itemId), false));
    }

    return this.fixtures.menuItems
      .filter((item) => includesAll(
        `${item.name} ${item.description} ${item.category} ${item.productCode} ${modifierSearchText(this.modifierByItemId.get(item.itemId))}`,
        query,
      ))
      .map((item, fixtureIndex) => ({ item, fixtureIndex, relevance: menuSearchRelevance(item, query) }))
      .sort((left, right) => right.relevance - left.relevance || left.fixtureIndex - right.fixtureIndex)
      .map(({ item }) => menuItemWithModifierData(item, this.modifierByItemId.get(item.itemId), true));
  }

  getMenuPlanningContext(input: MenuPlanningContextInput): MenuPlanningContext {
    if (!Number.isInteger(input.maxCandidates) || input.maxCandidates <= 0) {
      throw new Error('maxCandidates must be a positive integer');
    }

    const queryTokens = uniqueSearchTokens(input.query);
    const orderedQueryTokens = searchableTokens(input.query);
    const requestedProductTokens = new Set(
      orderedQueryTokens.flatMap((token, index) =>
        /^\d+$/.test(token) && orderedQueryTokens[index + 1] && !/^\d+$/.test(orderedQueryTokens[index + 1]!)
          ? [orderedQueryTokens[index + 1]!]
          : [],
      ),
    );
    const normalizedQuery = normalizeSearchText(input.query);
    const ranked = this.fixtures.menuItems.map((item, fixtureIndex) => {
      const modifier = this.modifierByItemId.get(item.itemId);
      const aliases = item.orderingMetadata?.searchAliases.join(' ') ?? '';
      const nameTokens = tokenSet(`${item.name} ${aliases}`);
      const directTokens = tokenSet(`${item.name} ${item.category} ${item.description} ${item.productCode} ${aliases}`);
      const modifierTokens = tokenSet(modifierSearchText(modifier));
      const lexicalDirectScore = queryTokens.reduce(
        (score, token) => score + (nameTokens.has(token) ? 8 : directTokens.has(token) ? 3 : 0),
        0,
      );
      const normalizedName = normalizeSearchText(item.name);
      const directScore = lexicalDirectScore + (
        normalizedName.length > 0 && normalizedQuery.includes(normalizedName) ? 100 : 0
      );
      const modifierScore = queryTokens.reduce(
        (score, token) => score + (modifierTokens.has(token) ? 1 : 0),
        0,
      );
      const modifierConstraintScore = queryTokens.reduce(
        (score, token) => score + (modifierTokens.has(token) && !directTokens.has(token) ? 1 : 0),
        0,
      );
      const requestedProductMatch = [...requestedProductTokens].some((token) => nameTokens.has(token));
      const fulfillmentAvailable = !input.fulfillment || this.checkItemsAvailable({
        storeId: input.fulfillment.storeId,
        disposition: input.fulfillment.disposition,
        itemIds: [item.code],
      }).ok;
      const queryMatchCount = queryTokens.filter(
        (token) => directTokens.has(token) || modifierTokens.has(token),
      ).length;
      return {
        item,
        fixtureIndex,
        nameTokens,
        directTokens,
        directScore,
        modifierScore,
        modifierConstraintScore,
        requestedProductMatch,
        queryMatchCount,
        fulfillmentAvailable,
      };
    });

    const activeCodeSet = new Set(input.activeItemCodes);
    const customerEvidenceSourcesByCode = new Map<string, Set<'favorite' | 'recent_order'>>();
    for (const evidence of input.customerEvidenceItems ?? []) {
      const sources = customerEvidenceSourcesByCode.get(evidence.itemCode) ?? new Set();
      sources.add(evidence.source);
      customerEvidenceSourcesByCode.set(evidence.itemCode, sources);
    }
    const minimumQueryMatchCount = queryTokens.length > 0 && queryTokens.length <= 3 ? 1 : 2;
    const hasCatalogSignal = queryTokens.length > 0 && ranked.some(
      (candidate) => candidate.queryMatchCount >= minimumQueryMatchCount,
    );
    const selected: typeof ranked = [];
    const selectedCodes = new Set<string>();
    const add = (candidate: (typeof ranked)[number] | undefined): void => {
      if (!candidate || selectedCodes.has(candidate.item.code)) return;
      selected.push(candidate);
      selectedCodes.add(candidate.item.code);
    };

    for (const code of customerEvidenceSourcesByCode.keys()) {
      add(ranked.find((candidate) => candidate.item.code === code && candidate.item.available));
    }

    if (hasCatalogSignal) {
      for (const code of input.activeItemCodes) {
        const activeCandidate = ranked.find((candidate) => candidate.item.code === code);
        if ((activeCandidate?.queryMatchCount ?? 0) >= minimumQueryMatchCount) add(activeCandidate);
      }

      // The mock planning API and the mock search API share one catalog truth.
      // Seed exact all-token matches first so modifier-aware matches such as a
      // spicy chicken combo cannot disappear behind broad lexical candidates.
      for (const matchedItem of this.searchMenu(input.query).slice(0, input.maxCandidates)) {
        add(ranked.find((candidate) => candidate.item.code === matchedItem.code));
      }
    }

    const availableMatches = ranked.filter(
      (candidate) =>
        hasCatalogSignal &&
        candidate.item.available &&
        !activeCodeSet.has(candidate.item.code),
    );
    const directMatches = availableMatches
      .filter((candidate) => candidate.directScore > 0)
      .sort(
        (left, right) =>
          Number(right.fulfillmentAvailable) - Number(left.fulfillmentAvailable) ||
          right.directScore - left.directScore ||
          right.modifierScore - left.modifierScore ||
          left.fixtureIndex - right.fixtureIndex,
      );

    // Preserve fixture ordering only as a final tie-breaker. When the customer's
    // message contains a complete catalog name, that API-backed item must be
    // visible before broad token matches such as "nước" or "đổi" consume the
    // bounded planning window.
    for (const candidate of directMatches) {
      const normalizedName = normalizeSearchText(candidate.item.name);
      if (normalizedName.length > 0 && normalizedQuery.includes(normalizedName)) add(candidate);
    }

    const modifierCompatibleMatches = availableMatches
      .filter((candidate) => candidate.directScore > 0 && candidate.modifierConstraintScore > 0)
      .sort(
        (left, right) =>
          Number(right.fulfillmentAvailable) - Number(left.fulfillmentAvailable) ||
          Number(right.requestedProductMatch) - Number(left.requestedProductMatch) ||
          right.queryMatchCount - left.queryMatchCount ||
          right.modifierConstraintScore - left.modifierConstraintScore ||
          right.directScore - left.directScore ||
          left.item.priceVnd - right.item.priceVnd ||
          left.fixtureIndex - right.fixtureIndex,
      );
    // Reserve one bounded slot for the strongest modifier-compatible dish
    // before broad lexical candidates consume the context window.
    add(modifierCompatibleMatches.find((candidate) => !selectedCodes.has(candidate.item.code)));

    for (const token of [...queryTokens].sort((left, right) => right.length - left.length).slice(0, 4)) {
      const tokenMatches = directMatches
        .filter((candidate) => candidate.nameTokens.has(token))
        .sort((left, right) => {
          const leftName = normalizeSearchText(left.item.name);
          const rightName = normalizeSearchText(right.item.name);
          const leftPrefix = leftName === token ? 2 : leftName.startsWith(token) ? 1 : 0;
          const rightPrefix = rightName === token ? 2 : rightName.startsWith(token) ? 1 : 0;
          return (
            rightPrefix - leftPrefix ||
            right.directScore - left.directScore ||
            left.fixtureIndex - right.fixtureIndex
          );
        });
      add(tokenMatches[0]);
    }

    const pureCompositionMatches = availableMatches
      .filter((candidate) => {
        const composition = candidate.item.orderingMetadata?.unitComposition;
        return candidate.directScore > 0 && composition &&
          Object.values(composition).filter((value) => typeof value === 'number' && value > 0).length === 1;
      })
      .sort(
        (left, right) =>
          right.directScore - left.directScore ||
          left.item.priceVnd - right.item.priceVnd ||
          left.fixtureIndex - right.fixtureIndex,
      );
    for (const candidate of pureCompositionMatches.slice(0, 6)) add(candidate);

    for (const candidate of directMatches.slice(0, 4)) add(candidate);
    for (const candidate of modifierCompatibleMatches.slice(0, 6)) add(candidate);
    for (const candidate of directMatches) add(candidate);
    const candidates: MenuPlanningCandidate[] = selected
      .slice(0, input.maxCandidates)
      .map(({ item, directTokens }) => {
        const modifier = this.modifierByItemId.get(item.itemId);
        const allModifierGroups = modifier ? flattenPlanningModifierGroups(modifier.modifierGroups) : [];
        const matchedSearchAliases = [
          ...(item.orderingMetadata?.searchAliases ?? []),
          ...allModifierGroups.flatMap((group) =>
            group.options.flatMap((option) => option.searchAliases ?? []),
          ),
        ].filter((alias) => Boolean(matchingLocationAlias(input.query, [alias])));
        const fulfillmentAvailability = input.fulfillment
          ? this.checkItemsAvailable({
              storeId: input.fulfillment.storeId,
              disposition: input.fulfillment.disposition,
              itemIds: [item.code],
            })
          : undefined;
        const availabilityReason = !fulfillmentAvailability
          ? undefined
          : fulfillmentAvailability.ok
            ? 'available' as const
            : fulfillmentAvailability.blockedTimeslotItemIds.includes(item.code)
              ? 'timeslot_excluded' as const
              : fulfillmentAvailability.unavailableItemIds.includes(item.code)
                ? 'excluded' as const
                : 'fixture_missing' as const;
        return {
          code: item.code,
          itemId: item.itemId,
          productCode: item.productCode,
          name: item.name,
          category: item.category,
          description: item.description,
          priceVnd: item.priceVnd,
          originalPriceVnd: item.originalPriceVnd,
          imageUrl: item.imageUrl,
          available: item.available,
          isCustomize: item.isCustomize,
          isQuickCombo: item.isQuickCombo,
          hasModifiers: allModifierGroups.length > 0,
          verifiedForMutation: true as const,
          verificationQuery: item.name,
          ...(activeCodeSet.has(item.code) ? { activeCartItem: true as const } : {}),
          ...(activeCodeSet.has(item.code) && Number.isInteger(input.activeItemQuantities?.[item.code]) && input.activeItemQuantities![item.code]! > 0
            ? { activeCartQuantity: input.activeItemQuantities![item.code] }
            : {}),
          ...(item.orderingMetadata?.unitComposition
            ? { unitComposition: item.orderingMetadata.unitComposition }
            : {}),
          ...(matchedSearchAliases.length > 0 ? { matchedSearchAliases } : {}),
          ...(customerEvidenceSourcesByCode.has(item.code)
            ? { customerEvidenceSources: [...customerEvidenceSourcesByCode.get(item.code)!] }
            : {}),
          modifierGroups: activeCodeSet.has(item.code)
            ? allModifierGroups
            : relevantPlanningModifierGroups(allModifierGroups, queryTokens, directTokens),
          ...(input.fulfillment && fulfillmentAvailability && availabilityReason
            ? {
                fulfillmentAvailability: {
                  storeId: input.fulfillment.storeId,
                  disposition: input.fulfillment.disposition,
                  available: fulfillmentAvailability.ok,
                  reason: availabilityReason,
                  source: fulfillmentAvailability.source,
                },
              }
            : {}),
        };
      });

    const numericTargets = [...new Set(
      (input.query.match(/\b\d+\b/g) ?? [])
        .map(Number)
        .filter((value) => Number.isInteger(value) && value > 0 && value <= 200),
    )];
    const exactQuantityPlans = numericTargets.flatMap((targetQuantity) =>
      (['friedChickenPieces', 'standardPepsi'] as const).flatMap((component) => {
        const plan = lowestPriceExactQuantityPlan(candidates, targetQuantity, component);
        return plan ? [{ targetQuantity, component, ...plan }] : [];
      }),
    );
    const componentAliases = new Map<keyof MenuComposition, string[]>();
    for (const item of this.fixtures.menuItems) {
      for (const component of ['friedChickenPieces', 'standardPepsi'] as const) {
        const aliases = item.orderingMetadata?.componentSearchAliases?.[component] ?? [];
        if (aliases.length === 0) continue;
        componentAliases.set(component, [...new Set([...(componentAliases.get(component) ?? []), ...aliases])]);
      }
    }
    const requestedQuantityTokens = tokens(input.query);
    const numericPositions = requestedQuantityTokens.flatMap((token, index) => /^\d+$/.test(token)
      ? [{ targetQuantity: Number(token), index }]
      : []);
    const requestedQuantityPlans = numericPositions.flatMap(({ targetQuantity, index }, positionIndex) => {
      const nextIndex = numericPositions[positionIndex + 1]?.index ?? requestedQuantityTokens.length;
      const requestFragment = requestedQuantityTokens.slice(index + 1, nextIndex).join(' ');
      const matchingComponents = [...componentAliases.entries()]
        .filter(([, aliases]) => matchingLocationAlias(requestFragment, aliases) !== undefined)
        .map(([component]) => component);
      if (matchingComponents.length !== 1) return [];
      const plan = exactQuantityPlans.find(
        (candidate) => candidate.targetQuantity === targetQuantity && candidate.component === matchingComponents[0],
      );
      return plan ? [plan] : [];
    });

    return {
      query: input.query,
      candidates,
      ...(exactQuantityPlans.length > 0 ? { exactQuantityPlans } : {}),
      ...(requestedQuantityPlans.length > 0 ? { requestedQuantityPlans } : {}),
    };
  }

  getFulfillmentPlanningContext(input: FulfillmentPlanningContextInput): FulfillmentPlanningContext {
    if (!Number.isInteger(input.maxCandidates) || input.maxCandidates <= 0) {
      throw new Error('maxCandidates must be a positive integer');
    }

    const currentQueryMatches = this.fixtures.fulfillmentServiceAreas
      .filter((area) => area.method === input.method)
      .flatMap((area) => {
        const matchedDistrictAlias = matchingLocationAlias(input.query, [area.canonicalDistrict, ...area.districts]);
        if (!matchedDistrictAlias) return [];
        const matchedCityAlias = matchingLocationAlias(input.query, [area.canonicalCity, ...area.cities]);
        return [{
          serviceAreaId: area.serviceAreaId,
          storeId: area.storeId,
          method: area.method,
          district: area.canonicalDistrict,
          city: area.canonicalCity,
          matchedDistrictAlias,
          ...(matchedCityAlias ? { matchedCityAlias } : {}),
          matchSource: 'current_query' as const,
          verifiedForQuote: true as const,
          source: {
            fixtureMode: area.provenance.fixtureMode,
            sourceFile: area.provenance.sourceFile,
            sourceApi: area.provenance.sourceApi,
          },
        }];
      });
    const draftMatches = currentQueryMatches.length > 0 || !input.knownDistrict
      ? []
      : this.fixtures.fulfillmentServiceAreas
        .filter((area) => area.method === input.method)
        .flatMap((area) => {
          const matchedDistrictAlias = matchingLocationAlias(input.knownDistrict!, [area.canonicalDistrict, ...area.districts]);
          if (!matchedDistrictAlias) return [];
          const matchedCityAlias = input.knownCity
            ? matchingLocationAlias(input.knownCity, [area.canonicalCity, ...area.cities])
            : undefined;
          return [{
            serviceAreaId: area.serviceAreaId,
            storeId: area.storeId,
            method: area.method,
            district: area.canonicalDistrict,
            city: area.canonicalCity,
            matchedDistrictAlias,
            ...(matchedCityAlias ? { matchedCityAlias } : {}),
            matchSource: 'address_draft' as const,
            verifiedForQuote: true as const,
            source: {
              fixtureMode: area.provenance.fixtureMode,
              sourceFile: area.provenance.sourceFile,
              sourceApi: area.provenance.sourceApi,
            },
          }];
        });
    const candidates = [...currentQueryMatches, ...draftMatches]
      .slice(0, input.maxCandidates);

    return { query: input.query, candidates };
  }

  getMenuItem(itemIdOrCode: string): MenuItemWithProvenance | undefined {
    const item = this.menuByCode.get(itemIdOrCode) ?? this.menuByItemId.get(itemIdOrCode);
    return item
      ? menuItemWithModifierData(item, this.modifierByItemId.get(item.itemId), true)
      : undefined;
  }

  getModifierTree(itemIdOrCode: string): GeneratedMenuModifier | undefined {
    const item = this.getMenuItem(itemIdOrCode);
    return item ? this.modifierByItemId.get(item.itemId) : undefined;
  }

  recommendEquivalentCombo(
    items: Array<{ itemCode: string; quantity: number }>,
  ): ComboConversionProposal | undefined {
    const composition = items.reduce<MenuComposition>((total, entry) => {
      const item = this.menuByCode.get(entry.itemCode);
      const itemComposition = item ? menuComposition(item) : undefined;
      return {
        friedChickenPieces: total.friedChickenPieces + (itemComposition?.friedChickenPieces ?? 0) * entry.quantity,
        standardPepsi: total.standardPepsi + (itemComposition?.standardPepsi ?? 0) * entry.quantity,
      };
    }, { friedChickenPieces: 0, standardPepsi: 0 });
    const sourceTotalVnd = items.reduce((total, entry) => {
      const item = this.menuByCode.get(entry.itemCode);
      return total + (item?.priceVnd ?? 0) * entry.quantity;
    }, 0);
    if (composition.friedChickenPieces === 0 || composition.standardPepsi === 0) return undefined;

    return this.fixtures.menuItems
      .filter((item) => item.available && item.isQuickCombo)
      .flatMap((combo) => {
        const comboComposition = menuComposition(combo);
        if (!comboComposition || comboComposition.friedChickenPieces === 0 || comboComposition.standardPepsi === 0) return [];
        const chickenQuantity = composition.friedChickenPieces / comboComposition.friedChickenPieces;
        const pepsiQuantity = composition.standardPepsi / comboComposition.standardPepsi;
        if (!Number.isInteger(chickenQuantity) || chickenQuantity !== pepsiQuantity || chickenQuantity <= 0) return [];
        const comboTotalVnd = combo.priceVnd * chickenQuantity;
        if (comboTotalVnd >= sourceTotalVnd) return [];
        return [{
          comboItemCode: combo.code,
          comboQuantity: chickenQuantity,
          sourceTotalVnd,
          comboTotalVnd,
          savingsVnd: sourceTotalVnd - comboTotalVnd,
          composition,
        }];
      })
      .sort((left, right) => right.savingsVnd - left.savingsVnd)[0];
  }

  recommendAddOns(): MenuItemWithProvenance[] {
    return this.fixtures.menuItems
      .filter((item) => item.available)
      .map((item) => menuItemWithModifierData(item, this.modifierByItemId.get(item.itemId), false));
  }

  searchStores(input: StoreSearchInput): StoreWithProvenance[] {
    const query = [input.query, input.city, input.district].filter(Boolean).join(' ');
    const matched = this.fixtures.stores.filter((store) =>
      query.length === 0 ? true : includesAll(`${store.name} ${store.address} ${store.city}`, query),
    );
    return matched.map((store) => ({ ...store, provenance: storeProvenance(store) }));
  }

  getStoreAvailability(storeId: string, disposition: Disposition): GeneratedStoreAvailability[Disposition] | undefined {
    return this.availabilityByStoreId.get(storeId)?.[disposition];
  }

  checkItemsAvailable(input: AvailabilityInput): ItemAvailabilityResult {
    const availability = this.availabilityByStoreId.get(input.storeId);
    const source = availability ? availabilityProvenance(availability) : missingAvailabilitySource(input.storeId);
    const disposition = availability?.[input.disposition] as DispositionAvailability | undefined;
    if (!availability || !this.hasCompleteDispositionAvailability(disposition)) {
      return {
        ok: false,
        checkedItemIds: input.itemIds,
        unavailableItemIds: [...input.itemIds],
        blockedTimeslotItemIds: [],
        source,
      };
    }
    const excluded = new Set(disposition?.excludedItemIds ?? []);
    const blockedTimeslotItems = new Set((disposition?.timeslotExclusions ?? []).map((rule) => rule.itemId));
    return {
      ok: input.itemIds.every((itemId) => !excluded.has(itemId) && !blockedTimeslotItems.has(itemId)),
      checkedItemIds: input.itemIds,
      unavailableItemIds: input.itemIds.filter((itemId) => excluded.has(itemId)),
      blockedTimeslotItemIds: input.itemIds.filter((itemId) => blockedTimeslotItems.has(itemId)),
      source,
    };
  }

  searchPromotionOffers(input: PromotionSearchInput): GeneratedPromotionVoucherOffer[] {
    const activeOffers = this.fixtures.promotionVoucherOffers.filter(
      (offer) =>
        this.isOfferActive(offer) &&
        matchesOfferChannel(offer, input.channel) &&
        (input.subtotalVnd === undefined || input.subtotalVnd >= minimumOrderVnd(offer.minimumOrderVnd)),
    );
    const matchedOffers = activeOffers.filter((offer) => matchesOfferText(offer, input.query));
    return input.query.trim() ? matchedOffers : activeOffers;
  }

  explainPromotion(offerId: string): GeneratedPromotionVoucherOffer | undefined {
    return this.offersById.get(offerId);
  }

  validateVoucherInput(input: VoucherValidationInput): PromotionValidationResult {
    const normalizedInput = normalizeSearchText(input.inputCodeOrText);
    const matchingPublicCode = this.fixtures.promotionVoucherOffers.find(
      (offer) =>
        offer.actualCodeExposed &&
        offer.publicCode &&
        normalizeSearchText(offer.publicCode) === normalizedInput,
    );
    if (matchingPublicCode) {
      if (this.isOfferExpired(matchingPublicCode)) {
        return {
          ok: false,
          reason: 'expired',
          publicCode: matchingPublicCode.publicCode,
          discountVnd: 0,
          source: offerProvenance(matchingPublicCode),
        };
      }

      const minimum = minimumOrderVnd(matchingPublicCode.minimumOrderVnd);
      if (input.subtotalVnd < minimum) {
        return {
          ok: false,
          reason: 'minimum_not_met',
          publicCode: matchingPublicCode.publicCode,
          discountVnd: 0,
          source: offerProvenance(matchingPublicCode),
        };
      }

      return {
        ok: true,
        reason: 'validated',
        publicCode: matchingPublicCode.publicCode,
        discountVnd: typeof matchingPublicCode.discountAmountVnd === 'number' ? matchingPublicCode.discountAmountVnd : 0,
        source: offerProvenance(matchingPublicCode),
      };
    }

    const matchingOffer = this.fixtures.promotionVoucherOffers.find((offer) => matchesOfferText(offer, input.inputCodeOrText));
    if (!matchingOffer) {
      return {
        ok: false,
        reason: 'not_found',
        publicCode: '',
        discountVnd: 0,
        source: {
          fixtureMode: 'public_crawl_seed',
          sourceFile: 'fixtures/generated/promotion-voucher-offers.json',
        },
      };
    }

    if (this.isOfferExpired(matchingOffer)) {
      return {
        ok: false,
        reason: 'expired',
        publicCode: matchingOffer.publicCode,
        discountVnd: 0,
        source: offerProvenance(matchingOffer),
      };
    }

    const minimum = minimumOrderVnd(matchingOffer.minimumOrderVnd);
    if (input.subtotalVnd < minimum) {
      return {
        ok: false,
        reason: 'minimum_not_met',
        publicCode: matchingOffer.publicCode,
        discountVnd: 0,
        source: offerProvenance(matchingOffer),
      };
    }

    return {
      ok: false,
      reason: 'public_code_not_exposed',
      publicCode: '',
      discountVnd: 0,
      source: offerProvenance(matchingOffer),
    };
  }

  searchContent(kind: ContentEvidence['kind'] | 'all', query: string): ContentEvidence[] {
    const pages = this.fixtures.contentPages.filter((page) => kind === 'all' || contentKind(page) === kind);
    const matched = pages.filter((page) => includesAll(`${page.title} ${page.markdown}`, query));
    const selected = query.trim() ? matched : pages;
    return selected
      .map((page) => ({
        kind: contentKind(page),
        title: page.title,
        snippet: page.markdown.slice(0, 600),
        sourceUrl: page.sourceUrl,
        sourceFile: page.provenance.sourceFile,
      }));
  }

  getAllergenEvidence(query: string): ContentEvidence[] {
    return this.searchContent('allergen', query);
  }

  listPaymentMethods(input: { query?: string; paymentSurface?: string } = {}): GeneratedPaymentMethod[] {
    const bySurface = this.fixtures.paymentMethods.filter((method) =>
      input.paymentSurface ? method.paymentSurface === input.paymentSurface : true,
    );
    const selected = input.query?.trim()
      ? bySurface.filter((method) =>
          includesAll(
            [
              method.methodId,
              method.displayName,
              method.category,
              method.supportStatus,
              method.paymentSurface,
              method.evidenceText,
              method.notes,
            ].join(' '),
            input.query!,
          ),
        )
      : bySurface;

    return selected.map((method) => ({ ...method, provenance: paymentMethodProvenance(method) }));
  }

  getPaymentMethodForLink(method: PaymentLinkMethod): GeneratedPaymentMethod | undefined {
    const fixture = this.paymentMethodByLinkMethod.get(method);
    return fixture ? { ...fixture, provenance: paymentMethodProvenance(fixture) } : undefined;
  }

  getMembershipProfile(): GeneratedMembershipProfileSnapshot | undefined {
    return this.fixtures.membershipProfileSnapshots[0];
  }

  listMembershipRewards(query?: string): GeneratedMembershipRewardOffer[] {
    if (!query?.trim()) return this.fixtures.membershipRewardOffers;
    const matched = this.fixtures.membershipRewardOffers.filter((offer) =>
      includesAll(`${offer.name} ${offer.brand} ${offer.offerType} ${offer.eligibilityText} ${offer.evidenceText} ${offer.channels.join(' ')}`, query),
    );
    return matched;
  }

  listMembershipWallet(status?: string): GeneratedMembershipWalletVoucher[] {
    return this.fixtures.membershipWalletVouchers.filter((voucher) =>
      status ? normalizeSearchText(voucher.status) === normalizeSearchText(status) : true,
    );
  }

  getMembershipPointHistory(days?: number): GeneratedMembershipPointHistorySnapshot | undefined {
    const snapshots = this.fixtures.membershipPointHistorySnapshots;
    if (days === undefined) return snapshots[0];
    return snapshots.find((snapshot) => snapshot.filterWindowDays === days) ?? snapshots[0];
  }

  listMembershipTools(sideEffect?: GeneratedMembershipToolDefinition['sideEffect']): GeneratedMembershipToolDefinition[] {
    return this.fixtures.membershipToolDefinitions.filter((tool) => (sideEffect ? tool.sideEffect === sideEffect : true));
  }

  acquireMembershipVoucher(input: { rewardId: string; confirmed: boolean }): MembershipActionResult | undefined {
    const reward = this.membershipRewardsById.get(input.rewardId);
    if (!reward) return undefined;
    return {
      actionId: `acquire_${reward.rewardId}`,
      status: input.confirmed ? 'completed' : 'previewed',
      requiresUserConfirmation: !input.confirmed,
      targetId: reward.rewardId,
      message: input.confirmed
        ? `Membership reward "${reward.name}" was added.`
        : `Confirmation is required before acquiring membership reward "${reward.name}".`,
      source: membershipProvenance(reward),
    };
  }

  redeemMembershipReward(input: { voucherId: string; channel?: string; confirmed: boolean }): MembershipActionResult | undefined {
    const voucher = this.membershipWalletById.get(input.voucherId);
    if (!voucher) return undefined;
    const channel = input.channel ? ` on ${input.channel}` : '';
    return {
      actionId: `redeem_${voucher.voucherId}`,
      status: input.confirmed ? 'completed' : 'previewed',
      requiresUserConfirmation: !input.confirmed,
      targetId: voucher.voucherId,
      message: input.confirmed
        ? `Membership voucher "${voucher.name}" was redeemed${channel}.`
        : `Confirmation is required before redeeming membership voucher "${voucher.name}"${channel}.`,
      source: membershipProvenance(voucher),
    };
  }

  private hasCompleteDispositionAvailability(
    disposition: Partial<DispositionAvailability> | undefined,
  ): disposition is DispositionAvailability {
    return Array.isArray(disposition?.excludedItemIds) && Array.isArray(disposition?.timeslotExclusions);
  }

  private isOfferActive(offer: GeneratedPromotionVoucherOffer): boolean {
    const startDate = parseFixtureDate(offer.startDate);
    const endDate = parseFixtureDate(offer.endDate);
    if (startDate && this.currentDate < startDate) return false;
    if (endDate && this.currentDate > endDate) return false;
    return true;
  }

  private isOfferExpired(offer: GeneratedPromotionVoucherOffer): boolean {
    const endDate = parseFixtureDate(offer.endDate);
    return Boolean(endDate && this.currentDate > endDate);
  }
}

export async function loadOrderingDataService(rootDir: string): Promise<OrderingDataService> {
  return new OrderingDataService(await loadGeneratedFixtures(rootDir));
}
