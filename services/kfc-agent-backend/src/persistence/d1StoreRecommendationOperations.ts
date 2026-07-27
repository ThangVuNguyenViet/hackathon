import type { RecommendationEvent } from '../recommendations/domain/contracts.js';
import {
  instantSchema,
  sha256Schema,
} from '../recommendations/domain/schemas.js';
import type {
  AppendRecommendationEventInput,
  AppendRecommendationEventResult,
  CommitRecommendationDecisionInput,
  CommitRecommendationDecisionResult,
  ListRecommendationEventsInput,
  RecommendationDecisionRecord,
  RecommendationDemoCustomerHistoryRecord,
  ReserveRecommendationDecisionInput,
  ReserveRecommendationDecisionResult,
} from '../recommendations/persistence/repository.js';
import {
  assertDecisionEventsCorrelate,
  assertCompletedRecommendationReservationReplay,
  assertRecommendationPackState,
  sameRecommendationDecisionRecord,
  sameRecommendationEvent,
} from '../recommendations/persistence/repository.js';
import {
  parseRecommendationDecisionRecord,
  parseRecommendationDecisionStoragePayload,
  parseRecommendationDemoCustomerHistoryRecord,
  parsePersistedRecommendationEvent,
  serializeRecommendationDecisionStoragePayload,
} from '../recommendations/persistence/types.js';
import { digestCommerceAction } from '../ordering/commerceDigest.js';
import type { PackStateEnvelope } from '../runtime/businessPack.js';
import { D1StoreConversationOperations } from './d1StoreConversationOperations.js';
import type {
  D1PreparedStatement,
  RecommendationDecisionRow,
  RecommendationDemoCustomerHistoryRow,
  RecommendationEventRow,
  RecommendationReservationRow,
} from './d1StoreSupport.js';

const decisionColumns = `
  recommendation_id,
  request_id,
  order_flow_id,
  session_id,
  placement,
  response_json,
  technical_json,
  action_digest,
  request_fingerprint,
  state_revision_before,
  state_revision_after,
  recorded_at
`;

const eventColumns = `
  event_id,
  event_fingerprint,
  schema_version,
  event_type,
  recommendation_id,
  request_id,
  order_flow_id,
  session_id,
  placement,
  occurred_at,
  recorded_at,
  actor,
  action_id,
  cart_revision,
  version_bindings_json,
  payload_json
`;

interface ParsedReservationInput {
  sessionId: string;
  idempotencyKey: string;
  requestId: string;
  requestFingerprint: string;
  ownerToken: string;
  createdAt: string;
}

interface PersistedEvent {
  eventFingerprint: string;
  event: RecommendationEvent;
}

export class D1StoreRecommendationOperations extends D1StoreConversationOperations {
  async reserveRecommendationDecision(
    input: ReserveRecommendationDecisionInput,
  ): Promise<ReserveRecommendationDecisionResult> {
    const parsed = parseReservationInput(input);
    const inserted = await this.db
      .prepare(
        `INSERT OR IGNORE INTO recommendation_request_reservations (
           session_id, idempotency_key, request_id, request_fingerprint,
           status, owner_token, response_json, technical_json,
           recommendation_id, created_at, completed_at
         ) VALUES (?, ?, ?, ?, 'pending', ?, NULL, NULL, NULL, ?, NULL)`,
      )
      .bind(
        parsed.sessionId,
        parsed.idempotencyKey,
        parsed.requestId,
        parsed.requestFingerprint,
        parsed.ownerToken,
        parsed.createdAt,
      )
      .run();
    if (Number(inserted.meta.changes ?? 0) === 1) {
      return { status: 'reserved' };
    }

    const existing = await this.readReservation(
      parsed.sessionId,
      parsed.idempotencyKey,
    );
    if (
      !existing ||
      existing.request_id !== parsed.requestId ||
      existing.request_fingerprint !== parsed.requestFingerprint
    ) {
      return { status: 'conflict' };
    }
    if (existing.status === 'completed') {
      if (!existing.recommendation_id) {
        throw new Error('recommendation_completed_reservation_invalid');
      }
      const record = await this.getRecommendationDecision(
        existing.recommendation_id,
      );
      if (!record) throw new Error('recommendation_replay_record_missing');
      assertCompletedRecommendationReservationReplay({
        requested: parsed,
        stored: {
          sessionId: existing.session_id,
          idempotencyKey: existing.idempotency_key,
          requestId: existing.request_id,
          requestFingerprint: existing.request_fingerprint,
          recommendationId: existing.recommendation_id ?? undefined,
          responseJson: existing.response_json ?? undefined,
          technicalJson: existing.technical_json ?? undefined,
        },
        record,
      });
      return { status: 'replay', record };
    }
    return { status: 'pending' };
  }

