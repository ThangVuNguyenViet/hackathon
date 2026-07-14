import { describe, expect, it } from 'vitest';
import { buildServer } from '../../src/api/server.js';

const token = 'demo-admin-test-token';

describe('temporary demo-admin boundary', () => {
  it('fails closed and accepts the existing bearer/header token contract', async () => {
    const configured = buildServer({ demoAdminToken: token });
    const missingConfig = await buildServer().inject({ method: 'GET', url: '/dashboard/sessions' });
    const unauthorized = await configured.inject({ method: 'GET', url: '/dashboard/sessions' });
    const dashboard = await configured.inject({
      method: 'GET',
      url: '/dashboard/sessions',
      headers: { authorization: `Bearer ${token}` },
    });
    const sessionUpdates = await configured.inject({
      method: 'GET',
      url: '/chat/kfc/sessions/kfc%3Acustomer/updates',
      headers: { 'x-kfc-demo-admin-token': token },
    });
    const adminStatus = await configured.inject({
      method: 'GET',
      url: '/admin/messenger/sync-history/status',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(missingConfig.statusCode).toBe(503);
    expect(unauthorized.statusCode).toBe(401);
    expect(dashboard.statusCode).toBe(200);
    expect(sessionUpdates.statusCode).toBe(200);
    expect(adminStatus.statusCode).toBe(200);
  });

  it('does not protect readiness or webhook challenge routes', async () => {
    const server = buildServer({ messengerVerifyToken: 'verify' });
    expect((await server.inject({ method: 'GET', url: '/ready' })).json()).not.toHaveProperty('errorCode', 'demo_admin_unauthorized');
    expect((await server.inject({
      method: 'GET',
      url: '/webhooks/messenger?hub.mode=subscribe&hub.verify_token=verify&hub.challenge=ok',
    })).statusCode).toBe(200);
  });
});
