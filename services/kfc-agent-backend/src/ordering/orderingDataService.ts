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
import type {
  ContentEvidence,
  Disposition,
  ItemAvailabilityResult,
  MembershipActionResult,
  PaymentLinkMethod,
  PromotionValidationResult,
  SourceProvenance,
} from './types.js';

function normalizeSearchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/đ/g, 'd')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function tokens(value: string): string[] {
  return normalizeSearchText(value).match(/[a-z0-9]+/g) ?? [];
}

function searchableTokens(value: string): string[] {
  return tokens(value).filter((token) => token.length > 1);
}

function includesAll(haystack: string, query: string): boolean {
  const haystackText = normalizeSearchText(haystack);
  const queryTokens = searchableTokens(query);
  return queryTokens.length > 0 && queryTokens.every((token) => haystackText.includes(token));
}

function menuProvenance(item: GeneratedMenuItem): SourceProvenance {
  return {
    fixtureMode: item.provenance.fixtureMode,
    sourceFile: item.provenance.sourceFile,
    sourceApi: item.provenance.sourceApi,
  };
}

function storeProvenance(store: GeneratedStore): SourceProvenance {
  return {
    fixtureMode: store.provenance.fixtureMode,
    sourceFile: store.provenance.sourceFile,
  };
}

function availabilityProvenance(store: GeneratedStoreAvailability): SourceProvenance {
  return {
    fixtureMode: store.provenance.fixtureMode,
    sourceFile: store.provenance.sourceFile,
    sourceApi: store.provenance.sourceApi,
  };
}

function offerProvenance(offer: GeneratedPromotionVoucherOffer): SourceProvenance {
  return {
    fixtureMode: 'public_crawl_seed',
    sourceFile: offer.sourceFile,
    sourceUrl: offer.sourceUrl,
  };
}

function paymentMethodProvenance(method: GeneratedPaymentMethod): GeneratedPaymentMethod['provenance'] {
  return {
    fixtureMode: method.provenance.fixtureMode,
    sourceFile: method.provenance.sourceFile,
    sourceUrl: method.provenance.sourceUrl,
  };
}

function membershipProvenance(
  fixture:
    | GeneratedMembershipRewardOffer
    | GeneratedMembershipWalletVoucher
    | GeneratedMembershipProfileSnapshot
    | GeneratedMembershipPointHistorySnapshot
    | GeneratedMembershipToolDefinition,
): SourceProvenance {
  return {
    fixtureMode: fixture.provenance.fixtureMode,
    sourceFile: fixture.provenance.sourceFile,
    sourceUrl: fixture.provenance.sourceUrl,
  };
}

function contentKind(page: GeneratedContentPage): ContentEvidence['kind'] {
  if (page.kind === 'allergen') return 'allergen';
  if (page.kind === 'promotion') return 'promotion';
  if (page.kind === 'news') return 'news';
  return 'policy';
}

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

type MenuItemWithProvenance = Omit<GeneratedMenuItem, 'provenance'> & { provenance: SourceProvenance };
type StoreWithProvenance = Omit<GeneratedStore, 'provenance'> & { provenance: SourceProvenance };
type DispositionAvailability = GeneratedStoreAvailability[Disposition];

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
    if (!query.trim()) return this.fixtures.menuItems.map((item) => ({ ...item, provenance: menuProvenance(item) }));

    return this.fixtures.menuItems
      .filter((item) => includesAll(`${item.name} ${item.description} ${item.category} ${item.productCode}`, query))
      .map((item) => ({ ...item, provenance: menuProvenance(item) }));
  }

  getMenuItem(itemIdOrCode: string): MenuItemWithProvenance | undefined {
    const item = this.menuByCode.get(itemIdOrCode) ?? this.menuByItemId.get(itemIdOrCode);
    return item ? { ...item, provenance: menuProvenance(item) } : undefined;
  }

  getModifierTree(itemIdOrCode: string): GeneratedMenuModifier | undefined {
    const item = this.getMenuItem(itemIdOrCode);
    return item ? this.modifierByItemId.get(item.itemId) : undefined;
  }

  recommendAddOns(): MenuItemWithProvenance[] {
    return this.fixtures.menuItems
      .filter((item) => item.available)
      .map((item) => ({ ...item, provenance: menuProvenance(item) }));
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
        ? `Mock acquired membership reward "${reward.name}".`
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
        ? `Mock redeemed membership voucher "${voucher.name}"${channel}.`
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
