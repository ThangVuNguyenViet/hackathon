import type { Channel } from '../domain/types.js';

export interface ConversationEvent {
  channel: Extract<Channel, 'messenger' | 'zalo' | 'messenger_mock' | 'zalo_mock' | 'web_mock'>;
  externalUserId: string;
  externalThreadId: string;
  text: string;
  eventType: 'message' | 'postback';
  rawEventId: string;
  receivedAt: string;
}
