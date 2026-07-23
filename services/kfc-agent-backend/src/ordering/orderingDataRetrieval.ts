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
import type { MenuItem, MenuModifierGroup } from '../domain/types.js';
import type {
  CompactModifierMatch,
  ContentEvidence,
  Disposition,
  MenuSearchInput,
  MenuSearchResult,
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
  return tokens(value).filter(
    (token) => token.length > 1 || /^\d+$/.test(token),
  );
}

export function includesAll(haystack: string, query: string): boolean {
  const haystackText = normalizeSearchText(haystack);
  const queryTokens = searchableTokens(query);
  return (
    queryTokens.length > 0 &&
    queryTokens.every((token) => haystackText.includes(token))
  );
}

export interface MenuSearchDocument {
  identifiers: readonly string[];
  name: string;
  category: string;
  description: string;
  aliases?: readonly string[];
  modifierText?: string;
}

export interface MenuModifierSearchCandidate {
  groupId: string;
  groupName: string;
  groupMin: number | null;
  groupMax: number | null;
  modifierId: string;
  name: string;
  priceDeltaVnd: number;
  default: boolean;
  quantity: number | null;
  aliases?: readonly string[];
}

function normalizedPhrase(value: string): string {
  return searchableTokens(value).join(' ');
}

function containsPhrase(value: string, phrase: string): boolean {
  return ` ${value} `.includes(` ${phrase} `);
}

function menuCategoryMatchScore(
  category: string,
  categoryQuery: string,
): number {
  const categoryTokens = new Set(searchableTokens(category));
  const queryTokens = [...new Set(searchableTokens(categoryQuery))];
  if (queryTokens.length === 0) return 0;
  return (
    queryTokens.filter((token) => categoryTokens.has(token)).length /
    queryTokens.length
  );
}

export function menuCategoryMatches(
  category: string,
  categoryQuery: string | undefined,
  candidateCategories: readonly string[] = [category],
): boolean {
  if (!categoryQuery) return true;
  const score = menuCategoryMatchScore(category, categoryQuery);
  const bestScore = Math.max(
    ...candidateCategories.map((candidate) =>
      menuCategoryMatchScore(candidate, categoryQuery),
    ),
  );
  return score > 0 && score === bestScore;
}

export function menuSearchTextScore(
  document: MenuSearchDocument,
  query: string,
): number | undefined {
  const normalizedQuery = normalizedPhrase(query);
  const queryTokens = [...new Set(searchableTokens(query))];
  if (queryTokens.length === 0) return 0;

  const identifiers = document.identifiers.map(normalizedPhrase);
  const name = normalizedPhrase(document.name);
  const category = normalizedPhrase(document.category);
  const description = normalizedPhrase(document.description);
  const aliases = normalizedPhrase((document.aliases ?? []).join(' '));
  const modifierText = normalizedPhrase(document.modifierText ?? '');
  const surfaces = [
    ...identifiers,
    name,
    category,
    description,
    aliases,
    modifierText,
  ];
  const matchedTokens = queryTokens.filter((token) =>
    surfaces.some((surface) => surface.includes(token)),
  );
  const minimumTokenMatches = Math.max(1, Math.ceil(queryTokens.length * 0.6));
  if (matchedTokens.length < minimumTokenMatches) return undefined;

  let score = Math.round((matchedTokens.length / queryTokens.length) * 300);
  if (identifiers.includes(normalizedQuery)) score += 1_400;
  if (name === normalizedQuery) score += 1_200;
  else if (name.startsWith(normalizedQuery)) score += 700;
  else if (containsPhrase(name, normalizedQuery)) score += 500;
  if (containsPhrase(aliases, normalizedQuery)) score += 450;
  if (containsPhrase(modifierText, normalizedQuery)) score += 400;
  if (containsPhrase(category, normalizedQuery)) score += 350;
  if (containsPhrase(description, normalizedQuery)) score += 250;

  for (const token of matchedTokens) {
    score += Math.max(
      identifiers.some((identifier) => identifier.includes(token)) ? 100 : 0,
      name.includes(token) ? 80 : 0,
      aliases.includes(token) ? 70 : 0,
      modifierText.includes(token) ? 65 : 0,
      category.includes(token) ? 50 : 0,
      description.includes(token) ? 40 : 0,
    );
  }
  return score;
}

