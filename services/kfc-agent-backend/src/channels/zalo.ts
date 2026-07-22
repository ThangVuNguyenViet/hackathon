import { z } from 'zod';
import {
  channelTextSendOutcomeToLegacyToolResult,
  type ChannelMediaDeliveryResult,
  type ChannelTextOutcomeClient,
  type ChannelTextSendOutcome,
  type ZaloClient,
} from '../clients/interfaces.js';
import type { ConversationAttachment, ToolResult } from '../domain/types.js';
import type { ConversationEvent } from './conversationEvent.js';

const zaloTextSendResponseSchema = z
  .object({
    message_id: z.string().trim().min(1).optional(),
    error: z.number().optional(),
    message: z.string().optional(),
  })
  .passthrough();

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
  const isLink = eventName.includes('link');
  const fallbackText = text && text.length > 0 ? text : attachmentText(eventName);

  return [
    {
      channel: 'zalo',
      externalUserId: body.sender.id,
      externalThreadId: body.sender.id,
      text: fallbackText,
      eventType: isText ? 'message' : isFollow ? 'follow' : isLink || attachments.length > 0 ? 'attachment' : 'unsupported',
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
      acknowledgementText: undefined,
      rawEvent: body,
    },
  ];
}

export function createZaloClient(input: {
  accessToken?: string;
  apiBaseUrl?: string;
  fetchImpl?: typeof fetch;
}): ZaloClient & ChannelTextOutcomeClient {
  const fetchImpl = input.fetchImpl ?? fetch;
  const apiBaseUrl = input.apiBaseUrl ?? 'https://openapi.zalo.me';
  const textAccessToken = input.accessToken?.trim();
  const sendTextWithOutcome = async (
    recipientId: string,
    text: string,
  ): Promise<ChannelTextSendOutcome> => {
    if (!textAccessToken) {
      return {
        status: 'not_dispatched',
        errorCode: 'missing_zalo_access_token',
        message: 'Zalo access token is not configured',
      };
    }
    if (recipientId.trim().length === 0 || text.trim().length === 0) {
      return {
        status: 'not_dispatched',
        errorCode: 'zalo_send_input_invalid',
        message: 'Zalo recipient and text are required',
      };
    }

    let response: Response;
    try {
      response = await fetchImpl(`${apiBaseUrl}/v3.0/oa/message/cs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          access_token: textAccessToken,
        },
        body: JSON.stringify({
          recipient: { user_id: recipientId },
          message: { text },
        }),
      });
    } catch (error) {
      return {
        status: 'delivery_outcome_unknown',
        errorCode: 'zalo_delivery_outcome_unknown',
        message: error instanceof Error
          ? error.message
          : 'Zalo delivery outcome is unknown',
      };
    }

    let body: z.infer<typeof zaloTextSendResponseSchema>;
    try {
      const parsed = zaloTextSendResponseSchema.safeParse(
        await response.json(),
      );
      if (!parsed.success) {
        return {
          status: 'delivery_outcome_unknown',
          errorCode: 'zalo_delivery_outcome_unknown',
          message: 'Zalo response did not confirm a message ID',
        };
      }
      body = parsed.data;
    } catch {
      return {
        status: 'delivery_outcome_unknown',
        errorCode: 'zalo_delivery_outcome_unknown',
        message: 'Zalo response could not confirm delivery',
      };
    }

    if (body.error !== undefined && body.error !== 0) {
      return {
        status: 'confirmed_not_sent',
        errorCode: 'zalo_send_failed',
        message: body.message ?? 'Zalo send was rejected',
      };
    }
    if (!response.ok || !body.message_id) {
      return {
        status: 'delivery_outcome_unknown',
        errorCode: 'zalo_delivery_outcome_unknown',
        message: 'Zalo response did not confirm a message ID',
      };
    }
    return {
      status: 'confirmed_sent',
      messageId: body.message_id,
    };
  };

  return {
    sendTextWithOutcome,
    async sendText(recipientId, text): Promise<ToolResult<{ messageId: string }>> {
      return channelTextSendOutcomeToLegacyToolResult(
        await sendTextWithOutcome(recipientId, text),
      );
    },
    async sendMedia(recipientId, media): Promise<ChannelMediaDeliveryResult> {
      const items: ChannelMediaDeliveryResult['items'] = [];
      for (const item of media) {
        try {
          const response = await fetchImpl(`${apiBaseUrl}/v3.0/oa/message/cs`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', access_token: input.accessToken ?? '' },
            body: JSON.stringify({
              recipient: { user_id: recipientId },
              message: { text: item.title, attachment: { type: 'template', payload: { template_type: 'media', elements: [{ media_type: 'image', url: item.imageUrl }] } } },
            }),
          });
          const body = (await response.json()) as { message_id?: string; error?: number; message?: string };
          if (!response.ok || (body.error !== undefined && body.error !== 0) || !body.message_id) {
            items.push({ key: item.key, status: 'failed', errorCode: 'zalo_media_send_failed', errorMessage: body.message ?? 'Zalo media send failed' });
          } else {
            items.push({ key: item.key, status: 'sent', messageId: body.message_id });
          }
        } catch (error) {
          items.push({ key: item.key, status: 'failed', errorCode: 'zalo_media_send_failed', errorMessage: error instanceof Error ? error.message : 'Zalo media send failed' });
        }
      }
      const sent = items.filter((item) => item.status === 'sent').length;
      return { status: sent === items.length ? 'sent' : sent === 0 ? 'failed' : 'partial', items };
    },
    async getProfile(_recipientId) {
      return {
        ok: false,
        errorCode: 'zalo_profile_lookup_not_configured',
        message: 'Zalo profile lookup is not configured; webhook sender profile is used when available',
      };
    },
  };
}
