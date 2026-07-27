import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Client } from 'langsmith';
import { runLangSmithNoModelProbe } from '../src/qualification/externalQualification.js';

const required = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};

const outputPath = resolve(required('KFC_LANGSMITH_PROBE_OUTPUT'));
const projectName = required('LANGSMITH_PROJECT');
const client = new Client({
  apiKey: required('LANGSMITH_API_KEY'),
  apiUrl: required('LANGSMITH_ENDPOINT'),
  autoBatchTracing: false,
});
const result = await runLangSmithNoModelProbe(client, {
  projectName,
  runId: randomUUID(),
});
await writeFile(
  outputPath,
  JSON.stringify(
    {
      schemaVersion: 'kfc-langsmith-no-model-probe-v1',
      ...result,
    },
    null,
    2,
  ) + '\n',
  'utf8',
);
console.log(JSON.stringify(result, null, 2));
