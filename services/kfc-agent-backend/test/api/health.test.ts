import { describe, expect, it } from 'vitest';
import { buildServer } from '../../src/api/server.js';

describe('health route', () => {
  it('returns service status without external dependencies', async () => {
    const server = buildServer();
    const response = await server.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      ok: true,
      service: 'kfc-agent-backend',
    });
    expect(response.headers['access-control-allow-origin']).toBe('*');
  });

  it('responds to dashboard CORS preflight requests', async () => {
    const server = buildServer();
    const response = await server.inject({ method: 'OPTIONS', url: '/dashboard/sessions' });

    expect(response.statusCode).toBe(204);
    expect(response.headers['access-control-allow-methods']).toContain('GET');
  });

  it('reports readiness when database, fixtures, and demo channel config are available', async () => {
    const server = buildServer({
      messengerVerifyToken: 'local_verify',
      messengerPageAccessToken: 'page_token_local',
      readiness: {
        database: async () => ({ ok: true }),
      },
    });

    const response = await server.inject({ method: 'GET', url: '/ready' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      ok: true,
      service: 'kfc-agent-backend',
      checks: {
        database: { ok: true },
        fixtures: { ok: true },
        messenger: { ok: true },
        openai: { ok: true, required: false },
      },
    });
    expect(response.json().timestamp).toEqual(expect.any(String));
  });

  it('returns 503 readiness when a required dependency fails', async () => {
    const server = buildServer({
      readiness: {
        database: async () => ({ ok: false, message: 'database unavailable' }),
        fixturesRoot: '/tmp/kfc-agent-backend-missing-fixtures',
      },
    });

    const response = await server.inject({ method: 'GET', url: '/ready' });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      ok: false,
      checks: {
        database: { ok: false, message: 'database unavailable' },
        fixtures: { ok: false },
        messenger: { ok: false },
      },
    });
  });
});
