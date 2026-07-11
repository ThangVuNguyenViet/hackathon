export const agenticProofScoreKeys = [
  'context_relevance_pass',
  'forbidden_context_absent',
  'required_behavior_present',
  'forbidden_tools_absent',
  'required_tools_present',
  'state_mutation_allowed',
] as const;

export type AgenticProofScoreKey = (typeof agenticProofScoreKeys)[number];
export type AgenticProofScores = Record<AgenticProofScoreKey, number>;

export interface AgenticProofCheckout {
  commit: string;
  branch: string;
  dirty: boolean;
  changedPaths: string[];
}

export interface AgenticProofAssertion {
  name: string;
  passed: boolean;
  detail?: string;
}

export interface AgenticProofManifestInput {
  generatedAt: string;
  checkout: AgenticProofCheckout;
  scenario: {
    id: string;
    traceUrl: string;
    turnCount: number;
    assertions: AgenticProofAssertion[];
  };
  experiment: {
    name: string;
    url: string;
    caseCount: number;
    scores: AgenticProofScores;
  };
}

export interface AgenticProofScreenshot {
  kind: 'trace-tree' | 'policy-detail' | 'experiment';
  rawPath: string;
  annotatedPath?: string;
  chromeUrl: string;
  callouts: Array<{ number: number; label: string }>;
}

export interface AgenticProofManifest {
  schemaVersion: 'kfc-agentic-langsmith-proof-v1';
  generatedAt: string;
  checkout: AgenticProofCheckout;
  trace: AgenticProofCheckout & {
    scenarioId: string;
    url: string;
    turnCount: number;
    assertions: AgenticProofAssertion[];
  };
  experiment: AgenticProofCheckout & {
    name: string;
    url: string;
    caseCount: number;
    scores: AgenticProofScores;
  };
  screenshots: AgenticProofScreenshot[];
}

const forbiddenProofKeys = new Set([
  'apikey',
  'authorization',
  'accesstoken',
  'refreshtoken',
  'password',
  'secret',
  'email',
  'phonenumber',
  'savedaddresses',
  'rawproviderevent',
]);

function normalizedKey(key: string): string {
  return key.replace(/[_-]/g, '').toLowerCase();
}

export function assertNoForbiddenProofKeys(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) assertNoForbiddenProofKeys(item);
    return;
  }
  if (typeof value !== 'object' || value === null) return;

  for (const [key, entry] of Object.entries(value)) {
    if (forbiddenProofKeys.has(normalizedKey(key))) {
      throw new Error(`Forbidden proof key: ${key}`);
    }
    assertNoForbiddenProofKeys(entry);
  }
}

export function validateAgenticProofPrerequisites(input: {
  openAiApiKey?: string;
  langSmithApiKey?: string;
}): void {
  if (!input.openAiApiKey?.trim() || !input.langSmithApiKey?.trim()) {
    throw new Error('OPENAI_API_KEY and LANGSMITH_API_KEY are required');
  }
}

export function buildAgenticProofManifest(input: AgenticProofManifestInput): AgenticProofManifest {
  const manifest: AgenticProofManifest = {
    schemaVersion: 'kfc-agentic-langsmith-proof-v1',
    generatedAt: input.generatedAt,
    checkout: input.checkout,
    trace: {
      ...input.checkout,
      scenarioId: input.scenario.id,
      url: input.scenario.traceUrl,
      turnCount: input.scenario.turnCount,
      assertions: input.scenario.assertions,
    },
    experiment: {
      ...input.checkout,
      name: input.experiment.name,
      url: input.experiment.url,
      caseCount: input.experiment.caseCount,
      scores: input.experiment.scores,
    },
    screenshots: [],
  };
  assertNoForbiddenProofKeys(manifest);
  return manifest;
}

function walkthroughMarkdown(manifest: AgenticProofManifest): string {
  const scoreRows = agenticProofScoreKeys
    .map((key) => `| ${key} | ${manifest.experiment.scores[key].toFixed(2)} |`)
    .join('\n');
  const assertionRows = manifest.trace.assertions
    .map((assertion) => `- ${assertion.passed ? 'PASS' : 'FAIL'} — ${assertion.name}${assertion.detail ? `: ${assertion.detail}` : ''}`)
    .join('\n');

  return `# KFC Agentic LangSmith Proof

- Checkout: \`${manifest.checkout.commit}\`
- Branch: \`${manifest.checkout.branch}\`
- Dirty snapshot: \`${manifest.checkout.dirty}\`
- Scenario: \`${manifest.trace.scenarioId}\`
- [Open the agent trace](${manifest.trace.url})
- [Open the LangSmith experiment](${manifest.experiment.url})

## Scenario Assertions

${assertionRows}

## Experiment Scores

| Evaluator | Average |
| --- | ---: |
${scoreRows}

## Visual Walkthrough

Chrome capture pending. Raw screenshots remain unchanged; annotated copies will use numbered callouts with this walkthrough as the legend.
`;
}

export async function writeAgenticProofArtifacts(input: {
  outputRoot: string;
  manifest: AgenticProofManifest;
}): Promise<{ proofDirectory: string; manifestPath: string; walkthroughPath: string }> {
  assertNoForbiddenProofKeys(input.manifest);
  const directoryName = input.manifest.generatedAt.replace(/[:.]/g, '-');
  const proofDirectory = join(input.outputRoot, directoryName);
  await mkdir(proofDirectory, { recursive: true });

  const manifestPath = join(proofDirectory, 'manifest.json');
  const walkthroughPath = join(proofDirectory, 'walkthrough.md');
  const temporaryManifestPath = `${manifestPath}.tmp`;
  const temporaryWalkthroughPath = `${walkthroughPath}.tmp`;
  await writeFile(temporaryManifestPath, `${JSON.stringify(input.manifest, null, 2)}\n`, 'utf8');
  await writeFile(temporaryWalkthroughPath, walkthroughMarkdown(input.manifest), 'utf8');
  await rename(temporaryManifestPath, manifestPath);
  await rename(temporaryWalkthroughPath, walkthroughPath);

  return { proofDirectory, manifestPath, walkthroughPath };
}
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
