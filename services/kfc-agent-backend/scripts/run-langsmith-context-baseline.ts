import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { Client, RunTree } from 'langsmith';
import { DashboardEventBus } from '../src/dashboard/eventBus.js';
import type { Cart, ConversationTurn } from '../src/domain/types.js';
import { runAgentTurn, type AgentTurnOutput } from '../src/graph/buildGraph.js';
import type { AgentGraphState } from '../src/graph/state.js';
import { OpenAIResponseComposer, type ResponseComposer, type ResponseComposerInput } from '../src/llm/responseComposer.js';
import { OpenAIToolPlanner, type ToolPlanner, type ToolPlannerInput, type ToolPlannerOutput } from '../src/llm/toolPlanner.js';
import { loadGeneratedFixtures } from '../src/fixtures/loadFixtures.js';
import { createMockClients } from '../src/mock/createMockClients.js';
import type { ToolTraceEntry } from '../src/ordering/types.js';
import { MemoryStore } from '../src/persistence/memoryStore.js';

const plannerPromptVersion = 'openai-tool-planner-inline-2026-07-10';
const composerPromptVersion = 'openai-response-composer-inline-2026-07-10';
const projectName = process.env["LANGSMITH_PROJECT"] ?? 'kfc-agent-backend-local';
const reportPath = resolve(
  process.cwd(),
  '../../.scratch/langsmith-context-prompt-optimization-wayfinder/assets/02-langsmith-baseline-trace-report.json',
);

interface TurnReport {
  name: string;
  inputText: string;
  responseText: string;
  replyIntent: string;
  toolNames: string[];
  cartItemNames: string[];
  stateSummary: Record<string, unknown>;
}

class LangSmithRecordingToolPlanner implements ToolPlanner {
  readonly supportsMultiStep = true;
  private iteration = 0;

  constructor(
    private readonly delegate: ToolPlanner,
    private readonly parentRun: RunTree,
    private readonly turnName: string,
  ) {}

  async plan(input: ToolPlannerInput): Promise<ToolPlannerOutput> {
    this.iteration += 1;
    const run = this.parentRun.createChild({
      name: `${this.turnName}: planner iteration ${this.iteration}`,
      run_type: 'llm',
      inputs: {
        promptVersion: plannerPromptVersion,
        latestUserMessage: input.state.latestUserMessage,
        recentTurns: summarizeTurns(input.recentTurns),
        state: summarizeState(input.state),
        availableTools: input.availableTools,
      },
      metadata: {
        promptVersion: plannerPromptVersion,
        component: 'OpenAIToolPlanner',
        turnName: this.turnName,
      },
      tags: ['kfc-context-baseline', 'planner'],
    });
    await run.postRun();

    try {
      const output = await this.delegate.plan(input);
      await run.end({
        intent: output.intent,
        entities: output.entities,
        toolCalls: output.toolCalls,
        responseClaims: output.responseClaims,
        directResponse: output.directResponse,
      });
      await run.patchRun();
      return output;
    } catch (error) {
      await run.end(undefined, error instanceof Error ? error.stack ?? error.message : String(error));
      await run.patchRun();
      throw error;
    }
  }
}

class LangSmithRecordingResponseComposer implements ResponseComposer {
  constructor(
    private readonly delegate: ResponseComposer,
    private readonly parentRun: RunTree,
    private readonly turnName: string,
  ) {}

