import type {
  GeneratedContentPage,
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
import type { MenuModifierGroup } from '../domain/types.js';
import type {
  ContentEvidence,
  Disposition,
  SourceProvenance,
} from './types.js';

export function normalizeSearchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/đ/g, 'd')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

export function tokens(value: string): string[] {
  return normalizeSearchText(value).match(/[a-z0-9]+/g) ?? [];
}

export function searchableTokens(value: string): string[] {
  return tokens(value).filter((token) => token.length > 1 || /^\d+$/.test(token));
}

export function includesAll(haystack: string, query: string): boolean {
  const haystackText = normalizeSearchText(haystack);
  const queryTokens = searchableTokens(query);
  return queryTokens.length > 0 && queryTokens.every((token) => haystackText.includes(token));
}

export function modifierSearchText(modifier: GeneratedMenuModifier | undefined): string {
  if (!modifier) return '';
  const values: string[] = [];
  const visitGroups = (groups: GeneratedMenuModifier['modifierGroups']): void => {
    for (const group of groups) {
      values.push(group.name);
      for (const option of group.options) {
        values.push(option.name, ...(option.searchAliases ?? []));
        visitGroups(option.modifierGroups);
      }
    }
  };
  visitGroups(modifier.modifierGroups);
  return values.join(' ');
}

export function toMenuModifierGroups(groups: GeneratedMenuModifier['modifierGroups']): MenuModifierGroup[] {
  return groups.map((group) => ({
    groupId: group.groupId,
    name: group.name,
    min: group.min === '' ? null : group.min,
    max: group.max === '' ? null : group.max,
    depth: group.depth,
    options: group.options.map((option) => ({
      modifierId: option.modifierId,
      name: option.name,
      priceDeltaVnd: option.priceDeltaVnd,
      default: option.default,
      quantity: option.quantity === '' ? null : option.quantity,
      modifierGroups: toMenuModifierGroups(option.modifierGroups),
    })),
  }));
}

export function menuSearchRelevance(item: GeneratedMenuItem, query: string): number {
  const normalizedQuery = normalizeSearchText(query).trim();
  const name = normalizeSearchText(item.name);
  const category = normalizeSearchText(item.category);
  const productCode = normalizeSearchText(item.productCode);
  const queryTokens = searchableTokens(query);

  if (name === normalizedQuery) return 1_000;
  if (name.startsWith(normalizedQuery)) return 800;
  if (queryTokens.every((token) => name.includes(token))) return 600;
  if (category === normalizedQuery) return 500;
  if (category.includes(normalizedQuery)) return 400;
  if (productCode.includes(normalizedQuery)) return 300;
  return 100;
}

export function menuProvenance(item: GeneratedMenuItem): SourceProvenance {
  return {
    fixtureMode: item.provenance.fixtureMode,
    sourceFile: item.provenance.sourceFile,
    sourceApi: item.provenance.sourceApi,
  };
}

export function storeProvenance(store: GeneratedStore): SourceProvenance {
  return {
    fixtureMode: store.provenance.fixtureMode,
    sourceFile: store.provenance.sourceFile,
  };
}

export function availabilityProvenance(store: GeneratedStoreAvailability): SourceProvenance {
  return {
    fixtureMode: store.provenance.fixtureMode,
    sourceFile: store.provenance.sourceFile,
    sourceApi: store.provenance.sourceApi,
  };
}

export function offerProvenance(offer: GeneratedPromotionVoucherOffer): SourceProvenance {
  return {
    fixtureMode: 'public_crawl_seed',
    sourceFile: offer.sourceFile,
    sourceUrl: offer.sourceUrl,
  };
}

export function paymentMethodProvenance(method: GeneratedPaymentMethod): GeneratedPaymentMethod['provenance'] {
  return {
    fixtureMode: method.provenance.fixtureMode,
    sourceFile: method.provenance.sourceFile,
    sourceUrl: method.provenance.sourceUrl,
  };
}

export function membershipProvenance(
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

export function contentKind(page: GeneratedContentPage): ContentEvidence['kind'] {
  if (page.kind === 'allergen') return 'allergen';
  if (page.kind === 'promotion') return 'promotion';
  if (page.kind === 'news') return 'news';
  return 'policy';
}
