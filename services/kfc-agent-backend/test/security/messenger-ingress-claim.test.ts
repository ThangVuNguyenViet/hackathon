import { describe, expect, it } from 'vitest';
import type { ConversationEvent } from '../../src/channels/conversationEvent.js';
import {
  issueMessengerIngressClaim,
  type MessengerIngressQueueBinding,
} from '../../src/security/messengerIngressClaim.js';
import {
  guestCheckoutAuthorityIsIssued,
  issueVerifiedMessengerGuestCheckoutAuthority,
  verifyMessengerIngressClaim,
} from '../../src/security/guestCheckoutAuthority.js';

const event: ConversationEvent = {
  channel: 'messenger',
  externalUserId: 'customer-123',
  externalThreadId: 'customer-123',
  text: 'Cho tôi đặt một phần gà',
  eventType: 'message',
  rawEventId: 'message-456',
  receivedAt: '2026-07-24T03:00:00.000Z',
  platformEventName: 'message',
  shouldRunAgent: true,
};
const queueBinding: MessengerIngressQueueBinding = {
  kind: 'agent_run_wakeup',
  generation: 7,
};
const secret = 'meta-app-secret';
const issuedAt = new Date('2026-07-24T03:00:01.000Z');

describe('compact Messenger ingress claim', () => {
  it('roundtrips through serialization into verified ingress authority', async () => {
    const issued = await issueMessengerIngressClaim({
      event,
      sessionId: 'messenger:customer-123',
      queueBinding,
      appSecret: secret,
      issuedAt,
    });
    const serialized = JSON.parse(JSON.stringify(issued)) as unknown;

    const verified = await verifyMessengerIngressClaim({
      claim: serialized,
      expectedEvent: event,
      expectedSessionId: 'messenger:customer-123',
      expectedQueueBinding: queueBinding,
      appSecret: secret,
      now: new Date('2026-07-24T03:00:02.000Z'),
    });

    expect(verified).toMatchObject({
      schemaVersion: 'kfc-verified-messenger-ingress-v1',
      tenantScope: 'kfc-vietnam',
      channel: 'messenger',
      sessionId: 'messenger:customer-123',
      customerId: 'customer-123',
      surfaceSubjectRef: 'customer-123',
      externalThreadRef: 'customer-123',
      externalMessageId: 'message-456',
      receivedAt: '2026-07-24T03:00:00.000Z',
    });
    expect(verified?.evidenceDigest).toMatch(/^[a-f0-9]{64}$/u);
    if (!verified) throw new Error('expected verified ingress');
    const authority = await issueVerifiedMessengerGuestCheckoutAuthority({
      ingress: verified,
      runFence: {
        kind: 'agent_run',
        runId: 'run-123',
        generation: 7,
        sessionAuthorityGeneration: 2,
        executionAttempt: 1,
        executionLeaseToken: 'lease-123',
      },
      issuedAt: new Date('2026-07-24T03:00:03.000Z'),
    });
    expect(guestCheckoutAuthorityIsIssued(authority)).toBe(true);
  });

  it.each([
    {
      name: 'tampered claim',
      mutate: (claim: Record<string, unknown>) => {
        claim.customerId = 'attacker';
      },
      secret,
      expectedEvent: event,
      binding: queueBinding,
      now: new Date('2026-07-24T03:00:02.000Z'),
    },
    {
      name: 'wrong secret',
      mutate: () => undefined,
      secret: 'wrong-secret',
      expectedEvent: event,
      binding: queueBinding,
      now: new Date('2026-07-24T03:00:02.000Z'),
    },
    {
      name: 'mismatched event',
      mutate: () => undefined,
      secret,
      expectedEvent: { ...event, rawEventId: 'different-message' },
      binding: queueBinding,
      now: new Date('2026-07-24T03:00:02.000Z'),
    },
    {
      name: 'replayed for another generation',
      mutate: () => undefined,
      secret,
      expectedEvent: event,
      binding: { kind: 'agent_run_wakeup', generation: 8 } as const,
      now: new Date('2026-07-24T03:00:02.000Z'),
    },
    {
      name: 'expired claim',
      mutate: () => undefined,
      secret,
      expectedEvent: event,
      binding: queueBinding,
      now: new Date('2026-07-24T03:16:00.000Z'),
    },
  ])('fails closed for $name', async (testCase) => {
    const claim = JSON.parse(
      JSON.stringify(
        await issueMessengerIngressClaim({
          event,
          sessionId: 'messenger:customer-123',
          queueBinding,
          appSecret: secret,
          issuedAt,
        }),
      ),
    ) as Record<string, unknown>;
    testCase.mutate(claim);

    await expect(
      verifyMessengerIngressClaim({
        claim,
        expectedEvent: testCase.expectedEvent,
        expectedSessionId: 'messenger:customer-123',
        expectedQueueBinding: testCase.binding,
        appSecret: testCase.secret,
        now: testCase.now,
      }),
    ).resolves.toBeUndefined();
  });

  it('rejects unbounded normalized identifiers before signing', async () => {
    await expect(
      issueMessengerIngressClaim({
        event: { ...event, rawEventId: 'x'.repeat(1_025) },
        sessionId: 'messenger:customer-123',
        queueBinding,
        appSecret: secret,
        issuedAt,
      }),
    ).rejects.toThrow('messenger_ingress_external_message_id_invalid');
  });
});