  async commitRecommendationDecision(
    input: CommitRecommendationDecisionInput,
  ): Promise<CommitRecommendationDecisionResult> {
    if (!this.db.batch) throw new Error('d1_batch_required');
    const ownerToken = nonBlank(input.ownerToken, 'owner_token_invalid');
    const expectedPackStateDigest =
      input.expectedPackStateDigest === null
        ? null
        : sha256Schema.parse(input.expectedPackStateDigest);
    const record = parseRecommendationDecisionRecord(
      structuredClone(input.record),
    );
    const events = input.events.map((event) =>
      parsePersistedRecommendationEvent(structuredClone(event)),
    );
    assertDecisionEventsCorrelate(record, events);
    await assertRecommendationPackState(
      input.nextPackState,
      record.request.orderFlowId,
      record.stateRevisionAfter,
    );
    const persistedEvents = await Promise.all(
      events.map(async (event) => ({
        eventFingerprint: await digestCommerceAction(event),
        event,
      })),
    );

    const existing =
      (await this.getRecommendationDecision(
        record.response.recommendationId,
      )) ??
      (await this.getRecommendationDecisionByRequest(record.request.requestId));
    if (existing) {
      return sameRecommendationDecisionRecord(existing, record)
        ? { status: 'replay', record: existing }
        : { status: 'stale' };
    }

    const currentPackState = await this.getPackState(
      record.request.sessionId,
      input.nextPackState.packRef,
    );
    if (
      (expectedPackStateDigest === null && currentPackState !== undefined) ||
      (expectedPackStateDigest !== null &&
        currentPackState?.integrity.digest !== expectedPackStateDigest)
    ) {
      return { status: 'stale' };
    }
    const currentRevision =
      currentPackState === undefined
        ? 0
        : await assertRecommendationPackState(
            currentPackState,
            record.request.orderFlowId,
          );
    if (currentRevision !== record.stateRevisionBefore) {
      return { status: 'stale' };
    }

    const { responseJson, technicalJson: storageTechnicalJson } =
      serializeRecommendationDecisionStoragePayload(record);
    const nextEnvelopeJson = JSON.stringify(input.nextPackState);
    const packCas = this.packStateCasStatement({
      sessionId: record.request.sessionId,
      expectedPackStateDigest,
      expectedStateRevision: record.stateRevisionBefore,
      nextPackState: input.nextPackState,
      nextEnvelopeJson,
      updatedAt: record.recordedAt,
      reservation: {
        ownerToken,
        requestId: record.request.requestId,
        requestFingerprint: record.requestFingerprint,
        idempotencyKey: record.request.idempotencyKey,
      },
      recommendationId: record.response.recommendationId,
      eventIds: persistedEvents.map(({ event }) => event.eventId),
    });
    const decisionInsert = this.db
      .prepare(
        `INSERT INTO recommendation_decisions (${decisionColumns})
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
         WHERE changes() = 1
           AND EXISTS (
             SELECT 1 FROM recommendation_request_reservations
             WHERE session_id = ?
               AND idempotency_key = ?
               AND request_id = ?
               AND request_fingerprint = ?
               AND owner_token = ?
               AND status = 'pending'
           )`,
      )
      .bind(
        record.response.recommendationId,
        record.request.requestId,
        record.request.orderFlowId,
        record.request.sessionId,
        record.request.placement,
        responseJson,
        storageTechnicalJson,
        record.actionDigest,
        record.requestFingerprint,
        record.stateRevisionBefore,
        record.stateRevisionAfter,
        record.recordedAt,
        record.request.sessionId,
        record.request.idempotencyKey,
        record.request.requestId,
        record.requestFingerprint,
        ownerToken,
      );
    const eventInserts = persistedEvents.map((persisted) =>
      this.decisionEventInsertStatement({
        persisted,
        record,
        ownerToken,
        nextPackState: input.nextPackState,
        responseJson,
        storageTechnicalJson,
      }),
    );
    const completion = this.reservationCompletionStatement({
      record,
      ownerToken,
      nextPackState: input.nextPackState,
      responseJson,
      storageTechnicalJson,
      events: persistedEvents,
    });
    const results = await this.db.batch([
      packCas,
      decisionInsert,
      ...eventInserts,
      completion,
    ]);

    const committed = await this.getRecommendationDecision(
      record.response.recommendationId,
    );
    const completedReservation = await this.readReservation(
      record.request.sessionId,
      record.request.idempotencyKey,
    );
    if (
      committed &&
      sameRecommendationDecisionRecord(committed, record) &&
      completedReservation?.status === 'completed'
    ) {
      const completionResult = results.at(-1);
      return {
        status:
          Number(completionResult?.meta.changes ?? 0) === 1
            ? 'committed'
            : 'replay',
        record: committed,
      };
    }
    return { status: 'stale' };
  }

