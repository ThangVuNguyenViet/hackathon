import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { OpenAIClient } from '@kfc/openai-agents-runtime';
import { ChatOpenAI } from '@langchain/openai';
import OpenAI from 'openai';
import { OpenAiKfcAgent } from '../src/agent/openAiKfcAgent.js';
import { buildServer } from '../src/api/server.js';
import { loadBundledGeneratedFixtures } from '../src/fixtures/bundledFixtures.js';

// Auto-load root .env if process.env.OPENAI_API_KEY is unset
if (!process.env.OPENAI_API_KEY) {
  const rootEnvPath = resolve(process.cwd(), '../../.env');
  if (existsSync(rootEnvPath)) {
    const envContent = readFileSync(rootEnvPath, 'utf8');
    for (const line of envContent.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx > 0) {
        const key = trimmed.slice(0, eqIdx).trim();
        const value = trimmed.slice(eqIdx + 1).trim();
        if (key && !process.env[key]) {
          process.env[key] = value;
        }
      }
    }
  }
}

const port = Number.parseInt(process.env.PORT?.trim() || '8787', 10);
const host = process.env.HOST?.trim() || '127.0.0.1';

const apiKey = process.env.OPENAI_API_KEY?.trim();
const modelName = process.env.KFC_AGENT_MODEL?.trim() || 'gpt-4.1-mini';

const directOpenAiClient = apiKey
  ? new OpenAI({ apiKey })
  : undefined;

const openAiAgent = directOpenAiClient
  ? new OpenAiKfcAgent({
      client: directOpenAiClient as unknown as OpenAIClient,
      model: modelName,
      compaction: {
        enabled: true,
        thresholdBytes: 98304,
      },
    })
  : undefined;

const agentModel = apiKey
  ? new ChatOpenAI({
      openAIApiKey: apiKey,
      modelName,
      temperature: 0,
    })
  : undefined;

const agentIdentity = {
  provider: 'openai' as const,
  model: modelName,
  profile: 'openai-gpt-4.1-mini',
};

const fixtures = loadBundledGeneratedFixtures();

const server = buildServer({
  openAiAgent,
  agent: agentModel ? { model: agentModel, identity: agentIdentity } : undefined,
  fixtures,
});

await server.listen({ host, port });
console.log(
  JSON.stringify({
    ok: true,
    message: `KFC & PVCFC Business-Agnostic Live AI Backend Server running at http://${host}:${port}`,
    port,
    hasOpenAiKey: Boolean(apiKey),
    model: modelName,
  }),
);
