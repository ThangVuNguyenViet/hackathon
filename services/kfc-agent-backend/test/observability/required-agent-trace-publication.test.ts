import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ProtectedTraceQualificationPolicy } from '../../src/evaluation/protectedTraceQualificationPolicy.js';
import {
  LangSmithAgentTracer,
  type LangSmithRunConfig,
  type LangSmithRunLike,
} from '../../src/observability/langsmithAgentTracer.js';
import {
  isVerifiedAgentTraceReceipt,
  reverifyAgentTraceReceiptPayload,
  verifiedAgentTraceReceiptPayload,
  writeVerifiedAgentTraceReceipt,
  type RequiredAgentTracePublicationClient,
} from '../../src/observability/requiredAgentTracePublication.js';

const APAC_ENDPOINT = 'https://apac.api.smith.langchain.com';
const rootId = '00000000-0000-4000-8000-000000000001';
let nextId = 2;

const policy: ProtectedTraceQualificationPolicy = {
  policyId: 'test-policy-v1',
  dataset: {
    name: 'private-test-dataset',
    schemaVersion: 'test-schema-v1',
    inventoryVersion: 'test-inventory-v1',
    inventoryDigest: 'a'.repeat(64),
    sourcePath: 'test/scenarios/test-ledger.ts',
    scenarioCount: 1,
    turnCount: 1,
    caseCount: 2,
  },
  modes: ['genui'],
  repetitionsPerMode: 1,
  costPolicy: 'provider_reported_or_unavailable',
};

interface PersistedRun {
  id: string;
  trace_id: string;
  parent_run_id?: string;
  name: string;
  run_type: string;
  start_time: number;
  end_time: number;
  extra: { metadata: Record<string, unknown> };
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
  error?: string;
}

class FakeRun implements LangSmithRunLike {
  readonly children: FakeRun[] = [];
  readonly id: string;
  readonly trace_id: string;
  readonly parent_run_id?: string;
  outputs: Record<string, unknown> = {};
  error?: string;

  constructor(
    readonly config: LangSmithRunConfig,
    parent?: FakeRun,
    id = parent ? `00000000-0000-4000-8000-${String(nextId++).padStart(12, '0')}` : rootId,
  ) {
    this.id = id;
    this.trace_id = parent?.trace_id ?? id;
    this.parent_run_id = parent?.id;
  }

  createChild(config: LangSmithRunConfig): LangSmithRunLike {
    const child = new FakeRun(config, this);
    this.children.push(child);
    return child;
  }

  async postRun(): Promise<void> {}
  async end(outputs?: Record<string, unknown>, error?: string): Promise<void> {
    this.outputs = outputs ?? {};
    this.error = error;
  }
  async patchRun(): Promise<void> {}
}

function flatten(run: FakeRun): FakeRun[] {
  return [run, ...run.children.flatMap(flatten)];
}

function persisted(run: FakeRun, index: number): PersistedRun {
  return {
    id: run.id,
    trace_id: run.trace_id,
    ...(run.parent_run_id ? { parent_run_id: run.parent_run_id } : {}),
    name: run.config.name,
    run_type: run.config.run_type ?? 'chain',
    start_time: 1_000 + index * 100,
    end_time: 1_050 + index * 100,
    extra: { metadata: structuredClone(run.config.metadata ?? {}) },
    inputs: structuredClone(run.config.inputs ?? {}),
    outputs: structuredClone(run.outputs),
    ...(run.error ? { error: run.error } : {}),
  };
}

