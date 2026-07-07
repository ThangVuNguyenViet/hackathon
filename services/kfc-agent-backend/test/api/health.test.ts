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
  });
});
