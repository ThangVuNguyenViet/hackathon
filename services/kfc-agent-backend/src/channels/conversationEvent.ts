import type { Channel, ConversationAttachment, ConversationProfile } from '../domain/types.js';

export interface ConversationEvent {
  channel: Extract<Channel, 'messenger' | 'zalo' | 'kfc' | 'messenger_mock' | 'zalo_mock'>;
  externalUserId: string;
  externalThreadId: string;
  text: string;
  eventType: 'message' | 'postback' | 'attachment' | 'follow' | 'unsupported';
  rawEventId: string;
  receivedAt: string;
  platformEventName?: string | undefined;
  attachments?: ConversationAttachment[] | undefined;
  profile?: ConversationProfile | undefined;
  shouldRunAgent: boolean;
  acknowledgementText?: string | undefined;
  rawEvent?: Record<string, unknown> | undefined;
}
