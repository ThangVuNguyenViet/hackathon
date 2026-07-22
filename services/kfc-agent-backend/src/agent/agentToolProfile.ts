import type { CustomerAccessContext, Channel } from '../domain/types.js';
import type { RunCommitFence } from '../persistence/contracts.js';
import type { AgentGraphState } from '../graph/state.js';
import { activeCartSupersedesSubmittedOrder } from '../graph/activeCheckout.js';
import { authorizeCustomerAccess } from '../security/customerAccessContext.js';
import {
  TOOL_NAMES,
  type CollectionToolName,
  type ToolName,
  type VerifiedGuestApprovalResumeAuthority,
} from '../ordering/types.js';
import {
  currentTurnRecentOrderFromIssuedExecutions,
  type GraphExecutedToolResult,
} from './graphExecutedToolResult.js';
import {
  authorizeGuestCheckout,
  type GuestCheckoutAuthority,
} from '../security/guestCheckoutAuthority.js';
import { verifiedGuestApprovalAuthorityIsIssued } from '../security/verifiedGuestApprovalAuthority.js';
import type { ModelPublicationAuthority } from './modelPublicationAuthority.js';
import { hasCurrentMembershipCapabilityEligibility } from '../ordering/agentMembershipApprovalAuthority.js';

export const AGENT_TOOL_CAPABILITY_SCHEMA_VERSION =
  'kfc-agent-tool-capabilities-v1' as const;

const issuedCapabilitySnapshots = new WeakSet<object>();
const channelSet = new Set<Channel>([
  'messenger',
  'zalo',
  'kfc',
  'messenger_mock',
  'zalo_mock',
]);
const toolNameSet = new Set<string>(TOOL_NAMES);

