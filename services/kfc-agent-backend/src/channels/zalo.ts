import { z } from 'zod';
import type { ZaloClient } from '../clients/interfaces.js';
import type { ToolResult } from '../domain/types.js';
import type { ConversationEvent } from './conversationEvent.js';

const zaloWebhookSchema = z
  .object({
    event_name: z.string(),
    sender: z.object({ id: z.string() }).optional(),
    recipient: z.object({ id: z.string() }).optional(),
    message: z
      .object({
        msg_id: z.string().optional(),
        text: z.string().optional(),
      })
      .optional(),
    timestamp: z.number().optional(),
  })
  .passthrough();

export function normalizeZaloWebhook(payload: unknown, expectedOaId?: string): ConversationEvent[] {
  const body = zaloWebhookSchema.parse(payload);
  if (expectedOaId && body.recipient?.id && body.recipient.id !== expectedOaId) return [];
  if (!body.event_name.includes('text')) return [];
  if (!body.sender?.id || !body.message?.text) return [];

  const timestamp = body.timestamp ?? Date.now();
  return [
    {
      channel: 'zalo',
      externalUserId: body.sender.id,
      externalThreadId: body.sender.id,
      text: body.message.text,
      eventType: 'message',
      rawEventId: body.message.msg_id ?? `${body.sender.id}:${timestamp}`,
      receivedAt: new Date(timestamp).toISOString(),
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
