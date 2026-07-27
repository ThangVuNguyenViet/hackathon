import type {
  Address,
  Cart,
  CartItem,
  CustomerAccessScope,
  MenuItem,
  Order,
} from '../domain/types.js';
import type { VerifiedRef } from '../domain/verifiedRef.js';
import { agentStateWithCurrentOrderStatusEvidence } from './orderStatusEvidenceProjection.js';
import {
  activeCartSupersedesSubmittedOrder,
  cartMatchesSubmittedOrder,
} from './activeCheckout.js';
import type { AgentState } from './agentState.js';
import type {
  CollectionToolName,
  ContentEvidence,
  FulfillmentState,
  VerifiedCollectionResult,
} from '../ordering/types.js';
import { paymentAttemptForVerifiedOrder } from '../ordering/paymentOrderAuthority.js';
import { responseEvidenceContractForTool } from './responseEvidenceContracts.js';

const terminalOrderStatuses = new Set<Order['status']>([
  'completed',
  'cancelled',
]);

const projectedCollectionToolNames = [
  'searchMenu',
  'findStores',
  'searchPromotions',
  'listMembershipRewards',
  'listMembershipWallet',
  'listMembershipTools',
  'listPaymentMethods',
  'searchContentPolicy',
  'answerAllergenQuestion',
] as const satisfies readonly CollectionToolName[];

export interface ModelPublicationLifecycle {
  currentUserMessageDigest: string;
  authorityDigest: string;
  currentTurnRevision: string;
  order:
    | 'none'
    | 'preview'
    | 'active'
    | 'terminal_hidden'
    | 'submitted_history_hidden';
  cart: 'none' | 'active' | 'terminal_history_hidden';
  address: 'none' | 'active' | 'superseded_by_draft' | 'history_hidden';
  fulfillment: 'none' | 'active' | 'superseded_by_draft' | 'history_hidden';
  payment: 'none' | 'active' | 'history_hidden';
  customerHistory: 'hidden';
}

export interface ModelPublicationOrder {
  id: string;
  cart: Cart;
  status: Order['status'];
  paymentStatus: Order['paymentStatus'];
  assignedStoreId: string;
  createdAt: string;
  deliveryEstimate?: {
    kind: 'remaining_delivery_window';
    minMinutes: number;
    maxMinutes: number;
    observedAt: string;
    expiresAt: string;
  };
}

export interface ModelPublicationState {
  cart?: Cart;
  activeCollections?: Partial<Record<CollectionToolName, unknown>>;
  selectedModifiers?: AgentState['selectedModifiers'];
  menuSearchResults?: MenuItem[];
  menuItemDetail?: MenuItem;
  menuModifierOptions?: unknown;
  address?: Address;
  addressDraft?: Partial<Address>;
  orderPreview?: ModelPublicationOrder;
  order?: ModelPublicationOrder;
  fulfillment?: unknown;
  promotionOffers?: unknown[];
  paymentAttempt?: {
    method?: string;
    status: 'pending' | 'paid' | 'failed';
  };
  selectedPaymentMethod?: { methodId: string };
  paymentMethodEvidence?: unknown[];
  invoiceRequest?: { collected: true };
  handoff?: { active: true };
  pendingSavedAddressRef?: VerifiedRef;
}

export function projectAddress(address: Address): Address {
  return {
    label: address.label,
    line1: address.line1,
    district: address.district,
    city: address.city,
  };
}

function projectAddressDraft(
  address: Partial<Address> | undefined,
): Partial<Address> | undefined {
  if (!address) return undefined;
  const projected: Partial<Address> = {};
  if (address.label !== undefined) projected.label = address.label;
  if (address.line1 !== undefined) projected.line1 = address.line1;
  if (address.district !== undefined) projected.district = address.district;
  if (address.city !== undefined) projected.city = address.city;
  return Object.keys(projected).length > 0 ? projected : undefined;
}

function latestSuccessfulQuoteUsesSavedAddress(state: AgentState): boolean {
  const latestQuote = [...(state.toolTrace ?? [])]
    .reverse()
    .find((entry) => entry.ok && entry.toolName === 'quoteFulfillment');
  if (!latestQuote) return false;
  const ref = latestQuote.arguments.savedAddressRef;
  return (
    typeof ref === 'object' &&
    ref !== null &&
    !Array.isArray(ref) &&
    'kind' in ref &&
    'id' in ref &&
    ref.kind === 'saved_address' &&
    typeof ref.id === 'string'
  );
}

