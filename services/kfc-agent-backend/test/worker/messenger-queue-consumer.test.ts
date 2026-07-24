import { describe, expect, it } from 'vitest';
import type { ConversationEvent } from '../../src/channels/conversationEvent.js';
import type { WebhookDelivery } from '../../src/persistence/contracts.js';
import { issueMessengerIngressClaim } from '../../src/security/messengerIngressClaim.js';
import { verifyQueuedMessengerIngress } from '../../src/workerMessengerIngress.js';

const event: ConversationEvent = {
  channel: 'messenger',
  externalUserId: 'customer-123',
  externalThreadId: 'customer-123',
  text: 'Xác nhận đơn hàng',
  eventType: 'postback',
  rawEventId: 'postback-456',
  receivedAt: '2026-07-24T03:00:00.000Z',
  platformEventName: 'postback',
  shouldRunAgent: true,
};
const delivery: WebhookDelivery = {
  channel: 'messenger',
  externalEventId: event.rawEventId,
  externalThreadId: event.externalThreadId,
  externalUserId: event.externalUserId,
  sessionId: 'messenger:customer-123',
  status: 'received',
  payload: {
    eventType: event.eventType,
    text: event.text,
    receivedAt: event.receivedAt,
  },
  receivedAt: event.receivedAt,
  processedAt: null,
  failedAt: null,
  lastError: null,
  createdAt: event.receivedAt,
  updatedAt: event.receivedAt,
};

describe('Messenger queue consumer ingress verification', () => {
  it('reconstructs only the exact reserved event after claim verification', async () => {
    const claim = await issueMessengerIngressClaim({
      event,
      sessionId: delivery.sessionId,
      queueBinding: { kind: 'agent_run_wakeup', generation: 3 },
      appSecret: 'secret',
      issuedAt: new Date('2026-07-24T03:00:01.000Z'),
    });

    const result = await verifyQueuedMessengerIngress({
      claim: JSON.parse(JSON.stringify(claim)),
      delivery: structuredClone(delivery),
      expectedExternalMessageId: event.rawEventId,
      expectedSessionId: delivery.sessionId,
      expectedQueueBinding: { kind: 'agent_run_wakeup', generation: 3 },
      appSecret: 'secret',
      now: new Date('2026-07-24T03:00:02.000Z'),
    });

    expect(result?.event).toEqual(event);
    expect(result?.verifiedIngress.externalMessageId).toBe(event.rawEventId);
  });

  it.each([
    {
      name: 'changed durable text',
      changedDelivery: {
        ...delivery,
        payload: { ...delivery.payload, text: 'Đặt một đơn khác' },
      },
      externalMessageId: event.rawEventId,
      sessionId: delivery.sessionId,
    },
    {
      name: 'changed queued identifier',
      changedDelivery: delivery,
      externalMessageId: 'another-message',
      sessionId: delivery.sessionId,
    },
    {
      name: 'changed queued session',
      changedDelivery: delivery,
      externalMessageId: event.rawEventId,
      sessionId: 'messenger:another-customer',
    },
  ])('fails closed for $name', async (testCase) => {
    const claim = await issueMessengerIngressClaim({
      event,
      sessionId: delivery.sessionId,
      queueBinding: { kind: 'agent_run_wakeup', generation: 3 },
      appSecret: 'secret',
      issuedAt: new Date('2026-07-24T03:00:01.000Z'),
    });

    await expect(
      verifyQueuedMessengerIngress({
        claim,
        delivery: testCase.changedDelivery,
        expectedExternalMessageId: testCase.externalMessageId,
        expectedSessionId: testCase.sessionId,
        expectedQueueBinding: { kind: 'agent_run_wakeup', generation: 3 },
        appSecret: 'secret',
        now: new Date('2026-07-24T03:00:02.000Z'),
      }),
    ).resolves.toBeUndefined();
  });
});
