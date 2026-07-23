import type {
  CartClient,
  ExternalCallContext,
  IrreversibleConfirmationAuthority,
  MenuClient,
  OmsClient,
  RecommendationClient,
} from './interfaces.js';
import type { Cart, MenuItem, MenuModifierGroup, ToolResult } from '../domain/types.js';
import type { GeneratedMenuModifier } from '../fixtures/schema.js';
import {
  revalidateCatalogPin,
  type CatalogItemFact,
  type CatalogObservation,
} from '../catalog/catalogObservation.js';
import { createVerifiedCommerceProjection } from '../commerce/verifiedCommerceProjection.js';
import { rankEligibleRecommendations } from '../ordering/recommendationRanking.js';
import {
  matchMenuModifierQueries,
  menuCategoryMatches,
  menuSearchDocumentMatchesQuery,
  menuPartySizeScore,
  menuSearchTextScore,
  normalizeSearchText,
  type MenuModifierSearchCandidate,
} from '../ordering/orderingDataRetrieval.js';

function ok<T>(value: T): ToolResult<T> {
  return { ok: true, value, message: 'verified_catalog_observation' };
}

function fail<T>(message: string): ToolResult<T> {
  return { ok: false, errorCode: 'catalog_observation_stale', message };
}

type RawGroup = CatalogItemFact['modifierGroups'][number];

function modifierSearchText(groups: readonly MenuModifierGroup[]): string {
  const text: string[] = [];
  const visit = (nested: readonly MenuModifierGroup[]): void => {
    for (const group of nested) {
      text.push(group.name);
      for (const option of group.options) {
        text.push(option.name);
        visit(option.modifierGroups);
      }
    }
  };
  visit(groups);
  return text.join(' ');
}