function requiredOptions(input: {
  roots: FakeRun[];
  client: RequiredAgentTracePublicationClient;
  flush?: () => Promise<void>;
}) {
  return {
    projectName: 'private-apac-project',
    apiUrl: APAC_ENDPOINT,
    samplingRate: 1,
    createRoot(config: LangSmithRunConfig) {
      const root = new FakeRun(config);
      input.roots.push(root);
      return root;
    },
    flush: input.flush ?? (async () => undefined),
    requiredProof: {
      context: {
        executionId: '00000000-0000-4000-8000-000000000010',
        gitSha: 'b'.repeat(40),
        runtime: {
          runtimeId: 'langgraph-stategraph-v1',
          provider: 'openai' as const,
          model: 'gpt-4.1-mini',
          profile: 'openai-qualification',
        },
        policy,
        remoteDatasetId: '00000000-0000-4000-8000-000000000020',
        mode: 'genui' as const,
        repetition: 1,
      },
      publicationClient: input.client,
      polling: {
        timeoutMs: 20,
        pollIntervalMs: 5,
        now: (() => {
          let now = 0;
          return () => now++;
        })(),
        sleep: async () => undefined,
      },
    },
  };
}

async function completeRequiredTrace(tracer: LangSmithAgentTracer): Promise<void> {
  const root = await tracer.startTurn({
    name: 'agent_turn',
    category: 'agent_loop',
    applicability: {
      tool: 'required',
      approval: 'required',
      verifiedState: 'required',
      genui: 'required',
    },
    inputs: { latestUserMessage: 'private customer prompt' },
    metadata: { scenarioId: 'scenario-01', executionId: 'ignored-caller-value' },
  });
  for (const [name, runType, category] of [
    ['context_load', 'chain', 'graph_node'],
    ['provider_attempt', 'llm', 'model'],
    ['tool_call:placeOrder', 'tool', 'tool'],
    ['approval_interrupt', 'chain', 'approval'],
    ['state_update', 'chain', 'verified_state'],
    ['genui_projection', 'chain', 'genui_projection'],
  ] as const) {
    const span = await root.startSpan({
      name,
      runType,
      category,
      inputs: {
        toolName: category === 'tool' ? 'placeOrder' : undefined,
        arguments: { phone: '+84-secret' },
      },
    });
    await span.end(
      category === 'model'
        ? {
            privateGeneration: 'secret response',
            usageMetadata: { inputTokens: 12, outputTokens: 4, totalTokens: 16 },
            costMetadata: { currency: 'USD', amountUsd: 0.0042 },
          }
        : category === 'genui_projection'
          ? { genUiKind: 'order_summary', privateState: 'secret state' }
          : { privateResult: 'secret result' },
    );
  }
  await root.end({ status: 'completed', privateTranscript: 'secret transcript' });
}

