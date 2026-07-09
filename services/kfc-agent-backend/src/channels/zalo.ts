import { z } from 'zod';
import type { ZaloClient } from '../clients/interfaces.js';
import type { ConversationAttachment, ToolResult } from '../domain/types.js';
import type { ConversationEvent } from './conversationEvent.js';

const zaloWebhookSchema = z
  .object({
    event_name: z.string(),
    sender: z.object({ id: z.string(), name: z.string().optional(), avatar: z.string().optional() }).passthrough().optional(),
    recipient: z.object({ id: z.string() }).passthrough().optional(),
    message: z
      .object({
        msg_id: z.string().optional(),
        text: z.string().optional(),
        attachments: z.array(z.unknown()).optional(),
      })
      .passthrough()
      .optional(),
    timestamp: z.number().optional(),
  })
  .passthrough();

function attachmentText(eventName: string): string {
  if (eventName.includes('image')) return '[Zalo image]';
  if (eventName.includes('file')) return '[Zalo file]';
  if (eventName.includes('link')) return '[Zalo link]';
  if (eventName.includes('sticker')) return '[Zalo sticker]';
  if (eventName.includes('audio') || eventName.includes('voice')) return '[Zalo audio]';
  if (eventName.includes('location')) return '[Zalo location]';
  if (eventName === 'follow') return '[Zalo follow]';
  return '[Unsupported Zalo event]';
}

function normalizeAttachment(value: unknown): ConversationAttachment {
  const attachment = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const payload =
    attachment.payload && typeof attachment.payload === 'object' ? (attachment.payload as Record<string, unknown>) : {};
  const type = typeof attachment.type === 'string' ? attachment.type : 'unknown';
  return {
    type: ['image', 'file', 'link', 'sticker', 'audio', 'location'].includes(type)
      ? (type as ConversationAttachment['type'])
      : 'unknown',
    url: typeof payload.url === 'string' ? payload.url : undefined,
    title: typeof payload.name === 'string' ? payload.name : undefined,
    latitude: typeof payload.latitude === 'number' ? payload.latitude : undefined,
    longitude: typeof payload.longitude === 'number' ? payload.longitude : undefined,
    raw: attachment,
  };
}

export function normalizeZaloWebhook(payload: unknown, expectedOaId?: string): ConversationEvent[] {
  const body = zaloWebhookSchema.parse(payload);
  if (expectedOaId && body.recipient?.id && body.recipient.id !== expectedOaId) return [];
  if (!body.sender?.id) return [];

  const timestamp = body.timestamp ?? Date.now();
  const attachments = (body.message?.attachments ?? []).map(normalizeAttachment);
  const text = body.message?.text?.trim();
  const hasText = Boolean(text);
  const eventName = body.event_name;
  const isText = eventName.includes('text') && hasText;
  const isFollow = eventName === 'follow';
  const fallbackText = text && text.length > 0 ? text : attachmentText(eventName);

  return [
    {
      channel: 'zalo',
      externalUserId: body.sender.id,
      externalThreadId: body.sender.id,
      text: fallbackText,
      eventType: isText ? 'message' : isFollow ? 'follow' : attachments.length > 0 ? 'attachment' : 'unsupported',
      rawEventId: body.message?.msg_id ?? `${body.sender.id}:${eventName}:${timestamp}`,
      receivedAt: new Date(timestamp).toISOString(),
      platformEventName: eventName,
      attachments,
      profile: {
        channel: 'zalo',
        externalUserId: body.sender.id,
        displayName: body.sender.name ?? null,
        avatarUrl: body.sender.avatar ?? null,
        profileSource: 'zalo_webhook',
        profileUpdatedAt: new Date(timestamp).toISOString(),
      },
      shouldRunAgent: isText,
      acknowledgementText: isText
        ? undefined
        : 'Mình đã nhận được nội dung bạn gửi. Bạn mô tả yêu cầu đặt món bằng tin nhắn chữ giúp mình nhé.',
      rawEvent: body,
    },
  ];
}

export function createZaloClient(input: {
  accessToken?: string;
  apiBaseUrl?: string;
  fetchImpl?: typeof fetch;
}): ZaloClient {
  const fetchImpl = input.fetchImpl ?? fetch;
  const apiBaseUrl = input.apiBaseUrl ?? 'https://openapi.zalo.me';

  return {
    async sendText(recipientId, text): Promise<ToolResult<{ messageId: string }>> {
      if (!input.accessToken) {
        return {
          ok: false,
          errorCode: 'missing_zalo_access_token',
          message: 'Zalo access token is not configured',
        };
      }

      try {
        const response = await fetchImpl(`${apiBaseUrl}/v3.0/oa/message/cs`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            access_token: input.accessToken,
          },
          body: JSON.stringify({
            recipient: { user_id: recipientId },
            message: { text },
          }),
        });
        const body = (await response.json()) as { message_id?: string; error?: number; message?: string };
        if (!response.ok || body.error) {
          return { ok: false, errorCode: 'zalo_send_failed', message: body.message ?? 'Zalo send failed' };
        }

        return { ok: true, value: { messageId: body.message_id ?? `zalo_${recipientId}` }, message: 'sent' };
      } catch (error) {
        return {
          ok: false,
          errorCode: 'zalo_send_failed',
          message: error instanceof Error ? error.message : 'Zalo send failed',
        };
      }
    },
  };
}