  async appendRecommendationEvent(
    input: AppendRecommendationEventInput,
  ): Promise<AppendRecommendationEventResult> {
    if (!this.db.batch) throw new Error('d1_batch_required');
    const eventFingerprint = sha256Schema.parse(input.eventFingerprint);
    const expectedPackStateDigest = sha256Schema.parse(
      input.expectedPackStateDigest,
    );
    const event = parsePersistedRecommendationEvent(
      structuredClone(input.event),
    );
    const nextRevision = await assertRecommendationPackState(
      input.nextPackState,
      event.orderFlowId,
    );
    const existing = await this.readEvent(event.eventId);
    if (existing) {
      return existing.eventFingerprint === eventFingerprint &&
        sameRecommendationEvent(existing.event, event)
        ? { status: 'replay', event: existing.event }
        : { status: 'conflict' };
    }

    const currentPackState = await this.getPackState(
      event.sessionId,
      input.nextPackState.packRef,
    );
    if (
      !currentPackState ||
      currentPackState.integrity.digest !== expectedPackStateDigest
    ) {
      return { status: 'stale' };
    }
    const currentRevision = await assertRecommendationPackState(
      currentPackState,
      event.orderFlowId,
    );
    if (nextRevision <= currentRevision) return { status: 'stale' };

    const nextEnvelopeJson = JSON.stringify(input.nextPackState);
    const packCas = this.db
      .prepare(
        `UPDATE pack_state_projections
         SET envelope_json = ?, updated_at = ?
         WHERE session_id = ?
           AND pack_id = ?
           AND pack_version = ?
           AND json_extract(envelope_json, '$.integrity.digest') = ?
           AND json_extract(
             envelope_json,
             '$.state.recommendationState.revision'
           ) = ?
           AND NOT EXISTS (
             SELECT 1 FROM recommendation_events WHERE event_id = ?
           )`,
      )
      .bind(
        nextEnvelopeJson,
        event.recordedAt,
        event.sessionId,
        input.nextPackState.packRef.packId,
        input.nextPackState.packRef.version,
        expectedPackStateDigest,
        currentRevision,
        event.eventId,
      );
    const eventInsert = this.db
      .prepare(
        `INSERT INTO recommendation_events (${eventColumns})
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
         WHERE changes() = 1`,
      )
      .bind(...eventStorageValues({ eventFingerprint, event }));
    const results = await this.db.batch([packCas, eventInsert]);
    const stored = await this.readEvent(event.eventId);
    if (stored) {
      if (
        stored.eventFingerprint !== eventFingerprint ||
        !sameRecommendationEvent(stored.event, event)
      ) {
        return { status: 'conflict' };
      }
      return {
        status:
          Number(results[1]?.meta.changes ?? 0) === 1 ? 'recorded' : 'replay',
        event: stored.event,
      };
    }
    return { status: 'stale' };
  }