describe('required LangSmith trace publication', () => {
  it('flushes, polls exact SDK run IDs, and issues one opaque verifier receipt', async () => {
    nextId = 2;
    const roots: FakeRun[] = [];
    let flushed = false;
    let attempts = 0;
    const client: RequiredAgentTracePublicationClient = {
      async readDataset() {
        return {
          id: policy.dataset.name === 'private-test-dataset'
            ? '00000000-0000-4000-8000-000000000020'
            : '',
          name: policy.dataset.name,
        };
      },
      async *listRuns(query) {
        attempts += 1;
        expect(flushed).toBe(true);
        expect(query.projectName).toBe('private-apac-project');
        expect(query.limit).toBe(query.id.length);
        if (attempts === 1) return;
        const selected = new Set(query.id);
        for (const [index, run] of roots.flatMap(flatten).entries()) {
          if (selected.has(run.id)) yield persisted(run, index);
        }
      },
    };
    const tracer = new LangSmithAgentTracer(
      requiredOptions({
        roots,
        client,
        flush: async () => {
          flushed = true;
        },
      }),
    );

    await completeRequiredTrace(tracer);
    await tracer.flush();
    const receipt = tracer.requiredProofReceipt();
    const payload = verifiedAgentTraceReceiptPayload(receipt);

    expect(attempts).toBe(2);
    expect(isVerifiedAgentTraceReceipt(receipt)).toBe(true);
    expect(isVerifiedAgentTraceReceipt(structuredClone(payload))).toBe(false);
    expect(payload).toMatchObject({
      target: { apiUrl: APAC_ENDPOINT, projectName: 'private-apac-project' },
      context: {
        runtime: { provider: 'openai', model: 'gpt-4.1-mini' },
        mode: 'genui',
        repetition: 1,
      },
      publication: {
        queryAttempts: 2,
        flushVerified: true,
        datasetReadbackVerified: true,
        readbackVerified: true,
      },
      evidence: {
        latency: { totalMs: 50, modelMs: 50, toolMs: 50 },
        providerEconomics: {
          usage: { status: 'reported', totalTokens: 16 },
          cost: { status: 'reported', currency: 'USD', amountUsd: 0.0042 },
        },
      },
    });
    expect(payload.runs).toHaveLength(7);
    expect(JSON.stringify(payload)).not.toContain('secret');
    expect(JSON.stringify(roots.map((root) => root.config))).not.toContain(
      'private customer prompt',
    );

    const directory = await mkdtemp(join(tmpdir(), 'verified-trace-receipt-'));
    const output = join(directory, 'receipt.json');
    try {
      await writeVerifiedAgentTraceReceipt(output, receipt);
      const serialized = JSON.parse(await readFile(output, 'utf8'));
      expect(serialized).toEqual(payload);
      const reverified = await reverifyAgentTraceReceiptPayload({
        payload: serialized,
        client,
        polling: {
          timeoutMs: 1,
          pollIntervalMs: 1,
          now: () => 0,
          sleep: async () => undefined,
        },
      });
      expect(isVerifiedAgentTraceReceipt(reverified)).toBe(true);
      await expect(writeVerifiedAgentTraceReceipt(output, receipt)).rejects.toThrow();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('fails closed when a conditionally required category is absent', async () => {
    nextId = 2;
    const roots: FakeRun[] = [];
    const client: RequiredAgentTracePublicationClient = {
      async readDataset() {
        return {
          id: policy.dataset.name === 'private-test-dataset'
            ? '00000000-0000-4000-8000-000000000020'
            : '',
          name: policy.dataset.name,
        };
      },
      async *listRuns(query) {
        const selected = new Set(query.id);
        for (const [index, run] of roots.flatMap(flatten).entries()) {
          if (selected.has(run.id)) yield persisted(run, index);
        }
      },
    };
    const tracer = new LangSmithAgentTracer(requiredOptions({ roots, client }));
    const root = await tracer.startTurn({
      name: 'agent_turn',
      category: 'agent_loop',
      applicability: {
        tool: 'required',
        approval: 'forbidden',
        verifiedState: 'required',
        genui: 'forbidden',
      },
      inputs: {},
    });
    for (const category of ['graph_node', 'model', 'verified_state'] as const) {
      const span = await root.startSpan({
        name: `semantic:${category}`,
        runType: category === 'model' ? 'llm' : 'chain',
        category,
        inputs: {},
      });
      await span.end();
    }
    await root.end();

    await expect(tracer.flush()).rejects.toThrow(
      'agent_required_trace_categories_invalid',
    );
  });

  it('rejects required proof outside the exact APAC target and sampling policy', () => {
    const client: RequiredAgentTracePublicationClient = {
      async readDataset() {
        return {
          id: policy.dataset.name === 'private-test-dataset'
            ? '00000000-0000-4000-8000-000000000020'
            : '',
          name: policy.dataset.name,
        };
      },
      async *listRuns() {},
    };
    expect(
      () =>
        new LangSmithAgentTracer({
          ...requiredOptions({ roots: [], client }),
          apiUrl: 'https://api.smith.langchain.com',
        }),
    ).toThrow('agent_required_trace_target_invalid');
    expect(
      () =>
        new LangSmithAgentTracer({
          ...requiredOptions({ roots: [], client }),
          samplingRate: 0.5,
        }),
    ).toThrow('agent_required_trace_target_invalid');
  });
});
