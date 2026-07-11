import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { Client, RunTree } from 'langsmith';
import { evaluate } from 'langsmith/evaluation';
import { DashboardEventBus } from '../src/dashboard/eventBus.js';
import { contextEvalDatasetName } from '../src/evaluation/contextEvalCases.js';
import {
  createContextExperimentEvaluator,
  createContextExperimentTarget,
} from '../src/evaluation/contextLangsmithExperiment.js';
import { loadGeneratedFixtures } from '../src/fixtures/loadFixtures.js';
import { runAgentTurn } from '../src/graph/buildGraph.js';
import { OpenAIResponseComposer } from '../src/llm/responseComposer.js';
import { OpenAIToolPlanner } from '../src/llm/toolPlanner.js';
import { createMockClients } from '../src/mock/createMockClients.js';
import { LangSmithAgentTracer } from '../src/observability/langsmithAgentTracer.js';
import { MemoryStore } from '../src/persistence/memoryStore.js';
import {
  agenticProofScoreKeys,
  buildAgenticProofManifest,
  validateAgenticProofPrerequisites,
  writeAgenticProofArtifacts,
  type AgenticProofAssertion,
  type AgenticProofCheckout,
  type AgenticProofScores,
} from '../src/proof/langsmithAgenticProof.js';

const generatedAt = new Date().toISOString();
const scenarioId = `kfc-agentic-demo-${generatedAt.replace(/[:.]/g, '-')}`;
const projectName = process.env.LANGSMITH_PROJECT?.trim() || 'kfc-agentic-proof';
const apiUrl = process.env.LANGSMITH_ENDPOINT?.trim();
const openAiApiKey = process.env.OPENAI_API_KEY?.trim();
const langSmithApiKey = process.env.LANGSMITH_API_KEY?.trim();
validateAgenticProofPrerequisites({ openAiApiKey, langSmithApiKey });

function git(repoRoot: string, args: string[]): string {
  return execFileSync('git', ['-C', repoRoot, ...args], { encoding: 'utf8' }).trim();
}

function checkoutIdentity(repoRoot: string): AgenticProofCheckout {
  const status = git(repoRoot, ['status', '--porcelain']);
  return {
    commit: git(repoRoot, ['rev-parse', 'HEAD']),
    branch: git(repoRoot, ['branch', '--show-current']) || 'detached',
    dirty: status.length > 0,
    changedPaths: status
      .split('\n')
      .filter(Boolean)
      .map((line) => line.slice(3).trim())
      .sort(),
  };
}

function scoreValue(value: unknown): number {
  return value === true || value === 1 ? 1 : 0;
}

const repoRoot = resolve(process.cwd(), '../..');
const checkout = checkoutIdentity(repoRoot);
const fixtures = await loadGeneratedFixtures(process.cwd());
const clients = createMockClients(fixtures, {
  fulfillmentQuoteProvider: async () => ({
    ok: true,
    value: { feeVnd: 18_000, etaMinutes: 30 },
    message: 'Deterministic demo fulfillment quote',
  }),
});
const store = new MemoryStore();
const dashboard = new DashboardEventBus();
const client = new Client({ apiKey: langSmithApiKey, apiUrl });
const planner = new OpenAIToolPlanner({
  apiKey: openAiApiKey!,
  baseUrl: process.env.OPENAI_BASE_URL,
  model: process.env.OPENAI_TOOL_PLANNER_MODEL?.trim() || process.env.OPENAI_MODEL?.trim() || 'gpt-4.1-mini',
});
const composer = new OpenAIResponseComposer({
  apiKey: openAiApiKey!,
  baseUrl: process.env.OPENAI_BASE_URL,
  model: process.env.OPENAI_RESPONSE_MODEL?.trim() || process.env.OPENAI_MODEL?.trim() || 'gpt-4.1-mini',
});

const scriptedTurns = [
  'Cho mình 1 Combo Hợp Gu 99K.',
  'Bỏ món đó.',
  'Bỏ Combo Hợp Gu 99K.',
  'Cho mình 1 Combo Hợp Gu 99K, giao đến 12 Nguyễn Hữu Thọ, Quận 7, TP Hồ Chí Minh.',
  'Xác nhận đơn và thanh toán bằng ZaloPay.',
  'Tôi muốn gặp nhân viên về đơn này.',
] as const;

const scenarioRun = new RunTree({
  name: 'kfc-agentic-demo-scenario',
  run_type: 'chain',
  project_name: projectName,
  client,
  inputs: { scenarioId, scriptedTurns },
  metadata: { ...checkout, scenarioId, schemaVersion: 'kfc-agentic-langsmith-proof-v1' },
  tags: ['kfc-agentic-proof', `scenario:${scenarioId}`],
});
await scenarioRun.postRun();

const tracer = new LangSmithAgentTracer({
  projectName,
  createRoot: (config) => scenarioRun.createChild(config),
  flush: () => client.awaitPendingTraceBatches(),
});
const sessionId = `kfc:${scenarioId}`;
const customerId = 'langsmith_agentic_demo_customer';
const turnReports: Array<{
  index: number;
  responseText: string;
  replyIntent: string;
  toolNames: string[];
  cartItemCodes: string[];
  orderId: string | null;
  handoffId: string | null;
}> = [];
let previousToolTraceLength = 0;

