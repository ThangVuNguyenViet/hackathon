import { kfcVerifiedStateSnapshotSchema } from '../../businessPacks/kfcVietnam/kfcVerifiedStateSchema.js';
import {
  type PackStateEnvelope,
  validatePackStateEnvelope,
} from '../../runtime/businessPack.js';
import type { RecommendationEvent } from '../domain/contracts.js';
import type {
  RecommendationDecisionRecord,
  RecommendationDemoCustomerHistoryRecord,
} from './types.js';

export type {
  RecommendationDecisionRecord,
  RecommendationDemoCustomerHistoryRecord,
} from './types.js';

const KFC_RECOMMENDATION_PACK_REF = {
  packId: 'kfc-vietnam',
  version: '1.0.0',
} as const;

export interface ReserveRecommendationDecisionInput {
  sessionId: string;
  idempotencyKey: string;
  requestId: string;
  requestFingerprint: string;
  ownerToken: string;
  createdAt: string;
}

export type ReserveRecommendationDecisionResult =
  | { status: 'reserved' }
  | { status: 'replay'; record: RecommendationDecisionRecord }
  | { status: 'pending' }
  | { status: 'conflict' };

export interface CommitRecommendationDecisionInput {
  ownerToken: string;
  expectedPackStateDigest: string | null;
  nextPackState: PackStateEnvelope;
  record: RecommendationDecisionRecord;
  events: readonly RecommendationEvent[];
}

export type CommitRecommendationDecisionResult =
  | {
      status: 'committed' | 'replay';
      record: RecommendationDecisionRecord;
    }
  | { status: 'stale' };

export interface AppendRecommendationEventInput {
  eventFingerprint: string;
  event: RecommendationEvent;
  expectedPackStateDigest: string;
  nextPackState: PackStateEnvelope;
}

export type AppendRecommendationEventResult =
  | { status: 'recorded' | 'replay'; event: RecommendationEvent }
  | { status: 'conflict' | 'stale' };

export interface ListRecommendationEventsInput {
  orderFlowId?: string;
  recommendationId?: string;
  sessionId?: string;
}

export interface RecommendationPersistence {
  reserveRecommendationDecision(
    input: ReserveRecommendationDecisionInput,
  ): Promise<ReserveRecommendationDecisionResult>;

  commitRecommendationDecision(
    input: CommitRecommendationDecisionInput,
  ): Promise<CommitRecommendationDecisionResult>;

  appendRecommendationEvent(
    input: AppendRecommendationEventInput,
  ): Promise<AppendRecommendationEventResult>;

  getRecommendationDecision(
    recommendationId: string,
  ): Promise<RecommendationDecisionRecord | undefined>;
  getRecommendationDecisionByRequest(
    requestId: string,
  ): Promise<RecommendationDecisionRecord | undefined>;
  listRecommendationEvents(
    input: ListRecommendationEventsInput,
  ): Promise<RecommendationEvent[]>;
  latestRecommendationDecisionForOrderFlow(
    orderFlowId: string,
  ): Promise<RecommendationDecisionRecord | undefined>;
  getRecommendationDemoCustomerHistory(
    verifiedCustomerRef: string,
  ): Promise<RecommendationDemoCustomerHistoryRecord | undefined>;
}

export function sameRecommendationDecisionRecord(
  left: RecommendationDecisionRecord,
  right: RecommendationDecisionRecord,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function sameRecommendationEvent(
  left: RecommendationEvent,
  right: RecommendationEvent,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function assertDecisionEventsCorrelate(
  record: RecommendationDecisionRecord,
  events: readonly RecommendationEvent[],
): void {
  if (new Set(events.map((event) => event.eventId)).size !== events.length) {
    throw new Error('recommendation_event_id_duplicate');
  }
  for (const event of events) {
    if (
      event.requestId !== record.request.requestId ||
      event.orderFlowId !== record.request.orderFlowId ||
      event.sessionId !== record.request.sessionId ||
      event.placement !== record.request.placement ||
      (event.recommendationId !== null &&
        event.recommendationId !== record.response.recommendationId)
    ) {
      throw new Error('recommendation_event_decision_mismatch');
    }
  }
}

export async function assertRecommendationPackState(
  envelope: PackStateEnvelope,
  orderFlowId: string,
  expectedRevision?: number,
): Promise<number> {
  const state = await validatePackStateEnvelope(envelope, {
    packRef: KFC_RECOMMENDATION_PACK_REF,
    schemaVersion: '1',
    parseState: (value) => kfcVerifiedStateSnapshotSchema.parse(value),
  });
  if (
    !state.recommendationState ||
    state.recommendationState.orderFlowId !== orderFlowId ||
    (expectedRevision !== undefined &&
      state.recommendationState.revision !== expectedRevision)
  ) {
    throw new Error('recommendation_pack_state_mismatch');
  }
  return state.recommendationState.revision;
}
