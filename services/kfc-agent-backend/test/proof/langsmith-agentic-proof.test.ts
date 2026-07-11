import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  assertNoForbiddenProofKeys,
  buildAgenticProofManifest,
  validateAgenticProofPrerequisites,
  writeAgenticProofArtifacts,
} from '../../src/proof/langsmithAgenticProof.js';

const perfectScores = {
  context_relevance_pass: 1,
  forbidden_context_absent: 1,
  required_behavior_present: 1,
  forbidden_tools_absent: 1,
  required_tools_present: 1,
  state_mutation_allowed: 1,
} as const;

describe('LangSmith agentic proof', () => {
  it('rejects missing OpenAI and LangSmith credentials before a run', () => {
    expect(() => validateAgenticProofPrerequisites({ openAiApiKey: '', langSmithApiKey: '' })).toThrow(
      'OPENAI_API_KEY and LANGSMITH_API_KEY are required',
    );
  });

  it('records one checkout identity for the scenario and experiment', () => {
    const checkout = {
      commit: 'abc123',
      branch: 'main',
      dirty: true,
      changedPaths: ['services/kfc-agent-backend/src/graph/buildGraph.ts'],
    };

    const manifest = buildAgenticProofManifest({
      generatedAt: '2026-07-11T00:00:00.000Z',
      checkout,
      scenario: {
        id: 'kfc-agentic-demo',
        traceUrl: 'https://smith.example/trace',
        turnCount: 6,
        assertions: [{ name: 'ambiguous-removal-blocked', passed: true }],
      },
      experiment: {
        name: 'kfc-context-eval-test',
        url: 'https://smith.example/experiment',
        caseCount: 14,
        scores: perfectScores,
      },
    });

    expect(manifest.trace).toMatchObject({
      commit: 'abc123',
      dirty: true,
      scenarioId: 'kfc-agentic-demo',
    });
    expect(manifest.experiment).toMatchObject({
      commit: 'abc123',
      dirty: true,
      caseCount: 14,
      scores: perfectScores,
    });
    expect(manifest.screenshots).toEqual([]);
  });

  it('rejects credential and customer PII keys anywhere in proof payloads', () => {
    expect(() => assertNoForbiddenProofKeys({ nested: { apiKey: 'secret' } })).toThrow('Forbidden proof key: apiKey');
    expect(() => assertNoForbiddenProofKeys({ customer: { phoneNumber: '0900000000' } })).toThrow(
      'Forbidden proof key: phoneNumber',
    );
    expect(() => assertNoForbiddenProofKeys({ safe: { scenarioId: 'demo', toolNames: ['searchMenu'] } })).not.toThrow();
  });

  it('writes an atomic manifest and a readable visual walkthrough', async () => {
    const outputRoot = await mkdtemp(join(tmpdir(), 'kfc-agentic-proof-'));
    const manifest = buildAgenticProofManifest({
      generatedAt: '2026-07-11T00:00:00.000Z',
      checkout: { commit: 'abc123', branch: 'main', dirty: true, changedPaths: [] },
      scenario: {
        id: 'kfc-agentic-demo',
        traceUrl: 'https://smith.example/trace',
        turnCount: 6,
        assertions: [{ name: 'ambiguous-removal-blocked', passed: true }],
      },
      experiment: {
        name: 'kfc-context-eval-test',
        url: 'https://smith.example/experiment',
        caseCount: 14,
        scores: perfectScores,
      },
    });

    try {
      const result = await writeAgenticProofArtifacts({ outputRoot, manifest });
      expect(JSON.parse(await readFile(result.manifestPath, 'utf8'))).toEqual(manifest);
      expect(await readFile(result.walkthroughPath, 'utf8')).toContain(
        '[Open the agent trace](https://smith.example/trace)',
      );
      expect(await readFile(result.walkthroughPath, 'utf8')).toContain('Chrome capture pending');
    } finally {
      await rm(outputRoot, { recursive: true, force: true });
    }
  });

  it('exposes one command that runs the traced scenario and native context experiment', async () => {
    const packageJson = JSON.parse(await readFile(join(process.cwd(), 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    const script = await readFile(join(process.cwd(), 'scripts/run-langsmith-agentic-proof.ts'), 'utf8');

    expect(packageJson.scripts['proof:langsmith:agentic']).toContain('run-langsmith-agentic-proof.ts');
    expect(script).toContain('new LangSmithAgentTracer');
    expect(script).toContain('runAgentTurn');
    expect(script).toContain('createContextExperimentTarget');
    expect(script).toContain('createContextExperimentEvaluator');
    expect(script).toContain('writeAgenticProofArtifacts');
  });
});