  async getRecommendationDecision(
    recommendationId: string,
  ): Promise<RecommendationDecisionRecord | undefined> {
    const row = await this.db
      .prepare(
        `SELECT ${decisionColumns}
         FROM recommendation_decisions
         WHERE recommendation_id = ?
         LIMIT 1`,
      )
      .bind(recommendationId)
      .first<RecommendationDecisionRow>();
    return row ? decisionFromRow(row) : undefined;
  }

  async getRecommendationDecisionByRequest(
    requestId: string,
  ): Promise<RecommendationDecisionRecord | undefined> {
    const row = await this.db
      .prepare(
        `SELECT ${decisionColumns}
         FROM recommendation_decisions
         WHERE request_id = ?
         LIMIT 1`,
      )
      .bind(requestId)
      .first<RecommendationDecisionRow>();
    return row ? decisionFromRow(row) : undefined;
  }

  async listRecommendationEvents(
    input: ListRecommendationEventsInput,
  ): Promise<RecommendationEvent[]> {
    const predicates: string[] = [];
    const values: string[] = [];
    if (input.orderFlowId !== undefined) {
      predicates.push('order_flow_id = ?');
      values.push(input.orderFlowId);
    }
    if (input.recommendationId !== undefined) {
      predicates.push('recommendation_id = ?');
      values.push(input.recommendationId);
    }
    if (input.sessionId !== undefined) {
      predicates.push('session_id = ?');
      values.push(input.sessionId);
    }
    const rows = await this.db
      .prepare(
        `SELECT ${eventColumns}
         FROM recommendation_events
         ${predicates.length > 0 ? `WHERE ${predicates.join(' AND ')}` : ''}
         ORDER BY occurred_at, event_id`,
      )
      .bind(...values)
      .all<RecommendationEventRow>();
    return (rows.results ?? []).map(eventFromRow).map(({ event }) => event);
  }

  async latestRecommendationDecisionForOrderFlow(
    orderFlowId: string,
  ): Promise<RecommendationDecisionRecord | undefined> {
    const row = await this.db
      .prepare(
        `SELECT ${decisionColumns}
         FROM recommendation_decisions
         WHERE order_flow_id = ?
         ORDER BY recorded_at DESC, recommendation_id DESC
         LIMIT 1`,
      )
      .bind(orderFlowId)
      .first<RecommendationDecisionRow>();
    return row ? decisionFromRow(row) : undefined;
  }

  async getRecommendationDemoCustomerHistory(
    verifiedCustomerRef: string,
  ): Promise<RecommendationDemoCustomerHistoryRecord | undefined> {
    const row = await this.db
      .prepare(
        `SELECT customer_ref, fixture_label, linked, completed_orders_json,
                favorites_json, updated_at
         FROM recommendation_demo_customer_history
         WHERE customer_ref = ?
         LIMIT 1`,
      )
      .bind(verifiedCustomerRef)
      .first<RecommendationDemoCustomerHistoryRow>();
    return row ? demoHistoryFromRow(row) : undefined;
  }

