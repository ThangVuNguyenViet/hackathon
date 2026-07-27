import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { Client } from 'langsmith';
import {
  currentLiveQualityProtectedTracePolicy,
  deriveProtectedTraceCampaignDimensions,
  reviewProtectedTraceRuntimeIdentity,
} from '../src/evaluation/protectedTraceQualificationPolicy.js';
import { createLangSmithPublicationClient } from '../src/observability/langsmithAgentTracer.js';
import {
  createProtectedCommandProofManifest,
  verifyProtectedProofArtifacts,
  writeProtectedCommandProofManifest,
} from '../src/observability/protectedCommandProofManifest.js';
import {
  reverifyAgentTraceReceiptPayload,
  verifiedAgentTraceReceiptPayload,
} from '../src/observability/requiredAgentTracePublication.js';

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`protected_trace_qualification_missing:${name}`);
  return value;
}

function gitOutput(args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

async function runSlice(env: NodeJS.ProcessEnv): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(
      process.platform === 'win32' ? 'npx.cmd' : 'npx',
      [
        'vitest',
        'run',
        'test/scenarios/live-ai-scenario-replay.test.ts',
        '--maxConcurrency=1',
      ],
      { cwd: process.cwd(), env, stdio: 'inherit' },
    );
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`protected_trace_slice_failed:${code ?? 'signal'}`));
    });
  });
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  });
}

async function main(): Promise<void> {
  const outputDir = resolve(required('KFC_PROTECTED_TRACE_OUTPUT_DIR'));
  const apiKey = required('LANGSMITH_API_KEY');
  const apiUrl = required('LANGSMITH_ENDPOINT');
  const projectName = required('LANGSMITH_PROJECT');
  const remoteDatasetId = required('KFC_PROTECTED_TRACE_REMOTE_DATASET_ID');
  if (apiUrl !== 'https://apac.api.smith.langchain.com') {
    throw new Error('agent_required_trace_target_invalid');
  }
  const gitSha = gitOutput(['rev-parse', 'HEAD']);
  if (gitOutput(['status', '--porcelain'])) {
    throw new Error('protected_trace_qualification_requires_clean_sha');
  }
  const executionId = process.env.KFC_PROTECTED_TRACE_EXECUTION_ID?.trim() || randomUUID();
  const runtime = reviewProtectedTraceRuntimeIdentity({
    runtimeId: 'langgraph-stategraph-v1',
    provider: 'openai',
    model: process.env.OPENAI_TOOL_PLANNER_MODEL?.trim() || 'gpt-4.1-mini',
    profile: 'openai-v2-live-qualification',
  });

  await mkdir(dirname(outputDir), { recursive: true });
  await mkdir(outputDir);
  const receiptPaths: string[] = [];
  for (const mode of currentLiveQualityProtectedTracePolicy.modes) {
    for (
      let repetition = 1;
      repetition <= currentLiveQualityProtectedTracePolicy.repetitionsPerMode;
      repetition += 1
    ) {
      const receiptPath = join(outputDir, `receipt-${mode}-${repetition}.json`);
      receiptPaths.push(receiptPath);
      const childEnv: NodeJS.ProcessEnv = {
        ...process.env,
        RUN_LIVE_AI_SCENARIOS: '1',
        KFC_AGENT_BACKEND_URL: '',
        KFC_ARENA_SCENARIOS: '',
        KFC_LIVE_HIGH_RISK_REPETITIONS: '1',
        KFC_LIVE_SCENARIO_MODE: mode,
        KFC_PROTECTED_TRACE_RECEIPT_OUTPUT: receiptPath,
        KFC_PROTECTED_TRACE_EXECUTION_ID: executionId,
        KFC_PROTECTED_TRACE_GIT_SHA: gitSha,
        KFC_PROTECTED_TRACE_REMOTE_DATASET_ID: remoteDatasetId,
        KFC_PROTECTED_TRACE_REPETITION: String(repetition),
      };
      await runSlice(childEnv);
    }
  }

  const serializedReceipts = await Promise.all(
    receiptPaths.map(async (path) => JSON.parse(await readFile(path, 'utf8'))),
  );
  const client = createLangSmithPublicationClient(
    new Client({ apiKey, apiUrl, tracingSamplingRate: 1 }),
  );
  const receipts = [];
  for (const payload of serializedReceipts) {
    receipts.push(
      await reverifyAgentTraceReceiptPayload({
        payload,
        client,
        polling: {
          timeoutMs: 30_000,
          pollIntervalMs: 1_000,
          now: Date.now,
          sleep: (durationMs) =>
            new Promise((resolvePromise) => setTimeout(resolvePromise, durationMs)),
        },
      }),
    );
  }

  const inventoryPath = join(outputDir, 'inventory.json');
  const matrixPath = join(outputDir, 'matrix.json');
  const runPath = join(outputDir, 'run.json');
  const traceReadbackPath = join(outputDir, 'trace-readback.json');
  await writeJson(inventoryPath, currentLiveQualityProtectedTracePolicy.dataset);
  await writeJson(matrixPath, {
    policyId: currentLiveQualityProtectedTracePolicy.policyId,
    modes: currentLiveQualityProtectedTracePolicy.modes,
    repetitionsPerMode: currentLiveQualityProtectedTracePolicy.repetitionsPerMode,
    ...deriveProtectedTraceCampaignDimensions(currentLiveQualityProtectedTracePolicy),
  });
  await writeJson(runPath, {
    executionId,
    gitSha,
    runtime,
    receiptFiles: receiptPaths.map((path) => path.split('/').at(-1)),
  });
  await writeJson(
    traceReadbackPath,
    receipts.map(verifiedAgentTraceReceiptPayload),
  );
  const artifacts = await verifyProtectedProofArtifacts({
    inventory: inventoryPath,
    matrix: matrixPath,
    run: runPath,
    traceReadback: traceReadbackPath,
  });
  const manifest = createProtectedCommandProofManifest({
    source: { gitSha, dirty: false },
    runtime,
    policy: currentLiveQualityProtectedTracePolicy,
    artifacts,
    receipts,
  });
  const manifestPath = join(outputDir, 'protected-command-proof-manifest.json');
  await writeProtectedCommandProofManifest(manifestPath, manifest);
  process.stdout.write(`${manifestPath}\n`);
}

await main();
