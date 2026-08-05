import {
  automaticRecommendationIdentityDigest,
  parseAutomaticRecommendationImpression,
  parseAutomaticRecommendationOutcome,
  type AutomaticRecommendationType,
} from '../contracts/automatic-recommendation.js';
import {
  parseJsonValue,
  type AutomaticEventEvidence,
} from './evidence-contracts.js';

export interface AutomaticRecommendationHttpRuntime {
  decide(type: AutomaticRecommendationType, body: unknown): Promise<unknown>;
  recordImpression(recommendationId: string, body: unknown): Promise<void>;
  recordOutcome(recommendationId: string, body: unknown): Promise<void>;
  inspect(
    recommendationId: string,
    page?: { limit: number; cursor?: string },
  ): Promise<unknown>;
  readiness(): Promise<{ ok: boolean; message?: string }>;
  close(): Promise<void>;
}

export function createUnavailableAutomaticRecommendationHttpRuntime(
  message: string,
): AutomaticRecommendationHttpRuntime {
  const unavailable = async (): Promise<never> => {
    throw new Error(message);
  };
  return {
    decide: unavailable,
    recordImpression: unavailable,
    recordOutcome: unavailable,
    inspect: unavailable,
    readiness: async () => ({ ok: false, message }),
    close: async () => undefined,
  };
}

export function createAutomaticRecommendationHttpRuntime({
  decisions,
  evidence,
  readiness,
  inspect = async () => {
    throw new Error('recommendation inspection storage is not configured');
  },
  close = async () => undefined,
  clock = () => new Date(),
}: {
  decisions: {
    decide(type: AutomaticRecommendationType, body: unknown): Promise<unknown>;
  };
  evidence: { commitEvent(event: AutomaticEventEvidence): Promise<unknown> };
  readiness: () => Promise<{ ok: boolean; message?: string }>;
  inspect?: (
    recommendationId: string,
    page?: { limit: number; cursor?: string },
  ) => Promise<unknown>;
  close?: () => Promise<void>;
  clock?: () => Date;
}): AutomaticRecommendationHttpRuntime {
  async function persistEvent(
    recommendationId: string,
    kind: 'impression' | 'outcome',
    value: unknown,
  ) {
    const impression =
      kind === 'impression'
        ? parseAutomaticRecommendationImpression(value)
        : null;
    const outcome =
      kind === 'outcome' ? parseAutomaticRecommendationOutcome(value) : null;
    const payload = impression ?? outcome;
    if (payload === null) throw new Error('automatic event parsing failed');
    const eventType = impression === null ? outcome!.eventType : 'impression';
    const action =
      outcome !== null && 'actionId' in outcome
        ? {
            actionId: outcome.actionId,
            renderedPosition:
              'renderedPosition' in outcome ? outcome.renderedPosition : null,
          }
        : { actionId: null, renderedPosition: null };
    await evidence.commitEvent({
      idempotencyKey: payload.eventId,
      eventId: payload.eventId,
      recommendationId,
      orderingJourneyRef: payload.orderingJourneyRef,
      channel: payload.channel,
      eventType,
      ...action,
      cartRevision: payload.cartRevision,
      payloadDigest: automaticRecommendationIdentityDigest({
        operationPath: `/v1/recommendations/${recommendationId}/${kind === 'impression' ? 'impressions' : 'outcomes'}`,
        identityType: eventType,
        payload,
      }),
      occurredAt: payload.occurredAt,
      receivedAt: clock().toISOString(),
      payload: parseJsonValue(payload),
    });
  }

  return {
    decide: (type, body) => decisions.decide(type, body),
    recordImpression: (recommendationId, body) =>
      persistEvent(recommendationId, 'impression', body),
    recordOutcome: (recommendationId, body) =>
      persistEvent(recommendationId, 'outcome', body),
    inspect,
    readiness,
    close,
  };
}