export function menuSearchDocumentMatchesQuery(
  document: MenuSearchDocument,
  query: string,
): boolean {
  const queryTokens = [...new Set(searchableTokens(query))];
  if (queryTokens.length === 0) return false;
  const documentTokens = searchableTokens(
    [
      ...document.identifiers,
      document.name,
      document.category,
      document.description,
      ...(document.aliases ?? []),
      document.modifierText ?? '',
    ].join(' '),
  );
  return queryTokens.every((queryToken) => documentTokens.includes(queryToken));
}

export function menuPartySizeScore(
  document: MenuSearchDocument,
  partySize: number | undefined,
): number {
  if (partySize === undefined) return 0;
  return searchableTokens(
    `${document.name} ${document.category} ${document.description} ${(document.aliases ?? []).join(' ')}`,
  ).includes(String(partySize))
    ? 180
    : 0;
}

export function matchMenuModifierQueries(
  candidates: readonly MenuModifierSearchCandidate[],
  queries: readonly string[],
): CompactModifierMatch[] {
  const matches: CompactModifierMatch[] = [];
  for (const query of queries) {
    const queryTokens = [...new Set(searchableTokens(query))];
    if (queryTokens.length === 0) continue;
    for (const candidate of candidates) {
      const candidateTokens = searchableTokens(
        `${candidate.name} ${(candidate.aliases ?? []).join(' ')}`,
      );
      if (
        !queryTokens.every((queryToken) => candidateTokens.includes(queryToken))
      ) {
        continue;
      }
      const { aliases: _aliases, ...evidence } = candidate;
      matches.push({ query, ...evidence });
      break;
    }
  }
  return matches;
}

function menuItemModifierText(groups: readonly MenuModifierGroup[]): string {
  const values: string[] = [];
  const visit = (current: readonly MenuModifierGroup[]): void => {
    for (const group of current) {
      values.push(group.name);
      for (const option of group.options) {
        values.push(option.name);
        visit(option.modifierGroups);
      }
    }
  };
  visit(groups);
  return values.join(' ');
}

function menuItemModifierCandidates(
  groups: readonly MenuModifierGroup[],
): MenuModifierSearchCandidate[] {
  const candidates: MenuModifierSearchCandidate[] = [];
  const visit = (current: readonly MenuModifierGroup[]): void => {
    for (const group of current) {
      for (const option of group.options) {
        candidates.push({
          groupId: group.groupId,
          groupName: group.name,
          groupMin: group.min,
          groupMax: group.max,
          modifierId: option.modifierId,
          name: option.name,
          priceDeltaVnd: option.priceDeltaVnd,
          default: option.default,
          quantity: option.quantity,
        });
        visit(option.modifierGroups);
      }
    }
  };
  visit(groups);
  return candidates;
}

function menuItemSearchDocument(item: MenuItem): MenuSearchDocument {
  return {
    identifiers: [item.code, item.itemId ?? '', item.productCode ?? ''],
    name: item.name,
    category: item.category,
    description: item.description,
    modifierText: menuItemModifierText(item.modifierGroups ?? []),
  };
}

/**
 * Apply exact normalized KFC menu retrieval rules to a provider collection.
 * The language model supplies structured search evidence; this function does
 * not infer intent from customer prose.
 */