function isToolName(value: unknown): value is ToolName {
  return typeof value === 'string' && toolNameSet.has(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export interface AgentToolCapabilitySnapshot {
  readonly schemaVersion: typeof AGENT_TOOL_CAPABILITY_SCHEMA_VERSION;
  readonly channel: Channel;
  readonly enabledTools: readonly ToolName[];
  readonly durableApprovalResumeSupported: boolean;
  readonly handoffResolutionSupported: boolean;
}

export type AgentToolCapabilityResolver = (
  channel: Channel,
) => AgentToolCapabilitySnapshot;

export type AgentToolProfileLifecycle = Pick<
  AgentGraphState,
  | 'sessionId'
  | 'customerId'
  | 'channel'
  | 'cart'
  | 'address'
  | 'fulfillment'
  | 'orderPreview'
  | 'order'
  | 'handoff'
  | 'verifiedCollections'
  | 'activeCollectionKeys'
>;

export interface DeriveAgentToolProfileInput {
  lifecycle: AgentToolProfileLifecycle;
  accessContext?: CustomerAccessContext;
  guestCheckoutAuthority?: GuestCheckoutAuthority;
  verifiedGuestAuthority?: VerifiedGuestApprovalResumeAuthority;
  runFence?: RunCommitFence;
  externalMessageId?: string | null;
  confirmationResume?: boolean;
  capabilities: AgentToolCapabilitySnapshot;
  currentTurn?: {
    authority: ModelPublicationAuthority;
    executions: readonly GraphExecutedToolResult[];
  };
  now: number;
}

export function createAgentToolCapabilitySnapshot(input: {
  channel: Channel;
  enabledTools: readonly unknown[];
  durableApprovalResumeSupported: boolean;
  handoffResolutionSupported: boolean;
}): AgentToolCapabilitySnapshot {
  if (
    !channelSet.has(input.channel) ||
    typeof input.durableApprovalResumeSupported !== 'boolean' ||
    typeof input.handoffResolutionSupported !== 'boolean'
  ) {
    throw new Error('agent_tool_capability_snapshot_invalid');
  }
  const names: ToolName[] = [];
  const seen = new Set<ToolName>();
  for (const candidate of input.enabledTools) {
    if (!isToolName(candidate)) {
      throw new Error('agent_tool_capability_snapshot_invalid');
    }
    if (seen.has(candidate)) {
      throw new Error('agent_tool_capability_snapshot_duplicate_tool');
    }
    seen.add(candidate);
    names.push(candidate);
  }
  const enabled = new Set(names);
  const snapshot = Object.freeze({
    schemaVersion: AGENT_TOOL_CAPABILITY_SCHEMA_VERSION,
    channel: input.channel,
    enabledTools: Object.freeze(TOOL_NAMES.filter((name) => enabled.has(name))),
    durableApprovalResumeSupported: input.durableApprovalResumeSupported,
    handoffResolutionSupported: input.handoffResolutionSupported,
  });
  issuedCapabilitySnapshots.add(snapshot);
  return snapshot;
}

interface ActiveCollection {
  result: {
    items: unknown[];
    total: number;
    returned: number;
    complete: boolean;
  };
}

function activeCollection(
  lifecycle: AgentToolProfileLifecycle,
  toolName: CollectionToolName,
): ActiveCollection | undefined {
  const key = lifecycle.activeCollectionKeys?.[toolName];
  if (!key) return undefined;
  const collections: unknown = lifecycle.verifiedCollections?.[toolName];
  if (!isRecord(collections)) return undefined;
  const snapshot: unknown = collections[key];
  if (
    !isRecord(snapshot) ||
    !snapshot ||
    snapshot.key !== key ||
    typeof snapshot.revision !== 'string' ||
    !snapshot.revision.trim() ||
    typeof snapshot.providerRevision !== 'string' ||
    !snapshot.providerRevision.trim() ||
    !isRecord(snapshot.result) ||
    !Array.isArray(snapshot.result.items) ||
    typeof snapshot.result.returned !== 'number' ||
    typeof snapshot.result.total !== 'number' ||
    typeof snapshot.result.complete !== 'boolean' ||
    snapshot.result.returned !== snapshot.result.items.length ||
    snapshot.result.total < snapshot.result.returned
  ) {
    return undefined;
  }
  return {
    result: {
      items: snapshot.result.items,
      total: snapshot.result.total,
      returned: snapshot.result.returned,
      complete: snapshot.result.complete,
    },
  };
}

function activeCollectionHasIdentifier(
  lifecycle: AgentToolProfileLifecycle,
  toolName: CollectionToolName,
  identifier: string,
): boolean {
  const collection = activeCollection(lifecycle, toolName);
  return (
    collection?.result.items.some(
      (item) =>
        isRecord(item) &&
        typeof item[identifier] === 'string' &&
        item[identifier].trim().length > 0,
    ) ?? false
  );
}

function activePaymentCollectionHasSupportedMethod(
  lifecycle: AgentToolProfileLifecycle,
): boolean {
  const collection = activeCollection(lifecycle, 'listPaymentMethods');
  return Boolean(
    collection &&
    collection.result.complete &&
    collection.result.total === collection.result.returned &&
    collection.result.items.some(
      (item) =>
        isRecord(item) &&
        typeof item.methodId === 'string' &&
        item.methodId.trim().length > 0 &&
        item.supported === true &&
        item.supportStatus === 'listed_supported',
    ),
  );
}

function hasScopes(
  input: DeriveAgentToolProfileInput,
  scopes: readonly CustomerAccessContext['authorizedScopes'][number][],
): boolean {
  return scopes.every(
    (scope) =>
      authorizeCustomerAccess(
        input.accessContext,
        {
          channel: input.lifecycle.channel,
          sessionId: input.lifecycle.sessionId,
          customerId: input.lifecycle.customerId,
          scope,
        },
        input.now,
      ).allowed,
  );
}

function hasGuestCheckoutAuthority(
  input: DeriveAgentToolProfileInput,
  toolName: 'placeOrder' | 'createPaymentLink',
): boolean {
  const verifiedResume = input.verifiedGuestAuthority;
  if (
    input.confirmationResume === true &&
    verifiedGuestApprovalAuthorityIsIssued(verifiedResume) &&
    (verifiedResume?.toolName === toolName ||
      (verifiedResume?.toolName === 'placeOrder' &&
        toolName === 'createPaymentLink')) &&
    verifiedResume.sessionId === input.lifecycle.sessionId &&
    verifiedResume.customerId === input.lifecycle.customerId &&
    verifiedResume.channel === input.lifecycle.channel &&
    Date.parse(verifiedResume.expiresAt) > input.now
  ) {
    return true;
  }
  const publication = input.currentTurn?.authority;
  if (!publication) return false;
  return authorizeGuestCheckout(input.guestCheckoutAuthority, {
    channel: input.lifecycle.channel,
    sessionId: input.lifecycle.sessionId,
    customerId: input.lifecycle.customerId,
    externalMessageId: input.externalMessageId,
    surfaceSubjectRef: publication.surfaceSubjectRef,
    runFence: input.runFence,
    confirmationResume: input.confirmationResume,
    now: input.now,
  }).allowed;
}

interface EligibilityFacts {
  input: DeriveAgentToolProfileInput;
  hasMenu: boolean;
  hasCart: boolean;
  hasStoreAuthority: boolean;
  hasPromotion: boolean;
  canAcquireVoucher: boolean;
  canRedeemReward: boolean;
  hasPaymentMethods: boolean;
  hasOrderReadAuthority: boolean;
}

type EligibilityRule = (facts: EligibilityFacts) => boolean;

const toolEligibilityRules = {
  searchMenu: () => true,
  getItemDetails: ({ hasMenu }) => hasMenu,
  getModifierOptions: ({ hasMenu }) => hasMenu,
  updateCart: ({ hasMenu, hasCart }) => hasMenu || hasCart,
  previewCart: ({ hasCart }) => hasCart,
  recommendAddOns: ({ hasCart }) => hasCart,
  findStores: () => true,
  checkStoreAvailability: ({ hasCart, hasStoreAuthority }) =>
    hasCart && hasStoreAuthority,
  quoteFulfillment: ({ hasCart }) => hasCart,
  searchPromotions: () => true,
  explainPromotion: ({ hasPromotion }) => hasPromotion,
  validateVoucher: ({ hasCart }) => hasCart,
  getMembershipProfile: ({ input }) => hasScopes(input, ['membership:read']),
  listMembershipRewards: ({ input }) => hasScopes(input, ['membership:read']),
  listMembershipWallet: ({ input }) => hasScopes(input, ['membership:read']),
  getMembershipPointHistory: ({ input }) =>
    hasScopes(input, ['membership:read']),
  listMembershipTools: ({ input }) => hasScopes(input, ['membership:read']),
  listPaymentMethods: () => true,
  getSavedAddresses: ({ input }) => hasScopes(input, ['customer:read']),
  getRecentOrder: ({ input }) =>
    hasScopes(input, ['customer:read', 'order:read']),
  getFavoriteItems: ({ input }) => hasScopes(input, ['customer:read']),
  acquireVoucher: ({ input, canAcquireVoucher }) =>
    canAcquireVoucher &&
    input.capabilities.durableApprovalResumeSupported &&
    hasScopes(input, ['membership:write']),
  redeemReward: ({ input, canRedeemReward }) =>
    canRedeemReward &&
    input.capabilities.durableApprovalResumeSupported &&
    hasScopes(input, ['membership:write']),
  searchContentPolicy: () => true,
  answerAllergenQuestion: () => true,
  previewOrder: ({ input, hasCart }) =>
    hasCart &&
    Boolean(input.lifecycle.address) &&
    Boolean(input.lifecycle.fulfillment?.storeId),
  placeOrder: ({ input }) =>
    Boolean(input.lifecycle.orderPreview) &&
    input.capabilities.durableApprovalResumeSupported &&
    (hasScopes(input, ['order:write']) ||
      hasGuestCheckoutAuthority(input, 'placeOrder')),
  getOrderStatus: ({ input, hasOrderReadAuthority }) =>
    hasOrderReadAuthority && hasScopes(input, ['order:read']),
  createPaymentLink: ({ input, hasPaymentMethods }) =>
    input.lifecycle.order?.status === 'created' &&
    !activeCartSupersedesSubmittedOrder(input.lifecycle) &&
    hasPaymentMethods &&
    input.capabilities.durableApprovalResumeSupported &&
    (hasScopes(input, ['payment:write']) ||
      hasGuestCheckoutAuthority(input, 'createPaymentLink')),
  checkPaymentStatus: ({ input, hasOrderReadAuthority }) =>
    hasOrderReadAuthority && hasScopes(input, ['payment:read']),
  collectInvoice: () => true,
  handoff: ({ input }) =>
    input.capabilities.durableApprovalResumeSupported &&
    hasScopes(input, ['handoff:write']),
  resolveHandoff: ({ input }) =>
    Boolean(input.lifecycle.handoff) &&
    input.capabilities.durableApprovalResumeSupported &&
    input.capabilities.handoffResolutionSupported &&
    hasScopes(input, ['handoff:write']),
} satisfies Record<ToolName, EligibilityRule>;

export function deriveAgentToolProfile(
  input: DeriveAgentToolProfileInput,
): readonly ToolName[] {
  if (
    !Number.isFinite(input.now) ||
    !issuedCapabilitySnapshots.has(input.capabilities) ||
    input.capabilities.schemaVersion !== AGENT_TOOL_CAPABILITY_SCHEMA_VERSION ||
    input.capabilities.channel !== input.lifecycle.channel
  ) {
    throw new Error('agent_tool_capability_snapshot_invalid');
  }
  const hasMenu =
    activeCollectionHasIdentifier(input.lifecycle, 'searchMenu', 'code') ||
    activeCollectionHasIdentifier(input.lifecycle, 'recommendAddOns', 'code');
  const hasCart = (input.lifecycle.cart?.items.length ?? 0) > 0;
  const hasStoreAuthority =
    activeCollectionHasIdentifier(input.lifecycle, 'findStores', 'storeId') ||
    Boolean(input.lifecycle.fulfillment?.storeId);
  const facts: EligibilityFacts = {
    input,
    hasMenu,
    hasCart,
    hasStoreAuthority,
    hasPromotion: activeCollectionHasIdentifier(
      input.lifecycle,
      'searchPromotions',
      'offerId',
    ),
    canAcquireVoucher: hasCurrentMembershipCapabilityEligibility({
      state: input.lifecycle,
      capability: 'acquireVoucher',
    }),
    canRedeemReward: hasCurrentMembershipCapabilityEligibility({
      state: input.lifecycle,
      capability: 'redeemReward',
    }),
    hasPaymentMethods: activePaymentCollectionHasSupportedMethod(
      input.lifecycle,
    ),
    hasOrderReadAuthority:
      Boolean(input.lifecycle.order) ||
      Boolean(
        input.currentTurn &&
        currentTurnRecentOrderFromIssuedExecutions(input.currentTurn),
      ),
  };
  const enabled = new Set(input.capabilities.enabledTools);
  return Object.freeze(
    TOOL_NAMES.filter(
      (toolName) =>
        enabled.has(toolName) && toolEligibilityRules[toolName](facts),
    ),
  );
}

export function createAgentToolProfileResolver(
  configured?: AgentToolCapabilityResolver,
): (
  input: Omit<DeriveAgentToolProfileInput, 'capabilities'> & {
    providerCapabilities?: {
      readonly handoffResolutionSupported: boolean;
    };
  },
) => readonly ToolName[] {
  const defaults = new Map<string, AgentToolCapabilitySnapshot>();
  return (input) => {
    let capabilities = configured?.(input.lifecycle.channel);
    if (!capabilities) {
      const handoffResolutionSupported =
        input.providerCapabilities?.handoffResolutionSupported === true;
      const cacheKey = `${input.lifecycle.channel}:${handoffResolutionSupported}`;
      capabilities = defaults.get(cacheKey);
      if (!capabilities) {
        capabilities = createAgentToolCapabilitySnapshot({
          channel: input.lifecycle.channel,
          enabledTools: TOOL_NAMES,
          durableApprovalResumeSupported: true,
          handoffResolutionSupported,
        });
        defaults.set(cacheKey, capabilities);
      }
    }
    return deriveAgentToolProfile({ ...input, capabilities });
  };
}
