import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ProtectedTraceQualificationPolicy } from '../../src/evaluation/protectedTraceQualificationPolicy.js';
import {
  createProtectedCommandProofManifest,
  verifyProtectedProofArtifacts,
  writeProtectedCommandProofManifest,
} from '../../src/observability/protectedCommandProofManifest.js';
import {
  verifyCapturedAgentTracePublication,
  verifiedAgentTraceReceiptPayload,
  type CapturedAgentTraceRun,
  type VerifiedAgentTraceReceipt,
} from '../../src/observability/requiredAgentTracePublication.js';

const policy: ProtectedTraceQualificationPolicy = {
  policyId: 'reviewed-test-policy-v1',
  dataset: {
    name: 'reviewed-private-dataset',
    schemaVersion: 'reviewed-schema-v1',
    inventoryVersion: 'reviewed-inventory-v1',
    inventoryDigest: 'a'.repeat(64),
    sourcePath: 'test/scenarios/reviewed-ledger.ts',
    scenarioCount: 1,
    turnCount: 1,
    caseCount: 2,
  },
  modes: ['text', 'genui'],
  repetitionsPerMode: 2,
  costPolicy: 'provider_reported_or_unavailable',
};
const runtime = {
  runtimeId: 'langgraph-stategraph-v1',
  provider: 'openai' as const,
  model: 'gpt-4.1-mini',
  profile: 'openai-qualification',
};
const rootId = '00000000-0000-4000-8000-000000000001';
const inputs = { evidenceDigest: 'b'.repeat(64) };
const outputs = { evidenceDigest: 'c'.repeat(64) };
const captured: CapturedAgentTraceRun[] = [
  {
    id: rootId,
    traceId: rootId,
    name: 'agent_turn',
    runType: 'chain',
    category: 'agent_loop',
    applicability: {
      tool: 'forbidden',
      approval: 'forbidden',
      verifiedState: 'required',
      genui: 'forbidden',
    },
    metadata: { category: 'agent_loop' },
    inputs,
    completion: { status: 'succeeded', outputs, error: null },
  },
  ...(['graph_node', 'model', 'verified_state'] as const).map((category, index) => ({
    id: `00000000-0000-4000-8000-${String(index + 2).padStart(12, '0')}`,
    traceId: rootId,
    parentRunId: rootId,
    name: `semantic:${category}`,
    runType: category === 'model' ? 'llm' as const : 'chain' as const,
    category,
    metadata: { category },
    inputs,
    completion: { status: 'succeeded' as const, outputs, error: null },
  })),
];
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function receipt(
  mode: 'text' | 'genui',
  repetition: number,
  model = runtime.model,
): Promise<VerifiedAgentTraceReceipt> {
  const slot = (mode === 'text' ? 0 : policy.repetitionsPerMode) + repetition;
  const modeRuns = structuredClone(captured);
  const ids = new Map(
    modeRuns.map((run, index) => [
      run.id,
      `${String(slot).padStart(8, '0')}-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    ]),
  );
  for (const run of modeRuns) {
    const id = ids.get(run.id);
    const traceId = ids.get(run.traceId);
    const parentRunId = run.parentRunId ? ids.get(run.parentRunId) : undefined;
    if (!id || !traceId || (run.parentRunId && !parentRunId)) {
      throw new Error('test_fixture_invalid');
    }
    run.id = id;
    run.traceId = traceId;
    run.parentRunId = parentRunId;
  }
  if (mode === 'genui') {
    modeRuns[0].applicability = {
      tool: 'forbidden',
      approval: 'forbidden',
      verifiedState: 'required',
      genui: 'required',
    };
    modeRuns.push({
      id: `${String(slot).padStart(8, '0')}-0000-4000-8000-000000000005`,
      traceId: modeRuns[0].traceId,
      parentRunId: modeRuns[0].id,
      name: 'genui_projection',
      runType: 'chain',
      category: 'genui_projection',
      metadata: { category: 'genui_projection' },
      inputs,
      completion: {
        status: 'succeeded',
        outputs: { ...outputs, genUiProjected: true },
        error: null,
      },
    });
  }
  const published = modeRuns.map((run, index) => ({
    id: run.id,
    trace_id: run.traceId,
    ...(run.parentRunId ? { parent_run_id: run.parentRunId } : {}),
    name: run.name,
    run_type: run.runType,
    start_time: 1_000 + index * 100,
    end_time: 1_050 + index * 100,
    extra: { metadata: run.metadata },
    inputs: run.inputs,
    outputs: run.completion.outputs,
  }));
  return verifyCapturedAgentTracePublication({
    apiUrl: 'https://apac.api.smith.langchain.com',
    projectName: 'private-apac-project',
    context: {
      executionId: '00000000-0000-4000-8000-000000000010',
      gitSha: 'd'.repeat(40),
      runtime: { ...runtime, model },
      policy,
      remoteDatasetId: '00000000-0000-4000-8000-000000000020',
      mode,
      repetition,
    },
    runs: modeRuns,
    client: {
      async readDataset() {
        return {
          id: '00000000-0000-4000-8000-000000000020',
          name: policy.dataset.name,
        };
      },
      async *listRuns(query) {
        const selected = new Set(query.id);
        for (const run of published) if (selected.has(run.id)) yield run;
      },
    },
    polling: {
      timeoutMs: 1,
      pollIntervalMs: 1,
      now: () => 0,
      sleep: async () => undefined,
    },
  });
}

async function artifacts() {
  const directory = await mkdtemp(join(tmpdir(), 'protected-trace-artifacts-'));
  temporaryDirectories.push(directory);
  const paths = {
    inventory: join(directory, 'inventory.json'),
    matrix: join(directory, 'matrix.json'),
    run: join(directory, 'run.json'),
    traceReadback: join(directory, 'trace-readback.json'),
  };
  await Promise.all(
    Object.entries(paths).map(([role, path]) => writeFile(path, `${role}\n`, 'utf8')),
  );
  return verifyProtectedProofArtifacts(paths);
}

function input(
  receipts: readonly VerifiedAgentTraceReceipt[],
  verifiedArtifacts: Awaited<ReturnType<typeof artifacts>>,
) {
  return {
    source: { gitSha: 'd'.repeat(40), dirty: false },
    runtime,
    policy,
    artifacts: verifiedArtifacts,
    receipts,
  };
}

async function completeReceipts(): Promise<VerifiedAgentTraceReceipt[]> {
  return Promise.all(
    policy.modes.flatMap((mode) =>
      Array.from(
        { length: policy.repetitionsPerMode },
        (_, index) => receipt(mode, index + 1),
      ),
    ),
  );
}

describe('protected command proof manifest', () => {
  it('derives one immutable campaign manifest from every issued receipt', async () => {
    const receipts = await completeReceipts();
    const receiptRunIds = receipts.flatMap((value) =>
      verifiedAgentTraceReceiptPayload(value).runs.map(({ id }) => id),
    );
    expect(new Set(receiptRunIds).size).toBe(receiptRunIds.length);
    const manifest = createProtectedCommandProofManifest(
      input(receipts, await artifacts()),
    );

    expect(manifest).toMatchObject({
      schemaVersion: 2,
      artifactKind: 'kfc-protected-command-proof-manifest',
      campaign: {
        receiptCount: 4,
        scenarioModeRuns: 4,
        turnEvaluations: 4,
      },
      target: {
        apiUrl: 'https://apac.api.smith.langchain.com',
        projectName: 'private-apac-project',
        remoteDatasetId: '00000000-0000-4000-8000-000000000020',
      },
      integrity: {
        algorithm: 'sha256',
        payloadDigest: expect.stringMatching(/^[0-9a-f]{64}$/u),
      },
    });
    expect(manifest.receipts).toHaveLength(4);
  });

  it('rejects missing, duplicate, foreign, or deserialized self-attested receipts', async () => {
    const receipts = await completeReceipts();
    const verifiedArtifacts = await artifacts();
    expect(() =>
      createProtectedCommandProofManifest(input(receipts.slice(1), verifiedArtifacts)),
    ).toThrow(
      'protected_command_proof_receipts_invalid',
    );
    expect(() =>
      createProtectedCommandProofManifest(
        input([receipts[0], receipts[0], receipts[2], receipts[3]], verifiedArtifacts),
      ),
    ).toThrow('protected_command_proof_receipts_invalid');

    const foreign = await receipt('text', 1, 'foreign-model');
    expect(() =>
      createProtectedCommandProofManifest(
        input([foreign, receipts[1], receipts[2], receipts[3]], verifiedArtifacts),
      ),
    ).toThrow('protected_command_proof_binding_mismatch');

    const clonedPayload = structuredClone(verifiedAgentTraceReceiptPayload(receipts[0]));
    expect(() =>
      createProtectedCommandProofManifest({
        ...input(receipts, verifiedArtifacts),
        receipts: [clonedPayload, ...receipts.slice(1)],
      }),
    ).toThrow('protected_command_proof_receipt_unverified');
  });

  it('writes once without leaking trace payloads or overwriting immutable proof', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'protected-trace-proof-'));
    temporaryDirectories.push(directory);
    const output = join(directory, 'manifest.json');
    const manifest = createProtectedCommandProofManifest(
      input(await completeReceipts(), await artifacts()),
    );

    await writeProtectedCommandProofManifest(output, manifest);

    const written = await readFile(output, 'utf8');
    expect(JSON.parse(written)).toEqual(manifest);
    expect(written).not.toContain('latestUserMessage');
    await expect(writeProtectedCommandProofManifest(output, manifest)).rejects.toThrow();
  });
});
