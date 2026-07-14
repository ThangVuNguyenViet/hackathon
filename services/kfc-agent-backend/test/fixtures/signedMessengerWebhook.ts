import { createHmac } from 'node:crypto';

export const TEST_META_APP_SECRET = 'meta_test_secret';

export function signedMessengerWebhook(payload: unknown, rawBody?: string) {
  const body = rawBody ?? JSON.stringify(payload);
  return {
    method: 'POST' as const,
    url: '/webhooks/messenger',
    payload: body,
    headers: {
      'content-type': 'application/json',
      'x-hub-signature-256': `sha256=${createHmac('sha256', TEST_META_APP_SECRET).update(body).digest('hex')}`,
    },
  };
}
