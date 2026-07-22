import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'langsmith';

interface ScriptScenario {
  id: string;
  title: string;
  goal: string;
  useCases: string[];
  expectations: string[];
  turns: Array<{
    index: number;
    speaker: 'User' | 'Bot';
    text: string;
    useCases: string[];
  }>;
}

const backendRoot = resolve(import.meta.dirname, '..');
const scenariosRoot = resolve(
  backendRoot,
  '../../ai-talent-tracks/fnb/conversations',
);
const datasetName =
  process.env.KFC_SHOWCASE_DATASET?.trim() || 'kfc-showcase-scenarios-v1';
const baseUrl = (
  process.env.KFC_CHATBOT_URL?.trim() || 'https://kfc-ai-chatbot.pages.dev'
).replace(/\/$/, '');
const apiKey = process.env.LANGSMITH_API_KEY?.trim();
if (!apiKey) throw new Error('LANGSMITH_API_KEY is required');

const client = new Client({ apiKey, apiUrl: process.env.LANGSMITH_ENDPOINT });
const dataset = (await client.hasDataset({ datasetName }))
  ? await client.readDataset({ datasetName })
  : await client.createDataset(datasetName, {
      description:
        'PM-curated KFC showcase scenarios. Inputs are fixed customer turns; outputs are acceptance criteria.',
      dataType: 'kv',
      metadata: { schemaVersion: 'kfc-showcase-v1' },
    });
const existing = new Set<string>();
for await (const example of client.listExamples({ datasetId: dataset.id })) {
  const scenarioId = (example.inputs as Record<string, unknown>).scenarioId;
  if (typeof scenarioId === 'string') existing.add(scenarioId);
}
const scripts = readdirSync(scenariosRoot)
  .filter((name) => /^\d{2}-.*\.json$/.test(name))
  .sort()
  .map(
    (name) =>
      JSON.parse(
        readFileSync(resolve(scenariosRoot, name), 'utf8'),
      ) as ScriptScenario,
  );
for (const scenario of scripts) {
  if (existing.has(scenario.id)) continue;
  await client.createExample({
    dataset_id: dataset.id,
    inputs: {
      scenarioId: scenario.id,
      title: scenario.title,
      goal: scenario.goal,
      useCases: scenario.useCases,
      turns: scenario.turns
        .filter((turn) => turn.speaker === 'User')
        .map(({ index, text, useCases }) => ({ index, text, useCases })),
    },
    outputs: { acceptanceCriteria: scenario.expectations },
    metadata: { schemaVersion: 'kfc-showcase-v1', scenarioId: scenario.id },
    split: 'showcase',
  });
}

const catalog = await requestJson<{
  scenarios: Array<{ id: string; turns: Array<{ text: string }> }>;
}>('/showcase/scenarios');
const completed: string[] = [];
const stale: Array<{ scenarioId: string; mode: string; error: string }> = [];
for (const scenario of catalog.scenarios) {
  for (const mode of ['genui', 'text'] as const) {
    const customerId = `showcase_seed_${safeId(scenario.id)}_${mode}_${Date.now()}`;
    const sessionId = `kfc:${customerId}`;
    try {
      for (const [index, turn] of scenario.turns.entries()) {
        await requestJson('/chat/kfc/message', {
          method: 'POST',
          body: {
            sessionId,
            customerId,
            clientMessageId: `${customerId}_${index + 1}`,
            text: turn.text,
            metadata: {
              showcaseScenarioId: scenario.id,
              showcaseResponseMode: mode,
            },
          },
        });
      }
      await requestJson('/showcase/results', {
        method: 'POST',
        body: { scenarioId: scenario.id, mode, sessionId },
      });
      completed.push(`${scenario.id}:${mode}`);
    } catch (error) {
      stale.push({
        scenarioId: scenario.id,
        mode,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

console.log(
  JSON.stringify(
    { ok: stale.length === 0, datasetName, baseUrl, completed, stale },
    null,
    2,
  ),
);
if (stale.length > 0) process.exitCode = 1;

async function requestJson<T = Record<string, unknown>>(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? 'GET',
    headers:
      options.body === undefined
        ? undefined
        : { 'content-type': 'application/json' },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const body = (await response.json()) as T;
  if (!response.ok)
    throw new Error(
      `${path} returned ${response.status}: ${JSON.stringify(body)}`,
    );
  return body;
}

function safeId(value: string): string {
  return value
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
}
