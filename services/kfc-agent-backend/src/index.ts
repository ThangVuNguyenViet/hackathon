import { buildServer } from './api/server.js';
import { buildServerOptionsFromEnv } from './api/serverOptions.js';
import { loadEnv } from './config/env.js';

const env = loadEnv();
const server = buildServer(buildServerOptionsFromEnv(env));

await server.listen({ host: '0.0.0.0', port: env.PORT });