function projectCartItem(item: CartItem): CartItem {
  return {
    itemCode: item.itemCode,
    name: item.name,
    quantity: item.quantity,
    unitPriceVnd: item.unitPriceVnd,
    ...(item.modifiers
      ? {
          modifiers: item.modifiers.map((modifier) => ({
            groupId: modifier.groupId,
            groupName: modifier.groupName,
            modifierId: modifier.modifierId,
            modifierName: modifier.modifierName,
            quantity: modifier.quantity,
            priceDeltaVnd: modifier.priceDeltaVnd,
          })),
        }
      : {}),
    ...(item.imageUrl !== undefined ? { imageUrl: item.imageUrl } : {}),
    ...(item.category !== undefined ? { category: item.category } : {}),
  };
}

export function projectCart(cart: Cart): Cart {
  return {
    id: cart.id,
    items: cart.items.map(projectCartItem),
    subtotalVnd: cart.subtotalVnd,
    discountVnd: cart.discountVnd,
    deliveryFeeVnd: cart.deliveryFeeVnd,
    totalVnd: cart.totalVnd,
    voucherCode: cart.voucherCode,
  };
}

function projectModifierGroups(
  groups: MenuItem['modifierGroups'],
): MenuItem['modifierGroups'] {
  return groups?.map((group) => ({
    groupId: group.groupId,
    name: group.name,
    min: group.min,
    max: group.max,
    depth: group.depth,
    options: group.options.map((option) => ({
      modifierId: option.modifierId,
      name: option.name,
      priceDeltaVnd: option.priceDeltaVnd,
      default: option.default,
      quantity: option.quantity,
      modifierGroups: projectModifierGroups(option.modifierGroups) ?? [],
    })),
  }));
}

export function projectMenuItem(item: MenuItem): MenuItem {
  return {
    code: item.code,
    ...(item.itemId !== undefined ? { itemId: item.itemId } : {}),
    ...(item.productCode !== undefined
      ? { productCode: item.productCode }
      : {}),
    category: item.category,
    categoryId: item.categoryId,
    name: item.name,
    description: item.description,
    priceVnd: item.priceVnd,
    originalPriceVnd: item.originalPriceVnd,
    imageUrl: item.imageUrl,
    available: item.available,
    ...(item.isCustomize !== undefined
      ? { isCustomize: item.isCustomize }
      : {}),
    ...(item.isQuickCombo !== undefined
      ? { isQuickCombo: item.isQuickCombo }
      : {}),
    ...(item.hasModifiers !== undefined
      ? { hasModifiers: item.hasModifiers }
      : {}),
    ...(item.modifierGroups
      ? { modifierGroups: projectModifierGroups(item.modifierGroups) }
      : {}),
  };
}

export function projectOrder(order: Order): ModelPublicationOrder {
  return {
    id: order.id,
    cart: projectCart(order.cart),
    status: order.status,
    paymentStatus: order.paymentStatus,
    assignedStoreId: order.assignedStoreId,
    createdAt: order.createdAt,
    ...(order.deliveryEstimate
      ? {
          deliveryEstimate: {
            kind: order.deliveryEstimate.kind,
            minMinutes: order.deliveryEstimate.minMinutes,
            maxMinutes: order.deliveryEstimate.maxMinutes,
            observedAt: order.deliveryEstimate.observedAt,
            expiresAt: order.deliveryEstimate.expiresAt,
          },
        }
      : {}),
  };
}

export function projectFulfillment(
  fulfillment: FulfillmentState,
): ModelPublicationState['fulfillment'] {
  return {
    method: fulfillment.method,
    disposition: fulfillment.disposition,
    storeId: fulfillment.storeId,
    storeName: fulfillment.storeName,
    feeVnd: fulfillment.feeVnd,
    etaMinutes: fulfillment.etaMinutes,
    availability: {
      ok: fulfillment.availability.ok,
      checkedItemIds: [...fulfillment.availability.checkedItemIds],
      unavailableItemIds: [...fulfillment.availability.unavailableItemIds],
      blockedTimeslotItemIds: [
        ...fulfillment.availability.blockedTimeslotItemIds,
      ],
    },
  };
}

