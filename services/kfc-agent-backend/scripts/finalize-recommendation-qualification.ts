import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import { buildQualificationManifest } from '../src/qualification/qualificationManifest.js';

const inputSchema = z
  .object({
    sourceCommit: z.string().regex(/^[a-f0-9]{40,64}$/u),
    publicProvenancePath: z.string().min(1),
    externalProbePath: z.string().min(1),
    langsmithProbePath: z.string().min(1),
    scenarios: z
      .array(
        z
          .object({
            scenarioId: z.string().min(1),
            narrativePath: z.string().min(1),
            evidenceDirectory: z.string().min(1),
            evaluationPath: z.string().min(1),
          })
          .strict(),
      )
      .length(8),
  })
  .strict();

const expectedScenarioIds = [
  'recommendation-01-returning-customer-flagship',
  'recommendation-02-anonymous-local-favorite',
  'recommendation-03-modifier-accepted',
  'recommendation-04-modifier-empty-skipped',
  'recommendation-05-sanity-replacement',
  'recommendation-06-sanity-suppression',
  'recommendation-07-explicit-request-after-proactive',
  'recommendation-08-once-only-enforcement',
] as const;

const inputPath = resolve(
  requiredEnvironment('KFC_QUALIFICATION_FINALIZE_INPUT'),
);
const outputPath = resolve(
  requiredEnvironment('KFC_QUALIFICATION_MANIFEST_OUTPUT'),
);
const input = inputSchema.parse(JSON.parse(await readFile(inputPath, 'utf8')));
const manifest = await buildQualificationManifest({
  sourceCommit: input.sourceCommit,
  expectedScenarioIds,
  publicProvenancePath: resolve(input.publicProvenancePath),
  externalProbePath: resolve(input.externalProbePath),
  langsmithProbePath: resolve(input.langsmithProbePath),
  scenarios: await Promise.all(
    input.scenarios.map(async (scenario) => ({
      scenarioId: scenario.scenarioId,
      narrativeSha256: createHash('sha256')
        .update(await readFile(resolve(scenario.narrativePath)))
        .digest('hex'),
      evidenceDirectory: resolve(scenario.evidenceDirectory),
      evaluationPath: resolve(scenario.evaluationPath),
    })),
  ),
});
await writeFile(outputPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
console.log(JSON.stringify(manifest, null, 2));

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}