  async composeResponse(input: ResponseComposerInput): Promise<string> {
    const run = this.parentRun.createChild({
      name: `${this.turnName}: response composer`,
      run_type: 'llm',
      inputs: {
        promptVersion: composerPromptVersion,
        latestUserMessage: input.state.latestUserMessage,
        recentTurns: summarizeTurns(input.state.recentTurns ?? []),
        replyIntent: input.replyIntent,
        verifiedFallback: input.fallbackText,
        state: summarizeState(input.state),
        toolTrace: summarizeToolTrace(input.state.toolTrace ?? []),
      },
      metadata: {
        promptVersion: composerPromptVersion,
        component: 'OpenAIResponseComposer',
        turnName: this.turnName,
      },
      tags: ['kfc-context-baseline', 'composer'],
    });
    await run.postRun();

    try {
      const output = await this.delegate.composeResponse(input);
      await run.end({ responseText: output });
      await run.patchRun();
      return output;
    } catch (error) {
      await run.end(undefined, error instanceof Error ? error.stack ?? error.message : String(error));
      await run.patchRun();
      throw error;
    }
  }
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function summarizeTurns(turns: ConversationTurn[]): Array<Record<string, unknown>> {
  return turns.map((turn) => ({
    role: turn.role,
    text: turn.text,
    deliveryStatus: turn.deliveryStatus,
    createdAt: turn.createdAt,
  }));
}

function summarizeCart(cart: Cart | undefined): Record<string, unknown> | undefined {
  if (!cart) return undefined;
  return {
    id: cart.id,
    itemCount: cart.items.length,
    items: cart.items.map((item) => ({
      itemCode: item.itemCode,
      name: item.name,
      quantity: item.quantity,
      unitPriceVnd: item.unitPriceVnd,
    })),
    totalVnd: cart.totalVnd,
    voucherCode: cart.voucherCode,
  };
}

function summarizeToolTrace(entries: ToolTraceEntry[]): Array<Record<string, unknown>> {
  return entries.map((entry) => ({
    toolName: entry.toolName,
    arguments: entry.arguments,
    ok: entry.ok,
    resultSummary: entry.resultSummary,
    provenance: entry.provenance,
  }));
}

function summarizeState(state: AgentGraphState): Record<string, unknown> {
  return {
    sessionId: state.sessionId,
    customerId: state.customerId,
    channel: state.channel,
    latestUserMessage: state.latestUserMessage,
    intent: state.intent,
    cart: summarizeCart(state.cart),
    orderId: state.order?.id,
    orderStatus: state.order?.status,
    paymentAttempt: state.paymentAttempt,
    fulfillment: state.fulfillment,
    menuSearchResultCount: state.menuSearchResults?.length ?? 0,
    escalationReasons: state.escalationReasons,
    currentToolNames: state.toolTrace?.map((entry) => entry.toolName) ?? [],
    retrievedEvidenceCount: state.retrievedEvidence.length,
  };
}

async function emitToolRuns(parentRun: RunTree, turnName: string, entries: ToolTraceEntry[]): Promise<void> {
  for (const [index, entry] of entries.entries()) {
    const run = parentRun.createChild({
      name: `${turnName}: tool ${index + 1} ${entry.toolName}`,
      run_type: 'tool',
      inputs: {
        toolName: entry.toolName,
        arguments: entry.arguments,
      },
      metadata: {
        component: 'executeToolCall',
        turnName,
        ok: entry.ok,
      },
      tags: ['kfc-context-baseline', 'tool'],
    });
    await run.postRun();
    await run.end({
      ok: entry.ok,
      resultSummary: entry.resultSummary,
      provenance: entry.provenance,
    });
    await run.patchRun();
  }
}

async function runTracedTurn(input: {
  name: string;
  text: string;
  parentRun: RunTree;
  sessionId: string;
  customerId: string;
  store: MemoryStore;
  dashboard: DashboardEventBus;
  clients: ReturnType<typeof createMockClients>;
  planner: ToolPlanner;
  composer: ResponseComposer;
  previousToolTraceLength: number;
}): Promise<{ output: AgentTurnOutput; report: TurnReport; currentTurnToolTrace: ToolTraceEntry[] }> {
  const output = await runAgentTurn({
    sessionId: input.sessionId,
    customerId: input.customerId,
    channel: 'kfc',
    text: input.text,
    clients: input.clients,
    store: input.store,
    dashboard: input.dashboard,
    toolPlanner: new LangSmithRecordingToolPlanner(input.planner, input.parentRun, input.name),
    responseComposer: new LangSmithRecordingResponseComposer(input.composer, input.parentRun, input.name),
  });
  const fullToolTrace = output.state.toolTrace ?? [];
  const currentTurnToolTrace = fullToolTrace.slice(input.previousToolTraceLength);
  await emitToolRuns(input.parentRun, input.name, currentTurnToolTrace);

  return {
    output,
    currentTurnToolTrace,
    report: {
      name: input.name,
      inputText: input.text,
      responseText: output.responseText,
      replyIntent: output.replyIntent,
      toolNames: currentTurnToolTrace.map((entry) => entry.toolName),
      cartItemNames: output.state.cart?.items.map((item) => item.name) ?? [],
      stateSummary: summarizeState(output.state),
    },
  };
}

requireEnv('OPENAI_API_KEY');
requireEnv('LANGSMITH_API_KEY');
process.env["LANGSMITH_TRACING"] = 'true';

const fixtures = await loadGeneratedFixtures(process.cwd());
const clients = createMockClients(fixtures);
const store = new MemoryStore();
const dashboard = new DashboardEventBus();
const sessionId = `langsmith_context_baseline_${Date.now()}`;
const customerId = 'langsmith_context_customer';
const planner = new OpenAIToolPlanner({
  apiKey: requireEnv('OPENAI_API_KEY'),
  model: process.env["OPENAI_TOOL_PLANNER_MODEL"]?.trim() || process.env["OPENAI_MODEL"]?.trim() || 'gpt-4.1-mini',
  baseUrl: process.env["OPENAI_BASE_URL"],
});
const composer = new OpenAIResponseComposer({
  apiKey: requireEnv('OPENAI_API_KEY'),
  model: process.env["OPENAI_RESPONSE_MODEL"]?.trim() || process.env["OPENAI_MODEL"]?.trim() || 'gpt-4.1-mini',
  baseUrl: process.env["OPENAI_BASE_URL"],
});
const client = new Client();

const rootRun = new RunTree({
  name: 'kfc-langsmith-context-baseline',
  run_type: 'chain',
  project_name: projectName,
  inputs: {
    sessionId,
    customerId,
    purpose: 'Baseline prompt/context trace for stale-cart greeting investigation.',
    turns: [
      'Cho mình 1 Combo Hợp Gu 99K',
      'hi',
    ],
  },
  metadata: {
    project: projectName,
    scenario: 'stale-cart-greeting',
    plannerPromptVersion,
    composerPromptVersion,
  },
  tags: ['kfc-context-baseline', 'stale-cart-greeting'],
});

await rootRun.postRun();

try {
  const orderTurn = await runTracedTurn({
    name: 'baseline order turn',
    text: 'Cho mình 1 Combo Hợp Gu 99K',
    parentRun: rootRun,
    sessionId,
    customerId,
    store,
    dashboard,
    clients,
    planner,
    composer,
    previousToolTraceLength: 0,
  });
  const greetingTurn = await runTracedTurn({
    name: 'stale cart greeting turn',
    text: 'hi',
    parentRun: rootRun,
    sessionId,
    customerId,
    store,
    dashboard,
    clients,
    planner,
    composer,
    previousToolTraceLength: orderTurn.output.state.toolTrace?.length ?? 0,
  });

  const transcript = await store.listTurns(sessionId);
  const report = {
    generatedAt: new Date().toISOString(),
    projectName,
    projectUrl: await client.getProjectUrl({ projectName }).catch(() => null),
    sessionId,
    customerId,
    promptVersions: {
      planner: plannerPromptVersion,
      composer: composerPromptVersion,
    },
    turns: [orderTurn.report, greetingTurn.report],
    transcript: summarizeTurns(transcript),
    dashboardEventTypes: dashboard.getEvents(sessionId).map((event) => event.type),
    notes: [
      'Full API key values are intentionally omitted.',
      'Tool runs are emitted from current-turn toolTrace after runAgentTurn completes.',
      'This trace is a baseline evidence artifact, not a production instrumentation design.',
    ],
  };

  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  await rootRun.end({
    reportPath,
    orderTurn: orderTurn.report,
    greetingTurn: greetingTurn.report,
  });
  await rootRun.patchRun();
  await client.awaitPendingTraceBatches();

  console.log(
    JSON.stringify(
      {
        ok: true,
        projectName,
        projectUrl: report.projectUrl,
        sessionId,
        reportPath,
        orderTurnTools: orderTurn.report.toolNames,
        greetingTurnTools: greetingTurn.report.toolNames,
        greetingResponseText: greetingTurn.report.responseText,
      },
      null,
      2,
    ),
  );
} catch (error) {
  await rootRun.end(undefined, error instanceof Error ? error.stack ?? error.message : String(error));
  await rootRun.patchRun();
  throw error;
}
