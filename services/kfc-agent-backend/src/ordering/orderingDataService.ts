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
  Disposition,
  ItemAvailabilityResult,
  MenuSearchInput,
  MenuSearchProviderItem,
  MenuSearchResult,
  MembershipActionResult,
  PromotionValidationResult,
  SourceProvenance,
} from './types.js';
import {
  normalizeSearchText,
  includesAll,
  matchMenuModifierQueries,
  menuCategoryMatches,
  menuPartySizeScore,
  menuSearchDocumentMatchesQuery,
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
  type MenuSearchDocument,
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

type MenuItemWithProvenance = MenuSearchProviderItem &
  Omit<GeneratedMenuItem, 'provenance'> & {
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
    searchMetadata: {
      identifiers: [item.code, item.itemId, item.posItemId, item.productCode],
      aliases: [
        ...(item.orderingMetadata?.searchAliases ?? []),
        ...Object.values(
          item.orderingMetadata?.componentSearchAliases ?? {},
        ).flat(),
      ],
    },
    provenance: menuProvenance(item),
    hasModifiers: Boolean(modifier?.modifierGroups.length),
    ...(includeModifierGroups && modifier
      ? { modifierGroups: toMenuModifierGroups(modifier.modifierGroups) }
      : {}),
  };
}

function compactMenuItem(
  item: GeneratedMenuItem,
  hasModifiers: boolean,
  matchedModifiers: MenuSearchResult['items'][number]['matchedModifiers'] = [],
  matchesAllModifierQueries?: boolean,
): MenuSearchResult['items'][number] {
  return {
    code: item.code,
    category: item.category,
    categoryId: item.category,
    name: item.name,
    description: item.description,
    priceVnd: item.priceVnd,
    originalPriceVnd: item.originalPriceVnd,
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

function menuSearchDocument(
  item: GeneratedMenuItem,
  modifier: GeneratedMenuModifier | undefined,
): MenuSearchDocument {
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
          true,
        ),
      );
    }

    return this.fixtures.menuItems
      .filter((item) =>
        includesAll(
          `${item.name} ${item.description} ${item.category} ${item.productCode} ${modifierSearchText(this.modifierByItemId.get(item.itemId))}`,
          query,
        ),
      )
      .map((item, fixtureIndex) => ({
        item,
        fixtureIndex,
        relevance: menuSearchRelevance(item, query),
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
    const queries = (input.queries ?? [])
      .map((query) => query.trim())
      .filter(Boolean);
    const modifierQueries = input.modifierQueries ?? [];
    const categories = [
      ...new Set(this.fixtures.menuItems.map((item) => item.category)),
    ];
    const candidates = this.fixtures.menuItems
      .filter(
        (item) =>
          item.available &&
          menuCategoryMatches(item.category, input.category, categories) &&
          (input.maxPriceVnd === undefined ||
            item.priceVnd <= input.maxPriceVnd),
      )
      .map((item, fixtureIndex) => {
        const modifier = this.modifierByItemId.get(item.itemId);
        const document = menuSearchDocument(item, modifier);
        const matchedModifiers = matchMenuModifierQueries(
          modifierSearchCandidates(modifier),
          modifierQueries,
        );
        const recognizedModifierQueries = modifierQueries.filter(
          (modifierQuery) =>
            this.fixtures.menuItems.some((candidate) =>
              menuSearchDocumentMatchesQuery(
                menuSearchDocument(
                  candidate,
                  this.modifierByItemId.get(candidate.itemId),
                ),
                modifierQuery,
              ),
            ),
        );
        const matchedModifierQueries = new Set(
          matchedModifiers.map((match) => match.query),
        );
        const queryScores = queries
          .map((query) => menuSearchTextScore(document, query))
          .filter((score): score is number => score !== undefined);
        return {
          item,
          fixtureIndex,
          matchedModifiers,
          matchesAllModifierQueries:
            modifierQueries.length > 0 &&
            modifierQueries.every((query) => matchedModifierQueries.has(query)),
          recognizedModifierQueries,
          score:
            (queryScores.length > 0 ? Math.max(...queryScores) : 0) +
            menuPartySizeScore(document, input.partySize) +
            matchedModifierQueries.size * 300,
          matchesQuery: queries.length === 0 || queryScores.length > 0,
        };
      })
      .filter(
        ({
          matchesQuery,
          recognizedModifierQueries,
          matchedModifiers,
          item,
        }) => {
          if (!matchesQuery) return false;
          const document = menuSearchDocument(
            item,
            this.modifierByItemId.get(item.itemId),
          );
          return recognizedModifierQueries.every(
            (query) =>
              matchedModifiers.some((match) => match.query === query) ||
              menuSearchDocumentMatchesQuery(document, query),
          );
        },
      );
    const ranked =
      mode === 'full' && queries.length === 0
        ? candidates
        : candidates.sort(
            (left, right) =>
              right.score - left.score ||
              left.fixtureIndex - right.fixtureIndex,
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
    return {
      mode,
      queries,
      total: items.length,
      returned: items.length,
      complete: true,
      scope:
        mode === 'full' &&
        queries.length === 0 &&
        input.category === undefined &&
        input.maxPriceVnd === undefined &&
        input.partySize === undefined &&
        modifierQueries.length === 0
          ? { scope: 'all' }
          : { scope: 'filtered', query: JSON.stringify(input) },
      items,
    };
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
    input: { query?: string; paymentSurface?: string } = {},
  ): GeneratedPaymentMethod[] {
    const bySurface = this.fixtures.paymentMethods.filter((method) =>
      input.paymentSurface
        ? method.paymentSurface === input.paymentSurface
        : true,
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
