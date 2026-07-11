import { describe, expect, it } from 'vitest';
import { DashboardEventBus } from '../../src/dashboard/eventBus.js';
import {
  CustomerRunIdempotencyConflictError,
  CustomerRunSequenceConflictError,
  type CustomerRun,
} from '../../src/customerRuns/contracts.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';

describe('MemoryStore', () => {
  it('reuses a matching customer run request', async () => {
    const store = new MemoryStore();

    const first = await store.createCustomerRun(customerRun());
    const duplicate = await store.createCustomerRun({
      ...customerRun(),
      id: 'customer_run_duplicate_must_not_win',
    });

    expect(duplicate).toEqual(first);
    await expect(
      store.findCustomerRunByRequest('kfc:customer_1', 'customer_chat_msg_1'),
    ).resolves.toEqual(first);
  });

  it('rejects a reused request identity with a different fingerprint', async () => {
    const store = new MemoryStore();
    await store.createCustomerRun(customerRun());

    await expect(
      store.createCustomerRun({
        ...customerRun(),
        id: 'customer_run_conflict',
        requestFingerprint: 'sha256:text:different-order',
      }),
    ).rejects.toBeInstanceOf(CustomerRunIdempotencyConflictError);
  });

  it('appends contiguous customer-run events and rejects stale or unknown sequences', async () => {
    const store = new MemoryStore();
    await store.createCustomerRun(customerRun());

    const first = await store.appendCustomerRunEvent({
      schemaVersion: 1,
      eventId: 'customer_run_event_1',
      runId: 'customer_run_1',
      expectedSequence: 1,
      type: 'run_accepted',
      occurredAt: '2026-07-11T00:00:00.000Z',
      payload: { status: 'accepted', phase: 'queued' },
    });
    const second = await store.appendCustomerRunEvent({
      schemaVersion: 1,
      eventId: 'customer_run_event_2',
      runId: 'customer_run_1',
      expectedSequence: 2,
      type: 'run_started',
      occurredAt: '2026-07-11T00:00:01.000Z',
      payload: { status: 'running', phase: 'planning' },
    });

    expect([first.sequence, second.sequence]).toEqual([1, 2]);
    await expect(store.listCustomerRunEvents('customer_run_1', 0)).resolves.toEqual([first, second]);
    await expect(
      store.appendCustomerRunEvent({
        schemaVersion: 1,
        eventId: 'customer_run_event_stale',
        runId: 'customer_run_1',
        expectedSequence: 2,
        type: 'phase_changed',
        occurredAt: '2026-07-11T00:00:02.000Z',
        payload: { phase: 'read_only_tool' },
      }),
    ).rejects.toBeInstanceOf(CustomerRunSequenceConflictError);
    await expect(store.listCustomerRunEvents('customer_run_1', 1)).resolves.toEqual([second]);
    await expect(
      store.appendCustomerRunEvent({
        schemaVersion: 1,
        eventId: 'unknown_run_event',
        runId: 'unknown_run',
        expectedSequence: 1,
        type: 'run_accepted',
        occurredAt: '2026-07-11T00:00:00.000Z',
        payload: {},
      }),
    ).rejects.toThrow('Customer run not found');
  });
  it('stores turn metadata and channel customer profiles', async () => {
    const store = new MemoryStore();
    await store.upsertProfile({
      channel: 'messenger',
      externalUserId: 'psid_user_1',
      displayName: 'Nguyen An',
      avatarUrl: 'https://graph.local/avatar.jpg',
      profileSource: 'messenger_profile_api',
      profileUpdatedAt: '2026-07-09T00:00:00.000Z',
    });
    await store.appendTurn({
      sessionId: 'messenger:psid_user_1',
      channel: 'messenger',
      role: 'user',
      text: 'Ảnh menu',
      externalMessageId: 'mid_image_1',
      externalUserId: 'psid_user_1',
      deliveryStatus: 'received',
      metadata: {
        platformEventName: 'message',
        attachments: [{ type: 'image', url: 'https://cdn.local/image.jpg', title: 'image.jpg' }],
      },
    });

    await expect(store.getProfile('messenger', 'psid_user_1')).resolves.toMatchObject({
      displayName: 'Nguyen An',
      profileSource: 'messenger_profile_api',
    });
    await expect(store.listTurns('messenger:psid_user_1')).resolves.toEqual([
      expect.objectContaining({
        metadata: {
          platformEventName: 'message',
          attachments: [{ type: 'image', url: 'https://cdn.local/image.jpg', title: 'image.jpg' }],
        },
      }),
    ]);
  });

  it('stores full transcript and only returns direct long-range evidence matches', async () => {
    const store = new MemoryStore();
    await store.appendTurn({
      sessionId: 'session_1',
      channel: 'messenger',
      role: 'user',
      text: 'Giao tới 123 Nguyễn Trãi, Quận 5',
      externalMessageId: 'mid_address',
      externalUserId: 'psid_1',
      deliveryStatus: 'received',
      metadata: null,
    });
    await store.appendTurn({
      sessionId: 'session_1',
      channel: 'messenger',
      role: 'assistant',
      text: 'Mình đã lưu địa chỉ.',
      externalMessageId: null,
      externalUserId: 'psid_1',
      deliveryStatus: 'sent',
      metadata: null,
    });
    await store.appendTurn({
      sessionId: 'session_1',
      channel: 'messenger',
      role: 'user',
      text: 'Giao tới chỗ cũ nha',
      externalMessageId: 'mid_old_place',
      externalUserId: 'psid_1',
      deliveryStatus: 'received',
      metadata: null,
    });

    const results = await store.searchHistory('session_1', 'chỗ cũ');
    expect(results[0]).toMatchObject({
      sourceType: 'conversation_turn:user',
      confidence: 0.7,
    });
    expect(results).toHaveLength(1);
    expect(results[0]?.payload).toMatchObject({ text: 'Giao tới chỗ cũ nha' });
    expect(await store.listTurns('session_1')).toHaveLength(3);
  });

  it('returns every matching history event without a fixed top-five cap', async () => {
    const store = new MemoryStore();
    for (let index = 1; index <= 7; index += 1) {
      await store.appendTurn({
        sessionId: 'session_many_matches',
        channel: 'messenger',
        role: 'user',
        text: `ghi chú giao hàng ${index}`,
        externalMessageId: `mid_note_${index}`,
        externalUserId: 'psid_1',
        deliveryStatus: 'received',
        metadata: null,
      });
    }

    const results = await store.searchHistory('session_many_matches', 'ghi chú giao hàng');
    expect(results).toHaveLength(7);
    expect(results.map((result) => result.payload.text)).toEqual([
      'ghi chú giao hàng 1',
      'ghi chú giao hàng 2',
      'ghi chú giao hàng 3',
      'ghi chú giao hàng 4',
      'ghi chú giao hàng 5',
      'ghi chú giao hàng 6',
      'ghi chú giao hàng 7',
    ]);
  });

  it('reserves webhook deliveries once and records final status', async () => {
    const store = new MemoryStore();

    const first = await store.reserveWebhookDelivery({
      channel: 'messenger',
      externalEventId: 'mid_1',
      externalThreadId: 'psid_1',
      externalUserId: 'psid_1',
      sessionId: 'messenger:psid_1',
      receivedAt: '2026-07-08T08:00:00.000Z',
      payload: { message: { mid: 'mid_1' } },
    });
    const second = await store.reserveWebhookDelivery({
      channel: 'messenger',
      externalEventId: 'mid_1',
      externalThreadId: 'psid_1',
      externalUserId: 'psid_1',
      sessionId: 'messenger:psid_1',
      receivedAt: '2026-07-08T08:00:01.000Z',
      payload: { message: { mid: 'mid_1' } },
    });

    expect(first.reserved).toBe(true);
    expect(first.delivery).toMatchObject({ status: 'received' });
    expect(second.reserved).toBe(false);
    expect(second.delivery).toMatchObject({ status: 'received' });

    await store.markWebhookDeliveryProcessed('messenger', 'mid_1');
    expect(await store.getWebhookDelivery('messenger', 'mid_1')).toMatchObject({ status: 'processed' });

    await store.markWebhookDeliveryFailed('messenger', 'mid_1', 'send failed');
    expect(await store.getWebhookDelivery('messenger', 'mid_1')).toMatchObject({
      status: 'failed',
      lastError: 'send failed',
    });
  });

  it('lists received webhook deliveries older than a cutoff without terminal rows', async () => {
    const store = new MemoryStore();

    await store.reserveWebhookDelivery({
      channel: 'messenger',
      externalEventId: 'mid_old_received',
      externalThreadId: 'psid_1',
      externalUserId: 'psid_1',
      sessionId: 'messenger:psid_1',
      receivedAt: '2026-07-08T08:00:00.000Z',
      payload: { message: { mid: 'mid_old_received' } },
    });
    await store.reserveWebhookDelivery({
      channel: 'messenger',
      externalEventId: 'mid_new_received',
      externalThreadId: 'psid_2',
      externalUserId: 'psid_2',
      sessionId: 'messenger:psid_2',
      receivedAt: '2026-07-08T08:05:00.000Z',
      payload: { message: { mid: 'mid_new_received' } },
    });
    await store.reserveWebhookDelivery({
      channel: 'messenger',
      externalEventId: 'mid_processed',
      externalThreadId: 'psid_3',
      externalUserId: 'psid_3',
      sessionId: 'messenger:psid_3',
      receivedAt: '2026-07-08T07:59:00.000Z',
      payload: { message: { mid: 'mid_processed' } },
    });
    await store.reserveWebhookDelivery({
      channel: 'zalo',
      externalEventId: 'zalo_old_received',
      externalThreadId: 'zalo_thread',
      externalUserId: 'zalo_user',
      sessionId: 'zalo:zalo_user',
      receivedAt: '2026-07-08T07:58:00.000Z',
      payload: { message: { mid: 'zalo_old_received' } },
    });
    await store.markWebhookDeliveryProcessed('messenger', 'mid_processed');

    await expect(store.listStaleWebhookDeliveries('messenger', '2026-07-08T08:01:00.000Z', 10)).resolves.toEqual([
      expect.objectContaining({ externalEventId: 'mid_old_received', status: 'received' }),
    ]);
  });

  it('stores pending customer turns and current agent run state', async () => {
    const store = new MemoryStore();

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
      text: 'retried text',
      steerMode: 'steering',
      status: 'pending',
      claimedRunId: null,
      receivedAt: '2026-07-10T00:00:01.000Z',
    });
    const second = await store.upsertPendingCustomerTurn({
      turnId: 'pending_mid_2',
      sessionId: 'messenger:psid_1',
      channel: 'messenger',
      externalMessageId: 'mid_2',
      externalUserId: 'psid_1',
      text: 'doi thanh 2 combo',
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
      coalescedInputText: '1. Cho minh 1 combo\n2. doi thanh 2 combo',
      deliveryStatus: 'pending',
      scheduledAt: '2026-07-10T00:00:02.000Z',
    });
    await store.linkAgentRunTurn({ runId: run.id, turnId: first.turn.turnId, sequence: 0 });
    await store.linkAgentRunTurn({ runId: run.id, turnId: second.turn.turnId, sequence: 1 });
    await store.setSessionAgentState({
      sessionId: 'messenger:psid_1',
      currentRunId: run.id,
      generation: 1,
      debounceDeadlineAt: '2026-07-10T00:00:02.000Z',
    });

    expect(first.inserted).toBe(true);
    expect(duplicate.inserted).toBe(false);
    expect(duplicate.turn.turnId).toBe('pending_mid_1');
    expect(await store.listPendingCustomerTurns('messenger:psid_1')).toEqual([
      expect.objectContaining({ turnId: 'pending_mid_1', text: 'Cho minh 1 combo' }),
      expect.objectContaining({ turnId: 'pending_mid_2', text: 'doi thanh 2 combo' }),
    ]);
    expect(await store.getAgentRun('run_1')).toMatchObject({
      status: 'scheduled',
      coalescedInputText: '1. Cho minh 1 combo\n2. doi thanh 2 combo',
    });
    expect(await store.listAgentRunTurns('run_1')).toEqual([
      { runId: 'run_1', turnId: 'pending_mid_1', sequence: 0 },
      { runId: 'run_1', turnId: 'pending_mid_2', sequence: 1 },
    ]);
    expect(await store.getSessionAgentState('messenger:psid_1')).toMatchObject({
      currentRunId: 'run_1',
      generation: 1,
      debounceDeadlineAt: '2026-07-10T00:00:02.000Z',
    });
  });

  it('records superseded runs without treating them as failures', async () => {
    const store = new MemoryStore();
    await store.createAgentRun({
      id: 'run_old',
      sessionId: 'messenger:psid_1',
      generation: 1,
      channel: 'messenger',
      externalUserId: 'psid_1',
      status: 'running',
      coalescedInputText: 'old message',
      deliveryStatus: 'pending',
      scheduledAt: '2026-07-10T00:00:02.000Z',
      startedAt: '2026-07-10T00:00:03.000Z',
    });
    await store.createAgentRun({
      id: 'run_new',
      sessionId: 'messenger:psid_1',
      generation: 2,
      channel: 'messenger',
      externalUserId: 'psid_1',
      status: 'scheduled',
      coalescedInputText: 'new message',
      deliveryStatus: 'pending',
      scheduledAt: '2026-07-10T00:00:04.000Z',
    });

    const updated = await store.updateAgentRun('run_old', {
      status: 'superseded',
      supersededByRunId: 'run_new',
      deliveryStatus: 'suppressed',
      completedAt: '2026-07-10T00:00:04.500Z',
    });

    expect(updated).toMatchObject({
      status: 'superseded',
      supersededByRunId: 'run_new',
      deliveryStatus: 'suppressed',
      errorCode: null,
      errorMessage: null,
    });
  });
});

