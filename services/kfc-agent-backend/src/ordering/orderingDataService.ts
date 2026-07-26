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
import { parsePaymentSurface } from '../domain/paymentSurface.js';
import type { MenuModifierGroup } from '../domain/types.js';
import type {
  ContentEvidence,
  Disposition,
  ItemAvailabilityResult,
  MenuSearchInput,
  MenuSearchResult,
  MembershipActionResult,
  PromotionValidationResult,
  SourceProvenance,
} from './types.js';
import {
  normalizeSearchText,
  includesAll,
  menuCategoryMatches,
  menuSearchDocumentMatchesQuery,
  matchMenuModifierQueries,
  menuPartySizeScore,
  menuSearchTextScore,
  modifierSearchText,
  menuSearchRelevance,
  storeProvenance,
  availabilityProvenance,
  offerProvenance,
  paymentMethodProvenance,
  membershipProvenance,
  menuProvenance,
  contentKind,
  toMenuModifierGroups,
  type MenuModifierSearchCandidate,
} from './orderingDataRetrieval.js';

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
type StoreWithProvenance = Omit<GeneratedStore, 'provenance'> & {
  provenance: SourceProvenance;
};
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

function minimumOrderVnd(
  value: GeneratedPromotionVoucherOffer['minimumOrderVnd'],
): number {
  return typeof value === 'number' ? value : 0;
}

function matchesOfferText(
  offer: GeneratedPromotionVoucherOffer,
  query: string,
): boolean {
  return includesAll(
    `${offer.campaign} ${offer.offerName} ${offer.offerType} ${offer.partnerBrand} ${offer.appliesTo} ${offer.evidenceText} ${offer.publicCode}`,
    query,
  );
}

