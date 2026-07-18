import { buildServer, type BuildServerOptions } from '../../src/api/server.js';

const token = 'test-demo-admin-token';

export function buildDemoAdminServer(options: BuildServerOptions = {}) {
  const server = buildServer({ demoAdminToken: token, ...options });
  const inject = server.inject.bind(server) as (input: any, callback?: any) => any;
  server.inject = ((input: any, callback?: any) => {
    const request = typeof input === 'string'
      ? { method: 'GET', url: input, headers: { authorization: `Bearer ${token}` } }
      : {
          ...input,
          headers: { authorization: `Bearer ${token}`, ...input.headers },
        };
    return callback ? inject(request, callback) : inject(request);
  }) as typeof server.inject;
  return server;
}
