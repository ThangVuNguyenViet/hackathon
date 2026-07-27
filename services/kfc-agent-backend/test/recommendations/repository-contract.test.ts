import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  RecommendationDecisionRequest,
  RecommendationDecisionResponse,
  RecommendationEvent,
} from '../../src/recommendations/domain/contracts.js';
import {
  parseRecommendationDecisionRequest,
  parseRecommendationDecisionResponse,
  parseRecommendationEvent,
} from '../../src/recommendations/domain/schemas.js';
import { StoredDemoCustomerHistoryRepository } from '../../src/recommendations/history/stored-demo-history-repository.js';
import type {
  RecommendationDecisionRecord,
  RecommendationDemoCustomerHistoryRecord,
  RecommendationPersistence,
} from '../../src/recommendations/persistence/repository.js';
import { parsePersistedRecommendationEvent } from '../../src/recommendations/persistence/types.js';
import {
  applyRecommendationDecision,
  applyRecommendationImpression,
  applyRecommendationOutcome,
  initialRecommendationState,
} from '../../src/recommendations/state/state-machine.js';
import type { ConversationStore } from '../../src/persistence/contracts.js';
import { D1Store } from '../../src/persistence/d1Store.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';
import {
  createPackStateEnvelope,
  type PackStateEnvelope,
} from '../../src/runtime/businessPack.js';
import { SqliteD1Database } from '../support/sqlite-d1.js';

type Store = ConversationStore & RecommendationPersistence;

const requestExample = JSON.parse(
  await readFile(
    resolve(
      '../../contracts/recommendations/v1/examples/valid-decision-request.json',
    ),
    'utf8',
  ),
) as unknown;
const responseExample = JSON.parse(
  await readFile(
    resolve(
      '../../contracts/recommendations/v1/examples/valid-decision-response.json',
    ),
    'utf8',
  ),
) as unknown;

const closers: Array<() => void> = [];
afterEach(() => {
  for (const close of closers.splice(0)) close();
});

async function fixtures(): Promise<Array<{ name: string; store: Store }>> {
  const database = new SqliteD1Database();
  closers.push(() => database.close());
  const d1 = new D1Store(database);
  await d1.initialize();
  return [
    { name: 'MemoryStore', store: new MemoryStore() },
    { name: 'D1Store', store: d1 },
  ];
}

function requestFor(suffix: string): RecommendationDecisionRequest {
  const source = structuredClone(
    requestExample,
  ) as RecommendationDecisionRequest;
  return parseRecommendationDecisionRequest({
    ...source,
    requestId: `rec-request-${suffix}`,
    idempotencyKey: `rec-idempotency-${suffix}`,
    orderFlowId: `order-flow-${suffix}`,
    sessionId: `session-${suffix}`,
  });
}

function responseFor(
  request: RecommendationDecisionRequest,
  suffix: string,
): RecommendationDecisionResponse {
  const source = structuredClone(
    responseExample,
  ) as RecommendationDecisionResponse;
  const actionId = `action-product-${suffix}`;
  return parseRecommendationDecisionResponse({
    ...source,
    recommendationId: `recommendation-${suffix}`,
    requestId: request.requestId,
    orderFlowId: request.orderFlowId,
    placement: request.placement,
    primaryOffer: {
      actions: source.primaryOffer!.actions.map((action) => ({
        ...action,
        actionId,
        cartRevision: request.cartRevision,
      })),
    },
    displayFacts: source.displayFacts.map((fact) => ({
      ...fact,
      actionId,
    })),
    traceRef: `trace-${suffix}`,
  });
}

function recordFor(suffix: string): RecommendationDecisionRecord {
  const request = requestFor(suffix);
  const response = responseFor(request, suffix);
  return {
    request,
    response,
    technical: {
      potentialCandidates: [],
      eligibilityDecisions: [],
      eligiblePrePolicyRanking: [],
      merchandisingResolution: {
        suppressed: false,
        replacement: null,
        rankedCandidates: [],
        effects: [],
        reasonCodes: [],
      },
      emptyReason: null,
    },
    requestFingerprint: 'a'.repeat(64),
    actionDigest: 'b'.repeat(64),
    stateRevisionBefore: 0,
    stateRevisionAfter: 1,
    recordedAt: '2026-07-27T09:00:03Z',
  };
}

function recordForExistingFlow(
  suffix: string,
  existing: RecommendationDecisionRecord,
): RecommendationDecisionRecord {
  const source = recordFor(suffix);
  const request = parseRecommendationDecisionRequest({
    ...source.request,
    orderFlowId: existing.request.orderFlowId,
    sessionId: existing.request.sessionId,
  });
  return {
    ...source,
    request,
    response: responseFor(request, suffix),
  };
}

