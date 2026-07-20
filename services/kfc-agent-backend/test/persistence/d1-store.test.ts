import { describe, expect, it } from 'vitest';
import {
  CustomerRunIdempotencyConflictError,
  CustomerRunSequenceConflictError,
  type CustomerRun,
} from '../../src/customerRuns/contracts.js';
import { D1Store } from '../../src/persistence/d1Store.js';
import { FakeD1Database } from '../support/fakeD1Database.js';

describe('D1Store', () => {
  it('persists an idempotent run identity and contiguous events', async () => {
    const db = new FakeD1Database();
    const store = new D1Store(db);
    await store.initialize();

    const firstRun = await store.createCustomerRun(d1CustomerRun());
    const duplicateRun = await store.createCustomerRun({
      ...d1CustomerRun(),
      id: 'customer_run_duplicate',
    });
    const firstEvent = await store.appendCustomerRunEvent({
      schemaVersion: 1,
      eventId: 'customer_run_event_1',
      runId: firstRun.id,
      expectedSequence: 1,
      type: 'run_accepted',
      occurredAt: '2026-07-11T00:00:00.000Z',
      payload: { status: 'accepted', phase: 'queued' },
    });
    const secondEvent = await store.appendCustomerRunEvent({
      schemaVersion: 1,
      eventId: 'customer_run_event_2',
      runId: firstRun.id,
      expectedSequence: 2,
      type: 'run_started',
      occurredAt: '2026-07-11T00:00:01.000Z',
      payload: { status: 'running', phase: 'planning' },
    });

    expect(duplicateRun).toEqual(firstRun);
    await expect(
      store.findCustomerRunByRequest('kfc:customer_1', 'customer_chat_msg_1'),
    ).resolves.toMatchObject({ id: firstRun.id, nextEventSequence: 3 });
    await expect(store.listCustomerRunEvents(firstRun.id, 0)).resolves.toEqual([
      firstEvent,
      secondEvent,
    ]);
    await expect(store.listCustomerRunEvents(firstRun.id, 1)).resolves.toEqual([secondEvent]);

    await expect(
      store.createCustomerRun({
        ...d1CustomerRun(),
        id: 'customer_run_conflict',
        requestFingerprint: 'sha256:text:different',
      }),
    ).rejects.toBeInstanceOf(CustomerRunIdempotencyConflictError);
    await expect(
      store.appendCustomerRunEvent({
        schemaVersion: 1,
        eventId: 'customer_run_event_stale',
        runId: firstRun.id,
        expectedSequence: 2,
        type: 'phase_changed',
        occurredAt: '2026-07-11T00:00:02.000Z',
        payload: { phase: 'read_only_tool' },
      }),
    ).rejects.toBeInstanceOf(CustomerRunSequenceConflictError);
  });

  it('uses one D1 round trip for run writes and ordered event groups', async () => {
    const db = new FakeD1Database();
    const store = new D1Store(db);
    await store.initialize();

    db.resetCallCounts();
    const accepted = await store.createCustomerRunWithEvent(
      d1CustomerRun(),
      {
        schemaVersion: 1,
        eventId: 'customer_run_event_atomic_accept',
        runId: d1CustomerRun().id,
        expectedSequence: 1,
        type: 'run_accepted',
        occurredAt: '2026-07-11T00:00:00.000Z',
        payload: { status: 'accepted', phase: 'queued' },
      },
    );
    const run = accepted.run;
    expect(accepted.created).toBe(true);
    expect(run.nextEventSequence).toBe(2);
    expect(db.calls).toMatchObject({ batch: 1, first: 0, all: 0 });

    db.resetCallCounts();
    await store.updateCustomerRun(run.id, {
      status: 'running',
      phase: 'planning',
    });
    expect(db.calls).toMatchObject({ batch: 1, first: 0, all: 0 });

    db.resetCallCounts();
    const events = await store.appendCustomerRunEvents([
      {
        schemaVersion: 1,
        eventId: 'customer_run_event_batched_1',
        runId: run.id,
        expectedSequence: 2,
        type: 'run_started',
        occurredAt: '2026-07-11T00:00:01.000Z',
        payload: { status: 'running', phase: 'planning' },
      },
      {
        schemaVersion: 1,
        eventId: 'customer_run_event_batched_2',
        runId: run.id,
        expectedSequence: 3,
        type: 'progress_updated',
        occurredAt: '2026-07-11T00:00:02.000Z',
        payload: {
          code: 'reviewing_request',
          label: 'Đang xem yêu cầu của bạn…',
          cancellable: true,
        },
      },
    ]);
    expect(events.map((event) => event.sequence)).toEqual([2, 3]);
    expect(db.calls).toMatchObject({ batch: 1, first: 0, all: 0 });
  });

  it('evaluates customer and operation owners in advisory fence reads', async () => {
    const db = new FakeD1Database();
    const store = new D1Store(db);
    await store.initialize();
    const run = await store.createCustomerRun(d1CustomerRun());
    const operation = {
      requestId: 'd1-advisory-operation',
      sessionId: run.sessionId,
      operation: 'd1_advisory_sync',
      bindingFingerprint: 'd1-advisory-binding',
    };
    const reserved = await store.reserveIrreversibleOperation(operation);
    if (reserved.status !== 'reserved') {
      throw new Error('test_operation_lease_missing');
    }

    await expect(
      store.isRunCommitFenceCurrent({
        sessionId: run.sessionId,
        fence: {
          kind: 'customer_run',
          runId: run.id,
          sessionAuthorityGeneration:
            run.sessionAuthorityGeneration,
        },
        notAfter: '2099-01-01T00:00:00.000Z',
      }),
    ).resolves.toBe(true);
    await expect(
      store.isRunCommitFenceCurrent({
        sessionId: run.sessionId,
        fence: {
          kind: 'operation_lease',
          ...operation,
          attempt: reserved.attempt,
          leaseToken: reserved.leaseToken,
          sessionAuthorityGeneration:
            reserved.sessionAuthorityGeneration,
        },
        notAfter: '2099-01-01T00:00:00.000Z',
      }),
    ).resolves.toBe(true);

    await store.updateCustomerRun(run.id, {
      status: 'superseded',
      terminalAt: '2026-07-20T00:00:00.000Z',
    });
    const operationRow = db.tables.irreversible_operations.find(
      (row) => row.request_id === operation.requestId,
    );
    if (!operationRow) throw new Error('test_operation_row_missing');
    operationRow.status = 'unknown';
    await expect(
      store.isRunCommitFenceCurrent({
        sessionId: run.sessionId,
        fence: {
          kind: 'customer_run',
          runId: run.id,
          sessionAuthorityGeneration:
            run.sessionAuthorityGeneration,
        },
      }),
    ).resolves.toBe(false);
    await expect(
      store.isRunCommitFenceCurrent({
        sessionId: run.sessionId,
        fence: {
          kind: 'operation_lease',
          ...operation,
          attempt: reserved.attempt,
          leaseToken: reserved.leaseToken,
          sessionAuthorityGeneration:
            reserved.sessionAuthorityGeneration,
        },
      }),
    ).resolves.toBe(false);
  });
  it('upgrades an old conversation_turns schema before metadata writes', async () => {
    const db = new FakeD1Database();
    db.defineTable('conversation_turns', [
      'id',
      'session_id',
      'channel',
      'role',
      'text',
      'external_message_id',
      'external_user_id',
      'delivery_status',
      'created_at',
    ]);
    const store = new D1Store(db);

    await store.initialize();

    expect(db.hasColumn('conversation_turns', 'metadata')).toBe(true);
    expect(db.hasTable('conversation_profiles')).toBe(true);

    await store.appendTurn({
      sessionId: 'messenger:legacy_user',
      channel: 'messenger',
      role: 'user',
      text: 'legacy schema image',
      externalMessageId: 'mid_legacy_1',
      externalUserId: 'legacy_user',
      deliveryStatus: 'received',
      metadata: {
        platformEventName: 'message',
        attachments: [{ type: 'image', url: 'https://legacy.local/image.jpg' }],
      },
    });

    await expect(store.listTurns('messenger:legacy_user')).resolves.toEqual([
      expect.objectContaining({
        externalMessageId: 'mid_legacy_1',
        metadata: {
          platformEventName: 'message',
          attachments: [{ type: 'image', url: 'https://legacy.local/image.jpg' }],
        },
      }),
    ]);
  });

  it('persists profile rows and turn metadata in D1', async () => {
    const db = new FakeD1Database();
    const store = new D1Store(db);
    await store.initialize();

    await store.upsertProfile({
      channel: 'zalo',
      externalUserId: 'zalo_user_1',
      displayName: 'Tran Binh',
      avatarUrl: null,
      profileSource: 'zalo_webhook',
      profileUpdatedAt: '2026-07-09T00:00:00.000Z',
    });
    await store.appendTurn({
      sessionId: 'zalo:zalo_user_1',
      channel: 'zalo',
      role: 'user',
      text: '[Zalo image]',
      externalMessageId: 'zalo_image_1',
      externalUserId: 'zalo_user_1',
      deliveryStatus: 'received',
      metadata: {
        platformEventName: 'user_send_image',
        attachments: [{ type: 'image', url: 'https://zalo.local/image.jpg' }],
      },
    });

    expect(await store.getProfile('zalo', 'zalo_user_1')).toMatchObject({
      displayName: 'Tran Binh',
      profileSource: 'zalo_webhook',
    });
    expect((await store.listTurns('zalo:zalo_user_1'))[0]).toMatchObject({
      metadata: {
        platformEventName: 'user_send_image',
        attachments: [{ type: 'image', url: 'https://zalo.local/image.jpg' }],
      },
    });
  });

  it('returns the existing turn when appending a duplicate external message id', async () => {
    const db = new FakeD1Database();
    const store = new D1Store(db);
    await store.initialize();

    const first = await store.appendTurn({
      sessionId: 'messenger:psid_1',
      channel: 'messenger',
      role: 'user',
      text: 'first delivery',
      externalMessageId: 'mid_duplicate',
      externalUserId: 'psid_1',
      deliveryStatus: 'received',
      metadata: null,
    });
    const second = await store.appendTurn({
      sessionId: 'messenger:psid_1',
      channel: 'messenger',
      role: 'user',
      text: 'retried delivery',
      externalMessageId: 'mid_duplicate',
      externalUserId: 'psid_1',
      deliveryStatus: 'received',
      metadata: null,
    });

    expect(second).toEqual(first);
    expect(await store.listTurns('messenger:psid_1')).toHaveLength(1);
  });

  it('stores transcript turns, dashboard events, and webhook delivery state', async () => {
    const db = new FakeD1Database();
    const store = new D1Store(db);

    await store.initialize();
    const turn = await store.appendTurn({
      sessionId: 'messenger:psid_1',
      channel: 'messenger',
      role: 'user',
      text: 'Cho mình 1 Combo 99K',
      externalMessageId: 'mid_1',
      externalUserId: 'psid_1',
      deliveryStatus: 'received',
      metadata: null,
    });
    await store.appendDashboardEvent({
      id: 'dash_1',
      sessionId: 'messenger:psid_1',
      type: 'customer_message_received',
      payload: { text: 'Cho mình 1 Combo 99K' },
      createdAt: '2026-07-08T00:00:00.000Z',
    });
    const reserved = await store.reserveWebhookDelivery({
      channel: 'messenger',
      externalEventId: 'mid_1',
      externalThreadId: 'psid_1',
      externalUserId: 'psid_1',
      sessionId: 'messenger:psid_1',
      receivedAt: '2026-07-08T00:00:00.000Z',
      payload: { message: { mid: 'mid_1' } },
    });
    const duplicate = await store.reserveWebhookDelivery({
      channel: 'messenger',
      externalEventId: 'mid_1',
      externalThreadId: 'psid_1',
      externalUserId: 'psid_1',
      sessionId: 'messenger:psid_1',
      receivedAt: '2026-07-08T00:00:01.000Z',
      payload: { message: { mid: 'mid_1' } },
    });

    expect(turn).toMatchObject({ externalMessageId: 'mid_1', role: 'user' });
    expect(await store.findTurnByExternalMessage('messenger:psid_1', 'mid_1')).toMatchObject({ id: turn.id });
    expect(await store.listTurns('messenger:psid_1')).toHaveLength(1);
    expect(await store.listDashboardEvents()).toEqual([
      expect.objectContaining({ id: 'dash_1', payload: { text: 'Cho mình 1 Combo 99K' } }),
    ]);
    expect(reserved.reserved).toBe(true);
    expect(duplicate.reserved).toBe(false);

    await store.markWebhookDeliveryProcessed('messenger', 'mid_1');
    expect(await store.getWebhookDelivery('messenger', 'mid_1')).toMatchObject({ status: 'processed' });
  });

  it('lists dashboard session summaries with latest valid session intelligence', async () => {
    const db = new FakeD1Database();
    const store = new D1Store(db);
    await store.initialize();

    await store.appendDashboardEvent({
      id: 'dash_cart',
      sessionId: 'messenger:psid_1',
      type: 'cart_changed',
      payload: { cart: { items: [] } },
      createdAt: '2026-07-09T00:00:01.000Z',
    });
    await store.appendDashboardEvent({
      id: 'dash_bad_intelligence',
      sessionId: 'messenger:psid_1',
      type: 'session_intelligence_updated',
      payload: { sessionIntelligence: { schemaVersion: 1, orderStage: 'bad_stage' } },
      createdAt: '2026-07-09T00:00:02.000Z',
    });
    await store.appendDashboardEvent({
      id: 'dash_good_intelligence',
      sessionId: 'messenger:psid_1',
      type: 'session_intelligence_updated',
      payload: {
        sessionIntelligence: {
          schemaVersion: 1,
          orderStage: 'cart_ready',
          aiAutomationConfidencePercent: 85,
          riskLevel: 'low',
          priorityRank: 51,
          reasons: ['cart_verified'],
          contextSummary: 'Giỏ hàng đã có món đã xác minh.',
          evaluatedCustomerTurnCount: 1,
          evidence: {
            dashboardEventTypes: ['cart_changed'],
            toolNames: ['updateCart'],
            escalationReasons: [],
            safetyGateReasons: [],
          },
          source: 'runtime_rule_fallback',
          updatedAt: '2026-07-09T00:00:03.000Z',
        },
      },
      createdAt: '2026-07-09T00:00:03.000Z',
    });
    await store.appendDashboardEvent({
      id: 'dash_ai_intelligence',
      sessionId: 'messenger:psid_1',
      type: 'session_intelligence_updated',
      payload: {
        sessionIntelligence: {
          schemaVersion: 1,
          orderStage: 'cart_ready',
          aiAutomationConfidencePercent: 82,
          riskLevel: 'low',
          priorityRank: 51,
          reasons: ['cart_verified'],
          contextSummary: 'Giỏ hàng đã có món đã xác minh.',
          evaluatedCustomerTurnCount: 1,
          evidence: {
            dashboardEventTypes: ['cart_changed'],
            toolNames: ['updateCart'],
            escalationReasons: [],
            safetyGateReasons: [],
          },
          source: 'ai_monitor_judge',
          model: 'gpt-test',
          promptVersion: 'monitor-judge-v1',
          updatedAt: '2026-07-09T00:00:05.000Z',
        },
      },
      createdAt: '2026-07-09T00:00:05.000Z',
    });
    await store.appendDashboardEvent({
      id: 'dash_other',
      sessionId: 'messenger:psid_2',
      type: 'customer_message_received',
      payload: {},
      createdAt: '2026-07-09T00:00:06.000Z',
    });
    await store.appendDashboardEvent({
      id: 'dash_control_intelligence',
      sessionId: 'messenger:psid_1',
      type: 'session_intelligence_updated',
      payload: {
        sessionIntelligence: {
          schemaVersion: 1,
          orderStage: 'collecting_info',
          aiAutomationConfidencePercent: 0,
          riskLevel: 'high',
          priorityRank: 82,
          reasons: ['human_joined', 'awaiting_customer_info'],
          contextSummary: '',
          evaluatedCustomerTurnCount: 1,
          evidence: {
            dashboardEventTypes: ['session_updated'],
            toolNames: [],
            escalationReasons: [],
            safetyGateReasons: [],
          },
          source: 'runtime_rule_fallback',
          updatedAt: '2026-07-09T00:00:07.000Z',
        },
      },
      createdAt: '2026-07-09T00:00:07.000Z',
    });

    expect(await store.listDashboardSessionSummaries()).toEqual([
      expect.objectContaining({
        sessionId: 'messenger:psid_1',
        latestEventType: 'cart_changed',
        updatedAt: '2026-07-09T00:00:07.000Z',
        sessionIntelligence: expect.objectContaining({
          orderStage: 'collecting_info',
          aiAutomationConfidencePercent: 0,
          source: 'runtime_rule_fallback',
          contextSummary: '',
          reasons: expect.arrayContaining(['human_joined']),
        }),
      }),
      expect.objectContaining({
        sessionId: 'messenger:psid_2',
        latestEventType: 'customer_message_received',
        updatedAt: '2026-07-09T00:00:06.000Z',
        sessionIntelligence: null,
      }),
    ]);
  });

  it('lists session controls in one batched lookup', async () => {
    const db = new FakeD1Database();
    const store = new D1Store(db);
    await store.initialize();

    const messengerPaused =
      await store.transitionSessionAuthority({
        sessionId: 'messenger:psid_1',
        expectedGeneration: 0,
        agentMode: 'human_paused',
        assignedAgentId: 'agent_1',
      });
    const zaloPaused =
      await store.transitionSessionAuthority({
        sessionId: 'zalo:zalo_1',
        expectedGeneration: 0,
        agentMode: 'human_paused',
        assignedAgentId: 'agent_2',
      });
    const zaloResumed =
      await store.transitionSessionAuthority({
        sessionId: 'zalo:zalo_1',
        expectedGeneration:
          zaloPaused.control.sessionAuthorityGeneration,
        agentMode: 'ai_active',
        assignedAgentId: null,
      });
    const staleZaloTransition =
      await store.transitionSessionAuthority({
        sessionId: 'zalo:zalo_1',
        expectedGeneration: 0,
        agentMode: 'human_paused',
        assignedAgentId: 'stale-agent',
      });

    expect(messengerPaused).toMatchObject({
      status: 'transitioned',
      control: {
        sessionAuthorityGeneration: 1,
      },
    });
    expect(zaloResumed).toMatchObject({
      status: 'transitioned',
      control: {
        sessionAuthorityGeneration: 2,
      },
    });
    expect(staleZaloTransition).toMatchObject({
      status: 'stale',
      control: {
        agentMode: 'ai_active',
        sessionAuthorityGeneration: 2,
      },
    });

    const controls = await store.listSessionControls([
      'messenger:psid_1',
      'missing:session',
      'zalo:zalo_1',
    ]);

    expect(controls.get('messenger:psid_1')).toMatchObject({
      sessionId: 'messenger:psid_1',
      agentMode: 'human_paused',
      assignedAgentId: 'agent_1',
      sessionAuthorityGeneration: 1,
    });
    expect(controls.has('missing:session')).toBe(false);
    expect(controls.get('zalo:zalo_1')).toMatchObject({
      sessionId: 'zalo:zalo_1',
      agentMode: 'ai_active',
      assignedAgentId: null,
      sessionAuthorityGeneration: 2,
    });
  });

  it('initializes repeatedly without failing', async () => {
    const db = new FakeD1Database();
    const store = new D1Store(db);

    await store.initialize();
    await store.initialize();

    await expect(
      store.appendTurn({
        sessionId: 'messenger:psid_repeat',
        channel: 'messenger',
        role: 'user',
        text: 'repeat init',
        externalMessageId: 'mid_repeat',
        externalUserId: 'psid_repeat',
        deliveryStatus: 'received',
        metadata: null,
      }),
    ).resolves.toMatchObject({
      sessionId: 'messenger:psid_repeat',
      externalMessageId: 'mid_repeat',
      metadata: null,
    });
  });

  it('lists the latest bounded dashboard events for a session in chronological order', async () => {
    const db = new FakeD1Database();
    const store = new D1Store(db);
    await store.initialize();

    for (let index = 0; index < 205; index += 1) {
      await store.appendDashboardEvent({
        id: `dash_old_${index}`,
        sessionId: 'messenger:psid_many_events',
        type: 'conversation_turn_created',
        payload: { index },
        createdAt: `2026-07-09T00:${String(Math.floor(index / 60)).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}.000Z`,
      });
    }
    await store.appendDashboardEvent({
      id: 'dash_human_joined',
      sessionId: 'messenger:psid_many_events',
      type: 'session_updated',
      payload: { updateType: 'human_joined' },
      createdAt: '2026-07-09T01:00:00.000Z',
    });

    const events = await store.listDashboardEvents('messenger:psid_many_events');

    expect(events).toHaveLength(200);
    expect(events.at(-1)).toMatchObject({
      id: 'dash_human_joined',
      payload: { updateType: 'human_joined' },
    });
    expect(events[0]).toMatchObject({ id: 'dash_old_6' });
  });

  it('initializes repeatedly without failing', async () => {
    const db = new FakeD1Database();
    const store = new D1Store(db);

    await store.initialize();
    await store.initialize();

    await expect(
      store.appendTurn({
        sessionId: 'messenger:psid_repeat',
        channel: 'messenger',
        role: 'user',
        text: 'repeat init',
        externalMessageId: 'mid_repeat',
        externalUserId: 'psid_repeat',
        deliveryStatus: 'received',
        metadata: null,
      }),
    ).resolves.toMatchObject({
      sessionId: 'messenger:psid_repeat',
      externalMessageId: 'mid_repeat',
      metadata: null,
    });
  });

  it('initializes agent run tables and stores run state in D1', async () => {
    const db = new FakeD1Database();
    const store = new D1Store(db);
    await store.initialize();

    expect(db.hasTable('pending_customer_turns')).toBe(true);
    expect(db.hasTable('agent_runs')).toBe(true);
    expect(db.hasTable('agent_run_turns')).toBe(true);
    expect(db.hasTable('session_agent_state')).toBe(true);

    const first = await store.upsertPendingCustomerTurn({
      turnId: 'pending_mid_1',
      sessionId: 'messenger:psid_1',
      channel: 'messenger',
      externalMessageId: 'mid_1',
      externalUserId: 'psid_1',
      text: 'Cho minh 1 combo',
      steerMode: 'steering',
      status: 'pending',
      claimedRunId: null,
      receivedAt: '2026-07-10T00:00:00.000Z',
    });
    const duplicate = await store.upsertPendingCustomerTurn({
      turnId: 'pending_mid_retry',
      sessionId: 'messenger:psid_1',
      channel: 'messenger',
      externalMessageId: 'mid_1',
      externalUserId: 'psid_1',
      text: 'retry',
      steerMode: 'steering',
      status: 'pending',
      claimedRunId: null,
      receivedAt: '2026-07-10T00:00:01.000Z',
    });
    const run = await store.createAgentRun({
      id: 'run_1',
      sessionId: 'messenger:psid_1',
      generation: 1,
      channel: 'messenger',
      externalUserId: 'psid_1',
      status: 'scheduled',
      coalescedInputText: '1. Cho minh 1 combo',
      deliveryStatus: 'pending',
      scheduledAt: '2026-07-10T00:00:02.000Z',
    });
    const duplicateClaim = await store.claimAgentRun({
      id: 'run_duplicate',
      sessionId: 'messenger:psid_1',
      generation: 1,
      channel: 'messenger',
      externalUserId: 'psid_1',
      status: 'scheduled',
      coalescedInputText: 'duplicate worker input',
      deliveryStatus: 'pending',
      scheduledAt: '2026-07-10T00:00:03.000Z',
    });
    await store.linkAgentRunTurn({ runId: run.id, turnId: first.turn.turnId, sequence: 0 });
    await store.setSessionAgentState({
      sessionId: 'messenger:psid_1',
      currentRunId: run.id,
      generation: 1,
      debounceDeadlineAt: '2026-07-10T00:00:02.000Z',
    });

    expect(first.inserted).toBe(true);
    expect(duplicate.inserted).toBe(false);
    expect(await store.listPendingCustomerTurns('messenger:psid_1')).toEqual([
      expect.objectContaining({ turnId: 'pending_mid_1', text: 'Cho minh 1 combo' }),
    ]);
    expect(await store.getAgentRun('run_1')).toMatchObject({
      status: 'scheduled',
      deliveryStatus: 'pending',
    });
    expect(duplicateClaim).toMatchObject({ claimed: false, run: { id: 'run_1' } });
    expect(await store.listAgentRuns('messenger:psid_1')).toHaveLength(1);
    expect(await store.listAgentRunTurns('run_1')).toEqual([{ runId: 'run_1', turnId: 'pending_mid_1', sequence: 0 }]);
    expect(await store.getSessionAgentState('messenger:psid_1')).toMatchObject({
      currentRunId: 'run_1',
      generation: 1,
    });
  });

  it('atomically publishes an assistant turn only for the current D1 agent owner', async () => {
    const db = new FakeD1Database();
    const store = new D1Store(db);
    await store.initialize();
    const sessionId = 'messenger:atomic-turn';
    const runId = 'run_atomic_turn';
    const run = await store.createAgentRun({
      id: runId,
      sessionId,
      generation: 1,
      channel: 'messenger',
      externalUserId: 'atomic-turn',
      status: 'scheduled',
      coalescedInputText: 'One combo',
      deliveryStatus: 'pending',
      scheduledAt: '2026-07-20T00:00:00.000Z',
      startedAt: '2026-07-20T00:00:01.000Z',
    });
    await store.setSessionAgentState({
      sessionId,
      currentRunId: runId,
      generation: 1,
      debounceDeadlineAt: null,
    });
    const claimedAt = new Date();
    const execution = await store.claimAgentRunExecution({
      runId,
      sessionId,
      generation: 1,
      sessionAuthorityGeneration: run.sessionAuthorityGeneration,
      claimedAt: claimedAt.toISOString(),
      executionLeaseToken:
        '00000000-0000-4000-8000-000000000001',
      executionLeaseExpiresAt: new Date(
        claimedAt.getTime() + 60_000,
      ).toISOString(),
    });
    if (execution.status !== 'claimed') {
      throw new Error('test_agent_run_execution_claim_failed');
    }
    const commit = (text: string) => store.commitAssistantTurnIfRunCurrent({
      fence: {
        kind: 'agent_run',
        runId,
        generation: 1,
        sessionAuthorityGeneration:
          execution.run.sessionAuthorityGeneration,
        executionAttempt: execution.run.executionAttempt,
        executionLeaseToken: execution.run.executionLeaseToken!,
      },
      notAfter: '2099-07-20T00:00:00.000Z',
      stateEvent: {
        sessionId,
        sourceType: 'graph:verified_state',
        payload: { verifiedState: { toolTrace: [] } },
      },
      assistantTurn: {
        sessionId,
        channel: 'messenger',
        role: 'assistant',
        text,
        externalMessageId: null,
        externalUserId: 'atomic-turn',
        deliveryStatus: 'pending',
        metadata: null,
      },
    });

    await expect(commit('Committed reply')).resolves.toMatchObject({
      status: 'committed',
    });
    await expect(store.listTurns(sessionId)).resolves.toEqual([
      expect.objectContaining({ text: 'Committed reply' }),
    ]);
    await expect(store.listEvents(sessionId)).resolves.toHaveLength(2);

    await store.advanceSessionAgentGeneration({
      sessionId,
      debounceDeadlineAt: null,
    });
    await expect(commit('Stale reply')).resolves.toEqual({
      status: 'stale',
    });
    await expect(store.listTurns(sessionId)).resolves.toEqual([
      expect.objectContaining({ text: 'Committed reply' }),
    ]);
    await expect(store.listEvents(sessionId)).resolves.toHaveLength(2);
  });
});

function d1CustomerRun(): CustomerRun {
  return {
    id: 'customer_run_1',
    schemaVersion: 1,
    sessionId: 'kfc:customer_1',
    customerId: 'customer_1',
    clientMessageId: 'customer_chat_msg_1',
    requestFingerprint: 'sha256:text:one-combo',
    generation: 1,
    sessionAuthorityGeneration: 0,
    status: 'accepted',
    phase: 'queued',
    nextEventSequence: 1,
    clientSchemaVersion: 1,
    acceptedAt: '2026-07-11T00:00:00.000Z',
    startedAt: null,
    terminalAt: null,
    updatedAt: '2026-07-11T00:00:00.000Z',
  };
}
