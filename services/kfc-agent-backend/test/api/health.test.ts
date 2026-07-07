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
});