  private async readReservation(
    sessionId: string,
    idempotencyKey: string,
  ): Promise<RecommendationReservationRow | undefined> {
    return (
      (await this.db
        .prepare(
          `SELECT session_id, idempotency_key, request_id,
                  request_fingerprint, status, owner_token, response_json,
                  technical_json, recommendation_id, created_at, completed_at
           FROM recommendation_request_reservations
           WHERE session_id = ? AND idempotency_key = ?
           LIMIT 1`,
        )
        .bind(sessionId, idempotencyKey)
        .first<RecommendationReservationRow>()) ?? undefined
    );
  }

  private async readEvent(
    eventId: string,
  ): Promise<PersistedEvent | undefined> {
    const row = await this.db
      .prepare(
        `SELECT ${eventColumns}
         FROM recommendation_events
         WHERE event_id = ?
         LIMIT 1`,
      )
      .bind(eventId)
      .first<RecommendationEventRow>();
    return row ? eventFromRow(row) : undefined;
  }

  private packStateCasStatement(input: {
    sessionId: string;
    expectedPackStateDigest: string | null;
    expectedStateRevision: number;
    nextPackState: PackStateEnvelope;
    nextEnvelopeJson: string;
    updatedAt: string;
    reservation: {
      ownerToken: string;
      requestId: string;
      requestFingerprint: string;
      idempotencyKey: string;
    };
    recommendationId: string;
    eventIds: readonly string[];
  }): D1PreparedStatement {
    const eventConflictSql =
      input.eventIds.length === 0
        ? ''
        : `AND NOT EXISTS (
             SELECT 1 FROM recommendation_events
             WHERE event_id IN (${input.eventIds.map(() => '?').join(', ')})
           )`;
    const commonPredicate = `
      EXISTS (
        SELECT 1 FROM recommendation_request_reservations
        WHERE session_id = ?
          AND idempotency_key = ?
          AND request_id = ?
          AND request_fingerprint = ?
          AND owner_token = ?
          AND status = 'pending'
      )
      AND NOT EXISTS (
        SELECT 1 FROM recommendation_decisions
        WHERE recommendation_id = ? OR request_id = ?
      )
      ${eventConflictSql}`;
    const commonValues = [
      input.sessionId,
      input.reservation.idempotencyKey,
      input.reservation.requestId,
      input.reservation.requestFingerprint,
      input.reservation.ownerToken,
      input.recommendationId,
      input.reservation.requestId,
      ...input.eventIds,
    ];
    if (input.expectedPackStateDigest === null) {
      return this.db
        .prepare(
          `INSERT INTO pack_state_projections (
             session_id, pack_id, pack_version, envelope_json, updated_at
           )
           SELECT ?, ?, ?, ?, ?
           WHERE NOT EXISTS (
             SELECT 1 FROM pack_state_projections
             WHERE session_id = ? AND pack_id = ? AND pack_version = ?
           )
             AND ${commonPredicate}`,
        )
        .bind(
          input.sessionId,
          input.nextPackState.packRef.packId,
          input.nextPackState.packRef.version,
          input.nextEnvelopeJson,
          input.updatedAt,
          input.sessionId,
          input.nextPackState.packRef.packId,
          input.nextPackState.packRef.version,
          ...commonValues,
        );
    }
    return this.db
      .prepare(
        `UPDATE pack_state_projections
         SET envelope_json = ?, updated_at = ?
         WHERE session_id = ?
           AND pack_id = ?
           AND pack_version = ?
           AND json_extract(envelope_json, '$.integrity.digest') = ?
           AND json_extract(
             envelope_json,
             '$.state.recommendationState.revision'
           ) = ?
           AND ${commonPredicate}`,
      )
      .bind(
        input.nextEnvelopeJson,
        input.updatedAt,
        input.sessionId,
        input.nextPackState.packRef.packId,
        input.nextPackState.packRef.version,
        input.expectedPackStateDigest,
        input.expectedStateRevision,
        ...commonValues,
      );
  }

