import { describe, expect, it } from 'vitest';
import {
  PROTECTED_COMMAND_TRACE_CATEGORIES,
  createProtectedCommandProofManifest,
  parseProtectedCommandProofManifest,
} from '../../src/observability/protectedCommandProofManifest.js';

const executionId = '00000000-0000-4000-8000-000000000001';
const gitSha = 'a'.repeat(40);
const toolContractDigest = 'c'.repeat(64);
const publishedRunIds = Array.from(
  { length: 81 },
  (_, index) =>
    `00000000-0000-4000-8000-${String(index + 10).padStart(12, '0')}`,
);
const publishedTraceIds = publishedRunIds.slice(0, 46);
const canonicalScenarios = Array.from({ length: 9 }, (_, scenarioIndex) => {
  const fileName = `${String(scenarioIndex + 1).padStart(2, '0')}-v3.json`;
  const turnCount = scenarioIndex === 8 ? 6 : 5;
  return {
    fileName,
    sourcePath: `test/scenarios/${fileName}`,
    turnIds: Array.from(
      { length: turnCount },
      (_, turnIndex) => `${fileName}#${turnIndex + 1}`,
    ),
  };
});

function proofInput() {
  const categoryApplicability = {
    agent_loop: 'required',
    graph_node: 'required',
    model: 'required',
    tool: 'required',
    approval: 'required',
    retry: 'when_present',
    verified_state: 'required',
    genui_projection: 'not_applicable',
    latency: 'required',
    cost: 'when_provider_reports_cost',
  } as const;
  return {
    source: {
      gitSha,
      dirty: false,
    },
    runtime: {
      runtimeId: 'langgraph-stategraph-v1',
      provider: 'openai',
      model: 'gpt-4.1-mini',
      profile: 'openai-qualification',
    },
    dataset: {
      name: 'kfc-live-quality-v3',
      remoteDatasetId: '11111111-1111-4111-8111-111111111111',
      schemaVersion: 'injected-dataset-schema-v1',
      inventoryVersion: '2026-07-20.5',
      inventoryDigest:
        '62036883be7e603d19fb08096b6e4931e00c11cc038b62a13d6f12c6e78a9c50',
      sourcePath: 'test/scenarios/injected-ledger.ts',
      scenarioCount: 9,
      turnCount: 46,
      caseCount: 92,
    },
    commerceTools: {
      contractId: 'injected-commerce-tools',
      contractVersion: 'injected-contract-version',
      contractDigest: toolContractDigest,
    },
    artifacts: [
      { role: 'inventory', path: 'artifacts/inventory.json', digest: 'd'.repeat(64) },
      { role: 'matrix', path: 'artifacts/matrix.json', digest: 'e'.repeat(64) },
      { role: 'run', path: 'artifacts/run.json', digest: 'f'.repeat(64) },
      {
        role: 'trace_readback',
        path: 'artifacts/trace-readback.json',
        digest: '1'.repeat(64),
      },
    ],
    qualification: {
      executionId,
      mode: 'text',
      repetition: 1,
      matrix: {
        repetitionsPerMode: 3,
        modeCount: 2,
        scenarioRunCount: 54,
        turnEvaluationCount: 276,
      },
      scenarios: canonicalScenarios,
    },
    traceProof: {
      schemaVersion: 1,
      artifactKind: 'kfc-required-agent-trace-proof-receipt',
      failureMode: 'required',
      context: {
        executionId,
        gitSha,
        runtimeId: 'langgraph-stategraph-v1',
        provider: 'openai',
        model: 'gpt-4.1-mini',
        profile: 'openai-qualification',
        mode: 'text',
        repetition: 1,
        inventory: {
          name: 'kfc-live-quality-v3',
          version: '2026-07-20.5',
          digest:
            '62036883be7e603d19fb08096b6e4931e00c11cc038b62a13d6f12c6e78a9c50',
          scenarioCount: 9,
          turnCount: 46,
          caseCount: 92,
        },
      },
      target: {
        apiUrl: 'https://apac.api.smith.langchain.com',
        projectName: 'private-injected-project',
        samplingRate: 1,
      },
      lifecycle: {
        turnsStarted: 46,
        childSpansStarted: 35,
        spansCompleted: 81,
        spansFailed: 0,
        flushesSucceeded: 1,
      },
      publication: {
        verified: true,
        flushVerified: true,
        readbackVerified: true,
        expectedRuns: 81,
        queryAttempts: 2,
        runIds: publishedRunIds,
        traceIds: publishedTraceIds,
      },
      categories: PROTECTED_COMMAND_TRACE_CATEGORIES.map((name) => ({
        name,
        applicability: categoryApplicability[name],
        observed:
          name === 'retry' ||
          name === 'genui_projection' ||
          name === 'cost'
            ? 0
            : 1,
      })),
      evidence: {
        source: 'published_runs',
        latency: {
          totalMs: 8_500,
          modelMs: 6_900,
          toolMs: 900,
        },
        providerEconomics: {
          usage: {
            status: 'reported',
            inputTokens: 1_000,
            outputTokens: 250,
            totalTokens: 1_250,
          },
          cost: {
            status: 'provider_did_not_report',
          },
        },
      },
    },
  };
}

