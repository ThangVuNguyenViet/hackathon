import {
  isOfficialSourceAuthorityFor,
  sameOfficialSourceAuthority,
} from '../domain/officialSourceAuthority.js';
import type { ConversationTurn } from '../domain/types.js';
import type { AgentGraphState } from '../graph/state.js';
import { stateRevision } from '../graph/turnSupport.js';
import type {
  CollectionToolName,
  ContentEvidence,
  MembershipActionResult,
  ToolName,
  ToolTraceEntry,
  VerifiedCollectionResult,
} from '../ordering/types.js';
import type { AgentToolResultForModel } from '../graph/orderStatusEvidenceProjection.js';
import type {
  ResponseClaimEvidence,
  ResponseClaimKind,
} from './responseEvidenceContracts.js';
import {
  responseEvidenceContractForTool,
} from './responseEvidenceContracts.js';
import {
  projectAddress,
  projectCart,
  projectCollectionResult,
  projectFulfillment,
  projectMenuItem,
  projectMenuModifierOptions,
  projectModelPublicationState,
  projectOrder,
  projectPaymentMethod,
  projectPromotionOffer,
  type ModelPublicationLifecycle,
  type ModelPublicationState,
} from './modelPublicationStateProjection.js';
import {
  authorityAllowsCurrentSessionCheckoutEvidence,
  authorityHasScopes,
  modelPublicationAuthorityIsLive,
  modelPublicationAuthorizedScopes,
  validateModelPublicationAuthority,
  type ModelPublicationAuthority,
} from './modelPublicationAuthority.js';
import {
  isIssuedGraphExecutedToolResult,
  type GraphExecutedToolResult,
} from './graphExecutedToolResult.js';
import {
  CURRENT_TURN_RESPONSE_EVIDENCE_SCHEMA_VERSION,
  currentTurnResponseEvidenceDigest,
} from './currentTurnResponseEvidenceDigest.js';
export {
  CURRENT_TURN_RESPONSE_EVIDENCE_SCHEMA_VERSION,
  currentTurnResponseEvidenceDigest,
  currentTurnResponseEvidenceDigestInput,
  type CurrentTurnResponseEvidenceDigestInput,
} from './currentTurnResponseEvidenceDigest.js';
export {
  issueModelPublicationAuthority,
  modelPublicationAuthorizedScopes,
  type ModelPublicationAuthority,
} from './modelPublicationAuthority.js';
export type {
  ModelPublicationLifecycle,
  ModelPublicationOrder,
  ModelPublicationState,
} from './modelPublicationStateProjection.js';

export const MODEL_PUBLICATION_SCHEMA_VERSION =
  'kfc-model-publication-v1' as const;
export const CHECKPOINT_SAFE_TOOL_EVIDENCE_RECEIPT_SCHEMA_VERSION =
  'kfc-checkpoint-tool-evidence-receipt-v2' as const;
export const CHECKPOINT_SAFE_TOOL_EVIDENCE_RECEIPT_RESULT =
  'audit_evidence_reference' as const;

export type ToolExecutionOutcome = 'success' | 'error';

const issuedCurrentTurnEvidence = new WeakSet<object>();
const issuedPublicationBundles = new WeakSet<object>();
const publicationBundleAuthorities =
  new WeakMap<object, ModelPublicationAuthority>();
const publicationBundleUserTurnWindowDigests =
  new WeakMap<object, string>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value);
}

function modelVisibleUserTurnWindow(
  turns: readonly ConversationTurn[],
) {
  return turns
    .filter((turn) => turn.role === 'user')
    .map((turn) => ({
      id: turn.id,
      sessionId: turn.sessionId,
      channel: turn.channel,
      role: turn.role,
      text: turn.text,
      externalMessageId: turn.externalMessageId,
      externalUserId: turn.externalUserId,
      createdAt: turn.createdAt,
    }));
}

export interface CurrentTurnResponseEvidence {
  schemaVersion: typeof CURRENT_TURN_RESPONSE_EVIDENCE_SCHEMA_VERSION;
  evidenceId: string;
  toolCallId: string;
  toolName: ToolName;
  claimKinds: ResponseClaimKind[];
  value: unknown;
  digest: string;
  authorityDigest: string;
  currentTurnRevision: string;
  privateData: boolean;
  executionOutcome: ToolExecutionOutcome;
}

