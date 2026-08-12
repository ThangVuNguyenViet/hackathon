import { createHash } from 'node:crypto';
import { buildServer, type BuildServerOptions } from '../../src/api/server.js';

const token = 'test-demo-admin-token';
const zaloSecret = 'test-zalo-webhook-secret';

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? { ...value }
    : {};
}

export function buildDemoAdminServer(options: BuildServerOptions = {}) {
  const server = buildServer({
    demoAdminToken: token,
    zaloWebhookSecret: zaloSecret,
    messengerBusinessId: 'kfc',
    zaloBusinessId: 'kfc',
    ...options,
  });
  const inject = server.inject.bind(server) as (input: any, callback?: any) => any;
  server.inject = ((input: any, callback?: any) => {
    let request = typeof input === 'string'
      ? { method: 'GET', url: input, headers: { authorization: `Bearer ${token}` } }
      : {
          ...input,
          headers: { authorization: `Bearer ${token}`, ...input.headers },
        };
    if (
      request.url === '/webhooks/zalo' &&
      request.method === 'POST' &&
      !request.headers['x-zevent-signature']
    ) {
      const rawPayload: unknown = request.payload;
      const payload = typeof rawPayload === 'string'
        ? recordValue(JSON.parse(rawPayload))
        : recordValue(rawPayload);
      payload.app_id ??= 'test-zalo-app';
      payload.timestamp ??= Date.now();
      const body = JSON.stringify(payload);
      request = {
        ...request,
        payload: body,
        headers: {
          ...request.headers,
          'content-type': 'application/json',
          'x-zevent-signature': createHash('sha256')
            .update(`${String(payload.app_id)}${body}${String(payload.timestamp)}${zaloSecret}`)
            .digest('hex'),
        },
      };
    }
    return callback ? inject(request, callback) : inject(request);
  }) as typeof server.inject;
  return server;
}