function recordWithFeatureSummary(
  record: RecommendationDecisionRecord,
  featureSummary: Record<string, number | string | boolean | null>,
): RecommendationDecisionRecord {
  const action = record.response.primaryOffer!.actions[0]!;
  const candidate = {
    action,
    targetId: `target-${record.request.requestId}`,
    sellableItemId: 'item-001',
    categoryId: 'category-001',
    name: 'Synthetic technical candidate',
    imageUrl: null,
    basePriceVnd: 45_000,
    activeDiscountRatio: 0,
    promotionId: null,
    parentCartLineId: null,
    modifierGroupPath: [],
  };
  const ranked = {
    candidate,
    score: 1,
    reasonCodes: [],
    featureSummary,
  };
  return {
    ...record,
    technical: {
      ...record.technical,
      potentialCandidates: [candidate],
      eligiblePrePolicyRanking: [ranked],
      merchandisingResolution: {
        ...record.technical.merchandisingResolution,
        rankedCandidates: [ranked],
      },
    },
  };
}

function decisionEvents(
  record: RecommendationDecisionRecord,
): [RecommendationEvent, RecommendationEvent] {
  const shared = {
    schemaVersion: 'kfc-recommendation-event-v1' as const,
    requestId: record.request.requestId,
    orderFlowId: record.request.orderFlowId,
    sessionId: record.request.sessionId,
    placement: record.request.placement,
    actor: 'system' as const,
    actionId: null,
    cartRevision: record.request.cartRevision,
    versionBindings: record.response.versionBindings,
  };
  return [
    parseRecommendationEvent({
      ...shared,
      eventId: `event-requested-${record.request.requestId}`,
      eventType: 'decision_requested',
      recommendationId: null,
      occurredAt: '2026-07-27T09:00:01Z',
      recordedAt: '2026-07-27T09:00:01Z',
      payload: {
        requestFingerprint: record.requestFingerprint,
        cartRevision: record.request.cartRevision,
      },
    }),
    parseRecommendationEvent({
      ...shared,
      eventId: `event-completed-${record.request.requestId}`,
      eventType: 'decision_completed',
      recommendationId: record.response.recommendationId,
      occurredAt: '2026-07-27T09:00:02Z',
      recordedAt: '2026-07-27T09:00:02Z',
      payload: {
        actionDigest: record.actionDigest,
        status: record.response.status,
        source: record.response.decisionSource,
        counts: record.response.counts,
        traceRef: record.response.traceRef,
      },
    }),
  ];
}

async function envelopeFor(
  record: RecommendationDecisionRecord,
): Promise<PackStateEnvelope> {
  return createPackStateEnvelope({
    packRef: { packId: 'kfc-vietnam', version: '1.0.0' },
    schemaVersion: '1',
    state: {
      recommendationState: applyRecommendationDecision(
        initialRecommendationState(record.request.orderFlowId),
        record.response,
        record.request.decisionTime,
      ),
    },
  });
}

async function reserve(
  store: Store,
  record: RecommendationDecisionRecord,
  ownerToken = `owner-${record.request.requestId}`,
) {
  return store.reserveRecommendationDecision({
    sessionId: record.request.sessionId,
    idempotencyKey: record.request.idempotencyKey,
    requestId: record.request.requestId,
    requestFingerprint: record.requestFingerprint,
    ownerToken,
    createdAt: '2026-07-27T09:00:00Z',
  });
}

async function commit(
  store: Store,
  record: RecommendationDecisionRecord,
  expectedPackStateDigest: string | null = null,
) {
  return store.commitRecommendationDecision({
    ownerToken: `owner-${record.request.requestId}`,
    expectedPackStateDigest,
    nextPackState: await envelopeFor(record),
    record,
    events: decisionEvents(record).reverse(),
  });
}