export interface ModelPublicationEvidence extends ResponseClaimEvidence {
  publicationAuthority:
    | 'verified_state'
    | 'current_turn_execution'
    | 'current_turn_authenticated';
  privateData: boolean;
}

export interface ModelPublicationBundle {
  schemaVersion: typeof MODEL_PUBLICATION_SCHEMA_VERSION;
  modelState: ModelPublicationState;
  evidence: ModelPublicationEvidence[];
  allowedEvidenceIds: string[];
  projectionDigest: string;
  lifecycle: ModelPublicationLifecycle;
}

export interface CheckpointSafeToolEvidenceReceipt {
  schemaVersion:
    typeof CHECKPOINT_SAFE_TOOL_EVIDENCE_RECEIPT_SCHEMA_VERSION;
  evidenceId: string;
  evidenceDigest: string;
  toolCallId: string;
  toolName: ToolName;
  executionOutcome: ToolExecutionOutcome;
  result: typeof CHECKPOINT_SAFE_TOOL_EVIDENCE_RECEIPT_RESULT;
}

function deepFreeze<Value>(value: Value): Value {
  if (
    typeof value !== 'object' ||
    value === null ||
    Object.isFrozen(value)
  ) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function immutableCopy<Value>(value: Value): Value {
  return deepFreeze(structuredClone(value));
}

function hasOfficialContentAuthority(
  state: AgentGraphState,
  content: ContentEvidence,
): boolean {
  if (
    (content.kind !== 'policy' && content.kind !== 'allergen') ||
    content.approvalStatus !== 'approved' ||
    content.audience !== 'customer_public' ||
    !content.id ||
    !content.contentHash ||
    !content.approvedAt ||
    !isOfficialSourceAuthorityFor(content.officialAuthority, {
      id: content.id,
      kind: content.kind,
      title: content.title,
      snippet: content.snippet,
      sourceUrl: content.sourceUrl,
      sourceFile: content.sourceFile,
      tags: content.tags,
      retrievedAt: content.retrievedAt,
      approvedAt: content.approvedAt,
      approvalStatus: content.approvalStatus,
      audience: content.audience,
    }) ||
    content.officialAuthority.revision !== content.contentHash
  ) {
    return false;
  }
  return (state.toolTrace ?? []).some((entry) =>
    entry.ok &&
    entry.provenance.some((source) =>
      sameOfficialSourceAuthority(
        content.officialAuthority,
        source.officialAuthority,
      )));
}

function addEvidence(
  evidence: ModelPublicationEvidence[],
  input: {
    evidenceId: string;
    claimKinds: ResponseClaimKind[];
    requiredLimitations?: ResponseClaimEvidence['requiredLimitations'];
    value: unknown;
    officialSource?: boolean;
    publicationAuthority?: ModelPublicationEvidence['publicationAuthority'];
    privateData?: boolean;
  },
): void {
  if (input.value === undefined) return;
  evidence.push({
    evidenceId: input.evidenceId,
    claimKinds: [...input.claimKinds],
    requiredLimitations: (input.requiredLimitations ?? []).map(
      (requirement) => ({
        limitationId: requirement.limitationId,
        claimKinds: [...requirement.claimKinds],
        subjectScope: requirement.subjectScope,
      }),
    ),
    value: input.value,
    officialSource: input.officialSource ?? false,
    publicationAuthority:
      input.publicationAuthority ?? 'verified_state',
    privateData: input.privateData ?? false,
  });
}

function addActiveCollectionEvidence(
  evidence: ModelPublicationEvidence[],
  state: AgentGraphState,
  modelState: ModelPublicationState,
): void {
  for (const [rawToolName, projectedResult] of Object.entries(
    modelState.activeCollections ?? {},
  )) {
    const toolName = rawToolName as CollectionToolName;
    if (
      toolName !== 'searchContentPolicy' &&
      toolName !== 'answerAllergenQuestion'
    ) {
      const contract = responseEvidenceContractForTool(toolName);
      addEvidence(evidence, {
        evidenceId: `active_collection:${toolName}`,
        claimKinds: contract.claimKinds,
        requiredLimitations: contract.requiredLimitations,
        value: projectedResult,
        privateData: contract.privateData,
      });
      continue;
    }
    const key = state.activeCollectionKeys?.[toolName];
    const rawItems = key
      ? state.verifiedCollections?.[toolName]?.[key]?.result.items
      : undefined;
    const projectedItems =
      typeof projectedResult === 'object' &&
        projectedResult !== null &&
        !Array.isArray(projectedResult) &&
        Array.isArray(
          (projectedResult as Record<string, unknown>).items,
        )
        ? (projectedResult as { items: unknown[] }).items
        : undefined;
    if (
      !rawItems ||
      !projectedItems ||
      rawItems.length !== projectedItems.length
    ) {
      continue;
    }
    for (const [index, content] of rawItems.entries()) {
      addEvidence(evidence, {
        evidenceId: `active_collection:${toolName}:${index}`,
        claimKinds: [
          toolName === 'searchContentPolicy' ? 'policy' : 'allergen',
          'source',
          'status',
        ],
        value: projectedItems[index],
        officialSource: hasOfficialContentAuthority(state, content),
      });
    }
  }
}

function publicationEvidence(
  state: AgentGraphState,
  modelState: ModelPublicationState,
  currentTurnEvidence: readonly CurrentTurnResponseEvidence[],
): ModelPublicationEvidence[] {
  const evidence: ModelPublicationEvidence[] = [];
  addActiveCollectionEvidence(evidence, state, modelState);
  addEvidence(evidence, {
    evidenceId: 'cart',
    claimKinds: ['product', 'modifier', 'price', 'promotion', 'delivery'],
    value: modelState.cart,
  });
  addEvidence(evidence, {
    evidenceId: 'order_preview',
    claimKinds: [
      'product', 'modifier', 'price', 'payment', 'fulfillment', 'status',
      'delivery', 'order_id',
    ],
    value: modelState.orderPreview,
    privateData: true,
  });
  addEvidence(evidence, {
    evidenceId: 'order',
    claimKinds: [
      'product', 'modifier', 'price', 'payment', 'fulfillment', 'status',
      'delivery', 'order_id',
    ],
    value: modelState.order,
    privateData: true,
  });
  addEvidence(evidence, {
    evidenceId: 'address',
    claimKinds: ['address', 'fulfillment', 'delivery'],
    value: modelState.address,
    privateData: true,
  });
  addEvidence(evidence, {
    evidenceId: 'address_draft',
    claimKinds: ['address', 'fulfillment', 'delivery'],
    value: modelState.addressDraft,
    privateData: true,
  });
  addEvidence(evidence, {
    evidenceId: 'fulfillment',
    claimKinds: ['price', 'fulfillment', 'status', 'delivery'],
    value: modelState.fulfillment,
    privateData: true,
  });
  addEvidence(evidence, {
    evidenceId: 'menu_search_results',
    claimKinds: ['product', 'modifier', 'price', 'source', 'status'],
    value: modelState.menuSearchResults,
  });
  addEvidence(evidence, {
    evidenceId: 'menu_item_detail',
    claimKinds: ['product', 'modifier', 'price', 'source', 'status'],
    value: modelState.menuItemDetail,
  });
  addEvidence(evidence, {
    evidenceId: 'menu_modifier_options',
    claimKinds: ['product', 'modifier', 'price', 'source', 'status'],
    value: modelState.menuModifierOptions,
  });
  addEvidence(evidence, {
    evidenceId: 'promotion_offers',
    claimKinds: ['price', 'promotion', 'source', 'status'],
    value: modelState.promotionOffers,
  });
  addEvidence(evidence, {
    evidenceId: 'payment_attempt',
    claimKinds: ['payment', 'status', 'order_id'],
    value: modelState.paymentAttempt,
    privateData: true,
  });
  addEvidence(evidence, {
    evidenceId: 'selected_payment_method',
    claimKinds: ['payment', 'status'],
    value: modelState.selectedPaymentMethod,
    privateData: true,
  });
  addEvidence(evidence, {
    evidenceId: 'payment_method_evidence',
    claimKinds: ['payment', 'source', 'status'],
    value: modelState.paymentMethodEvidence,
    privateData: true,
  });
  addEvidence(evidence, {
    evidenceId: 'invoice_request',
    claimKinds: ['payment', 'status'],
    value: modelState.invoiceRequest,
    privateData: true,
  });
  addEvidence(evidence, {
    evidenceId: 'handoff',
    claimKinds: ['status', 'delivery'],
    value: modelState.handoff,
  });
  addEvidence(evidence, {
    evidenceId: 'selected_modifiers',
    claimKinds: ['product', 'modifier', 'price'],
    value: modelState.selectedModifiers,
  });
  for (const entry of currentTurnEvidence) {
    const contract = responseEvidenceContractForTool(entry.toolName);
    addEvidence(evidence, {
      evidenceId: entry.evidenceId,
      claimKinds: entry.claimKinds,
      requiredLimitations: contract.requiredLimitations,
      value:
        entry.toolName === 'getSavedAddresses' &&
          entry.executionOutcome === 'success' &&
          Array.isArray(entry.value)
          ? {
              savedAddressCount: entry.value.length,
              privateAddressWithheld: true,
            }
          : entry.value,
      publicationAuthority: entry.privateData
        ? 'current_turn_authenticated'
        : 'current_turn_execution',
      privateData: entry.privateData,
    });
  }
  return evidence;
}

export async function buildModelPublicationBundle(input: {
  state: AgentGraphState;
  authority: ModelPublicationAuthority;
  currentTurnEvidence?: readonly CurrentTurnResponseEvidence[];
}): Promise<ModelPublicationBundle> {
  if (!await validateModelPublicationAuthority({
    authority: input.authority,
    state: input.state,
  })) {
    throw new Error('model_publication_authority_invalid');
  }
  const currentTurnEvidence = input.currentTurnEvidence ?? [];
  const evidenceIds = new Set<string>();
  const evidenceDigests = new Set<string>();
  const toolCallIds = new Set<string>();
  for (const entry of currentTurnEvidence) {
    if (
      !await currentTurnEvidenceIsValid(entry, input.authority) ||
      evidenceIds.has(entry.evidenceId) ||
      evidenceDigests.has(entry.digest) ||
      toolCallIds.has(entry.toolCallId)
    ) {
      throw new Error('current_turn_response_evidence_invalid');
    }
    evidenceIds.add(entry.evidenceId);
    evidenceDigests.add(entry.digest);
    toolCallIds.add(entry.toolCallId);
  }
  const currentUserMessageDigest = await stateRevision(
    input.state.latestUserMessage,
  );
  const projection = projectModelPublicationState({
    state: input.state,
    currentUserMessageDigest,
    authorityDigest: input.authority.authorityDigest,
    currentTurnRevision: input.authority.currentTurnRevision,
    authorizedScopes:
      modelPublicationAuthorizedScopes(input.authority),
  });
  const evidence = publicationEvidence(
    input.state,
    projection.modelState,
    currentTurnEvidence,
  );
  const allowedEvidenceIds = evidence
    .map((entry) => entry.evidenceId)
    .sort((left, right) => left.localeCompare(right));
  if (new Set(allowedEvidenceIds).size !== allowedEvidenceIds.length) {
    throw new Error('model_publication_evidence_id_duplicate');
  }
  const digestInput = {
    schemaVersion: MODEL_PUBLICATION_SCHEMA_VERSION,
    modelState: projection.modelState,
    evidence,
    allowedEvidenceIds,
    lifecycle: projection.lifecycle,
  };
  const bundle = immutableCopy({
    ...digestInput,
    projectionDigest: await stateRevision(digestInput),
  });
  if (!await validateModelPublicationAuthority({
    authority: input.authority,
    state: input.state,
  })) {
    throw new Error('model_publication_authority_invalid');
  }
  issuedPublicationBundles.add(bundle);
  publicationBundleAuthorities.set(bundle, input.authority);
  publicationBundleUserTurnWindowDigests.set(
    bundle,
    await stateRevision(
      modelVisibleUserTurnWindow(input.state.recentTurns ?? []),
    ),
  );
  return bundle;
}

function projectCurrentToolValue(
  result: AgentToolResultForModel,
): unknown | undefined {
  if (!result.ok) {
    return {
      ok: false,
      errorCode: result.errorCode ?? 'tool_execution_failed',
    };
  }
  switch (result.toolName) {
    case 'searchMenu':
    case 'recommendAddOns':
    case 'findStores':
    case 'searchPromotions':
    case 'listMembershipRewards':
    case 'listMembershipWallet':
    case 'listMembershipTools':
    case 'listPaymentMethods':
    case 'searchContentPolicy':
    case 'answerAllergenQuestion':
      return projectCollectionResult(
        result.toolName,
        result.value as VerifiedCollectionResult<unknown>,
      );
    case 'getItemDetails':
      return projectMenuItem(result.value);
    case 'getModifierOptions':
      return projectMenuModifierOptions(result.value);
    case 'updateCart':
    case 'previewCart':
      return projectCart(result.value);
    case 'checkStoreAvailability':
      return structuredClone(result.value);
    case 'quoteFulfillment':
      return projectFulfillment(result.value);
    case 'explainPromotion':
      return projectPromotionOffer(
        result.value as unknown as Record<string, unknown>,
      );
    case 'validateVoucher':
      return {
        ok: result.value.ok,
        reason: result.value.reason,
        publicCode: result.value.publicCode,
        discountVnd: result.value.discountVnd,
      };
    case 'getSavedAddresses':
      return result.value.map(projectAddress);
    case 'getRecentOrder':
      return result.value ? projectOrder(result.value) : null;
    case 'getFavoriteItems':
      return result.value.map(projectMenuItem);
    case 'getMembershipProfile':
      return {
        tier: result.value.tier,
        points: result.value.points,
        hasPhoneOnFile: result.value.hasPhoneOnFile,
        hasGoogleConnection: result.value.hasGoogleConnection,
        redactedFields: [...result.value.redactedFields],
      };
    case 'getMembershipPointHistory':
      return {
        filterWindowDays: result.value.filterWindowDays,
        filterTabs: [...result.value.filterTabs],
        transactions: result.value.transactions.map((entry) => ({
          transactionId: entry.transactionId,
          type: entry.type,
          points: entry.points,
          description: entry.description,
          occurredAt: entry.occurredAt,
        })),
        emptyStateText: result.value.emptyStateText,
      };
    case 'acquireVoucher':
    case 'redeemReward':
      return {
        actionId: result.value.actionId,
        status: result.value.status,
        requiresUserConfirmation: result.value.requiresUserConfirmation,
        targetId: result.value.targetId,
      };
    case 'previewOrder':
    case 'placeOrder':
      return projectOrder(result.value);
    case 'getOrderStatus':
      return {
        status: result.value.status,
        paymentStatus: result.value.paymentStatus,
        ...(result.value.posStatus
          ? { posStatus: result.value.posStatus }
          : {}),
      };
    case 'createPaymentLink':
      return {
        url: result.value.url,
        status: result.value.status,
      };
    case 'checkPaymentStatus':
      return { status: result.value.status };
    case 'collectInvoice':
      return { collected: true };
    case 'handoff':
      return { active: true };
    case 'resolveHandoff':
      return { active: false };
  }
}

function authorityAllowsResponseEvidence(
  authority: ModelPublicationAuthority,
  contract: ReturnType<typeof responseEvidenceContractForTool>,
): boolean {
  return (
    authorityHasScopes(authority, contract.requiredScopes) ||
    (
      contract.currentSessionCheckout &&
      authorityAllowsCurrentSessionCheckoutEvidence(authority)
    )
  );
}

async function currentTurnEvidenceIsValid(
  evidence: CurrentTurnResponseEvidence,
  authority: ModelPublicationAuthority,
): Promise<boolean> {
  const contract = responseEvidenceContractForTool(evidence.toolName);
  const claimKinds = contract.claimKinds;
  const expectedPrivate = contract.privateData;
  if (
    !issuedCurrentTurnEvidence.has(evidence) ||
    evidence.schemaVersion !==
      CURRENT_TURN_RESPONSE_EVIDENCE_SCHEMA_VERSION ||
    evidence.authorityDigest !== authority.authorityDigest ||
    evidence.currentTurnRevision !== authority.currentTurnRevision ||
    evidence.toolCallId.length === 0 ||
    evidence.privateData !== expectedPrivate ||
    (
      evidence.executionOutcome !== 'success' &&
      evidence.executionOutcome !== 'error'
    ) ||
    JSON.stringify(evidence.claimKinds) !== JSON.stringify(claimKinds) ||
    !authorityAllowsResponseEvidence(authority, contract)
  ) {
    return false;
  }
  const digest = await currentTurnResponseEvidenceDigest({
    authorityDigest: authority.authorityDigest,
    currentTurnRevision: authority.currentTurnRevision,
    toolCallId: evidence.toolCallId,
    toolName: evidence.toolName,
    claimKinds,
    value: evidence.value,
    privateData: expectedPrivate,
    executionOutcome: evidence.executionOutcome,
  });
  return (
    evidence.digest === digest &&
    evidence.evidenceId === `current:${evidence.toolName}:${digest}`
  );
}

/**
 * Re-validates an issued current-turn evidence object at a downstream private
 * presentation boundary. This prevents a typed or frozen lookalike, evidence
 * from another turn, or evidence whose authority has expired from becoming a
 * disclosure source.
 */
export async function validateIssuedCurrentTurnResponseEvidence(input: {
  evidence: CurrentTurnResponseEvidence;
  authority: ModelPublicationAuthority;
}): Promise<boolean> {
  return currentTurnEvidenceIsValid(input.evidence, input.authority);
}

export async function buildCurrentTurnResponseEvidence(input: {
  authority: ModelPublicationAuthority;
  execution: GraphExecutedToolResult;
}): Promise<CurrentTurnResponseEvidence | undefined> {
  if (
    !isIssuedGraphExecutedToolResult(input.execution) ||
    input.execution.authorityDigest !== input.authority.authorityDigest
  ) {
    throw new Error('current_turn_response_evidence_source_invalid');
  }
  const { result, toolCallId } = input.execution;
  const contract = responseEvidenceContractForTool(result.toolName);
  if (
    !authorityAllowsResponseEvidence(input.authority, contract)
  ) {
    return undefined;
  }
  const value = projectCurrentToolValue(result);
  if (value === undefined) return undefined;
  const claimKinds = contract.claimKinds;
  const privateData = contract.privateData;
  const executionOutcome: ToolExecutionOutcome =
    result.ok ? 'success' : 'error';
  const digest = await currentTurnResponseEvidenceDigest({
    authorityDigest: input.authority.authorityDigest,
    currentTurnRevision: input.authority.currentTurnRevision,
    toolCallId,
    toolName: result.toolName,
    claimKinds,
    value,
    privateData,
    executionOutcome,
  });
  const evidence = deepFreeze({
    schemaVersion: CURRENT_TURN_RESPONSE_EVIDENCE_SCHEMA_VERSION,
    evidenceId: `current:${result.toolName}:${digest}`,
    toolCallId,
    toolName: result.toolName,
    claimKinds,
    value,
    digest,
    authorityDigest: input.authority.authorityDigest,
    currentTurnRevision: input.authority.currentTurnRevision,
    privateData,
    executionOutcome,
  });
  issuedCurrentTurnEvidence.add(evidence);
  return evidence;
}

export function checkpointSafeToolEvidenceReceipt(
  evidence: CurrentTurnResponseEvidence,
): CheckpointSafeToolEvidenceReceipt {
  if (!issuedCurrentTurnEvidence.has(evidence)) {
    throw new Error('checkpoint_tool_evidence_receipt_source_invalid');
  }
  return immutableCopy({
    schemaVersion: CHECKPOINT_SAFE_TOOL_EVIDENCE_RECEIPT_SCHEMA_VERSION,
    evidenceId: evidence.evidenceId,
    evidenceDigest: evidence.digest,
    toolCallId: evidence.toolCallId,
    toolName: evidence.toolName,
    executionOutcome: evidence.executionOutcome,
    result: CHECKPOINT_SAFE_TOOL_EVIDENCE_RECEIPT_RESULT,
  });
}

function checkpointMembershipActionOutcome(
  value: unknown,
): Pick<
  MembershipActionResult,
  'actionId' | 'status' | 'requiresUserConfirmation' | 'targetId'
> | undefined {
  if (
    !isRecord(value)
  ) {
    return undefined;
  }
  if (
    Object.keys(value).sort().join(',') !==
      'actionId,requiresUserConfirmation,status,targetId' ||
    typeof value.actionId !== 'string' ||
    (
      value.status !== 'previewed' &&
      value.status !== 'completed'
    ) ||
    typeof value.requiresUserConfirmation !== 'boolean' ||
    typeof value.targetId !== 'string'
  ) {
    return undefined;
  }
  return {
    actionId: value.actionId,
    status: value.status,
    requiresUserConfirmation: value.requiresUserConfirmation,
    targetId: value.targetId,
  };
}

export async function rehydrateCheckpointSafeCurrentTurnEvidence(input: {
  authority: ModelPublicationAuthority;
  trace: ToolTraceEntry;
  receipt: CheckpointSafeToolEvidenceReceipt;
}): Promise<CurrentTurnResponseEvidence | undefined> {
  const audit = input.trace.publicationEvidenceAudit;
  if (
    input.trace.toolName !== 'acquireVoucher' &&
    input.trace.toolName !== 'redeemReward'
  ) {
    return undefined;
  }
  const value = checkpointMembershipActionOutcome(
    audit?.membershipActionOutcome,
  );
  const contract = responseEvidenceContractForTool(input.trace.toolName);
  if (
    !audit ||
    audit.schemaVersion !== 'kfc-tool-trace-publication-audit-v2' ||
    !value ||
    !input.trace.ok ||
    audit.currentTurnId !== input.authority.currentTurnId ||
    audit.toolName !== input.trace.toolName ||
    audit.executionOutcome !== 'success' ||
    audit.authorityDigest !== input.authority.authorityDigest ||
    audit.currentTurnRevision !== input.authority.currentTurnRevision ||
    audit.toolCallId !== input.receipt.toolCallId ||
    audit.evidenceId !== input.receipt.evidenceId ||
    audit.evidenceDigest !== input.receipt.evidenceDigest ||
    !contract.privateData ||
    !authorityHasScopes(input.authority, contract.requiredScopes)
  ) {
    throw new Error('checkpoint_current_turn_evidence_unrecoverable');
  }
  const digest = await currentTurnResponseEvidenceDigest({
    authorityDigest: input.authority.authorityDigest,
    currentTurnRevision: input.authority.currentTurnRevision,
    toolCallId: audit.toolCallId,
    toolName: audit.toolName,
    claimKinds: contract.claimKinds,
    value,
    privateData: true,
    executionOutcome: 'success',
  });
  if (
    digest !== audit.evidenceDigest ||
    audit.evidenceId !== `current:${audit.toolName}:${digest}`
  ) {
    throw new Error('checkpoint_current_turn_evidence_unrecoverable');
  }
  const evidence = deepFreeze({
    schemaVersion: CURRENT_TURN_RESPONSE_EVIDENCE_SCHEMA_VERSION,
    evidenceId: audit.evidenceId,
    toolCallId: audit.toolCallId,
    toolName: audit.toolName,
    claimKinds: contract.claimKinds,
    value,
    digest,
    authorityDigest: input.authority.authorityDigest,
    currentTurnRevision: input.authority.currentTurnRevision,
    privateData: true,
    executionOutcome: 'success' as const,
  });
  issuedCurrentTurnEvidence.add(evidence);
  return evidence;
}

export function privateDisclosureEvidenceIds(
  bundle: ModelPublicationBundle,
): string[] {
  return bundle.evidence
    .filter((entry) => entry.privateData)
    .map((entry) => entry.evidenceId)
    .sort((left, right) => left.localeCompare(right));
}

export function isIssuedModelPublicationBundle(
  bundle: ModelPublicationBundle,
): boolean {
  const authority = publicationBundleAuthorities.get(bundle);
  return (
    issuedPublicationBundles.has(bundle) &&
    authority !== undefined &&
    modelPublicationAuthorityIsLive(authority)
  );
}

export async function publicationBundleMatchesUserTurnWindow(
  bundle: ModelPublicationBundle,
  turns: readonly ConversationTurn[],
): Promise<boolean> {
  const issuedDigest = publicationBundleUserTurnWindowDigests.get(bundle);
  return (
    issuedDigest !== undefined &&
    issuedDigest === await stateRevision(modelVisibleUserTurnWindow(turns))
  );
}

export function validateModelPublicationReference(input: {
  bundle: ModelPublicationBundle;
  projectionDigest: string;
}): boolean {
  return (
    isIssuedModelPublicationBundle(input.bundle) &&
    input.projectionDigest === input.bundle.projectionDigest
  );
}
