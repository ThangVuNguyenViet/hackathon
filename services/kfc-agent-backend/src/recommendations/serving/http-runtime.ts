import {
  automaticRecommendationIdentityDigest,
  automaticRecommendationOperations,
  parseAutomaticRecommendationImpression,
  parseAutomaticRecommendationInspection,
  parseAutomaticRecommendationOutcome,
  parseAutomaticRecommendationRequest,
  parseAutomaticRecommendationResponse,
  type AutomaticRecommendationType,
  validateAutomaticRecommendationBinding,
} from '../contracts/automatic-recommendation.js';
import {
  parseJsonValue,
  type AutomaticEventEvidence,
} from './evidence-contracts.js';

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

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
export interface AutomaticRecommendationHttpClientOptions {
  baseUrl: string | URL;
  fetchImpl?: typeof fetch;
  headers?: Record<string, string>;
}

export function createAutomaticRecommendationHttpClient(
  options: AutomaticRecommendationHttpClientOptions,
): AutomaticRecommendationHttpRuntime {
  const baseUrl = new URL(options.baseUrl);
  const fetchImpl = options.fetchImpl ?? fetch;
  const headers = {
    accept: 'application/json',
    'content-type': 'application/json',
    ...options.headers,
  };

  async function requestJson(
    path: string,
    init: RequestInit,
    expectedStatusCodes: readonly number[],
  ): Promise<unknown> {
    const response = await fetchImpl(new URL(path, baseUrl), {
      ...init,
      headers: { ...headers, ...(init.headers ?? {}) },
    });
    const text = await response.text();
    let body: unknown = null;
    if (text.trim().length > 0) {
      try {
        body = JSON.parse(text);
      } catch (error) {
        throw new Error(
          `Automatic recommendation response was not JSON: ${
            error instanceof Error ? error.message : 'invalid body'
          }`,
        );
      }
    }
    if (!expectedStatusCodes.includes(response.status)) {
      throw new Error(
        `Automatic recommendation HTTP request failed with ${response.status}`,
      );
    }
    return body;
  }

  return {
    async decide(type, body) {
      const request = parseAutomaticRecommendationRequest(type, body);
      const response = parseAutomaticRecommendationResponse(
        await requestJson(
          automaticRecommendationOperations[type],
          {
            method: 'POST',
            body: JSON.stringify(request),
          },
          [200],
        ),
      );
      return validateAutomaticRecommendationBinding(type, request, response);
    },
    async recordImpression(recommendationId, body) {
      const impression = parseAutomaticRecommendationImpression(body);
      await requestJson(
        `/v1/recommendations/${encodeURIComponent(recommendationId)}/impressions`,
        { method: 'POST', body: JSON.stringify(impression) },
        [204],
      );
    },
    async recordOutcome(recommendationId, body) {
      const outcome = parseAutomaticRecommendationOutcome(body);
      await requestJson(
        `/v1/recommendations/${encodeURIComponent(recommendationId)}/outcomes`,
        { method: 'POST', body: JSON.stringify(outcome) },
        [204],
      );
    },
    async inspect(recommendationId, page) {
      const query = new URLSearchParams({
        limit: String(page?.limit ?? 25),
      });
      if (page?.cursor) query.set('cursor', page.cursor);
      return parseAutomaticRecommendationInspection(
        await requestJson(
          `/v1/admin/recommendations/${encodeURIComponent(recommendationId)}/inspection?${query}`,
          { method: 'GET' },
          [200],
        ),
      );
    },
    async readiness() {
      try {
        const body = await requestJson('/ready', { method: 'GET' }, [200, 503]);
        if (!isJsonRecord(body)) {
          return {
            ok: false,
            message: 'Automatic recommendation readiness was invalid',
          };
        }
        const value = body;
        return {
          ok: value.ok === true,
          ...(typeof value.message === 'string'
            ? { message: value.message }
            : {}),
        };
      } catch (error) {
        return {
          ok: false,
          message:
            error instanceof Error
              ? error.message
              : 'Automatic recommendation readiness failed',
        };
      }
    },
    async close() {},
  };
}
