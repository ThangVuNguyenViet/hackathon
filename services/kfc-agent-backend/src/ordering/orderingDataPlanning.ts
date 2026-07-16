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
  MenuComposition,
  MenuPlanningCandidate,
  MenuPlanningModifierGroup,
  MenuPlanningModifierRequirement,
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

export function matchingLocationAlias(query: string, aliases: string[]): string | undefined {
  const queryTokens = tokens(query);
  return aliases.find((alias) => {
    const aliasTokens = tokens(alias);
    if (aliasTokens.length === 0 || aliasTokens.length > queryTokens.length) return false;
    return queryTokens.some((_, startIndex) =>
      aliasTokens.every((token, offset) => queryTokens[startIndex + offset] === token),
    );
  });
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

export function uniqueSearchTokens(value: string): string[] {
  return [...new Set(searchableTokens(value).filter((token) => !/^\d+$/.test(token)))];
}

export function tokenSet(value: string): Set<string> {
  return new Set(uniqueSearchTokens(value));
}

export function lowestPriceExactQuantityPlan(
  candidates: MenuPlanningCandidate[],
  targetQuantity: number,
  component: keyof MenuComposition,
): { selections: Array<{ itemCode: string; quantity: number }>; totalPriceVnd: number } | undefined {
  const options = candidates.flatMap((candidate) => {
    const composition = candidate.unitComposition;
    const amount = composition?.[component];
    const nonZeroComponents = composition
      ? Object.values(composition).filter((value) => typeof value === 'number' && value > 0).length
      : 0;
    return candidate.available && typeof amount === 'number' && amount > 0 && nonZeroComponents === 1
      ? [{ itemCode: candidate.code, amount, priceVnd: candidate.priceVnd }]
      : [];
  });
  if (options.length === 0) return undefined;

  const plans: Array<{ cost: number; quantities: Map<string, number> } | undefined> = Array(targetQuantity + 1);
  plans[0] = { cost: 0, quantities: new Map() };
  for (let amount = 1; amount <= targetQuantity; amount += 1) {
    for (const option of options) {
      const previous = plans[amount - option.amount];
      if (!previous) continue;
      const cost = previous.cost + option.priceVnd;
      const current = plans[amount];
      if (current && current.cost <= cost) continue;
      const quantities = new Map(previous.quantities);
      quantities.set(option.itemCode, (quantities.get(option.itemCode) ?? 0) + 1);
      plans[amount] = { cost, quantities };
    }
  }
  const exact = plans[targetQuantity];
  if (!exact) return undefined;
  return {
    selections: [...exact.quantities].map(([itemCode, quantity]) => ({ itemCode, quantity })),
    totalPriceVnd: exact.cost,
  };
}

export function planningSelectionQuantity(
  optionQuantity: number | '',
  group: GeneratedMenuModifier['modifierGroups'][number],
): number | undefined {
  if (typeof optionQuantity === 'number' && optionQuantity > 0) return optionQuantity;
  if (
    typeof group.min === 'number' &&
    group.min > 0 &&
    group.min === group.max
  ) {
    return group.min;
  }
  return undefined;
}

export function flattenPlanningModifierGroups(
  groups: GeneratedMenuModifier['modifierGroups'],
  requiredSelections: MenuPlanningModifierRequirement[] = [],
): MenuPlanningModifierGroup[] {
  return groups.flatMap((group) => {
    const current: MenuPlanningModifierGroup = {
      groupId: group.groupId,
      name: group.name,
      min: group.min === '' ? null : group.min,
      max: group.max === '' ? null : group.max,
      requiredSelections,
      options: group.options.map((option) => {
        const quantity = planningSelectionQuantity(option.quantity, group);
        const selection = {
          groupId: group.groupId,
          modifierId: option.modifierId,
          ...(quantity === undefined ? {} : { quantity }),
        };
        return {
          modifierId: option.modifierId,
          name: option.name,
          ...(option.searchAliases?.length ? { searchAliases: option.searchAliases } : {}),
          priceDeltaVnd: option.priceDeltaVnd,
          default: option.default,
          ...(quantity === undefined ? {} : { quantity }),
          selectionBundle: [...requiredSelections, selection],
        };
      }),
    };
    const nested = group.options.flatMap((option) =>
      flattenPlanningModifierGroups(option.modifierGroups, [
        ...requiredSelections,
        {
          groupId: group.groupId,
          modifierId: option.modifierId,
          ...(planningSelectionQuantity(option.quantity, group) === undefined
            ? {}
            : { quantity: planningSelectionQuantity(option.quantity, group) }),
        },
      ]),
    );
    return [current, ...nested];
  });
}

export function relevantPlanningModifierGroups(
  groups: MenuPlanningModifierGroup[],
  queryTokens: string[],
  directTokens: Set<string>,
): MenuPlanningModifierGroup[] {
  const modifierOnlyTokens = new Set(queryTokens.filter((token) => !directTokens.has(token)));
  if (modifierOnlyTokens.size === 0) return [];

  return groups.flatMap((group) => {
    const groupMatches = uniqueSearchTokens(group.name).some((token) => modifierOnlyTokens.has(token));
    const matchingOptions = group.options.filter((option) =>
      uniqueSearchTokens(`${option.name} ${(option.searchAliases ?? []).join(' ')}`)
        .some((token) => modifierOnlyTokens.has(token)),
    );
    if (!groupMatches && matchingOptions.length === 0) return [];
    return [{
      ...group,
      options: groupMatches ? group.options : matchingOptions,
    }];
  });
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
