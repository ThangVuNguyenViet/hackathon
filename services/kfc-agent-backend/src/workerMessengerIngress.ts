import type { ConversationEvent } from './channels/conversationEvent.js';
import type { WebhookDelivery } from './persistence/contracts.js';
import type { MessengerIngressQueueBinding } from './security/messengerIngressClaim.js';
import {
  verifyMessengerIngressClaim,
  type VerifiedMessengerGuestCheckoutIngress,
} from './security/guestCheckoutAuthority.js';

export async function verifyQueuedMessengerIngress(input: {
  claim: unknown;
  delivery: WebhookDelivery;
  expectedExternalMessageId: string;
  expectedSessionId: string;
  expectedQueueBinding: MessengerIngressQueueBinding;
  appSecret: string;
  now?: Date;
}): Promise<
  | {
      event: ConversationEvent;
      verifiedIngress: VerifiedMessengerGuestCheckoutIngress;
    }
  | undefined
> {
  if (
    input.delivery.channel !== 'messenger' ||
    input.delivery.externalEventId !== input.expectedExternalMessageId ||
    input.delivery.sessionId !== input.expectedSessionId
  ) {
    return undefined;
  }
  const event = eventFromReservedMessengerDelivery(input.delivery);
  if (!event) return undefined;
  const verifiedIngress = await verifyMessengerIngressClaim({
    claim: input.claim,
    expectedEvent: event,
    expectedSessionId: input.expectedSessionId,
    expectedQueueBinding: input.expectedQueueBinding,
    appSecret: input.appSecret,
    ...(input.now ? { now: input.now } : {}),
  });
  return verifiedIngress ? { event, verifiedIngress } : undefined;
}

export function eventFromReservedMessengerDelivery(
  delivery: WebhookDelivery,
): ConversationEvent | undefined {
  const payloadKeys = Object.keys(delivery.payload).sort();
  if (
    payloadKeys.join('\u0000') !==
    ['eventType', 'receivedAt', 'text'].join('\u0000')
  ) {
    return undefined;
  }
  const text = delivery.payload.text;
  const receivedAt = delivery.payload.receivedAt;
  if (
    typeof text !== 'string' ||
    text.length === 0 ||
    typeof receivedAt !== 'string' ||
    receivedAt !== delivery.receivedAt
  ) {
    return undefined;
  }
  const eventType =
    delivery.payload.eventType === 'postback'
      ? 'postback'
      : delivery.payload.eventType === 'message'
        ? 'message'
        : undefined;
  if (!eventType) return undefined;
  return {
    channel: 'messenger',
    externalUserId: delivery.externalUserId,
    externalThreadId: delivery.externalThreadId,
    text,
    eventType,
    rawEventId: delivery.externalEventId,
    receivedAt,
    platformEventName: eventType,
    shouldRunAgent: true,
  };
}