function modifierSearchCandidates(
  groups: readonly MenuModifierGroup[],
): MenuModifierSearchCandidate[] {
  const candidates: MenuModifierSearchCandidate[] = [];
  const visit = (nested: readonly MenuModifierGroup[]): void => {
    for (const group of nested) {
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

function menuSearchDocument(item: MenuItem) {
  return {
    identifiers: [item.code, item.itemId, item.productCode].filter(
      (value): value is string => typeof value === 'string',
    ),
    name: item.name,
    category: item.category,
    description: item.description,
    modifierText: modifierSearchText(item.modifierGroups ?? []),
  };
}

function toModifierGroups(groups: CatalogItemFact['modifierGroups'], depth = 0): MenuModifierGroup[] {
  return groups.map((group) => ({
    groupId: group.id,
    name: group.name,
    min: group.min,
    max: group.max,
    depth,
    options: group.modifiers.map((modifier) => ({
      modifierId: modifier.id,
      name: modifier.name,
      priceDeltaVnd: modifier.price,
      default: modifier.dflt === 'Y',
      quantity: modifier.qty ?? null,
      modifierGroups: toModifierGroups(modifier.modgrps ?? [], depth + 1),
    })),
  }));
}

function toGeneratedGroups(groups: CatalogItemFact['modifierGroups'], depth = 0): GeneratedMenuModifier['modifierGroups'] {
  return groups.map((group: RawGroup) => ({
    groupId: group.id,
    name: group.name,
    min: group.min,
    max: group.max,
    depth,
    options: group.modifiers.map((modifier) => ({
      modifierId: modifier.id,
      name: modifier.name,
      priceDeltaVnd: modifier.price,
      default: modifier.dflt === 'Y',
      quantity: modifier.qty ?? '',
      posItemId: modifier.posItemId,
      imageName: '',
      modifierGroups: toGeneratedGroups(modifier.modgrps ?? [], depth + 1),
    })),
  }));
}

function toMenuItem(item: CatalogItemFact): MenuItem {
  return {
    code: item.itemCode,
    itemId: item.itemCode,
    productCode: item.productCode,
    category: item.category,
    categoryId: item.categoryId,
    name: item.name,
    description: item.description,
    priceVnd: item.priceVnd,
    originalPriceVnd: item.originalPriceVnd,
    imageUrl: item.imageUrl,
    available: true,
    isCustomize: item.isCustomize,
    isQuickCombo: item.isQuickCombo,
    hasModifiers: item.modifierGroups.length > 0,
    modifierGroups: toModifierGroups(item.modifierGroups),
  };
}

export interface CatalogObservationClientOptions {
  sessionId: string;
  pinned: CatalogObservation;
  fetchCurrent(
    externalCallContext: ExternalCallContext,
  ): Promise<CatalogObservation>;
  cart: CartClient;
  oms: OmsClient;
  now?: () => Date;
}

export function createCatalogObservationClients(options: CatalogObservationClientOptions): {
  confirmationAuthority: IrreversibleConfirmationAuthority;
  menu: MenuClient;
  recommendation: RecommendationClient;
  cart: CartClient;
  oms: OmsClient;
} {
  const discoveryObservation = async (
    externalCallContext: ExternalCallContext,
  ): Promise<CatalogObservation> => {
    const expiresAt = options.pinned.expiresAt
      ?? new Date(Date.parse(options.pinned.observedAt) + 300_000).toISOString();
    return Date.parse(expiresAt) <= (options.now?.() ?? new Date()).getTime()
      ? options.fetchCurrent(externalCallContext)
      : options.pinned;
  };

  const verify = async (
    itemCodes: string[],
    externalCallContext: ExternalCallContext,
  ): Promise<ToolResult<true>> => {
    const current = await options.fetchCurrent(externalCallContext);
    const result = revalidateCatalogPin(options.pinned, current, itemCodes);
    return result.ok ? ok(true) : fail(`Catalog changed for ${result.changedItemCodes.join(', ')}`);
  };

  const menu: MenuClient = {
    async searchMenu(input, externalCallContext) {
      const observation = await discoveryObservation(externalCallContext);
      const mode = input.mode ?? 'search';
      const query = input.query?.trim() ?? '';
      const effectiveQuery =
        input.category &&
        normalizeSearchText(query) === normalizeSearchText(input.category)
          ? ''
          : query;
      const modifierQueries = input.modifierQueries ?? [];
      const categories = [
        ...new Set(observation.items.map((item) => item.category)),
      ];
      const candidates = observation.items
        .map(toMenuItem)
        .filter((item) =>
          item.available &&
          menuCategoryMatches(item.category, input.category, categories) &&
          (input.maxPriceVnd === undefined ||
            item.priceVnd <= input.maxPriceVnd),
        )
        .map((item, fixtureIndex) => {
          const document = menuSearchDocument(item);
          const productDocument = { ...document, modifierText: '' };
          const textScore = menuSearchTextScore(document, effectiveQuery);
          const matchedModifiers = matchMenuModifierQueries(
            modifierSearchCandidates(item.modifierGroups ?? []),
            modifierQueries,
          );
          const matchedQueryCount = new Set(
            matchedModifiers.map((match) => match.query),
          ).size;
          const documentMatchedQueries = modifierQueries.filter(
            (modifierQuery) =>
              menuSearchDocumentMatchesQuery(document, modifierQuery),
          );
          const productMatchedQueries = modifierQueries.filter(
            (modifierQuery) =>
              menuSearchDocumentMatchesQuery(productDocument, modifierQuery),
          );
          return {
            item,
            fixtureIndex,
            matchedModifiers,
            inclusionMatchedQueries: [
              ...new Set([
                ...matchedModifiers.map((match) => match.query),
                ...documentMatchedQueries,
              ]),
            ],
            matchesAllModifierQueries:
              modifierQueries.length > 0 &&
              matchedQueryCount === modifierQueries.length,
            score:
              textScore === undefined
                ? undefined
                : textScore +
                  menuPartySizeScore(document, input.partySize) +
                  matchedQueryCount * 300 +
                  productMatchedQueries.length * 200,
          };
        });
      const recognizedModifierQueries = modifierQueries.filter(
        (modifierQuery) =>
          observation.items
            .map(toMenuItem)
            .some((item) =>
              menuSearchDocumentMatchesQuery(
                menuSearchDocument(item),
                modifierQuery,
              ),
            ),
      );
      const ranked = candidates
        .filter(
          ({ score, inclusionMatchedQueries }) =>
            mode === 'full' ||
            ((effectiveQuery.length === 0 || score !== undefined) &&
              recognizedModifierQueries.every((modifierQuery) =>
                inclusionMatchedQueries.includes(modifierQuery),
              )),
        )
        .sort((left, right) =>
          mode === 'full' || (!effectiveQuery && input.partySize === undefined)
            ? left.fixtureIndex - right.fixtureIndex
            : (right.score ?? 0) - (left.score ?? 0) ||
              left.fixtureIndex - right.fixtureIndex,
        )
        .map(
          ({ item, matchedModifiers, matchesAllModifierQueries }) => ({
            item,
            matchedModifiers,
            matchesAllModifierQueries,
          }),
        );
      return ok({
        mode,
        query,
        total: ranked.length,
        items: ranked.map(
          ({ item, matchedModifiers, matchesAllModifierQueries }) => ({
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
          isCustomize: item.isCustomize ?? false,
          hasModifiers: item.hasModifiers ?? false,
          ...(matchedModifiers.length > 0 ? { matchedModifiers } : {}),
            ...(modifierQueries.length > 0
              ? { matchesAllModifierQueries }
              : {}),
          }),
        ),
      });
    },
    async getItemDetails(code, externalCallContext) {
      const item = (
        await discoveryObservation(externalCallContext)
      ).items.find((candidate) => candidate.itemCode === code);
      return item ? ok(toMenuItem(item)) : { ok: false, errorCode: 'item_not_found', message: `No current item ${code}` };
    },
    async getModifierOptions(code, externalCallContext) {
      const observation = await discoveryObservation(externalCallContext);
      const item = observation.items.find((candidate) => candidate.itemCode === code);
      return item && item.modifierGroups.length > 0
        ? ok({
            itemCode: item.itemCode,
            itemId: item.itemCode,
            productCode: item.productCode,
            name: item.name,
            modifierGroups: toGeneratedGroups(item.modifierGroups),
            provenance: { sourceFile: observation.sourceUrl, fixtureMode: 'current_api' },
          })
        : { ok: false, errorCode: 'modifiers_not_found', message: `No current modifiers for ${code}` };
    },
  };

  const recommendation: RecommendationClient = {
    async recommendAddOns(cart, externalCallContext) {
      const observation = await discoveryObservation(externalCallContext);
      try {
        createVerifiedCommerceProjection({
          environment: observation.environment,
          observation,
          subjectId: options.sessionId,
          journeyId: options.sessionId,
          factGroups: [{
            key: 'catalog',
            environment: observation.environment,
            providerFingerprint: observation.providerFingerprint,
            subjectId: options.sessionId,
            journeyId: options.sessionId,
            revision: observation.id,
            verifiedAt: observation.observedAt,
            expiresAt: observation.expiresAt ?? new Date(Date.parse(observation.observedAt) + 300_000).toISOString(),
            dependencies: [],
            value: observation.items,
          }],
        });
      } catch (error) {
        return fail(error instanceof Error ? error.message : 'Catalog projection is stale');
      }
      const inCart = new Set(cart.items.map((item) => item.itemCode));
      return ok(rankEligibleRecommendations(observation.items.map((item) => ({
        itemCode: item.itemCode,
        eligible: !inCart.has(item.itemCode),
        value: toMenuItem(item),
        score: {
          requestMatch: 0,
          partySizeFit: 0,
          budgetFit: -item.priceVnd,
          preferenceMatch: 0,
          cartDisruption: 0,
        },
      }))).map((candidate) => candidate.value));
    },
  };

  const cart: CartClient = {
    createCart: (sessionId, externalCallContext) =>
      options.cart.createCart(sessionId, externalCallContext),
    async applyChanges(current, changes, externalCallContext) {
      const checked = await verify(
        [
          ...current.items.map((item) => item.itemCode),
          ...changes.map((change) => change.itemCode),
        ],
        externalCallContext,
      );
      return checked.ok
        ? options.cart.applyChanges(
            current,
            changes,
            externalCallContext,
          )
        : fail<Cart>(checked.message);
    },
    async updateCart(
      current,
      itemCode,
      quantity,
      modifiers,
      externalCallContext,
    ) {
      const checked = await verify(
        [...current.items.map((item) => item.itemCode), itemCode],
        externalCallContext,
      );
      return checked.ok
        ? options.cart.updateCart(
            current,
            itemCode,
            quantity,
            modifiers,
            externalCallContext,
          )
        : fail<Cart>(checked.message);
    },
    previewCart: (current, externalCallContext) =>
      options.cart.previewCart(current, externalCallContext),
  };

  const verifyCart = async (
    cart: Cart,
    externalCallContext: ExternalCallContext,
  ): Promise<ToolResult<true>> =>
    verify(
      cart.items.map((item) => item.itemCode),
      externalCallContext,
    );
  const oms: OmsClient = {
    async previewOrder(input, externalCallContext) {
      const checked = await verifyCart(input.cart, externalCallContext);
      return checked.ok
        ? options.oms.previewOrder(input, externalCallContext)
        : fail(checked.message);
    },
    async placeOrder(input, externalCallContext, mutationIdentity) {
      const checked = await verifyCart(
        input.preview.cart,
        externalCallContext,
      );
      return checked.ok
        ? options.oms.placeOrder(input, externalCallContext, mutationIdentity)
        : fail(checked.message);
    },
    getOrderStatus: (orderId, externalCallContext) =>
      options.oms.getOrderStatus(orderId, externalCallContext),
    cancelOrder: (
      orderId,
      externalCallContext,
      mutationIdentity,
    ) =>
      options.oms.cancelOrder(
        orderId,
        externalCallContext,
        mutationIdentity,
      ),
  };

  return {
    confirmationAuthority: {
      environment: options.pinned.environment,
      scenarioId: 'live-agent',
      catalogObservationId: options.pinned.id,
      catalogObservationHash: options.pinned.sha256,
      providerRevision: options.pinned.providerFingerprint,
      async revalidate(binding, externalCallContext) {
        const current = await options.fetchCurrent(externalCallContext);
        return current.environment === binding.environment &&
          current.providerFingerprint === binding.providerRevision &&
          current.id === binding.catalogObservationId &&
          current.sha256 === binding.catalogObservationHash
          ? { ok: true }
          : { ok: false, reason: 'Catalog or provider binding changed' };
      },
    },
    menu,
    recommendation,
    cart,
    oms,
  };
}