export function projectPromotionOffer(value: Record<string, unknown>): unknown {
  return {
    offerId: value.offerId,
    imageUrl: value.imageUrl,
    campaign: value.campaign,
    campaignType: value.campaignType,
    offerType: value.offerType,
    offerName: value.offerName,
    discountPercent: value.discountPercent,
    discountAmountVnd: value.discountAmountVnd,
    priceVnd: value.priceVnd,
    minimumOrderVnd: value.minimumOrderVnd,
    maximumDiscountVnd: value.maximumDiscountVnd,
    giftQuantity: value.giftQuantity,
    partnerBrand: value.partnerBrand,
    appliesTo: value.appliesTo,
    channel: value.channel,
    startDate: value.startDate,
    endDate: value.endDate,
    actualCodeExposed: value.actualCodeExposed,
    publicCode: value.publicCode,
    requiresLogin: value.requiresLogin,
    requiresPartnerApi: value.requiresPartnerApi,
    redemptionSurface: value.redemptionSurface,
  };
}

export function projectPaymentMethod(value: Record<string, unknown>): unknown {
  return {
    methodId: value.methodId,
    displayName: value.displayName,
    category: value.category,
    supported: value.supported,
    supportStatus: value.supportStatus,
    paymentSurface: value.paymentSurface,
  };
}

export function projectContentEvidence(content: ContentEvidence): unknown {
  return {
    ...(content.id !== undefined ? { id: content.id } : {}),
    kind: content.kind,
    title: content.title,
    snippet: content.snippet,
    sourceUrl: content.sourceUrl,
    ...(content.tags !== undefined ? { tags: [...content.tags] } : {}),
  };
}

export function projectMenuModifierOptions(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const groups = Array.isArray(record.modifierGroups)
    ? record.modifierGroups.flatMap((group) => {
        if (
          typeof group !== 'object' ||
          group === null ||
          Array.isArray(group)
        ) {
          return [];
        }
        const groupRecord = group as Record<string, unknown>;
        const options = Array.isArray(groupRecord.options)
          ? groupRecord.options.flatMap((option) => {
              if (
                typeof option !== 'object' ||
                option === null ||
                Array.isArray(option)
              ) {
                return [];
              }
              const optionRecord = option as Record<string, unknown>;
              return [
                {
                  modifierId: optionRecord.modifierId,
                  name: optionRecord.name,
                  priceDeltaVnd: optionRecord.priceDeltaVnd,
                  default: optionRecord.default,
                  quantity: optionRecord.quantity,
                },
              ];
            })
          : [];
        return [
          {
            groupId: groupRecord.groupId,
            name: groupRecord.name,
            min: groupRecord.min,
            max: groupRecord.max,
            depth: groupRecord.depth,
            options,
          },
        ];
      })
    : [];
  return {
    itemCode: record.itemCode,
    itemId: record.itemId,
    productCode: record.productCode,
    name: record.name,
    modifierGroups: groups,
  };
}

function projectCollectionItems(
  toolName: CollectionToolName,
  items: unknown[],
): unknown[] | undefined {
  switch (toolName) {
    case 'searchMenu':
      return items.map((item) => projectMenuItem(item as MenuItem));
    case 'findStores':
      return items.map((item) => {
        const record = item as Record<string, unknown>;
        return {
          storeId: record.storeId,
          name: record.name,
          address: record.address,
          city: record.city,
        };
      });
    case 'searchPromotions':
      return items.map((item) =>
        projectPromotionOffer(item as Record<string, unknown>),
      );
    case 'listPaymentMethods':
      return items.map((item) =>
        projectPaymentMethod(item as Record<string, unknown>),
      );
    case 'listMembershipRewards':
      return items.map((item) => {
        const record = item as Record<string, unknown>;
        return {
          rewardId: record.rewardId,
          name: record.name,
          brand: record.brand,
          offerType: record.offerType,
          pointsCost: record.pointsCost,
          minimumOrderVnd: record.minimumOrderVnd,
          discountAmountVnd: record.discountAmountVnd,
          discountPercent: record.discountPercent,
          priceVnd: record.priceVnd,
          channels: record.channels,
          usageSurface: record.usageSurface,
          eligibilityText: record.eligibilityText,
          imageUrl: record.imageUrl,
          requiresLogin: record.requiresLogin,
        };
      });
    case 'listMembershipWallet':
      return items.map((item) => {
        const record = item as Record<string, unknown>;
        return {
          voucherId: record.voucherId,
          name: record.name,
          description: record.description,
          status: record.status,
          remainingValidityText: record.remainingValidityText,
          discountAmountVnd: record.discountAmountVnd,
          discountPercent: record.discountPercent,
          priceVnd: record.priceVnd,
          channels: record.channels,
          usageSurface: record.usageSurface,
          imageUrl: record.imageUrl,
        };
      });
    case 'listMembershipTools':
      return items.map((item) => {
        const record = item as Record<string, unknown>;
        return {
          toolName: record.toolName,
          category: record.category,
          sideEffect: record.sideEffect,
          requiresAuthenticatedMembership:
            record.requiresAuthenticatedMembership,
          requiresUserConfirmation: record.requiresUserConfirmation,
        };
      });
    case 'searchContentPolicy':
    case 'answerAllergenQuestion':
      return items.map((item) =>
        projectContentEvidence(item as ContentEvidence),
      );
    default:
      return undefined;
  }
}