  private decisionEventInsertStatement(input: {
    persisted: PersistedEvent;
    record: RecommendationDecisionRecord;
    ownerToken: string;
    nextPackState: PackStateEnvelope;
    responseJson: string;
    storageTechnicalJson: string;
  }): D1PreparedStatement {
    return this.db
      .prepare(
        `INSERT INTO recommendation_events (${eventColumns})
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
         WHERE NOT EXISTS (
             SELECT 1 FROM recommendation_events WHERE event_id = ?
           )
           AND EXISTS (
             SELECT 1 FROM pack_state_projections
             WHERE session_id = ?
               AND pack_id = ?
               AND pack_version = ?
               AND json_extract(envelope_json, '$.integrity.digest') = ?
           )
           AND EXISTS (
             SELECT 1 FROM recommendation_request_reservations
             WHERE session_id = ?
               AND idempotency_key = ?
               AND request_id = ?
               AND request_fingerprint = ?
               AND owner_token = ?
               AND status = 'pending'
           )
           AND EXISTS (
             SELECT 1 FROM recommendation_decisions
             WHERE recommendation_id = ?
               AND request_id = ?
               AND response_json = ?
               AND technical_json = ?
               AND action_digest = ?
               AND request_fingerprint = ?
           )`,
      )
      .bind(
        ...eventStorageValues(input.persisted),
        input.persisted.event.eventId,
        input.record.request.sessionId,
        input.nextPackState.packRef.packId,
        input.nextPackState.packRef.version,
        input.nextPackState.integrity.digest,
        input.record.request.sessionId,
        input.record.request.idempotencyKey,
        input.record.request.requestId,
        input.record.requestFingerprint,
        input.ownerToken,
        input.record.response.recommendationId,
        input.record.request.requestId,
        input.responseJson,
        input.storageTechnicalJson,
        input.record.actionDigest,
        input.record.requestFingerprint,
      );
  }

  private reservationCompletionStatement(input: {
    record: RecommendationDecisionRecord;
    ownerToken: string;
    nextPackState: PackStateEnvelope;
    responseJson: string;
    storageTechnicalJson: string;
    events: readonly PersistedEvent[];
  }): D1PreparedStatement {
    const eventPredicates = input.events
      .map(
        () =>
          `EXISTS (
             SELECT 1 FROM recommendation_events
             WHERE event_id = ? AND event_fingerprint = ?
           )`,
      )
      .join(' AND ');
    return this.db
      .prepare(
        `UPDATE recommendation_request_reservations
         SET status = 'completed',
             response_json = ?,
             technical_json = ?,
             recommendation_id = ?,
             completed_at = ?
         WHERE session_id = ?
           AND idempotency_key = ?
           AND request_id = ?
           AND request_fingerprint = ?
           AND owner_token = ?
           AND status = 'pending'
           AND EXISTS (
             SELECT 1 FROM pack_state_projections
             WHERE session_id = ?
               AND pack_id = ?
               AND pack_version = ?
               AND json_extract(envelope_json, '$.integrity.digest') = ?
           )
           AND EXISTS (
             SELECT 1 FROM recommendation_decisions
             WHERE recommendation_id = ?
               AND request_id = ?
               AND response_json = ?
               AND technical_json = ?
               AND action_digest = ?
               AND request_fingerprint = ?
           )
           ${eventPredicates ? `AND ${eventPredicates}` : ''}`,
      )
      .bind(
        input.responseJson,
        input.storageTechnicalJson,
        input.record.response.recommendationId,
        input.record.recordedAt,
        input.record.request.sessionId,
        input.record.request.idempotencyKey,
        input.record.request.requestId,
        input.record.requestFingerprint,
        input.ownerToken,
        input.record.request.sessionId,
        input.nextPackState.packRef.packId,
        input.nextPackState.packRef.version,
        input.nextPackState.integrity.digest,
        input.record.response.recommendationId,
        input.record.request.requestId,
        input.responseJson,
        input.storageTechnicalJson,
        input.record.actionDigest,
        input.record.requestFingerprint,
        ...input.events.flatMap(({ eventFingerprint, event }) => [
          event.eventId,
          eventFingerprint,
        ]),
      );
  }
}