function customerRun(): CustomerRun {
  return {
    id: 'customer_run_1',
    schemaVersion: 1,
    sessionId: 'kfc:customer_1',
    customerId: 'customer_1',
    clientMessageId: 'customer_chat_msg_1',
    requestFingerprint: 'sha256:text:one-combo',
    generation: 1,
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

describe('DashboardEventBus', () => {
  it('hydrates existing events and persists newly emitted events', () => {
    const persistedEvents: unknown[] = [];
    const bus = new DashboardEventBus({
      initialEvents: [
        {
          id: 'event_existing',
          sessionId: 'session_1',
          type: 'customer_message_received',
          payload: { text: 'Cho mình Combo Hợp Gu 99K' },
          createdAt: '2026-07-07T00:00:00.000Z',
        },
      ],
      persistEvent(event) {
        persistedEvents.push(event);
      },
    });

    bus.emitEvent({
      id: 'event_new',
      sessionId: 'session_1',
      type: 'assistant_reply_sent',
      payload: { deliveryStatus: 'sent' },
      createdAt: '2026-07-07T00:00:01.000Z',
    });

    expect(bus.getEvents('session_1').map((event) => event.id)).toEqual(['event_existing', 'event_new']);
    expect(persistedEvents).toEqual([expect.objectContaining({ id: 'event_new' })]);
  });

  it('records emitted events for replay assertions', () => {
    const bus = new DashboardEventBus();
    bus.emitEvent({
      id: 'event_1',
      sessionId: 'session_1',
      type: 'cart_changed',
      payload: { totalVnd: 99000 },
      createdAt: '2026-07-07T00:00:00.000Z',
    });

    expect(bus.getEvents('session_1')).toHaveLength(1);
  });

  it('filters session summaries by latest dashboard activity cutoff', () => {
    const bus = new DashboardEventBus({
      initialEvents: [
        {
          id: 'event_old',
          sessionId: 'session_old',
          type: 'customer_message_received',
          payload: {},
          createdAt: '2026-07-09T03:59:59.000Z',
        },
        {
          id: 'event_recent',
          sessionId: 'session_recent',
          type: 'assistant_reply_sent',
          payload: {},
          createdAt: '2026-07-09T04:00:00.000Z',
        },
      ],
    });

    expect(
      bus
        .listSessionSummaries({ updatedSince: '2026-07-09T04:00:00.000Z' })
        .map((summary) => summary.sessionId),
    ).toEqual(['session_recent']);
  });

  it('notifies dashboard stream subscribers and supports unsubscribe', () => {
    const bus = new DashboardEventBus();
    const received: string[] = [];
    const unsubscribe = bus.subscribe((event) => {
      received.push(event.id);
    });

    bus.emitEvent({
      id: 'event_1',
      sessionId: 'session_1',
      type: 'cart_changed',
      payload: { totalVnd: 99000 },
      createdAt: '2026-07-07T00:00:00.000Z',
    });
    unsubscribe();
    bus.emitEvent({
      id: 'event_2',
      sessionId: 'session_1',
      type: 'order_created',
      payload: { orderId: 'KFC-MOCK-1001' },
      createdAt: '2026-07-07T00:00:01.000Z',
    });

    expect(received).toEqual(['event_1']);
  });
});