export function searchMenuCollection(
  providerItems: readonly MenuItem[],
  input: MenuSearchInput,
): MenuSearchResult {
  const mode = input.mode ?? 'search';
  const queries = (input.queries ?? [])
    .map((query) => query.trim())
    .filter(Boolean);
  const modifierQueries = input.modifierQueries ?? [];
  const categories = [...new Set(providerItems.map((item) => item.category))];
  const recognizedModifierQueries = modifierQueries.filter((query) =>
    providerItems.some((item) =>
      menuSearchDocumentMatchesQuery(menuItemSearchDocument(item), query),
    ),
  );
  const candidates = providerItems
    .filter(
      (item) =>
        item.available &&
        menuCategoryMatches(item.category, input.category, categories) &&
        (input.maxPriceVnd === undefined || item.priceVnd <= input.maxPriceVnd),
    )
    .map((item, providerIndex) => {
      const document = menuItemSearchDocument(item);
      const matchedModifiers = matchMenuModifierQueries(
        menuItemModifierCandidates(item.modifierGroups ?? []),
        modifierQueries,
      );
      const matchedModifierQueries = new Set(
        matchedModifiers.map((match) => match.query),
      );
      const queryScores = queries
        .map((query) => menuSearchTextScore(document, query))
        .filter((score): score is number => score !== undefined);
      return {
        item,
        providerIndex,
        matchedModifiers,
        matchesAllModifierQueries:
          modifierQueries.length > 0 &&
          modifierQueries.every((query) => matchedModifierQueries.has(query)),
        score:
          (queryScores.length > 0 ? Math.max(...queryScores) : 0) +
          menuPartySizeScore(document, input.partySize) +
          matchedModifierQueries.size * 300,
        matchesQuery: queries.length === 0 || queryScores.length > 0,
        recognizedModifierQueries,
      };
    })
    .filter(
      ({ item, matchesQuery, matchedModifiers, recognizedModifierQueries }) =>
        matchesQuery &&
        recognizedModifierQueries.every(
          (query) =>
            matchedModifiers.some((match) => match.query === query) ||
            menuSearchDocumentMatchesQuery(menuItemSearchDocument(item), query),
        ),
    )
    .sort(
      (left, right) =>
        right.score - left.score || left.providerIndex - right.providerIndex,
    );
  const items = candidates.map(
    ({ item, matchedModifiers, matchesAllModifierQueries }) => ({
      code: item.code,
      category: item.category,
      categoryId: item.categoryId,
      name: item.name,
      description: item.description,
      priceVnd: item.priceVnd,
      originalPriceVnd: item.originalPriceVnd,
      imageUrl: item.imageUrl,
      available: item.available,
      isCustomize: item.isCustomize,
      hasModifiers: Boolean(item.modifierGroups?.length ?? item.hasModifiers),
      ...(matchedModifiers.length > 0 ? { matchedModifiers } : {}),
      ...(modifierQueries.length > 0 ? { matchesAllModifierQueries } : {}),
    }),
  );
  return { mode, queries, total: items.length, items };
}

export function modifierSearchText(
  modifier: GeneratedMenuModifier | undefined,
): string {
  if (!modifier) return '';
  const values: string[] = [];
  const visitGroups = (
    groups: GeneratedMenuModifier['modifierGroups'],
  ): void => {
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

export function toMenuModifierGroups(
  groups: GeneratedMenuModifier['modifierGroups'],
): MenuModifierGroup[] {
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

export function menuSearchRelevance(
  item: GeneratedMenuItem,
  query: string,
): number {
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

export function availabilityProvenance(
  store: GeneratedStoreAvailability,
): SourceProvenance {
  return {
    fixtureMode: store.provenance.fixtureMode,
    sourceFile: store.provenance.sourceFile,
    sourceApi: store.provenance.sourceApi,
  };
}

export function offerProvenance(
  offer: GeneratedPromotionVoucherOffer,
): SourceProvenance {
  return {
    fixtureMode: 'public_crawl_seed',
    sourceFile: offer.sourceFile,
    sourceUrl: offer.sourceUrl,
  };
}

export function paymentMethodProvenance(
  method: GeneratedPaymentMethod,
): GeneratedPaymentMethod['provenance'] {
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

export function contentKind(
  page: GeneratedContentPage,
): ContentEvidence['kind'] {
  if (page.kind === 'allergen') return 'allergen';
  if (page.kind === 'promotion') return 'promotion';
  if (page.kind === 'news') return 'news';
  return 'policy';
}
