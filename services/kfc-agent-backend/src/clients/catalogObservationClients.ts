import type {
  CartClient,
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

function ok<T>(value: T): ToolResult<T> {
  return { ok: true, value, message: 'verified_catalog_observation' };
}

function fail<T>(message: string): ToolResult<T> {
  return { ok: false, errorCode: 'catalog_observation_stale', message };
}

function normalized(value: string): string {
  return value.toLowerCase().replace(/đ/g, 'd').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

type RawGroup = CatalogItemFact['modifierGroups'][number];

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
  fetchCurrent(): Promise<CatalogObservation>;
  cart: CartClient;
  oms: OmsClient;
}

export function createCatalogObservationClients(options: CatalogObservationClientOptions): {
  confirmationAuthority: IrreversibleConfirmationAuthority;
  menu: MenuClient;
  recommendation: RecommendationClient;
  cart: CartClient;
  oms: OmsClient;
} {
  const byCode = new Map(options.pinned.items.map((item) => [item.itemCode, item]));

  const verify = async (itemCodes: string[]): Promise<ToolResult<true>> => {
    const current = await options.fetchCurrent();
    const result = revalidateCatalogPin(options.pinned, current, itemCodes);
    return result.ok ? ok(true) : fail(`Catalog changed for ${result.changedItemCodes.join(', ')}`);
  };

  const menu: MenuClient = {
    async searchMenu(query) {
      const words = normalized(query).split(/\s+/).filter(Boolean);
      return ok(options.pinned.items
        .filter((item) => words.every((word) => normalized(`${item.name} ${item.category} ${item.itemCode}`).includes(word)))
        .map(toMenuItem));
    },
    async getItemDetails(code) {
      const item = byCode.get(code);
      return item ? ok(toMenuItem(item)) : { ok: false, errorCode: 'item_not_found', message: `No current item ${code}` };
    },
    async getModifierOptions(code) {
      const item = byCode.get(code);
      return item && item.modifierGroups.length > 0
        ? ok({
            itemCode: item.itemCode,
            itemId: item.itemCode,
            productCode: item.productCode,
            name: item.name,
            modifierGroups: toGeneratedGroups(item.modifierGroups),
            provenance: { sourceFile: options.pinned.sourceUrl, fixtureMode: 'current_api' },
          })
        : { ok: false, errorCode: 'modifiers_not_found', message: `No current modifiers for ${code}` };
    },
    async getPlanningContext(input) {
      const matches = await menu.searchMenu(input.query);
      if (!matches.ok) return { ok: false, errorCode: matches.errorCode, message: matches.message };
      return ok({
        query: input.query,
        candidates: (matches.value ?? []).slice(0, input.maxCandidates).map((item) => ({
          code: item.code,
          itemId: item.itemId ?? item.code,
          productCode: item.productCode ?? '',
          name: item.name,
          category: item.category,
          description: item.description,
          priceVnd: item.priceVnd,
          originalPriceVnd: item.originalPriceVnd,
          imageUrl: item.imageUrl,
          available: item.available,
          isCustomize: item.isCustomize,
          isQuickCombo: item.isQuickCombo,
          hasModifiers: item.hasModifiers,
          verifiedForMutation: true,
          verificationQuery: input.query,
          activeCartItem: input.activeItemCodes.includes(item.code) ? true : undefined,
          activeCartQuantity: input.activeItemQuantities?.[item.code],
          modifierGroups: (item.modifierGroups ?? []).map((group) => ({
            groupId: group.groupId,
            name: group.name,
            min: group.min,
            max: group.max,
            requiredSelections: [],
            options: group.options.map((option) => ({
              modifierId: option.modifierId,
              name: option.name,
              priceDeltaVnd: option.priceDeltaVnd,
              default: option.default,
              quantity: option.quantity ?? undefined,
              selectionBundle: [{ groupId: group.groupId, modifierId: option.modifierId, quantity: option.quantity ?? undefined }],
            })),
          })),
        })),
      });
    },
  };

  const recommendation: RecommendationClient = {
    async recommendAddOns(cart) {
      try {
        createVerifiedCommerceProjection({
          environment: options.pinned.environment,
          observation: options.pinned,
          subjectId: options.sessionId,
          journeyId: options.sessionId,
          factGroups: [{
            key: 'catalog',
            environment: options.pinned.environment,
            providerFingerprint: options.pinned.providerFingerprint,
            subjectId: options.sessionId,
            journeyId: options.sessionId,
            revision: options.pinned.id,
            verifiedAt: options.pinned.observedAt,
            expiresAt: options.pinned.expiresAt ?? new Date(Date.parse(options.pinned.observedAt) + 300_000).toISOString(),
            dependencies: [],
            value: options.pinned.items,
          }],
        });
      } catch (error) {
        return fail(error instanceof Error ? error.message : 'Catalog projection is stale');
      }
      const inCart = new Set(cart.items.map((item) => item.itemCode));
      return ok(rankEligibleRecommendations(options.pinned.items.map((item) => ({
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
    createCart: (sessionId) => options.cart.createCart(sessionId),
    async applyChanges(current, changes) {
      const checked = await verify([...current.items.map((item) => item.itemCode), ...changes.map((change) => change.itemCode)]);
      return checked.ok ? options.cart.applyChanges(current, changes) : fail<Cart>(checked.message);
    },
    async updateCart(current, itemCode, quantity, modifiers) {
      const checked = await verify([...current.items.map((item) => item.itemCode), itemCode]);
      return checked.ok ? options.cart.updateCart(current, itemCode, quantity, modifiers) : fail<Cart>(checked.message);
    },
    previewCart: (current) => options.cart.previewCart(current),
  };

  const verifyCart = async (cart: Cart): Promise<ToolResult<true>> => verify(cart.items.map((item) => item.itemCode));
  const oms: OmsClient = {
    async previewOrder(input) {
      const checked = await verifyCart(input.cart);
      return checked.ok ? options.oms.previewOrder(input) : fail(checked.message);
    },
    async placeOrder(input) {
      const checked = await verifyCart(input.preview.cart);
      return checked.ok ? options.oms.placeOrder(input) : fail(checked.message);
    },
    getOrderStatus: (orderId) => options.oms.getOrderStatus(orderId),
    cancelOrder: (orderId) => options.oms.cancelOrder(orderId),
  };

  return {
    confirmationAuthority: {
      environment: options.pinned.environment,
      scenarioId: 'live-agent',
      catalogObservationId: options.pinned.id,
      catalogObservationHash: options.pinned.sha256,
      providerRevision: options.pinned.providerFingerprint,
      async revalidate(binding) {
        const current = await options.fetchCurrent();
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