describe('protected command proof manifest', () => {
  it('rejects a noncanonical Text corpus even when its arithmetic is self-consistent', () => {
    const input = proofInput();
    const noncanonical = {
      ...input,
      dataset: { ...input.dataset, name: 'noncanonical-dataset' },
      traceProof: {
        ...input.traceProof,
        context: {
          ...input.traceProof.context,
          inventory: {
            ...input.traceProof.context.inventory,
            name: 'noncanonical-dataset',
          },
        },
      },
    };
    expect(() => createProtectedCommandProofManifest(noncanonical)).toThrow(
      'protected_command_proof_text_corpus_invalid',
    );
  });

  it('creates one digest-bound manifest for the exact ordered corpus', () => {
    const manifest = createProtectedCommandProofManifest(proofInput());

    expect(manifest).toMatchObject({
      schemaVersion: 1,
      artifactKind: 'kfc-protected-command-proof-manifest',
      source: { gitSha, dirty: false },
      artifacts: [
        { role: 'inventory', digest: 'd'.repeat(64) },
        { role: 'matrix', digest: 'e'.repeat(64) },
        { role: 'run', digest: 'f'.repeat(64) },
        { role: 'trace_readback', digest: '1'.repeat(64) },
      ],
      qualification: {
        matrix: {
          repetitionsPerMode: 3,
        modeCount: 2,
          scenarioRunCount: 54,
          turnEvaluationCount: 276,
        },
        scenarios: canonicalScenarios,
      },
      traceProof: {
        publication: {
          verified: true,
          flushVerified: true,
          readbackVerified: true,
          runIds: publishedRunIds,
          traceIds: publishedTraceIds,
        },
        evidence: {
          source: 'published_runs',
          providerEconomics: {
            cost: { status: 'provider_did_not_report' },
          },
        },
      },
      integrity: {
        algorithm: 'sha256',
        payloadDigest: expect.stringMatching(/^[0-9a-f]{64}$/u),
      },
    });
    expect(parseProtectedCommandProofManifest(manifest)).toEqual(manifest);
  });

  it.each([
    {
      label: 'missing remote dataset identity',
      invalid(input: ReturnType<typeof proofInput>): unknown {
        return {
          ...input,
          dataset: { ...input.dataset, remoteDatasetId: undefined },
        };
      },
    },
    {
      label: 'malformed inventory digest',
      invalid(input: ReturnType<typeof proofInput>): unknown {
        return {
          ...input,
          dataset: { ...input.dataset, inventoryDigest: 'not-a-digest' },
        };
      },
    },
    {
      label: 'missing tool contract identity',
      invalid(input: ReturnType<typeof proofInput>): unknown {
        return {
          ...input,
          commerceTools: { ...input.commerceTools, contractId: undefined },
        };
      },
    },
    {
      label: 'malformed tool contract digest',
      invalid(input: ReturnType<typeof proofInput>): unknown {
        return {
          ...input,
          commerceTools: {
            ...input.commerceTools,
            contractDigest: 'not-a-digest',
          },
        };
      },
    },
  ])('fails closed for $label', ({ invalid }) => {
    expect(() => createProtectedCommandProofManifest(invalid(proofInput()))).toThrow(
      'protected_command_proof_input_invalid',
    );
  });

  it('rejects missing and duplicate artifact bindings', () => {
    const missing = structuredClone(proofInput());
    missing.artifacts.pop();
    expect(() => createProtectedCommandProofManifest(missing)).toThrow(
      'protected_command_proof_artifacts_invalid',
    );

    const duplicate = structuredClone(proofInput());
    duplicate.artifacts[1] = structuredClone(duplicate.artifacts[0]);
    expect(() => createProtectedCommandProofManifest(duplicate)).toThrow(
      'protected_command_proof_artifacts_invalid',
    );
  });

  it('requires an exact clean source SHA and rejects unknown fields', () => {
    const dirty = structuredClone(proofInput());
    dirty.source.dirty = true;
    expect(() => createProtectedCommandProofManifest(dirty)).toThrow(
      'protected_command_proof_input_invalid',
    );

    const unknown = { ...proofInput(), unreviewed: true };
    expect(() => createProtectedCommandProofManifest(unknown)).toThrow(
      'protected_command_proof_input_invalid',
    );
  });

  it('binds published root completeness to the inventory turn count', () => {
    const input = structuredClone(proofInput());
    input.traceProof.lifecycle = {
      ...input.traceProof.lifecycle,
      turnsStarted: 45,
      spansCompleted: 80,
    };
    input.traceProof.publication = {
      ...input.traceProof.publication,
      expectedRuns: 80,
      runIds: publishedRunIds.slice(0, 80),
      traceIds: publishedTraceIds.slice(0, 45),
    };

    expect(() => createProtectedCommandProofManifest(input)).toThrow(
      'protected_command_proof_binding_mismatch',
    );
  });

  it('rejects trace identity drift before issuing a manifest', () => {
    const input = structuredClone(proofInput());
    input.traceProof.context.model = 'different-model';

    expect(() => createProtectedCommandProofManifest(input)).toThrow(
      'protected_command_proof_binding_mismatch',
    );
  });

  it('rejects qualification matrix math that does not bind the corpus', () => {
    const invalid = structuredClone(proofInput());
    invalid.qualification.matrix.turnEvaluationCount = 23;

    expect(() => createProtectedCommandProofManifest(invalid)).toThrow(
      'protected_command_proof_matrix_invalid',
    );
  });

  it('rejects partial, duplicate, reordered, and misbound corpus inputs', () => {
    const partial = structuredClone(proofInput());
    partial.qualification.scenarios.pop();
    expect(() => createProtectedCommandProofManifest(partial)).toThrow(
      'protected_command_proof_corpus_invalid',
    );

    const duplicate = structuredClone(proofInput());
    duplicate.qualification.scenarios[1] =
      structuredClone(duplicate.qualification.scenarios[0]);
    expect(() => createProtectedCommandProofManifest(duplicate)).toThrow(
      'protected_command_proof_corpus_invalid',
    );

    const reordered = structuredClone(proofInput());
    reordered.qualification.scenarios.reverse();
    const reorderedManifest =
      createProtectedCommandProofManifest(reordered);
    expect(reorderedManifest.integrity.payloadDigest).not.toBe(
      createProtectedCommandProofManifest(proofInput())
        .integrity.payloadDigest,
    );

    const misbound = structuredClone(proofInput());
    misbound.qualification.scenarios[0].turnIds[0] =
      '02-v3.json#1';
    expect(() => createProtectedCommandProofManifest(misbound)).toThrow(
      'protected_command_proof_corpus_invalid',
    );
  });

  it('rejects duplicate, missing, and inapplicable trace categories', () => {
    const duplicate = structuredClone(proofInput());
    duplicate.traceProof.categories[1] = {
      ...duplicate.traceProof.categories[0],
    };
    expect(() => createProtectedCommandProofManifest(duplicate)).toThrow(
      'protected_command_proof_trace_categories_invalid',
    );

    const missing = structuredClone(proofInput());
    missing.traceProof.categories.pop();
    expect(() => createProtectedCommandProofManifest(missing)).toThrow(
      'protected_command_proof_trace_categories_invalid',
    );

    const unexpected = structuredClone(proofInput());
    const genUiCategory = unexpected.traceProof.categories.find(
      ({ name }) => name === 'genui_projection',
    );
    expect(genUiCategory).toBeDefined();
    if (genUiCategory === undefined) throw new Error('test_fixture_invalid');
    genUiCategory.observed = 1;
    expect(() => createProtectedCommandProofManifest(unexpected)).toThrow(
      'protected_command_proof_trace_categories_invalid',
    );
  });

  it('accepts only economics verified from the published receipt', () => {
    const valid = proofInput();
    const arbitraryCost = {
      ...valid,
      traceProof: {
        ...valid.traceProof,
        evidence: {
          ...valid.traceProof.evidence,
          providerEconomics: {
            ...valid.traceProof.evidence.providerEconomics,
            cost: {
              status: 'reported',
              currency: 'USD',
              amountUsd: 0.0042,
            },
          },
        },
      },
    };
    expect(() => createProtectedCommandProofManifest(arbitraryCost)).toThrow(
      'protected_command_proof_input_invalid',
    );

    const missingPublishedSource = structuredClone(proofInput());
    missingPublishedSource.traceProof.evidence.source = 'caller_reported';
    expect(() =>
      createProtectedCommandProofManifest(missingPublishedSource),
    ).toThrow('protected_command_proof_input_invalid');

    const badUsage = structuredClone(proofInput());
    badUsage.traceProof.evidence.providerEconomics.usage.totalTokens = 999;
    expect(() => createProtectedCommandProofManifest(badUsage)).toThrow(
      'protected_command_proof_economics_mismatch',
    );
  });

  it('binds the canonical V3 9/46/92 corpus to 54 runs and 276 evaluations', () => {
    const input = structuredClone(proofInput());
    const scenarios = Array.from({ length: 9 }, (_, scenarioIndex) => {
      const fileName = `${String(scenarioIndex + 1).padStart(2, '0')}-v3.json`;
      const turnCount = scenarioIndex === 8 ? 6 : 5;
      return {
        fileName,
        sourcePath: `test/scenarios/${fileName}`,
        turnIds: Array.from(
          { length: turnCount },
          (_, turnIndex) => `${fileName}#${turnIndex + 1}`,
        ),
      };
    });
    input.dataset = {
      ...input.dataset,
      name: 'kfc-live-quality-v3',
      inventoryVersion: '2026-07-20.5',
      inventoryDigest:
        '62036883be7e603d19fb08096b6e4931e00c11cc038b62a13d6f12c6e78a9c50',
      scenarioCount: 9,
      turnCount: 46,
      caseCount: 92,
    };
    input.qualification.matrix = {
      repetitionsPerMode: 3,
        modeCount: 2,
      scenarioRunCount: 54,
      turnEvaluationCount: 276,
    };
    input.qualification.scenarios = scenarios;
    input.traceProof.context.inventory = {
      name: input.dataset.name,
      version: input.dataset.inventoryVersion,
      digest: input.dataset.inventoryDigest,
      scenarioCount: 9,
      turnCount: 46,
      caseCount: 92,
    };
    input.traceProof.lifecycle = {
      turnsStarted: 46,
      childSpansStarted: 35,
      spansCompleted: 81,
      spansFailed: 0,
      flushesSucceeded: 1,
    };
    const canonicalRunIds = Array.from(
      { length: 81 },
      (_, index) =>
        `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    );
    input.traceProof.publication = {
      ...input.traceProof.publication,
      expectedRuns: 81,
      runIds: canonicalRunIds,
      traceIds: canonicalRunIds.slice(0, 46),
    };

    const manifest = createProtectedCommandProofManifest(input);

    expect(manifest.dataset).toMatchObject({
      name: 'kfc-live-quality-v3',
      inventoryVersion: '2026-07-20.5',
      scenarioCount: 9,
      turnCount: 46,
      caseCount: 92,
    });
    expect(manifest.qualification.matrix).toEqual({
      repetitionsPerMode: 3,
        modeCount: 2,
      scenarioRunCount: 54,
      turnEvaluationCount: 276,
    });
  });

  it('rejects any payload or integrity tampering', () => {
    const manifest = createProtectedCommandProofManifest(proofInput());
    const payloadTamper = structuredClone(manifest);
    payloadTamper.qualification.repetition = 2;
    expect(() => parseProtectedCommandProofManifest(payloadTamper)).toThrow(
      'protected_command_proof_integrity_invalid',
    );

    const digestTamper = structuredClone(manifest);
    digestTamper.integrity.payloadDigest = 'd'.repeat(64);
    expect(() => parseProtectedCommandProofManifest(digestTamper)).toThrow(
      'protected_command_proof_integrity_invalid',
    );
  });
});
