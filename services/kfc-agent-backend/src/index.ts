import { buildServer } from './api/server.js';
import { loadEnv } from './config/env.js';

const env = loadEnv();
const server = buildServer();

await server.listen({ host: '0.0.0.0', port: env.PORT });
