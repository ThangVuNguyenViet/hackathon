import type { Channel } from '../domain/types.js';
import type { AgentGraphState } from '../graph/state.js';
import { stateRevision } from '../graph/turnSupport.js';
import type { AgentToolCallEffect } from '../ordering/toolCallDisposition.js';
import type { ToolName } from '../ordering/types.js';
import type { CheckpointSafeToolEvidenceReceipt } from './modelPublicationProjection.js';

export const MAX_TOOL_CALL_LEDGER_ENTRIES = 64;

const pollingToolNames = new Set<ToolName>([
  'getOrderStatus',
  'checkPaymentStatus',
]);

export interface ToolCallLedgerEntry {
  signatureDigest: string;
  toolName: ToolName;
  effect: AgentToolCallEffect;
  receipt: CheckpointSafeToolEvidenceReceipt | null;
}

export type ToolCallSignatureClassification =
  | { kind: 'execute' }
  | { kind: 'no_progress' }
  | {
      kind: 'cached';
      receipt: CheckpointSafeToolEvidenceReceipt;
    };

function collectionRevision(
  state: AgentGraphState,
  toolName: keyof NonNullable<AgentGraphState['activeCollectionKeys']>,
): Record<string, unknown> | null {
  const key = state.activeCollectionKeys?.[toolName];
  const snapshot = key
    ? state.verifiedCollections?.[toolName]?.[key]
    : undefined;
  return snapshot
    ? {
        key: snapshot.key,
        revision: snapshot.revision,
        providerRevision: snapshot.providerRevision,
      }
    : null;
}

function menuRevision(state: AgentGraphState): Record<string, unknown> | null {
  const snapshot = state.activeMenuCollection;
  return snapshot
    ? {
        key: snapshot.key,
        revision: snapshot.revision,
        providerRevision: snapshot.providerRevision,
      }
    : null;
}

export function relevantToolState(
  toolName: ToolName,
  state: AgentGraphState,
): unknown {
  switch (toolName) {
    case 'getItemDetails':
    case 'getModifierOptions':
      return { menu: menuRevision(state) };
    case 'updateCart':
      return {
        cart: state.cart ?? null,
        menu: menuRevision(state),
        menuItemDetail: state.menuItemDetail ?? null,
        menuModifierOptions: state.menuModifierOptions ?? null,
      };
    case 'previewCart':
    case 'recommendAddOns':
      return { cart: state.cart ?? null };
    case 'checkStoreAvailability':
      return {
        cart: state.cart ?? null,
        fulfillment: state.fulfillment ?? null,
      };
    case 'quoteFulfillment':
      return {
        cart: state.cart ?? null,
        pendingSavedAddressRef: state.pendingSavedAddressRef ?? null,
      };
    case 'explainPromotion':
      return { promotions: collectionRevision(state, 'searchPromotions') };
    case 'validateVoucher':
      return { cart: state.cart ?? null };
    case 'acquireVoucher':
      return {
        rewards: collectionRevision(state, 'listMembershipRewards'),
        tools: collectionRevision(state, 'listMembershipTools'),
      };
    case 'redeemReward':
      return {
        wallet: collectionRevision(state, 'listMembershipWallet'),
        tools: collectionRevision(state, 'listMembershipTools'),
      };
    case 'previewOrder':
      return {
        cart: state.cart ?? null,
        fulfillment: state.fulfillment ?? null,
        availability: state.exactCartAvailabilityObservation ?? null,
        promotionContext: state.promotionContext ?? null,
        invoiceRequest: state.invoiceRequest ?? null,
      };
    case 'placeOrder':
      return {
        orderPreview: state.orderPreview ?? null,
        commerceApprovalReceipts: state.commerceApprovalReceipts ?? [],
      };
    case 'getOrderStatus':
      return { order: state.order ?? null };
    case 'createPaymentLink':
      return {
        order: state.order ?? null,
        selectedPaymentMethod: state.selectedPaymentMethod ?? null,
      };
    case 'checkPaymentStatus':
      return {
        order: state.order ?? null,
        paymentAttempt: state.paymentAttempt ?? null,
      };
    case 'collectInvoice':
      return { orderPreview: state.orderPreview ?? null };
    case 'handoff':
      return { escalationReasons: state.escalationReasons };
    case 'resolveHandoff':
      return { handoff: state.handoff ?? null };
    case 'searchMenu':
    case 'findStores':
    case 'searchPromotions':
    case 'getMembershipProfile':
    case 'listMembershipRewards':
    case 'listMembershipWallet':
    case 'getMembershipPointHistory':
    case 'listMembershipTools':
    case 'listPaymentMethods':
    case 'getSavedAddresses':
    case 'getRecentOrder':
    case 'getFavoriteItems':
    case 'searchContentPolicy':
    case 'answerAllergenQuestion':
      return null;
  }
}

export async function canonicalToolCallSignature(input: {
  sessionId: string;
  customerId: string;
  channel: Channel;
  toolName: ToolName;
  arguments: Record<string, unknown>;
  activeToolNames: readonly ToolName[];
  relevantState: unknown;
}): Promise<string> {
  return stateRevision({
    binding: {
      sessionId: input.sessionId,
      customerId: input.customerId,
      channel: input.channel,
    },
    toolName: input.toolName,
    arguments: input.arguments,
    activeToolNames: [...new Set(input.activeToolNames)].sort(),
    relevantState: input.relevantState,
  });
}

export function classifyToolCallSignature(input: {
  entries: readonly ToolCallLedgerEntry[];
  signatureDigest: string;
  toolName: ToolName;
  effect: AgentToolCallEffect;
}): ToolCallSignatureClassification {
  if (pollingToolNames.has(input.toolName)) return { kind: 'execute' };
  const prior = [...input.entries]
    .reverse()
    .find(
      (entry) =>
        entry.signatureDigest === input.signatureDigest &&
        entry.toolName === input.toolName &&
        entry.effect === input.effect,
    );
  if (!prior) return { kind: 'execute' };
  if (input.effect === 'provider_read') return { kind: 'no_progress' };
  return prior.receipt
    ? { kind: 'cached', receipt: prior.receipt }
    : { kind: 'execute' };
}

export function recordSuccessfulToolCall(
  entries: readonly ToolCallLedgerEntry[],
  entry: ToolCallLedgerEntry,
): ToolCallLedgerEntry[] {
  if (pollingToolNames.has(entry.toolName)) return [...entries];
  const deduplicated = entries.filter(
    (candidate) => candidate.signatureDigest !== entry.signatureDigest,
  );
  return [...deduplicated, entry].slice(-MAX_TOOL_CALL_LEDGER_ENTRIES);
}
