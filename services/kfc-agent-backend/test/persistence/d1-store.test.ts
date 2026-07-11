import { describe, expect, it } from 'vitest';
import { D1Store } from '../../src/persistence/d1Store.js';
import { FakeD1Database } from '../support/fakeD1Database.js';

describe('D1Store', () => {
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

    expect(await store.listDashboardSessionSummaries()).toEqual([
      expect.objectContaining({
        sessionId: 'messenger:psid_2',
        latestEventType: 'customer_message_received',
        updatedAt: '2026-07-09T00:00:06.000Z',
        sessionIntelligence: null,
      }),
      expect.objectContaining({
        sessionId: 'messenger:psid_1',
        latestEventType: 'cart_changed',
        updatedAt: '2026-07-09T00:00:05.000Z',
        sessionIntelligence: expect.objectContaining({
          orderStage: 'cart_ready',
          aiAutomationConfidencePercent: 82,
          source: 'ai_monitor_judge',
        }),
      }),
    ]);
  });

  it('lists session controls in one batched lookup', async () => {
    const db = new FakeD1Database();
    const store = new D1Store(db);
    await store.initialize();

    await store.setSessionControl('messenger:psid_1', {
      agentMode: 'human_paused',
      assignedAgentId: 'agent_1',
    });
    await store.setSessionControl('zalo:zalo_1', {
      agentMode: 'ai_active',
      assignedAgentId: null,
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
    });
    expect(controls.has('missing:session')).toBe(false);
    expect(controls.get('zalo:zalo_1')).toMatchObject({
      sessionId: 'zalo:zalo_1',
      agentMode: 'ai_active',
      assignedAgentId: null,
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
    expect(await store.listAgentRunTurns('run_1')).toEqual([{ runId: 'run_1', turnId: 'pending_mid_1', sequence: 0 }]);
    expect(await store.getSessionAgentState('messenger:psid_1')).toMatchObject({
      currentRunId: 'run_1',
      generation: 1,
    });
  });
});