for (const [offset, text] of scriptedTurns.entries()) {
  const output = await runAgentTurn({
    sessionId,
    customerId,
    channel: 'kfc',
    text,
    clients,
    store,
    dashboard,
    toolPlanner: planner,
    responseComposer: composer,
    tracer,
    externalMessageId: `${scenarioId}-turn-${offset + 1}`,
    metadata: { rawEvent: { scenarioId, scriptedTurn: offset + 1 } },
  });
  await tracer.flush();
  const fullTrace = output.state.toolTrace ?? [];
  const toolNames = fullTrace.slice(previousToolTraceLength).map((entry) => entry.toolName);
  previousToolTraceLength = fullTrace.length;
  turnReports.push({
    index: offset + 1,
    responseText: output.responseText,
    replyIntent: output.replyIntent,
    toolNames,
    cartItemCodes: output.state.cart?.items.map((item) => item.itemCode) ?? [],
    orderId: output.state.order?.id ?? null,
    handoffId: output.state.handoff?.escalationId ?? null,
  });
}

const assertions: AgenticProofAssertion[] = [
  {
    name: 'concrete-item-added',
    passed: turnReports[0]?.cartItemCodes.includes('20751') === true,
    detail: `tools=${turnReports[0]?.toolNames.join(',') ?? ''}`,
  },
  {
    name: 'ambiguous-removal-blocked',
    passed:
      turnReports[1]?.replyIntent === 'ask_clarification' &&
      turnReports[1]?.cartItemCodes.includes('20751') === true &&
      !turnReports[1]?.toolNames.includes('updateCart'),
    detail: `intent=${turnReports[1]?.replyIntent ?? 'missing'} tools=${turnReports[1]?.toolNames.join(',') ?? ''}`,
  },
  {
    name: 'named-removal-executed',
    passed: turnReports[2]?.cartItemCodes.length === 0 && turnReports[2]?.toolNames.includes('updateCart') === true,
    detail: `tools=${turnReports[2]?.toolNames.join(',') ?? ''}`,
  },
  {
    name: 'fulfillment-verified',
    passed:
      turnReports[3]?.cartItemCodes.includes('20751') === true &&
      turnReports[3]?.toolNames.some((name) => ['findStores', 'quoteFulfillment'].includes(name)) === true,
    detail: `tools=${turnReports[3]?.toolNames.join(',') ?? ''}`,
  },
  {
    name: 'confirmed-order-created',
    passed: Boolean(turnReports[4]?.orderId) && turnReports[4]?.toolNames.includes('placeOrder') === true,
    detail: `orderId=${turnReports[4]?.orderId ?? 'missing'} tools=${turnReports[4]?.toolNames.join(',') ?? ''}`,
  },
  {
    name: 'explicit-human-handoff',
    passed: Boolean(turnReports[5]?.handoffId) && turnReports[5]?.toolNames.includes('handoff') === true,
    detail: `handoffId=${turnReports[5]?.handoffId ?? 'missing'} tools=${turnReports[5]?.toolNames.join(',') ?? ''}`,
  },
];

await scenarioRun.end({ scenarioId, assertions, turns: turnReports });
await scenarioRun.patchRun();
await client.awaitPendingTraceBatches();
const traceUrl = await client.getRunUrl({ runId: scenarioRun.id });

const experimentResults = await evaluate(
  createContextExperimentTarget({
    fixtures,
    mode: 'live',
    openAiApiKey,
    openAiBaseUrl: process.env.OPENAI_BASE_URL,
    openAiPlannerModel: process.env.OPENAI_TOOL_PLANNER_MODEL,
    openAiComposerModel: process.env.OPENAI_RESPONSE_MODEL,
  }),
  {
    data: contextEvalDatasetName,
    client,
    evaluators: [createContextExperimentEvaluator()],
    experimentPrefix: 'kfc-agentic-proof-context',
    description: 'Agentic demo proof and context evaluation from one checkout snapshot.',
    metadata: { ...checkout, scenarioId, schemaVersion: 'kfc-agentic-langsmith-proof-v1', mode: 'live' },
    maxConcurrency: 1,
  },
);

const scoreTotals = Object.fromEntries(
  agenticProofScoreKeys.map((key) => [key, { passed: 0, total: 0 }]),
) as Record<(typeof agenticProofScoreKeys)[number], { passed: number; total: number }>;
for (const row of experimentResults.results) {
  for (const key of agenticProofScoreKeys) {
    const result = row.evaluationResults.results.find((entry) => entry.key === key);
    scoreTotals[key].total += 1;
    scoreTotals[key].passed += scoreValue(result?.score ?? result?.value);
  }
}
const scores = Object.fromEntries(
  agenticProofScoreKeys.map((key) => [
    key,
    scoreTotals[key].total === 0 ? 0 : scoreTotals[key].passed / scoreTotals[key].total,
  ]),
) as AgenticProofScores;
const experimentName = experimentResults.experimentName;
const experimentUrl = await client.getProjectUrl({ projectName: experimentName });

const manifest = buildAgenticProofManifest({
  generatedAt,
  checkout,
  scenario: {
    id: scenarioId,
    traceUrl,
    turnCount: scriptedTurns.length,
    assertions,
  },
  experiment: {
    name: experimentName,
    url: experimentUrl,
    caseCount: experimentResults.results.length,
    scores,
  },
});
const artifacts = await writeAgenticProofArtifacts({
  outputRoot: resolve(repoRoot, 'artifacts/langsmith-agentic-proof'),
  manifest,
});

const failedAssertions = assertions.filter((assertion) => !assertion.passed);
const failedScores = agenticProofScoreKeys.filter((key) => scores[key] !== 1);
const ok = failedAssertions.length === 0 && experimentResults.results.length === 14 && failedScores.length === 0;
console.log(JSON.stringify({ ok, traceUrl, experimentName, experimentUrl, scores, assertions, ...artifacts }, null, 2));
if (!ok) process.exitCode = 1;