export function projectCollectionResult(
  toolName: CollectionToolName,
  result: VerifiedCollectionResult<unknown>,
): unknown | undefined {
  const items = projectCollectionItems(toolName, result.items);
  if (!items) return undefined;
  return {
    items,
    total: result.total,
    returned: result.returned,
    complete: result.complete,
    scope: structuredClone(result.scope),
    ...(result.cursor !== undefined ? { cursor: result.cursor } : {}),
  };
}

function projectActiveCollections(
  state: AgentState,
  authorizedScopes: ReadonlySet<CustomerAccessScope>,
): Partial<Record<CollectionToolName, unknown>> | undefined {
  const projected: Partial<Record<CollectionToolName, unknown>> = {};
  for (const toolName of projectedCollectionToolNames) {
    const contract = responseEvidenceContractForTool(toolName);
    if (
      !contract.requiredScopes.every((scope) => authorizedScopes.has(scope))
    ) {
      continue;
    }
    const key = state.activeCollectionKeys?.[toolName];
    if (!key) continue;
    const snapshot = state.verifiedCollections?.[toolName]?.[key];
    if (!snapshot) continue;
    const result = projectCollectionResult(
      toolName,
      snapshot.result as VerifiedCollectionResult<unknown>,
    );
    if (result !== undefined) projected[toolName] = result;
  }
  return Object.keys(projected).length > 0 ? projected : undefined;
}

function activeCollectionItems(
  collections: Partial<Record<CollectionToolName, unknown>> | undefined,
  toolName: CollectionToolName,
): unknown[] | undefined {
  const collection = collections?.[toolName];
  if (
    typeof collection !== 'object' ||
    collection === null ||
    Array.isArray(collection)
  ) {
    return undefined;
  }
  const items = (collection as Record<string, unknown>).items;
  return Array.isArray(items) ? items : undefined;
}

function draftSupersedesAddress(
  address: Address | undefined,
  draft: Partial<Address> | undefined,
): boolean {
  if (!address || !draft) return false;
  return (['label', 'line1', 'district', 'city'] as const).some(
    (field) => draft[field] !== undefined && draft[field] !== address[field],
  );
}