describe('RecommendationPersistence shared contract', () => {
  it('accepts only the approved bounded persisted-event payload families', () => {
    const record = recordFor('persisted-payload-shapes');
    const [requested, completed] = decisionEvents(record);
    expect(parsePersistedRecommendationEvent(requested)).toEqual(requested);
    expect(parsePersistedRecommendationEvent(completed)).toEqual(completed);

    const actionId = record.response.primaryOffer!.actions[0]!.actionId;
    const impression = parseRecommendationEvent({
      ...completed,
      eventId: 'event-impression-payload-shape',
      eventType: 'impression_rendered',
      actor: 'client',
      actionId,
      payload: {
        assistantTurnId: 'assistant-turn-001',
        attachmentId: 'attachment-001',
        renderedActions: [{ actionId, position: 1 }],
        actionDigest: record.actionDigest,
      },
    });
    expect(parsePersistedRecommendationEvent(impression)).toEqual(impression);

    for (const eventType of [
      'selected',
      'explicitly_dismissed',
      'ignored',
      'superseded',
      'cart_mutation_succeeded',
      'cart_mutation_failed',
      'checkout_completed',
      'order_abandoned',
      'order_cancelled',
    ] as const) {
      const outcome = parseRecommendationEvent({
        ...completed,
        eventId: `event-${eventType}-payload-shape`,
        eventType,
        actor: 'customer',
        actionId,
        payload: {},
      });
      expect(parsePersistedRecommendationEvent(outcome)).toEqual(outcome);
    }

    const unapprovedCandidateSummary = parseRecommendationEvent({
      ...completed,
      eventId: 'event-candidate-summary-payload-shape',
      eventType: 'candidate_eligibility_summary',
      payload: {},
    });
    expect(() =>
      parsePersistedRecommendationEvent(unapprovedCandidateSummary),
    ).toThrow('recommendation_candidate_summary_persistence_unsupported');
  });

  it('reserves once, reports a pending duplicate, and rejects changed fingerprints and request-ID reuse', async () => {
    for (const { name, store } of await fixtures()) {
      const record = recordFor(`${name.toLowerCase()}-reserve`);
      await expect(reserve(store, record), name).resolves.toEqual({
        status: 'reserved',
      });
      await expect(reserve(store, record), name).resolves.toEqual({
        status: 'pending',
      });
      await expect(
        store.reserveRecommendationDecision({
          sessionId: record.request.sessionId,
          idempotencyKey: record.request.idempotencyKey,
          requestId: record.request.requestId,
          requestFingerprint: 'c'.repeat(64),
          ownerToken: 'other-owner',
          createdAt: '2026-07-27T09:00:00Z',
        }),
        name,
      ).resolves.toEqual({ status: 'conflict' });
      await expect(
        store.reserveRecommendationDecision({
          sessionId: `${record.request.sessionId}-other`,
          idempotencyKey: `${record.request.idempotencyKey}-other`,
          requestId: record.request.requestId,
          requestFingerprint: record.requestFingerprint,
          ownerToken: 'other-owner',
          createdAt: '2026-07-27T09:00:00Z',
        }),
        name,
      ).resolves.toEqual({ status: 'conflict' });
    }
  });

  it('atomically commits state, decision, events, and completed reservation replay', async () => {
    for (const { name, store } of await fixtures()) {
      const record = recordFor(`${name.toLowerCase()}-commit`);
      const nextPackState = await envelopeFor(record);
      await reserve(store, record);

      await expect(
        store.commitRecommendationDecision({
          ownerToken: `owner-${record.request.requestId}`,
          expectedPackStateDigest: null,
          nextPackState,
          record,
          events: decisionEvents(record).reverse(),
        }),
        name,
      ).resolves.toEqual({ status: 'committed', record });
      await expect(
        store.getPackState(record.request.sessionId, nextPackState.packRef),
        name,
      ).resolves.toEqual(nextPackState);
      await expect(
        store.getRecommendationDecision(record.response.recommendationId),
        name,
      ).resolves.toEqual(record);
      await expect(
        store.getRecommendationDecisionByRequest(record.request.requestId),
        name,
      ).resolves.toEqual(record);
      await expect(
        store.latestRecommendationDecisionForOrderFlow(
          record.request.orderFlowId,
        ),
        name,
      ).resolves.toEqual(record);
      await expect(
        store.listRecommendationEvents({
          orderFlowId: record.request.orderFlowId,
        }),
        name,
      ).resolves.toEqual(decisionEvents(record));
      await expect(reserve(store, record), name).resolves.toEqual({
        status: 'replay',
        record,
      });
      await expect(commit(store, record), name).resolves.toEqual({
        status: 'replay',
        record,
      });
    }
  });

  it('atomically adds the first recommendation state to an existing KFC envelope', async () => {
    for (const { name, store } of await fixtures()) {
      const record = recordFor(`${name.toLowerCase()}-existing-pack`);
      const existingPackState = await createPackStateEnvelope({
        packRef: { packId: 'kfc-vietnam', version: '1.0.0' },
        schemaVersion: '1',
        state: { cancellationStatusChecked: true },
      });
      const nextPackState = await createPackStateEnvelope({
        packRef: existingPackState.packRef,
        schemaVersion: existingPackState.schemaVersion,
        state: {
          cancellationStatusChecked: true,
          recommendationState: applyRecommendationDecision(
            initialRecommendationState(record.request.orderFlowId),
            record.response,
            record.request.decisionTime,
          ),
        },
      });
      await store.putPackState(record.request.sessionId, existingPackState);
      await reserve(store, record);

      await expect(
        store.commitRecommendationDecision({
          ownerToken: `owner-${record.request.requestId}`,
          expectedPackStateDigest: existingPackState.integrity.digest,
          nextPackState,
          record,
          events: decisionEvents(record),
        }),
        name,
      ).resolves.toEqual({ status: 'committed', record });
      await expect(
        store.getPackState(record.request.sessionId, existingPackState.packRef),
        name,
      ).resolves.toEqual(nextPackState);
      await expect(
        store.getRecommendationDecision(record.response.recommendationId),
        name,
      ).resolves.toEqual(record);
      await expect(
        store.listRecommendationEvents({ sessionId: record.request.sessionId }),
        name,
      ).resolves.toEqual(decisionEvents(record));
    }
  });

  it('does not match an absent recommendation state to a nonzero expected revision', async () => {
    for (const { name, store } of await fixtures()) {
      const baseRecord = recordFor(`${name.toLowerCase()}-absent-nonzero`);
      const record = {
        ...baseRecord,
        stateRevisionBefore: 1,
        stateRevisionAfter: 2,
      };
      const existingPackState = await createPackStateEnvelope({
        packRef: { packId: 'kfc-vietnam', version: '1.0.0' },
        schemaVersion: '1',
        state: { cancellationStatusChecked: true },
      });
      const stateAfterFirstDecision = applyRecommendationDecision(
        initialRecommendationState(record.request.orderFlowId),
        record.response,
        record.request.decisionTime,
      );
      const nextPackState = await createPackStateEnvelope({
        packRef: existingPackState.packRef,
        schemaVersion: existingPackState.schemaVersion,
        state: {
          cancellationStatusChecked: true,
          recommendationState: {
            ...stateAfterFirstDecision,
            revision: 2,
          },
        },
      });
      await store.putPackState(record.request.sessionId, existingPackState);
      await reserve(store, record);

      await expect(
        store.commitRecommendationDecision({
          ownerToken: `owner-${record.request.requestId}`,
          expectedPackStateDigest: existingPackState.integrity.digest,
          nextPackState,
          record,
          events: decisionEvents(record),
        }),
        name,
      ).resolves.toEqual({ status: 'stale' });
      await expect(
        store.getPackState(record.request.sessionId, existingPackState.packRef),
        name,
      ).resolves.toEqual(existingPackState);
      await expect(
        store.getRecommendationDecision(record.response.recommendationId),
        name,
      ).resolves.toBeUndefined();
      await expect(
        store.listRecommendationEvents({ sessionId: record.request.sessionId }),
        name,
      ).resolves.toEqual([]);
    }
  });

  it('fails closed on corrupt completed-reservation payloads in both stores', async () => {
    const memory = new MemoryStore();
    const memoryRecord = recordFor('memory-corrupt-reservation');
    await reserve(memory, memoryRecord);
    await commit(memory, memoryRecord);
    const memoryReservations = (
      memory as unknown as {
        recommendationReservations: Map<
          string,
          {
            responseJson?: string;
          }
        >;
      }
    ).recommendationReservations;
    const memoryReservation = [...memoryReservations.values()][0]!;
    memoryReservation.responseJson = '{}';
    await expect(reserve(memory, memoryRecord)).rejects.toThrow();

    const database = new SqliteD1Database();
    const d1 = new D1Store(database);
    try {
      await d1.initialize();
      const d1Record = recordFor('d1-corrupt-reservation');
      await reserve(d1, d1Record);
      await commit(d1, d1Record);
      database.sqlite
        .prepare(
          `UPDATE recommendation_request_reservations
           SET technical_json = '{}'
           WHERE session_id = ? AND idempotency_key = ?`,
        )
        .run(
          d1Record.request.sessionId,
          d1Record.request.idempotencyKey,
        );
      await expect(reserve(d1, d1Record)).rejects.toThrow();
    } finally {
      database.close();
    }
  });

  it('fails closed when a completed reservation links to another decision', async () => {
    const memory = new MemoryStore();
    const memoryFirst = recordFor('memory-reservation-link-first');
    const memorySecond = recordFor('memory-reservation-link-second');
    await reserve(memory, memoryFirst);
    await commit(memory, memoryFirst);
    await reserve(memory, memorySecond);
    await commit(memory, memorySecond);
    const memoryReservations = (
      memory as unknown as {
        recommendationReservations: Map<
          string,
          {
            requestId: string;
            recommendationId?: string;
          }
        >;
      }
    ).recommendationReservations;
    const memoryFirstReservation = [...memoryReservations.values()].find(
      (reservation) =>
        reservation.requestId === memoryFirst.request.requestId,
    )!;
    memoryFirstReservation.recommendationId =
      memorySecond.response.recommendationId;
    await expect(reserve(memory, memoryFirst)).rejects.toThrow(
      'recommendation_completed_reservation_mismatch',
    );

    const database = new SqliteD1Database();
    const d1 = new D1Store(database);
    try {
      await d1.initialize();
      const d1First = recordFor('d1-reservation-link-first');
      const d1Second = recordFor('d1-reservation-link-second');
      await reserve(d1, d1First);
      await commit(d1, d1First);
      await reserve(d1, d1Second);
      await commit(d1, d1Second);
      database.sqlite
        .prepare(
          `UPDATE recommendation_request_reservations
           SET recommendation_id = ?
           WHERE session_id = ? AND idempotency_key = ?`,
        )
        .run(
          d1Second.response.recommendationId,
          d1First.request.sessionId,
          d1First.request.idempotencyKey,
        );
      await expect(reserve(d1, d1First)).rejects.toThrow(
        'recommendation_completed_reservation_mismatch',
      );
    } finally {
      database.close();
    }
  });

  it('replays a semantically identical decision when technical feature keys are reordered', async () => {
    for (const { name, store } of await fixtures()) {
      const base = recordFor(`${name.toLowerCase()}-technical-order`);
      const first = recordWithFeatureSummary(base, {
        alpha: 1,
        beta: 'two',
      });
      const reordered = recordWithFeatureSummary(base, {
        beta: 'two',
        alpha: 1,
      });
      await reserve(store, first);
      await commit(store, first);

      await expect(commit(store, reordered), name).resolves.toEqual({
        status: 'replay',
        record: first,
      });
    }
  });

  it('leaves state, decision, and events unchanged when the pack-state CAS is stale', async () => {
    for (const { name, store } of await fixtures()) {
      const record = recordFor(`${name.toLowerCase()}-stale`);
      const existing = await createPackStateEnvelope({
        packRef: { packId: 'kfc-vietnam', version: '1.0.0' },
        schemaVersion: '1',
        state: {},
      });
      await store.putPackState(record.request.sessionId, existing);
      await reserve(store, record);

      await expect(commit(store, record, 'f'.repeat(64)), name).resolves.toEqual(
        { status: 'stale' },
      );
      await expect(
        store.getPackState(record.request.sessionId, existing.packRef),
        name,
      ).resolves.toEqual(existing);
      await expect(
        store.getRecommendationDecision(record.response.recommendationId),
        name,
      ).resolves.toBeUndefined();
      await expect(
        store.listRecommendationEvents({
          sessionId: record.request.sessionId,
        }),
        name,
      ).resolves.toEqual([]);
      await expect(reserve(store, record), name).resolves.toEqual({
        status: 'pending',
      });
    }
  });

  it('rejects a matching-digest commit whose state revision does not advance from the stored envelope', async () => {
    for (const { name, store } of await fixtures()) {
      const existing = recordFor(`${name.toLowerCase()}-revision-current`);
      await reserve(store, existing);
      await commit(store, existing);
      const currentEnvelope = await envelopeFor(existing);
      const rollback = recordForExistingFlow(
        `${name.toLowerCase()}-revision-rollback`,
        existing,
      );
      await reserve(store, rollback);

      await expect(
        store.commitRecommendationDecision({
          ownerToken: `owner-${rollback.request.requestId}`,
          expectedPackStateDigest: currentEnvelope.integrity.digest,
          nextPackState: await envelopeFor(rollback),
          record: rollback,
          events: decisionEvents(rollback),
        }),
        name,
      ).resolves.toEqual({ status: 'stale' });
      await expect(
        store.getPackState(existing.request.sessionId, currentEnvelope.packRef),
        name,
      ).resolves.toEqual(currentEnvelope);
      await expect(
        store.getRecommendationDecision(rollback.response.recommendationId),
        name,
      ).resolves.toBeUndefined();
      await expect(
        store.listRecommendationEvents({
          sessionId: existing.request.sessionId,
        }),
        name,
      ).resolves.toEqual(decisionEvents(existing));
    }
  });

  it('does not partially write pack state or a decision when an event ID conflicts', async () => {
    for (const { name, store } of await fixtures()) {
      const first = recordFor(`${name.toLowerCase()}-event-owner`);
      await reserve(store, first);
      await commit(store, first);

      const conflicting = recordFor(`${name.toLowerCase()}-event-conflict`);
      const conflictingEvents = decisionEvents(conflicting);
      conflictingEvents[0] = parseRecommendationEvent({
        ...conflictingEvents[0],
        eventId: decisionEvents(first)[0].eventId,
      });
      const nextPackState = await envelopeFor(conflicting);
      await reserve(store, conflicting);

      await expect(
        store.commitRecommendationDecision({
          ownerToken: `owner-${conflicting.request.requestId}`,
          expectedPackStateDigest: null,
          nextPackState,
          record: conflicting,
          events: conflictingEvents,
        }),
        name,
      ).resolves.toEqual({ status: 'stale' });
      await expect(
        store.getPackState(
          conflicting.request.sessionId,
          nextPackState.packRef,
        ),
        name,
      ).resolves.toBeUndefined();
      await expect(
        store.getRecommendationDecision(
          conflicting.response.recommendationId,
        ),
        name,
      ).resolves.toBeUndefined();
      await expect(
        store.listRecommendationEvents({
          sessionId: conflicting.request.sessionId,
        }),
        name,
      ).resolves.toEqual([]);
      await expect(reserve(store, conflicting), name).resolves.toEqual({
        status: 'pending',
      });
    }
  });

  it('records one event with state, replays its fingerprint, conflicts on another fingerprint, and rejects stale CAS', async () => {
    for (const { name, store } of await fixtures()) {
      const record = recordFor(`${name.toLowerCase()}-event`);
      await reserve(store, record);
      await commit(store, record);
      const currentEnvelope = await envelopeFor(record);
      const currentState = Reflect.get(
        currentEnvelope.state as object,
        'recommendationState',
      );
      const event = parseRecommendationEvent({
        ...decisionEvents(record)[1],
        eventId: `event-impression-${record.request.requestId}`,
        eventType: 'impression_rendered',
        occurredAt: '2026-07-27T09:00:04Z',
        recordedAt: '2026-07-27T09:00:05Z',
        actor: 'client',
        actionId: record.response.primaryOffer!.actions[0]!.actionId,
        payload: {
          assistantTurnId: 'assistant-turn-001',
          attachmentId: 'attachment-001',
          renderedActions: [
            {
              actionId: record.response.primaryOffer!.actions[0]!.actionId,
              position: 1,
            },
          ],
          actionDigest: record.actionDigest,
        },
      });
      const nextEnvelope = await createPackStateEnvelope({
        packRef: currentEnvelope.packRef,
        schemaVersion: '1',
        state: {
          recommendationState: applyRecommendationImpression(
            currentState,
            event,
          ),
        },
      });
      const appendInput = {
        eventFingerprint: 'd'.repeat(64),
        event,
        expectedPackStateDigest: currentEnvelope.integrity.digest,
        nextPackState: nextEnvelope,
      };

      await expect(
        store.appendRecommendationEvent(appendInput),
        name,
      ).resolves.toEqual({ status: 'recorded', event });
      await expect(
        store.appendRecommendationEvent(appendInput),
        name,
      ).resolves.toEqual({ status: 'replay', event });
      await expect(
        store.appendRecommendationEvent({
          ...appendInput,
          eventFingerprint: 'e'.repeat(64),
        }),
        name,
      ).resolves.toEqual({ status: 'conflict' });
      await expect(
        store.appendRecommendationEvent({
          ...appendInput,
          eventFingerprint: 'f'.repeat(64),
          event: parseRecommendationEvent({
            ...event,
            eventId: `${event.eventId}-stale`,
          }),
        }),
        name,
      ).resolves.toEqual({ status: 'stale' });
      await expect(
        store.listRecommendationEvents({
          recommendationId: record.response.recommendationId,
        }),
        name,
      ).resolves.toEqual([decisionEvents(record)[1], event]);
    }
  });

  it('replays a semantically identical event when payload keys are reordered', async () => {
    for (const { name, store } of await fixtures()) {
      const record = recordFor(`${name.toLowerCase()}-event-key-order`);
      await reserve(store, record);
      await commit(store, record);
      const currentEnvelope = await envelopeFor(record);
      const actionId = record.response.primaryOffer!.actions[0]!.actionId;
      const event = parseRecommendationEvent({
        ...decisionEvents(record)[1],
        eventId: `event-impression-key-order-${record.request.requestId}`,
        eventType: 'impression_rendered',
        occurredAt: '2026-07-27T09:00:04Z',
        recordedAt: '2026-07-27T09:00:05Z',
        actor: 'client',
        actionId,
        payload: {
          assistantTurnId: 'assistant-turn-001',
          attachmentId: 'attachment-001',
          renderedActions: [{ actionId, position: 1 }],
          actionDigest: record.actionDigest,
        },
      });
      const nextEnvelope = await createPackStateEnvelope({
        packRef: currentEnvelope.packRef,
        schemaVersion: '1',
        state: {
          recommendationState: applyRecommendationImpression(
            Reflect.get(
              currentEnvelope.state as object,
              'recommendationState',
            ),
            event,
          ),
        },
      });
      const first = {
        eventFingerprint: 'd'.repeat(64),
        event,
        expectedPackStateDigest: currentEnvelope.integrity.digest,
        nextPackState: nextEnvelope,
      };
      await store.appendRecommendationEvent(first);
      const reorderedEvent = parseRecommendationEvent({
        ...event,
        payload: {
          actionDigest: record.actionDigest,
          renderedActions: [{ actionId, position: 1 }],
          attachmentId: 'attachment-001',
          assistantTurnId: 'assistant-turn-001',
        },
      });

      await expect(
        store.appendRecommendationEvent({
          ...first,
          event: reorderedEvent,
        }),
        name,
      ).resolves.toEqual({ status: 'replay', event });
    }
  });

  it('records an approved empty-payload outcome event with its state transition', async () => {
    for (const { name, store } of await fixtures()) {
      const record = recordFor(`${name.toLowerCase()}-outcome`);
      await reserve(store, record);
      await commit(store, record);
      const currentEnvelope = await envelopeFor(record);
      const actionId = record.response.primaryOffer!.actions[0]!.actionId;
      const event = parseRecommendationEvent({
        ...decisionEvents(record)[1],
        eventId: `event-selected-${record.request.requestId}`,
        eventType: 'selected',
        occurredAt: '2026-07-27T09:00:04Z',
        recordedAt: '2026-07-27T09:00:05Z',
        actor: 'customer',
        actionId,
        payload: {},
      });
      const nextEnvelope = await createPackStateEnvelope({
        packRef: currentEnvelope.packRef,
        schemaVersion: '1',
        state: {
          recommendationState: applyRecommendationOutcome(
            Reflect.get(
              currentEnvelope.state as object,
              'recommendationState',
            ),
            event,
            [actionId],
          ),
        },
      });

      await expect(
        store.appendRecommendationEvent({
          eventFingerprint: 'e'.repeat(64),
          event,
          expectedPackStateDigest: currentEnvelope.integrity.digest,
          nextPackState: nextEnvelope,
        }),
        name,
      ).resolves.toEqual({ status: 'recorded', event });
      await expect(
        store.listRecommendationEvents({
          recommendationId: record.response.recommendationId,
        }),
        name,
      ).resolves.toEqual([decisionEvents(record)[1], event]);
    }
  });

  it('strictly rejects malformed records instead of persisting customer prose or non-finite evidence', async () => {
    for (const { name, store } of await fixtures()) {
      const record = recordFor(`${name.toLowerCase()}-strict`);
      await reserve(store, record);
      const malformed = {
        ...record,
        technical: {
          ...record.technical,
          hiddenCustomerProse: 'do not persist me',
          confidence: Number.POSITIVE_INFINITY,
        },
      } as unknown as RecommendationDecisionRecord;

      await expect(
        store.commitRecommendationDecision({
          ownerToken: `owner-${record.request.requestId}`,
          expectedPackStateDigest: null,
          nextPackState: await envelopeFor(record),
          record: malformed,
          events: decisionEvents(record),
        }),
        name,
      ).rejects.toThrow();
      await expect(
        store.getRecommendationDecision(record.response.recommendationId),
        name,
      ).resolves.toBeUndefined();
    }
  });

  it('rejects arbitrary customer prose in persisted recommendation event payloads', async () => {
    for (const { name, store } of await fixtures()) {
      const record = recordFor(`${name.toLowerCase()}-event-prose`);
      await reserve(store, record);
      const events = decisionEvents(record);
      events[0] = parseRecommendationEvent({
        ...events[0],
        payload: { customerMessage: 'please remember my exact words' },
      });

      await expect(
        store.commitRecommendationDecision({
          ownerToken: `owner-${record.request.requestId}`,
          expectedPackStateDigest: null,
          nextPackState: await envelopeFor(record),
          record,
          events,
        }),
        name,
      ).rejects.toThrow();
      await expect(
        store.getRecommendationDecision(record.response.recommendationId),
        name,
      ).resolves.toBeUndefined();
    }
  });

  it('rejects unapproved candidate eligibility summaries in both stores', async () => {
    for (const { name, store } of await fixtures()) {
      const record = recordFor(`${name.toLowerCase()}-candidate-summary`);
      await reserve(store, record);
      const events = decisionEvents(record);
      events[0] = parseRecommendationEvent({
        ...events[0],
        eventType: 'candidate_eligibility_summary',
        recommendationId: record.response.recommendationId,
        payload: {},
      });

      await expect(
        store.commitRecommendationDecision({
          ownerToken: `owner-${record.request.requestId}`,
          expectedPackStateDigest: null,
          nextPackState: await envelopeFor(record),
          record,
          events,
        }),
        name,
      ).rejects.toThrow(
        'recommendation_candidate_summary_persistence_unsupported',
      );
    }
  });

  it('fails closed when stored decision identity no longer matches its lookup key or scalar columns', async () => {
    const memory = new MemoryStore();
    const memoryRecord = recordFor('memory-corrupt-read');
    await reserve(memory, memoryRecord);
    await commit(memory, memoryRecord);
    const memoryInternals = memory as unknown as {
      recommendationDecisions: Map<string, RecommendationDecisionRecord>;
    };
    memoryInternals.recommendationDecisions.set(
      memoryRecord.response.recommendationId,
      {
        ...structuredClone(memoryRecord),
        response: parseRecommendationDecisionResponse({
          ...memoryRecord.response,
          recommendationId: `${memoryRecord.response.recommendationId}-wrong`,
        }),
      },
    );
    await expect(
      memory.getRecommendationDecision(
        memoryRecord.response.recommendationId,
      ),
    ).rejects.toThrow('recommendation_decision_storage_identity_mismatch');

    const database = new SqliteD1Database();
    const store = new D1Store(database);
    try {
      await store.initialize();
      const record = recordFor('d1-corrupt-read');
      await reserve(store, record);
      await commit(store, record);
      database.sqlite
        .prepare(
          `UPDATE recommendation_decisions
           SET order_flow_id = ?
           WHERE recommendation_id = ?`,
        )
        .run(
          `${record.request.orderFlowId}-wrong`,
          record.response.recommendationId,
        );

      await expect(
        store.getRecommendationDecision(record.response.recommendationId),
      ).rejects.toThrow('recommendation_decision_storage_identity_mismatch');
    } finally {
      database.close();
    }
  });

  it('strictly parses stored events and demo history for both implementations', async () => {
    const memory = new MemoryStore();
    const memoryRecord = recordFor('memory-corrupt-event');
    await reserve(memory, memoryRecord);
    await commit(memory, memoryRecord);
    const memoryInternals = memory as unknown as {
      recommendationEvents: Map<
        string,
        { eventFingerprint: string; event: RecommendationEvent }
      >;
      recommendationDemoCustomerHistory: Map<
        string,
        RecommendationDemoCustomerHistoryRecord
      >;
    };
    const memoryEvent = decisionEvents(memoryRecord)[0];
    const persistedMemoryEvent = memoryInternals.recommendationEvents.get(
      memoryEvent.eventId,
    )!;
    memoryInternals.recommendationEvents.set(memoryEvent.eventId, {
      ...persistedMemoryEvent,
      event: parseRecommendationEvent({
        ...memoryEvent,
        payload: { customerMessage: 'corrupt stored prose' },
      }),
    });
    await expect(
      memory.listRecommendationEvents({
        sessionId: memoryRecord.request.sessionId,
      }),
    ).rejects.toThrow();
    const memoryHistory =
      memoryInternals.recommendationDemoCustomerHistory.get(
        'demo-returning-linked',
      )!;
    memoryInternals.recommendationDemoCustomerHistory.set(
      'demo-returning-linked',
      {
        ...memoryHistory,
        favoriteSellableItemIds: [''],
      },
    );
    await expect(
      memory.getRecommendationDemoCustomerHistory('demo-returning-linked'),
    ).rejects.toThrow();

    const database = new SqliteD1Database();
    const d1 = new D1Store(database);
    try {
      await d1.initialize();
      const d1Record = recordFor('d1-corrupt-event');
      await reserve(d1, d1Record);
      await commit(d1, d1Record);
      database.sqlite
        .prepare(
          `UPDATE recommendation_events
           SET payload_json = '{"customerMessage":"corrupt stored prose"}'
           WHERE event_id = ?`,
        )
        .run(decisionEvents(d1Record)[0].eventId);
      await expect(
        d1.listRecommendationEvents({
          sessionId: d1Record.request.sessionId,
        }),
      ).rejects.toThrow();
      database.sqlite
        .prepare(
          `UPDATE recommendation_demo_customer_history
           SET favorites_json = '[""]'
           WHERE customer_ref = 'demo-returning-linked'`,
        )
        .run();
      await expect(
        d1.getRecommendationDemoCustomerHistory('demo-returning-linked'),
      ).rejects.toThrow();
    } finally {
      database.close();
    }
  });

  it('serves only linked, explicitly synthetic POC customer history through the adapter', async () => {
    for (const { name, store } of await fixtures()) {
      const adapter = new StoredDemoCustomerHistoryRepository(store);
      const returning = await adapter.load('demo-returning-linked');
      expect(returning, name).toMatchObject({
        verifiedCustomerRef: 'demo-returning-linked',
        linked: true,
      });
      expect(returning!.fixtureLabel.toLowerCase(), name).toMatch(
        /mock|synthetic/,
      );
      expect(
        returning!.completedOrders.flatMap((order) => order.lines),
        name,
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            sellableItemId: '20751',
            categoryId: '20000',
          }),
        ]),
      );
      await expect(
        adapter.load('demo-linked-zero-history'),
        name,
      ).resolves.toMatchObject({ linked: true, completedOrders: [] });
      await expect(
        adapter.load('demo-anonymous-unlinked'),
        name,
      ).resolves.toBeNull();
      await expect(adapter.load('unknown-customer'), name).resolves.toBeNull();
    }
  });
});
