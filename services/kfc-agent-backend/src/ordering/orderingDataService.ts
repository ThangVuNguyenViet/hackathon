import type {
  GeneratedContentPage,
  GeneratedFixtures,
  GeneratedMenuItem,
  GeneratedMenuModifier,
  GeneratedPromotionVoucherOffer,
  GeneratedStore,
  GeneratedStoreAvailability,
} from '../fixtures/schema.js';
import { loadGeneratedFixtures } from '../fixtures/loadFixtures.js';
import type {
  ContentEvidence,
  Disposition,
  ItemAvailabilityResult,
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

function includesAll(haystack: string, query: string): boolean {
  const haystackText = normalizeSearchText(haystack);
  const queryTokens = tokens(query).filter((token) => token.length > 1);
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

type MenuItemWithProvenance = Omit<GeneratedMenuItem, 'provenance'> & { provenance: SourceProvenance };
type StoreWithProvenance = Omit<GeneratedStore, 'provenance'> & { provenance: SourceProvenance };

export class OrderingDataService {
  private readonly menuByCode: Map<string, GeneratedMenuItem>;
  private readonly menuByItemId: Map<string, GeneratedMenuItem>;
  private readonly modifierByItemId: Map<string, GeneratedMenuModifier>;
  private readonly storesById: Map<string, GeneratedStore>;
  private readonly availabilityByStoreId: Map<string, GeneratedStoreAvailability>;
  private readonly offersById: Map<string, GeneratedPromotionVoucherOffer>;

  constructor(private readonly fixtures: GeneratedFixtures) {
    this.menuByCode = new Map(fixtures.menuItems.map((item) => [item.code, item]));
    this.menuByItemId = new Map(fixtures.menuItems.map((item) => [item.itemId, item]));
    this.modifierByItemId = new Map(fixtures.menuModifiers.map((modifier) => [modifier.itemId, modifier]));
    this.storesById = new Map(fixtures.stores.map((store) => [store.storeId, store]));
    this.availabilityByStoreId = new Map(fixtures.storeAvailability.map((availability) => [availability.storeId, availability]));
    this.offersById = new Map(fixtures.promotionVoucherOffers.map((offer) => [offer.offerId, offer]));
  }

  searchMenu(query: string): MenuItemWithProvenance[] {
    return this.fixtures.menuItems
      .filter((item) => includesAll(`${item.name} ${item.description} ${item.category} ${item.productCode}`, query))
      .map((item) => ({ ...item, provenance: menuProvenance(item) }))
      .slice(0, 10);
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
      .filter((item) => ['Thức Ăn Nhẹ', 'Thức Uống & Tráng Miệng', 'Upsell_2'].includes(item.category))
      .slice(0, 6)
      .map((item) => ({ ...item, provenance: menuProvenance(item) }));
  }

  searchStores(input: StoreSearchInput): StoreWithProvenance[] {
    const query = [input.query, input.city, input.district].filter(Boolean).join(' ');
    const matched = this.fixtures.stores.filter((store) =>
      query.length === 0 ? true : includesAll(`${store.name} ${store.address} ${store.city}`, query),
    );
    return (matched.length > 0 ? matched : this.fixtures.stores)
      .slice(0, 10)
      .map((store) => ({ ...store, provenance: storeProvenance(store) }));
  }

  getStoreAvailability(storeId: string, disposition: Disposition): GeneratedStoreAvailability[Disposition] | undefined {
    return this.availabilityByStoreId.get(storeId)?.[disposition];
  }

  checkItemsAvailable(input: AvailabilityInput): ItemAvailabilityResult {
    const availability = this.availabilityByStoreId.get(input.storeId);
    const source = availability
      ? availabilityProvenance(availability)
      : { fixtureMode: 'public_crawl_seed' as const, sourceFile: 'fixtures/generated/store-availability.json' };
    const disposition = availability?.[input.disposition];
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
    return this.fixtures.promotionVoucherOffers
      .filter((offer) =>
        includesAll(
          `${offer.campaign} ${offer.offerName} ${offer.offerType} ${offer.partnerBrand} ${offer.appliesTo} ${offer.evidenceText}`,
          input.query,
        ),
      )
      .slice(0, 10);
  }

  explainPromotion(offerId: string): GeneratedPromotionVoucherOffer | undefined {
    return this.offersById.get(offerId);
  }

  validateVoucherInput(input: VoucherValidationInput): PromotionValidationResult {
    const matchingPublicCode = this.fixtures.promotionVoucherOffers.find(
      (offer) =>
        offer.actualCodeExposed &&
        offer.publicCode &&
        normalizeSearchText(offer.publicCode) === normalizeSearchText(input.inputCodeOrText),
    );
    if (!matchingPublicCode) {
      const publicOffer = this.fixtures.promotionVoucherOffers.find((offer) => /voucher|mã|code/i.test(offer.evidenceText));
      return {
        ok: false,
        reason: 'public_code_not_exposed',
        publicCode: '',
        discountVnd: 0,
        source: publicOffer
          ? offerProvenance(publicOffer)
          : { fixtureMode: 'public_crawl_seed', sourceFile: 'fixtures/generated/promotion-voucher-offers.json' },
      };
    }

    const minimum = typeof matchingPublicCode.minimumOrderVnd === 'number' ? matchingPublicCode.minimumOrderVnd : 0;
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

  searchContent(kind: ContentEvidence['kind'] | 'all', query: string): ContentEvidence[] {
    return this.fixtures.contentPages
      .filter((page) => (kind === 'all' || contentKind(page) === kind) && includesAll(`${page.title} ${page.markdown}`, query))
      .slice(0, 5)
      .map((page) => ({
        kind: contentKind(page),
        title: page.title,
        snippet: page.markdown.slice(0, 600),
        sourceUrl: page.sourceUrl,
        sourceFile: page.provenance.sourceFile,
      }));
  }

  getAllergenEvidence(query: string): ContentEvidence[] {
    const results = this.searchContent('allergen', query);
    if (results.length > 0) return results;
    return this.fixtures.contentPages
      .filter((page) => page.kind === 'allergen')
      .slice(0, 1)
      .map((page) => ({
        kind: 'allergen',
        title: page.title,
        snippet: page.markdown.slice(0, 600),
        sourceUrl: page.sourceUrl,
        sourceFile: page.provenance.sourceFile,
      }));
  }
}

export async function loadOrderingDataService(rootDir: string): Promise<OrderingDataService> {
  return new OrderingDataService(await loadGeneratedFixtures(rootDir));
}