function parseReservationInput(input: {
  sessionId: string;
  idempotencyKey: string;
  requestId: string;
  requestFingerprint: string;
  ownerToken: string;
  createdAt: string;
}): ParsedReservationInput {
  return {
    sessionId: nonBlank(input.sessionId, 'session_id_invalid'),
    idempotencyKey: nonBlank(input.idempotencyKey, 'idempotency_key_invalid'),
    requestId: nonBlank(input.requestId, 'request_id_invalid'),
    requestFingerprint: sha256Schema.parse(input.requestFingerprint),
    ownerToken: nonBlank(input.ownerToken, 'owner_token_invalid'),
    createdAt: instantSchema.parse(input.createdAt),
  };
}

function nonBlank(value: string, error: string): string {
  if (!value.trim()) throw new Error(error);
  return value;
}

function decisionFromRow(
  row: RecommendationDecisionRow,
): RecommendationDecisionRecord {
  const storage = parseRecommendationDecisionStoragePayload({
    responseJson: row.response_json,
    technicalJson: row.technical_json,
  });
  const record = parseRecommendationDecisionRecord({
    request: storage.request,
    response: storage.response,
    technical: storage.technical,
    requestFingerprint: row.request_fingerprint,
    actionDigest: row.action_digest,
    stateRevisionBefore: Number(row.state_revision_before),
    stateRevisionAfter: Number(row.state_revision_after),
    recordedAt: row.recorded_at,
  });
  if (
    record.response.recommendationId !== row.recommendation_id ||
    record.request.requestId !== row.request_id ||
    record.request.orderFlowId !== row.order_flow_id ||
    record.request.sessionId !== row.session_id ||
    record.request.placement !== row.placement
  ) {
    throw new Error('recommendation_decision_storage_identity_mismatch');
  }
  return record;
}

function eventFromRow(row: RecommendationEventRow): PersistedEvent {
  return {
    eventFingerprint: sha256Schema.parse(row.event_fingerprint),
    event: parsePersistedRecommendationEvent({
      schemaVersion: row.schema_version,
      eventId: row.event_id,
      eventType: row.event_type,
      recommendationId: row.recommendation_id,
      requestId: row.request_id,
      orderFlowId: row.order_flow_id,
      sessionId: row.session_id,
      placement: row.placement,
      occurredAt: row.occurred_at,
      recordedAt: row.recorded_at,
      actor: row.actor,
      actionId: row.action_id,
      cartRevision: row.cart_revision,
      versionBindings: JSON.parse(row.version_bindings_json) as unknown,
      payload: JSON.parse(row.payload_json) as unknown,
    }),
  };
}

function eventStorageValues(input: PersistedEvent): unknown[] {
  const { event } = input;
  return [
    event.eventId,
    input.eventFingerprint,
    event.schemaVersion,
    event.eventType,
    event.recommendationId,
    event.requestId,
    event.orderFlowId,
    event.sessionId,
    event.placement,
    event.occurredAt,
    event.recordedAt,
    event.actor,
    event.actionId,
    event.cartRevision,
    JSON.stringify(event.versionBindings),
    JSON.stringify(event.payload),
  ];
}

function demoHistoryFromRow(
  row: RecommendationDemoCustomerHistoryRow,
): RecommendationDemoCustomerHistoryRecord {
  return parseRecommendationDemoCustomerHistoryRecord({
    verifiedCustomerRef: row.customer_ref,
    fixtureLabel: row.fixture_label,
    linked: row.linked === 1,
    completedOrders: JSON.parse(row.completed_orders_json) as unknown,
    favoriteSellableItemIds: JSON.parse(row.favorites_json) as unknown,
    updatedAt: row.updated_at,
  });
}