function matchesOfferChannel(
  offer: GeneratedPromotionVoucherOffer,
  channel?: string,
): boolean {
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

function menuQueryAlternatives(query: string): string[] {
  return normalizeSearchText(query)
    .trim()
    .split(/\s+or\s+/u)
    .map((alternative) => alternative.trim())
    .filter(Boolean);
}

function compactMenuItem(
  item: GeneratedMenuItem,
  hasModifiers: boolean,
  matchedModifiers: MenuSearchResult['items'][number]['matchedModifiers'] = [],
  matchesAllModifierQueries?: boolean,
): MenuSearchResult['items'][number] {
  return {
    code: item.code,
    name: item.name,
    category: item.category,
    description: item.description,
    priceVnd: item.priceVnd,
    ...(item.originalPriceVnd === null
      ? {}
      : { originalPriceVnd: item.originalPriceVnd }),
    imageUrl: item.imageUrl,
    available: item.available,
    isCustomize: item.isCustomize,
    hasModifiers,
    ...(matchedModifiers.length > 0 ? { matchedModifiers } : {}),
    ...(matchesAllModifierQueries === undefined
      ? {}
      : { matchesAllModifierQueries }),
  };
}

function modifierSearchCandidates(
  modifier: GeneratedMenuModifier | undefined,
): MenuModifierSearchCandidate[] {
  if (!modifier) return [];
  const candidates: MenuModifierSearchCandidate[] = [];
  const visit = (groups: GeneratedMenuModifier['modifierGroups']): void => {
    for (const group of groups) {
      for (const option of group.options) {
        candidates.push({
          groupId: group.groupId,
          groupName: group.name,
          groupMin: group.min === '' ? null : group.min,
          groupMax: group.max === '' ? null : group.max,
          modifierId: option.modifierId,
          name: option.name,
          priceDeltaVnd: option.priceDeltaVnd,
          default: option.default,
          quantity: option.quantity === '' ? null : option.quantity,
          ...(option.searchAliases ? { aliases: option.searchAliases } : {}),
        });
        visit(option.modifierGroups);
      }
    }
  };
  visit(modifier.modifierGroups);
  return candidates;
}

function searchScore(
  item: GeneratedMenuItem,
  modifier: GeneratedMenuModifier | undefined,
  query: string,
  partySize?: number,
): number {
  const document = {
    identifiers: [item.code, item.itemId, item.posItemId, item.productCode],
    name: item.name,
    category: item.category,
    description: item.description,
    aliases: [
      ...(item.orderingMetadata?.searchAliases ?? []),
      ...Object.values(
        item.orderingMetadata?.componentSearchAliases ?? {},
      ).flat(),
    ],
    modifierText: modifierSearchText(modifier),
  };
  const textScore = menuSearchTextScore(document, query);
  return textScore === undefined
    ? 0
    : textScore + menuPartySizeScore(document, partySize);
}

function menuSearchDocument(
  item: GeneratedMenuItem,
  modifier: GeneratedMenuModifier | undefined,
) {
  return {
    identifiers: [item.code, item.itemId, item.posItemId, item.productCode],
    name: item.name,
    category: item.category,
    description: item.description,
    aliases: [
      ...(item.orderingMetadata?.searchAliases ?? []),
      ...Object.values(
        item.orderingMetadata?.componentSearchAliases ?? {},
      ).flat(),
    ],
    modifierText: modifierSearchText(modifier),
  };
}

export class OrderingDataService {
  private readonly menuByCode: Map<string, GeneratedMenuItem>;
  private readonly menuByItemId: Map<string, GeneratedMenuItem>;
  private readonly modifierByItemId: Map<string, GeneratedMenuModifier>;
  private readonly storesById: Map<string, GeneratedStore>;
  private readonly availabilityByStoreId: Map<
    string,
    GeneratedStoreAvailability
  >;
  private readonly offersById: Map<string, GeneratedPromotionVoucherOffer>;
  private readonly membershipRewardsById: Map<
    string,
    GeneratedMembershipRewardOffer
  >;
  private readonly membershipWalletById: Map<
    string,
    GeneratedMembershipWalletVoucher
  >;
  private readonly paymentMethodById: Map<string, GeneratedPaymentMethod>;
  private readonly currentDate: string;

  constructor(
    private readonly fixtures: GeneratedFixtures,
    options: OrderingDataServiceOptions = {},
  ) {
    this.menuByCode = new Map(
      fixtures.menuItems.map((item) => [item.code, item]),
    );
    this.menuByItemId = new Map(
      fixtures.menuItems.map((item) => [item.itemId, item]),
    );
    this.modifierByItemId = new Map(
      fixtures.menuModifiers.map((modifier) => [modifier.itemId, modifier]),
    );
    this.storesById = new Map(
      fixtures.stores.map((store) => [store.storeId, store]),
    );
    this.availabilityByStoreId = new Map(
      fixtures.storeAvailability.map((availability) => [
        availability.storeId,
        availability,
      ]),
    );
    this.offersById = new Map(
      fixtures.promotionVoucherOffers.map((offer) => [offer.offerId, offer]),
    );
    this.membershipRewardsById = new Map(
      fixtures.membershipRewardOffers.map((offer) => [offer.rewardId, offer]),
    );
    this.membershipWalletById = new Map(
      fixtures.membershipWalletVouchers.map((voucher) => [
        voucher.voucherId,
        voucher,
      ]),
    );
    this.paymentMethodById = new Map(
      fixtures.paymentMethods.map((method) => [method.methodId, method]),
    );
    this.currentDate = options.currentDate ?? defaultCurrentDate();
  }

  searchMenu(query: string): MenuItemWithProvenance[] {
    if (!query.trim()) {
      return this.fixtures.menuItems.map((item) =>
        menuItemWithModifierData(
          item,
          this.modifierByItemId.get(item.itemId),
          false,
        ),
      );
    }

    const queryAlternatives = menuQueryAlternatives(query);
    const directSearchText = (item: GeneratedMenuItem) =>
      `${item.name} ${item.code} ${item.itemId} ${item.posItemId} ${item.productCode}`;
    const alternativesWithDirectMatches = new Set(
      queryAlternatives.length > 1
        ? queryAlternatives.filter((alternative) =>
            this.fixtures.menuItems.some((item) =>
              includesAll(directSearchText(item), alternative),
            ),
          )
        : [],
    );
    return this.fixtures.menuItems
      .filter((item) => {
        const directText = directSearchText(item);
        const searchText = `${directText} ${item.description} ${item.category} ${modifierSearchText(this.modifierByItemId.get(item.itemId))}`;
        return queryAlternatives.some((alternative) =>
          includesAll(
            alternativesWithDirectMatches.has(alternative)
              ? directText
              : searchText,
            alternative,
          ),
        );
      })
      .map((item, fixtureIndex) => ({
        item,
        fixtureIndex,
        relevance: Math.max(
          ...queryAlternatives.map((alternative) =>
            menuSearchRelevance(item, alternative),
          ),
        ),
      }))
      .sort(
        (left, right) =>
          right.relevance - left.relevance ||
          left.fixtureIndex - right.fixtureIndex,
      )
      .map(({ item }) =>
        menuItemWithModifierData(
          item,
          this.modifierByItemId.get(item.itemId),
          true,
        ),
      );
  }

  searchMenuTool(input: MenuSearchInput): MenuSearchResult {
    const mode = input.mode ?? 'search';
    const query = input.query?.trim() ?? '';
    const effectiveQuery =
      input.category &&
      normalizeSearchText(query) === normalizeSearchText(input.category)
        ? ''
        : query;
    const modifierQueries = input.modifierQueries ?? [];
    const categories = [
      ...new Set(this.fixtures.menuItems.map((item) => item.category)),
    ];
    const filtered = this.fixtures.menuItems.filter(
      (item) =>
        item.available &&
        menuCategoryMatches(item.category, input.category, categories) &&
        (input.minPriceVnd === undefined ||
          item.priceVnd >= input.minPriceVnd) &&
        (input.maxPriceVnd === undefined ||
          item.priceVnd <= input.maxPriceVnd) &&
        (input.maxPriceExclusiveVnd === undefined ||
          item.priceVnd < input.maxPriceExclusiveVnd),
    );
    const searchCandidates = filtered.map((item, fixtureIndex) => {
      const modifier = this.modifierByItemId.get(item.itemId);
      const document = menuSearchDocument(item, modifier);
      const productDocument = { ...document, modifierText: '' };
      const matchedModifiers = matchMenuModifierQueries(
        modifierSearchCandidates(modifier),
        modifierQueries,
      );
      const matchedQueryCount = new Set(
        matchedModifiers.map((match) => match.query),
      ).size;
      const documentMatchedQueries = modifierQueries.filter((modifierQuery) =>
        menuSearchDocumentMatchesQuery(document, modifierQuery),
      );
      const productMatchedQueries = modifierQueries.filter((modifierQuery) =>
        menuSearchDocumentMatchesQuery(productDocument, modifierQuery),
      );
      const inclusionMatchedQueries = [
        ...new Set([
          ...matchedModifiers.map((match) => match.query),
          ...documentMatchedQueries,
        ]),
      ];
      return {
        item,
        fixtureIndex,
        matchedModifiers,
        inclusionMatchedQueries,
        matchesAllModifierQueries:
          modifierQueries.length > 0 &&
          matchedQueryCount === modifierQueries.length,
        score:
          searchScore(item, modifier, effectiveQuery, input.partySize) +
          matchedQueryCount * 300 +
          productMatchedQueries.length * 200,
      };
    });
    const recognizedModifierQueries = modifierQueries.filter((modifierQuery) =>
      this.fixtures.menuItems.some((item) =>
        menuSearchDocumentMatchesQuery(
          menuSearchDocument(
            item,
            this.modifierByItemId.get(item.itemId),
          ),
          modifierQuery,
        ),
      ),
    );
    const ranked =
      mode === 'full' ||
      (!effectiveQuery &&
        input.partySize === undefined &&
        modifierQueries.length === 0)
        ? filtered.map((item) => ({
            item,
            matchedModifiers: [],
            matchesAllModifierQueries: undefined,
          }))
        : searchCandidates
            .filter(
              ({ score, inclusionMatchedQueries }) =>
                (effectiveQuery.length === 0 || score > 0) &&
                recognizedModifierQueries.every((modifierQuery) =>
                  inclusionMatchedQueries.includes(modifierQuery),
                ),
            )
            .sort(
              (left, right) =>
                right.score - left.score ||
                left.fixtureIndex - right.fixtureIndex,
            )
            .map(
              ({ item, matchedModifiers, matchesAllModifierQueries }) => ({
                item,
                matchedModifiers,
                matchesAllModifierQueries,
              }),
            );
    const items = ranked.map(
      ({ item, matchedModifiers, matchesAllModifierQueries }) =>
      compactMenuItem(
        item,
        Boolean(
          this.modifierByItemId.get(item.itemId)?.modifierGroups.length,
        ),
        matchedModifiers,
        matchesAllModifierQueries,
      ),
    );
    return { mode, query, total: items.length, items };
  }

  getMenuItem(itemIdOrCode: string): MenuItemWithProvenance | undefined {
    const item =
      this.menuByCode.get(itemIdOrCode) ?? this.menuByItemId.get(itemIdOrCode);
    return item
      ? menuItemWithModifierData(
          item,
          this.modifierByItemId.get(item.itemId),
          true,
        )
      : undefined;
  }

  getModifierTree(itemIdOrCode: string): GeneratedMenuModifier | undefined {
    const item = this.getMenuItem(itemIdOrCode);
    return item ? this.modifierByItemId.get(item.itemId) : undefined;
  }

  recommendAddOns(): MenuItemWithProvenance[] {
    return this.fixtures.menuItems
      .filter((item) => item.available)
      .map((item) =>
        menuItemWithModifierData(
          item,
          this.modifierByItemId.get(item.itemId),
          false,
        ),
      );
  }

  searchStores(input: StoreSearchInput): StoreWithProvenance[] {
    const query = [input.query, input.city, input.district]
      .filter(Boolean)
      .join(' ');
    const matched = this.fixtures.stores.filter((store) =>
      query.length === 0
        ? true
        : includesAll(`${store.name} ${store.address} ${store.city}`, query),
    );
    return matched.map((store) => ({
      ...store,
      provenance: storeProvenance(store),
    }));
  }

  getStoreAvailability(
    storeId: string,
    disposition: Disposition,
  ): GeneratedStoreAvailability[Disposition] | undefined {
    return this.availabilityByStoreId.get(storeId)?.[disposition];
  }

  checkItemsAvailable(input: AvailabilityInput): ItemAvailabilityResult {
    const availability = this.availabilityByStoreId.get(input.storeId);
    const source = availability
      ? availabilityProvenance(availability)
      : missingAvailabilitySource(input.storeId);
    const disposition = availability?.[input.disposition] as
      DispositionAvailability | undefined;
    if (
      !availability ||
      !this.hasCompleteDispositionAvailability(disposition)
    ) {
      return {
        ok: false,
        checkedItemIds: input.itemIds,
        unavailableItemIds: [...input.itemIds],
        blockedTimeslotItemIds: [],
        source,
      };
    }
    const excluded = new Set(disposition?.excludedItemIds ?? []);
    const blockedTimeslotItems = new Set(
      (disposition?.timeslotExclusions ?? []).map((rule) => rule.itemId),
    );
    return {
      ok: input.itemIds.every(
        (itemId) => !excluded.has(itemId) && !blockedTimeslotItems.has(itemId),
      ),
      checkedItemIds: input.itemIds,
      unavailableItemIds: input.itemIds.filter((itemId) =>
        excluded.has(itemId),
      ),
      blockedTimeslotItemIds: input.itemIds.filter((itemId) =>
        blockedTimeslotItems.has(itemId),
      ),
      source,
    };
  }

  searchPromotionOffers(
    input: PromotionSearchInput,
  ): GeneratedPromotionVoucherOffer[] {
    const activeOffers = this.fixtures.promotionVoucherOffers.filter(
      (offer) =>
        this.isOfferActive(offer) &&
        matchesOfferChannel(offer, input.channel) &&
        (input.subtotalVnd === undefined ||
          input.subtotalVnd >= minimumOrderVnd(offer.minimumOrderVnd)),
    );
    const matchedOffers = activeOffers.filter((offer) =>
      matchesOfferText(offer, input.query),
    );
    return input.query.trim() ? matchedOffers : activeOffers;
  }

  explainPromotion(
    offerId: string,
  ): GeneratedPromotionVoucherOffer | undefined {
    return this.offersById.get(offerId);
  }

  validateVoucherInput(
    input: VoucherValidationInput,
  ): PromotionValidationResult {
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
        discountVnd:
          typeof matchingPublicCode.discountAmountVnd === 'number'
            ? matchingPublicCode.discountAmountVnd
            : 0,
        source: offerProvenance(matchingPublicCode),
      };
    }

    const matchingOffer = this.fixtures.promotionVoucherOffers.find((offer) =>
      matchesOfferText(offer, input.inputCodeOrText),
    );
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

  listContentEvidence(
    kind: ContentEvidence['kind'] | 'all',
  ): ContentEvidence[] {
    const pages = this.fixtures.contentPages.filter((page) => {
      const pageKind = contentKind(page);
      return (
        (kind === 'all' || pageKind === kind) &&
        (!['policy', 'allergen'].includes(pageKind) ||
          page.approvalStatus === 'approved')
      );
    });
    return pages.map((page) => ({
      id: page.id,
      kind: contentKind(page),
      title: page.title,
      snippet: page.markdown.slice(0, 1_334),
      sourceUrl: page.sourceUrl,
      sourceFile: page.provenance.sourceFile,
      tags: page.tags,
      retrievedAt: page.retrievedAt,
      approvedAt: page.approvedAt,
      approvalStatus: page.approvalStatus,
      audience: page.audience,
      contentHash: page.contentHash,
      officialAuthority: page.officialAuthority,
    }));
  }

  searchContent(
    kind: ContentEvidence['kind'] | 'all',
    _query: string,
  ): ContentEvidence[] {
    return this.listContentEvidence(kind).slice(0, 3);
  }

  getAllergenEvidence(query: string): ContentEvidence[] {
    return this.searchContent('allergen', query);
  }

  listPaymentMethods(
    input: { query?: string; paymentSurface?: unknown } = {},
  ): GeneratedPaymentMethod[] {
    const paymentSurface = input.paymentSurface
      ? parsePaymentSurface(input.paymentSurface)
      : undefined;
    const bySurface = this.fixtures.paymentMethods.filter((method) =>
      paymentSurface ? method.paymentSurface === paymentSurface : true,
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

    return selected.map((method) => ({
      ...method,
      provenance: paymentMethodProvenance(method),
    }));
  }

  getPaymentMethodForLink(
    methodId: string,
  ): GeneratedPaymentMethod | undefined {
    const fixture = this.paymentMethodById.get(methodId);
    return fixture
      ? { ...fixture, provenance: paymentMethodProvenance(fixture) }
      : undefined;
  }

  getMembershipProfile(): GeneratedMembershipProfileSnapshot | undefined {
    return this.fixtures.membershipProfileSnapshots[0];
  }

  listMembershipRewards(query?: string): GeneratedMembershipRewardOffer[] {
    if (!query?.trim()) return this.fixtures.membershipRewardOffers;
    const matched = this.fixtures.membershipRewardOffers.filter((offer) =>
      includesAll(
        `${offer.name} ${offer.brand} ${offer.offerType} ${offer.eligibilityText} ${offer.evidenceText} ${offer.channels.join(' ')}`,
        query,
      ),
    );
    return matched;
  }

  listMembershipWallet(status?: string): GeneratedMembershipWalletVoucher[] {
    return this.fixtures.membershipWalletVouchers.filter((voucher) =>
      status
        ? normalizeSearchText(voucher.status) === normalizeSearchText(status)
        : true,
    );
  }

  getMembershipPointHistory(
    days?: number,
  ): GeneratedMembershipPointHistorySnapshot | undefined {
    const snapshots = this.fixtures.membershipPointHistorySnapshots;
    if (days === undefined) return snapshots[0];
    return (
      snapshots.find((snapshot) => snapshot.filterWindowDays === days) ??
      snapshots[0]
    );
  }

  listMembershipTools(
    sideEffect?: GeneratedMembershipToolDefinition['sideEffect'],
  ): GeneratedMembershipToolDefinition[] {
    return this.fixtures.membershipToolDefinitions.filter((tool) =>
      sideEffect ? tool.sideEffect === sideEffect : true,
    );
  }

  acquireMembershipVoucher(input: {
    rewardId: string;
    confirmed: boolean;
  }): MembershipActionResult | undefined {
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

  redeemMembershipReward(input: {
    voucherId: string;
    channel?: string;
    confirmed: boolean;
  }): MembershipActionResult | undefined {
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
    return (
      Array.isArray(disposition?.excludedItemIds) &&
      Array.isArray(disposition?.timeslotExclusions)
    );
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

export async function loadOrderingDataService(
  rootDir: string,
): Promise<OrderingDataService> {
  return new OrderingDataService(await loadGeneratedFixtures(rootDir));
}
