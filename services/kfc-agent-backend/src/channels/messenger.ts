import { z } from 'zod';
import type { MessengerClient } from '../clients/interfaces.js';
import type { ToolResult } from '../domain/types.js';
import type { ConversationEvent } from './conversationEvent.js';

const messengerWebhookSchema = z.object({
  object: z.literal('page'),
  entry: z.array(
    z.object({
      id: z.string(),
      time: z.number().optional(),
      messaging: z.array(
        z.object({
          sender: z.object({ id: z.string() }),
          recipient: z.object({ id: z.string() }),
          timestamp: z.number().optional(),
          message: z
            .object({
              mid: z.string().optional(),
              text: z.string().optional(),
              is_echo: z.boolean().optional(),
            })
            .optional(),
          postback: z
            .object({
              mid: z.string().optional(),
              payload: z.string(),
            })
            .optional(),
        }),
      ),
    }),
  ),
});

export function verifyMessengerChallenge(
  query: Record<string, unknown>,
  expectedVerifyToken: string,
): { statusCode: number; body: string } {
  if (
    query['hub.mode'] === 'subscribe' &&
    query['hub.verify_token'] === expectedVerifyToken &&
    typeof query['hub.challenge'] === 'string'
  ) {
    return { statusCode: 200, body: query['hub.challenge'] };
  }

  return { statusCode: 403, body: 'Forbidden' };
}

export function normalizeMessengerWebhook(payload: unknown, pageId: string): ConversationEvent[] {
  const body = messengerWebhookSchema.parse(payload);
  const events: ConversationEvent[] = [];

  for (const entry of body.entry) {
    if (entry.id !== pageId) continue;
    for (const item of entry.messaging) {
      if (item.message?.is_echo) continue;

      const text = item.message?.text ?? item.postback?.payload;
      if (!text) continue;

      const timestamp = item.timestamp ?? entry.time ?? Date.now();
      events.push({
        channel: 'messenger',
        externalUserId: item.sender.id,
        externalThreadId: item.sender.id,
        text,
        eventType: item.postback ? 'postback' : 'message',
        rawEventId: item.message?.mid ?? item.postback?.mid ?? `${item.sender.id}:${timestamp}`,
        receivedAt: new Date(timestamp).toISOString(),
        platformEventName: item.postback ? 'postback' : 'message',
        shouldRunAgent: true,
        rawEvent: item as unknown as Record<string, unknown>,
      });
    }
  }

  return events;
}

export function createMessengerClient(input: {
  pageAccessToken?: string;
  graphApiBaseUrl?: string;
  fetchImpl?: typeof fetch;
}): MessengerClient {
  const fetchImpl = input.fetchImpl ?? fetch;
  const graphApiBaseUrl = input.graphApiBaseUrl ?? 'https://graph.facebook.com';

  return {
    async sendText(recipientId, text): Promise<ToolResult<{ messageId: string }>> {
      if (!input.pageAccessToken) {
        return {
          ok: false,
          errorCode: 'missing_page_access_token',
          message: 'Messenger page access token is not configured',
        };
      }

      try {
        const response = await fetchImpl(`${graphApiBaseUrl}/me/messages?access_token=${input.pageAccessToken}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            recipient: { id: recipientId },
            message: { text },
          }),
        });
        const body = (await response.json()) as { message_id?: string; error?: { message?: string } };
        if (!response.ok || !body.message_id) {
          return {
            ok: false,
            errorCode: 'messenger_send_failed',
            message: body.error?.message ?? 'Messenger send failed',
          };
        }

        return { ok: true, value: { messageId: body.message_id }, message: 'sent' };
      } catch (error) {
        return {
          ok: false,
          errorCode: 'messenger_send_failed',
          message: error instanceof Error ? error.message : 'Messenger send failed',
        };
      }
    },
    async getProfile(recipientId) {
      if (!input.pageAccessToken) {
        return {
          ok: false,
          errorCode: 'missing_page_access_token',
          message: 'Messenger page access token is not configured',
        };
      }

      try {
        const response = await fetchImpl(
          `${graphApiBaseUrl}/${recipientId}?fields=first_name,last_name,profile_pic&access_token=${input.pageAccessToken}`,
        );
        const body = (await response.json()) as {
          first_name?: string;
          last_name?: string;
          profile_pic?: string;
          error?: { message?: string };
        };
        if (!response.ok || body.error) {
          return {
            ok: false,
            errorCode: 'messenger_profile_failed',
            message: body.error?.message ?? 'Messenger profile lookup failed',
          };
        }

        const displayName = [body.first_name, body.last_name].filter(Boolean).join(' ').trim() || null;
        return {
          ok: true,
          value: {
            displayName,
            avatarUrl: body.profile_pic ?? null,
            profileSource: 'messenger_profile_api',
          },
          message: 'ok',
        };
      } catch (error) {
        return {
          ok: false,
          errorCode: 'messenger_profile_failed',
          message: error instanceof Error ? error.message : 'Messenger profile lookup failed',
        };
      }
    },
  };
}