export function projectModelPublicationState(input: {
  state: AgentState;
  currentUserMessageDigest: string;
  authorityDigest: string;
  currentTurnRevision: string;
  authorizedScopes: readonly CustomerAccessScope[];
}): {
  modelState: ModelPublicationState;
  lifecycle: ModelPublicationLifecycle;
} {
  const state = agentStateWithCurrentOrderStatusEvidence(input.state);
  const authorizedScopes = new Set(input.authorizedScopes);
  const canReadCustomer = authorizedScopes.has('customer:read');
  const canReadOrder = authorizedScopes.has('order:read');
  const canReadPayment = authorizedScopes.has('payment:read');
  const terminalOrder =
    state.order !== undefined && terminalOrderStatuses.has(state.order.status);
  const submittedOrderHistory = activeCartSupersedesSubmittedOrder(state);
  const activeOrder =
    state.order !== undefined && !terminalOrder && !submittedOrderHistory;
  const activePreview =
    state.orderPreview !== undefined &&
    !terminalOrderStatuses.has(state.orderPreview.status) &&
    (!terminalOrder || state.orderPreview.id !== state.order?.id);
  const tiedTerminalCart =
    terminalOrder && cartMatchesSubmittedOrder(state.cart, state.order);
  const activeCart = state.cart !== undefined && !tiedTerminalCart;
  const addressDraft = projectAddressDraft(state.addressDraft);
  const addressSuperseded = draftSupersedesAddress(state.address, addressDraft);
  const privateSavedAddress = latestSuccessfulQuoteUsesSavedAddress(state);
  const activeCommerce =
    activeOrder || activePreview || activeCart || addressDraft !== undefined;
  const retainAddress =
    !terminalOrder &&
    activeCommerce &&
    !addressSuperseded &&
    !privateSavedAddress &&
    state.address !== undefined;
  const retainFulfillment =
    !terminalOrder &&
    activeCommerce &&
    !addressSuperseded &&
    state.fulfillment !== undefined;
  const retainPayment =
    !terminalOrder &&
    !submittedOrderHistory &&
    (activeOrder || activePreview || activeCart);
  const activeCollections = projectActiveCollections(state, authorizedScopes);
  const activeMenuItems = activeCollectionItems(
    activeCollections,
    'searchMenu',
  ) as MenuItem[] | undefined;
  const activePromotionOffers = activeCollectionItems(
    activeCollections,
    'searchPromotions',
  );
  const activePaymentMethods = activeCollectionItems(
    activeCollections,
    'listPaymentMethods',
  );
  const authorizedPaymentAttempt = paymentAttemptForVerifiedOrder(
    state.paymentAttempt,
    state.order,
  );

  const modelState: ModelPublicationState = {
    ...(activeCart && state.cart ? { cart: projectCart(state.cart) } : {}),
    ...(activeCollections ? { activeCollections } : {}),
    ...(activeMenuItems
      ? { menuSearchResults: structuredClone(activeMenuItems) }
      : {}),
    ...(activeCart && state.selectedModifiers
      ? { selectedModifiers: structuredClone(state.selectedModifiers) }
      : {}),
    ...(canReadCustomer && retainAddress && state.address
      ? { address: projectAddress(state.address) }
      : {}),
    ...(canReadCustomer && addressDraft ? { addressDraft } : {}),
    ...(canReadOrder && activePreview && state.orderPreview
      ? { orderPreview: projectOrder(state.orderPreview) }
      : {}),
    ...(canReadOrder && activeOrder && state.order
      ? { order: projectOrder(state.order) }
      : {}),
    ...(canReadCustomer && retainFulfillment && state.fulfillment
      ? { fulfillment: projectFulfillment(state.fulfillment) }
      : {}),
    ...(activePromotionOffers
      ? { promotionOffers: structuredClone(activePromotionOffers) }
      : {}),
    ...(canReadPayment && retainPayment && authorizedPaymentAttempt
      ? {
          paymentAttempt: {
            ...(authorizedPaymentAttempt.method
              ? { method: authorizedPaymentAttempt.method }
              : {}),
            status: authorizedPaymentAttempt.status,
          },
        }
      : {}),
    ...(canReadPayment && retainPayment && state.selectedPaymentMethod
      ? {
          selectedPaymentMethod: {
            methodId: state.selectedPaymentMethod.methodId,
          },
        }
      : {}),
    ...(canReadPayment && retainPayment && activePaymentMethods
      ? { paymentMethodEvidence: structuredClone(activePaymentMethods) }
      : {}),
    ...(canReadPayment && retainPayment && state.invoiceRequest
      ? { invoiceRequest: { collected: true } }
      : {}),
    ...(state.handoff ? { handoff: { active: true } } : {}),
    ...(canReadCustomer && activeCart && state.pendingSavedAddressRef
      ? {
          pendingSavedAddressRef: structuredClone(state.pendingSavedAddressRef),
        }
      : {}),
  };

  return {
    modelState,
    lifecycle: {
      currentUserMessageDigest: input.currentUserMessageDigest,
      authorityDigest: input.authorityDigest,
      currentTurnRevision: input.currentTurnRevision,
      order: !canReadOrder
        ? 'none'
        : terminalOrder
          ? 'terminal_hidden'
          : submittedOrderHistory
            ? 'submitted_history_hidden'
            : activeOrder
              ? 'active'
              : activePreview
                ? 'preview'
                : 'none',
      cart:
        tiedTerminalCart && !canReadOrder
          ? 'none'
          : tiedTerminalCart
            ? 'terminal_history_hidden'
            : activeCart
              ? 'active'
              : 'none',
      address: !canReadCustomer
        ? 'none'
        : addressSuperseded
          ? 'superseded_by_draft'
          : retainAddress
            ? 'active'
            : state.address
              ? 'history_hidden'
              : 'none',
      fulfillment: !canReadCustomer
        ? 'none'
        : addressSuperseded
          ? 'superseded_by_draft'
          : retainFulfillment
            ? 'active'
            : state.fulfillment
              ? 'history_hidden'
              : 'none',
      payment: !canReadPayment
        ? 'none'
        : retainPayment &&
            (authorizedPaymentAttempt ||
              state.selectedPaymentMethod ||
              state.paymentMethodEvidence)
          ? 'active'
          : (terminalOrder || submittedOrderHistory) &&
              (authorizedPaymentAttempt ||
                state.selectedPaymentMethod ||
                state.paymentMethodEvidence)
            ? 'history_hidden'
            : 'none',
      customerHistory: 'hidden',
    },
  };
}
