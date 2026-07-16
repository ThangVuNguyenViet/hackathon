import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { Order } from '../../src/domain/types.js';
import type { KfcGenUiWidgetKind } from '../../src/genui/kfcGenUi.js';
import { OpenAIResponseComposer } from '../../src/llm/responseComposer.js';
import { OpenAIToolPlanner, StaticToolPlanner, type ToolPlanner, type ToolPlannerInput, type ToolPlannerOutput } from '../../src/llm/toolPlanner.js';
import { runScenario } from '../../src/scenarios/runner.js';
import { loadBundledGeneratedFixtures } from '../../src/fixtures/bundledFixtures.js';
import { loadScenarioScript } from '../../src/scenarios/scenarioScript.js';
import type { ToolName, ToolTraceEntry } from '../../src/ordering/types.js';
import { liveScenarioFixtures } from './liveScenarioFixtures.js';
import {
  liveScenarioCases,
  type LiveScenarioCase,
  type TurnExpectation,
  unexpectedScenarioTools,
} from './scenarioCoverageLedger.js';
import { controlledCustomerAccess } from '../fixtures/controlledCustomerAccess.js';
import { assertScenarioSemanticClaims } from './scenarioSemanticOracle.js';

const scenariosRoot = join(process.cwd(), '../../ai-talent-tracks/fnb/conversations');
const modifierPickerScenarioPath = join(process.cwd(), 'test/scenarios/fixtures/modifier-picker-live-ai.json');
const liveRequested = process.env.RUN_LIVE_AI_SCENARIOS === '1';
const deployedBackendUrl = process.env.KFC_AGENT_BACKEND_URL?.trim().replace(/\/$/, '');
const deployedBranchOutput = process.env.KFC_LIVE_SCENARIO_BRANCH_OUTPUT?.trim();
const proofAdminToken = process.env.KFC_PROOF_ADMIN_TOKEN?.trim();
const openAiApiKey = process.env.OPENAI_API_KEY?.trim();
const openAiModel = process.env.OPENAI_TOOL_PLANNER_MODEL?.trim() || process.env.OPENAI_MODEL?.trim() || 'gpt-4.1';
const openAiResponseModel = process.env.OPENAI_RESPONSE_MODEL?.trim() || 'gpt-4.1-nano';
const openAiTimeoutMs = Number.isFinite(Number(process.env.OPENAI_TOOL_PLANNER_TIMEOUT_MS))
  ? Number(process.env.OPENAI_TOOL_PLANNER_TIMEOUT_MS)
  : 60_000;

interface PlannerRecord {
  turnText: string;
  plan?: ToolPlannerOutput;
  error?: unknown;
  toolNames: ToolName[];
  catalogCandidateCodes: string[];
  activeCatalogCodes: string[];
  pendingCatalogSuggestion?: ToolPlannerInput['state']['pendingCatalogSuggestion'];
  pendingReorder?: ToolPlannerInput['state']['pendingReorder'];
  catalogCustomerEvidence: Array<{ code: string; available: boolean; sources: string[] }>;
  consentAssistantTexts: string[];
  availableTools: ToolName[];
  catalogModifierOptionNames: string[];
  catalogModifierAliases: string[];
  fulfillmentLocations: Array<{ district: string; city: string }>;
}

class RecordingToolPlanner implements ToolPlanner {
  readonly supportsMultiStep: boolean;
  readonly records: PlannerRecord[] = [];

  constructor(private readonly delegate: ToolPlanner) {
    this.supportsMultiStep = delegate.supportsMultiStep === true;
  }

  async plan(input: ToolPlannerInput): Promise<ToolPlannerOutput> {
    const record: PlannerRecord = {
      turnText: input.state.latestUserMessage,
      toolNames: [],
      catalogCandidateCodes: input.menuCatalogContext?.candidates.map((candidate) => candidate.code) ?? [],
      activeCatalogCodes: input.menuCatalogContext?.candidates
        .filter((candidate) => candidate.activeCartItem)
        .map((candidate) => candidate.code) ?? [],
      pendingCatalogSuggestion: input.state.pendingCatalogSuggestion,
      pendingReorder: input.state.pendingReorder,
      catalogCustomerEvidence: input.menuCatalogContext?.candidates.map((candidate) => ({
        code: candidate.code,
        available: candidate.available,
        sources: candidate.customerEvidenceSources ?? [],
      })) ?? [],
      consentAssistantTexts: (input.consentTurns ?? [])
        .filter((turn) => turn.role === 'assistant')
        .map((turn) => turn.text),
      availableTools: [...input.availableTools],
      catalogModifierOptionNames:
        input.menuCatalogContext?.candidates.flatMap((candidate) =>
          candidate.modifierGroups.flatMap((group) => group.options.map((option) => option.name)),
        ) ?? [],
      catalogModifierAliases:
        input.menuCatalogContext?.candidates.flatMap((candidate) =>
          candidate.modifierGroups.flatMap((group) =>
            group.options.flatMap((option) => option.searchAliases ?? []),
          ),
        ) ?? [],
      fulfillmentLocations:
        input.fulfillmentLocationContext?.candidates.map(({ district, city }) => ({ district, city })) ?? [],
    };
    this.records.push(record);
    try {
      const plan = await this.delegate.plan(input);
      record.plan = plan;
      record.toolNames = plan.toolCalls.map((call) => call.toolName);
      return plan;
    } catch (error) {
      record.error = error;
      throw error;
    }
  }
}

const expectedActionWidgetKinds: Record<string, KfcGenUiWidgetKind> = {
  add_item: 'smartMenuPicker',
  customize_item: 'smartMenuPicker',
  continue_to_fulfillment: 'cartBuilder',
  edit_cart: 'cartBuilder',
  remove_item: 'cartBuilder',
  accept_fulfillment: 'addressFulfillmentCheck',
  submit_address: 'addressFulfillmentCheck',
  confirm_order: 'orderReviewConfirm',
  apply_voucher: 'orderReviewConfirm',
  open_payment: 'paymentOrderStatus',
  change_payment_method: 'paymentOrderStatus',
  track_order: 'orderTrackingStatus',
  request_human: 'supportHandoff',
  send_issue_summary: 'supportHandoff',
};

function paidOrder(id: string): Order {
  return {
    id,
    status: 'preparing',
    paymentStatus: 'paid',
    assignedStoreId: 'store_kfc_nguyen_thi_minh_khai',
    createdAt: '2026-07-09T09:00:00.000Z',
    cart: {
      id: `cart_${id}`,
      items: [{ itemCode: '41141', name: 'Burger Gà Zinger', quantity: 1, unitPriceVnd: 55_000 }],
      subtotalVnd: 55_000,
      discountVnd: 0,
      deliveryFeeVnd: 18_000,
      totalVnd: 73_000,
      voucherCode: null,
    },
  };
}

function initialVerifiedStateForScenario(scenarioCase: LiveScenarioCase) {
  if (scenarioCase.seedPaidOrder) {
    const order = paidOrder('KFC-1024');
    return {
      order,
      paymentAttempt: {
        method: 'momo' as const,
        status: 'paid' as const,
        paymentUrl: `https://pay.mock/momo/${order.id}`,
      },
    };
  }
  if (!scenarioCase.seedPendingPayment) return undefined;
  const order = { ...paidOrder('KFC-MOCK-1001'), status: 'created' as const, paymentStatus: 'pending' as const };
  return {
    order,
    paymentAttempt: {
      method: 'momo' as const,
      status: 'pending' as const,
      paymentUrl: `https://pay.mock/momo/${order.id}`,
    },
  };
}

function mockClientOptionsForScenario(scenarioCase: LiveScenarioCase) {
  if (!scenarioCase.seedPaidOrder && !scenarioCase.seedPendingPayment) return undefined;
  const initialOrders = ['KFC-1024', 'KFC-MOCK-1001', '<verified_order_id>'].map((id) => ({
    ...paidOrder(id),
    ...(scenarioCase.seedPendingPayment
      ? { status: 'created' as const, paymentStatus: 'pending' as const }
      : {}),
  }));
  return {
    initialOrders,
    paymentStatusProvider: () => ({
      ok: !scenarioCase.seedPendingPayment,
      value: scenarioCase.seedPendingPayment ? undefined : { status: 'paid' as const },
      errorCode: scenarioCase.seedPendingPayment ? 'payment_failed' : undefined,
      message: scenarioCase.seedPendingPayment ? 'live_ai_genui_payment_failed_fixture' : 'live_ai_genui_paid_fixture',
    }),
  };
}

function expectGenUi(
  result: Awaited<ReturnType<typeof runScenario>>,
  scenarioCase: LiveScenarioCase,
  plannerRecords: PlannerRecord[],
) {
  const attachments = result.transcript
    .map((turn) => turn.metadata?.genUi)
    .filter((genUi): genUi is NonNullable<typeof genUi> => Boolean(genUi));
  const actualKinds = new Set(attachments.map((attachment) => attachment.widgetKind));
  const missingKinds = (scenarioCase.targetWidgetKinds ?? []).filter((kind) => !actualKinds.has(kind));
  expect(
    missingKinds,
    `${scenarioCase.fileName} missed required GenUI widget(s): ${JSON.stringify({
      actualWidgets: [...actualKinds],
      widgetsByTurn: result.transcript
        .filter((turn) => turn.role === 'assistant')
        .map((turn) => turn.metadata?.genUi?.widgetKind ?? null),
      escalationReasons: result.escalationReasons,
      plannerRecords,
      assistantTexts: result.transcript
        .filter((turn) => turn.role === 'assistant')
        .map((turn) => turn.text),
      toolTraceByTurn: result.toolTraceByTurn,
      finalState: {
        hasCart: Boolean(result.finalAgentState?.cart),
        hasFulfillment: Boolean(result.finalAgentState?.fulfillment),
        hasOrder: Boolean(result.finalAgentState?.order),
        hasPaymentAttempt: Boolean(result.finalAgentState?.paymentAttempt),
      },
    })}`,
  ).toEqual([]);

  for (const attachment of attachments) {
    for (const action of attachment.actions) {
      const expectedKind = action.id.startsWith('customize_item:')
        ? 'modifierPicker'
        : expectedActionWidgetKinds[action.id];
      if (expectedKind) expect(attachment.widgetKind).toBe(expectedKind);
    }
  }
}

function recordsByTurnIndex(
  scriptUserTurns: Array<{ index: number; text: string }>,
  records: PlannerRecord[],
  expectations: TurnExpectation[],
) {
  const byTurn = new Map<number, PlannerRecord[]>();
  const deterministicTurns = new Set(
    expectations.filter((expectation) => expectation.allowDeterministicExecution).map((expectation) => expectation.turnIndex),
  );
  let cursor = 0;

  for (const turn of scriptUserTurns) {
    const turnRecords: PlannerRecord[] = [];
    while (records[cursor]?.turnText === turn.text) {
      turnRecords.push(records[cursor]!);
      cursor += 1;
    }
    if (!deterministicTurns.has(turn.index)) {
      expect(turnRecords.length, `live planner should be invoked for scenario turn ${turn.index}`).toBeGreaterThan(0);
    }
    byTurn.set(turn.index, turnRecords);
  }

  expect(records.slice(cursor), 'live planner should not contain records after the final scenario turn').toEqual([]);
  return byTurn;
}

function expectTurnToolGroups(
  records: PlannerRecord[] | undefined,
  expectation: TurnExpectation,
  diagnostics?: { executedEntries?: ToolTraceEntry[]; [key: string]: unknown },
) {
  const executedToolNames = diagnostics?.executedEntries?.map((entry) => entry.toolName) ?? [];
  if (!expectation.allowDeterministicExecution || (records?.length ?? 0) > 0) {
    expect(records?.length, `missing planner record for turn ${expectation.turnIndex}`).toBeGreaterThan(0);
  }
  const errors = (records ?? []).flatMap((record) => (record.error ? [record.error] : []));
  const recoveredByDeterministicExecution =
    expectation.allowDeterministicExecution && executedToolNames.length > 0;
  if (!recoveredByDeterministicExecution) {
    expect(
      errors,
      `planner failed on turn ${expectation.turnIndex}: ${errors.map(String).join('; ')}; records: ${JSON.stringify(records)}; diagnostics: ${JSON.stringify(diagnostics)}`,
    ).toEqual([]);
  }

  const actual = new Set([
    ...(records ?? []).flatMap((record) => record.toolNames),
    ...executedToolNames,
  ]);
  const catalogCodes = new Set((records ?? []).flatMap((record) => record.catalogCandidateCodes));
  const catalogModifierOptionNames = (records ?? [])
    .flatMap((record) => record.catalogModifierOptionNames)
    .map((name) => name.toLocaleLowerCase('vi-VN'));
  const fulfillmentLocations = (records ?? []).flatMap((record) => record.fulfillmentLocations);
  const missingBooleanEntities = (expectation.requiredBooleanEntities ?? []).filter((entity) =>
    !(records ?? []).some((record) => record.plan?.entities[entity] === true),
  );
  const missing = (expectation.requiredGroups ?? []).filter((group) => !group.some((toolName) => actual.has(toolName)));
  const missingCatalogCodes = (expectation.requiredCatalogCodes ?? []).filter((code) => !catalogCodes.has(code));
  const forbidden = (expectation.forbiddenTools ?? []).filter((toolName) => actual.has(toolName));
  const unexpected = unexpectedScenarioTools(
    expectation.allowedTools,
    (records ?? []).flatMap((record) => record.toolNames),
    executedToolNames,
  );

  expect(
    missing.map((group) => group.join(' | ')),
    `model planner missed required tool group(s) on turn ${expectation.turnIndex}; actual tools: ${[...actual].join(', ')}; records: ${JSON.stringify(records)}; diagnostics: ${JSON.stringify(diagnostics)}`,
  ).toEqual([]);
  expect(
    missingCatalogCodes,
    `fixture-backed planner context missed required menu code(s) on turn ${expectation.turnIndex}; actual codes: ${[...catalogCodes].join(', ')}`,
  ).toEqual([]);
  if (expectation.requiredCatalogModifierText) {
    expect(
      catalogModifierOptionNames.some((name) => name.includes(expectation.requiredCatalogModifierText!)),
      `fixture-backed planner context missed modifier evidence "${expectation.requiredCatalogModifierText}" on turn ${expectation.turnIndex}; actual modifiers: ${catalogModifierOptionNames.join(', ')}`,
    ).toBe(true);
  }
  if (expectation.requiredFulfillmentLocation) {
    expect(
      fulfillmentLocations,
      `fixture-backed planner context missed required fulfillment location on turn ${expectation.turnIndex}`,
    ).toContainEqual(expectation.requiredFulfillmentLocation);
  }
  expect(
    missingBooleanEntities,
    `planner missed required boolean entities on turn ${expectation.turnIndex}; records: ${JSON.stringify(records)}`,
  ).toEqual([]);
  expect(
    forbidden,
    `model planner chose forbidden tool(s) on turn ${expectation.turnIndex}; actual tools: ${[...actual].join(', ')}; records: ${JSON.stringify(records)}; diagnostics: ${JSON.stringify(diagnostics)}`,
  ).toEqual([]);
  expect(
    unexpected,
    `model planner chose tool(s) outside the closed-world ledger on turn ${expectation.turnIndex}; allowed: ${expectation.allowedTools.join(', ')}; actual: ${[...actual].join(', ')}`,
  ).toEqual([]);

  if (!expectation.allowEmptyTools && (expectation.requiredGroups?.length ?? 0) > 0) {
    expect(actual.size, `turn ${expectation.turnIndex} should include at least one planned tool`).toBeGreaterThan(0);
  }
}

function valueAtPath(value: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, segment) =>
    current && typeof current === 'object' ? (current as Record<string, unknown>)[segment] : undefined, value);
}

function expectTurnOracle(
  expectation: TurnExpectation,
  records: PlannerRecord[] | undefined,
  entries: ToolTraceEntry[],
  evidence: Awaited<ReturnType<typeof runScenario>>['turnEvidence'][number],
) {
  expect(evidence.input).toBe(expectation.input);
  const plannedSequence = (records ?? []).flatMap((record) => record.toolNames);
  const observedTools = [...plannedSequence, ...entries.map((entry) => entry.toolName)];
  for (const constraint of expectation.toolCounts) {
    const count = observedTools.filter((toolName) => toolName === constraint.toolName).length;
    expect(count, `${expectation.id} tool count for ${constraint.toolName}`).toBeGreaterThanOrEqual(constraint.min);
    if (constraint.max !== undefined) expect(count).toBeLessThanOrEqual(constraint.max);
  }
  let previousIndex = -1;
  for (const toolName of expectation.toolOrder) {
    const nextIndex = observedTools.indexOf(toolName, previousIndex + 1);
    expect(nextIndex, `${expectation.id} expected ${toolName} after index ${previousIndex}`).toBeGreaterThan(previousIndex);
    previousIndex = nextIndex;
  }
  previousIndex = -1;
  for (const group of expectation.toolOrderGroups) {
    const nextIndex = observedTools.findIndex((toolName, index) => index > previousIndex && group.includes(toolName));
    expect(nextIndex, `${expectation.id} missed ordered tool group ${group.join('|')}`).toBeGreaterThan(previousIndex);
    previousIndex = nextIndex;
  }
  for (const constraint of expectation.argumentConstraints) {
    const candidates = entries.filter((entry) => entry.toolName === constraint.toolName);
    if (candidates.length === 0 && expectation.toolCounts.find(({ toolName }) => toolName === constraint.toolName)?.min === 0) continue;
    expect(
      candidates.some((entry) => constraint.requiredPaths.every((path) =>
        path.split('|').some((alternative) => valueAtPath(entry.arguments, alternative) !== undefined))),
      `${expectation.id} missing ${constraint.toolName} argument paths ${constraint.requiredPaths.join(', ')}`,
    ).toBe(true);
  }
  for (const key of expectation.stateTransition.mustNotChange) {
    expect(evidence.stateAfter[key], `${expectation.id} unexpectedly changed ${key}`).toEqual(evidence.stateBefore[key]);
  }
  for (const key of expectation.stateTransition.mustChange) {
    expect(evidence.stateAfter[key], `${expectation.id} did not change required state ${key}`).not.toEqual(evidence.stateBefore[key]);
  }
  for (const claim of [...expectation.claims.forbidden, ...expectation.messenger.forbiddenText]) {
    expect(evidence.assistantText.toLocaleLowerCase('vi-VN')).not.toContain(claim.toLocaleLowerCase('vi-VN'));
  }
  assertScenarioSemanticClaims({ expectation, text: evidence.assistantText, entries, state: evidence.stateAfter as Record<string, unknown>, genUi: evidence.genUi });
  if (expectation.genUi.required) {
    expect(
      evidence.genUi,
      `${expectation.id} missing required GenUI; tools=${entries.map(({ toolName }) => toolName).join(',')}; state=${JSON.stringify(evidence.stateAfter)}`,
    ).toBeDefined();
  }
  if (evidence.genUi) {
    expect(
      expectation.genUi.allowedWidgetKinds,
      `${expectation.id} emitted ${evidence.genUi.widgetKind}; tools=${entries.map(({ toolName }) => toolName).join(',')}`,
    ).toContain(evidence.genUi.widgetKind);
    for (const path of expectation.genUi.requiredDataPaths) {
      expect(valueAtPath(evidence.genUi, path), `${expectation.id} missing GenUI path ${path} on ${evidence.genUi.widgetKind}`).not.toBeUndefined();
    }
    const actionIds = evidence.genUi.actions.map((action) => action.id);
    for (const action of expectation.genUi.requiredActions) expect(actionIds).toContain(action);
    for (const action of expectation.genUi.forbiddenActions) {
      if (action.startsWith('widget:')) expect(evidence.genUi.widgetKind).not.toBe(action.slice('widget:'.length));
      else expect(actionIds).not.toContain(action);
    }
  }
  expectRequiredProviderProvenance(expectation, entries);
  expect(evidence.transcriptRevisionAfter - evidence.transcriptRevisionBefore).toBe(expectation.persistenceEvidence.transcriptDelta);
  expect(evidence.eventRevisionAfter).toBeGreaterThan(evidence.eventRevisionBefore);
  expect(evidence.eventIds).toHaveLength(evidence.eventRevisionAfter - evidence.eventRevisionBefore);
  expect(evidence.eventIdsAfter.slice(0, evidence.eventIdsBefore.length)).toEqual(evidence.eventIdsBefore);
  expect(evidence.eventIdsAfter.slice(evidence.eventIdsBefore.length)).toEqual(evidence.eventIds);
  expect(new Set(evidence.eventIds).size).toBe(evidence.eventIds.length);
  if (expectation.persistenceEvidence.checkpointRequired) expect(evidence.checkpointId).toEqual(expect.any(String));
  if (expectation.persistenceEvidence.checkpointRequired) expect(evidence.checkpointNamespace).toEqual(expect.any(String));
  expect(evidence.durationMs, `${expectation.id} exceeded its absolute turn latency gate`).toBeLessThanOrEqual(expectation.latency.maxTurnMs);
}

function expectDeployedTurnOracle(
  expectation: TurnExpectation,
  entries: ToolTraceEntry[],
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  response: Record<string, unknown>,
  durationMs: number,
) {
  const tools = entries.map(({ toolName }) => toolName);
  expect(unexpectedScenarioTools(expectation.allowedTools, [], tools), `${expectation.id} used a tool outside the ledger`).toEqual([]);
  for (const group of expectation.requiredGroups ?? []) {
    expect(group.some((toolName) => tools.includes(toolName)), `${expectation.id} missed ${group.join('|')}`).toBe(true);
  }
  for (const toolName of expectation.forbiddenTools ?? []) expect(tools).not.toContain(toolName);
  for (const constraint of expectation.toolCounts) {
    const count = tools.filter((toolName) => toolName === constraint.toolName).length;
    expect(count).toBeGreaterThanOrEqual(constraint.min);
    if (constraint.max !== undefined) expect(count).toBeLessThanOrEqual(constraint.max);
  }
  let previous = -1;
  for (const toolName of expectation.toolOrder) {
    const next = tools.indexOf(toolName, previous + 1);
    expect(next, `${expectation.id} missed ordered tool ${toolName}`).toBeGreaterThan(previous);
    previous = next;
  }
  previous = -1;
  for (const group of expectation.toolOrderGroups) {
    const next = tools.findIndex((toolName, index) => index > previous && group.includes(toolName));
    expect(next, `${expectation.id} missed ordered tool group ${group.join('|')}`).toBeGreaterThan(previous);
    previous = next;
  }
  for (const constraint of expectation.argumentConstraints) {
    const candidates = entries.filter(({ toolName }) => toolName === constraint.toolName);
    if (candidates.length === 0 && expectation.toolCounts.find(({ toolName }) => toolName === constraint.toolName)?.min === 0) continue;
    expect(candidates.some((entry) =>
      constraint.requiredPaths.every((path) => path.split('|').some((candidate) => valueAtPath(entry.arguments, candidate) !== undefined))),
    `${expectation.id} missed required ${constraint.toolName} arguments`).toBe(true);
  }
  for (const key of expectation.stateTransition.mustNotChange) expect(after[key]).toEqual(before[key]);
  for (const key of expectation.stateTransition.mustChange) expect(after[key]).not.toEqual(before[key]);
  const text = typeof response.responseText === 'string' ? response.responseText : '';
  const genUi = response.genUi as Record<string, unknown> | undefined;
  assertScenarioSemanticClaims({ expectation, text, entries, state: after, genUi });
  for (const forbidden of [...expectation.claims.forbidden, ...expectation.messenger.forbiddenText]) {
    expect(text.toLocaleLowerCase('vi-VN')).not.toContain(forbidden.toLocaleLowerCase('vi-VN'));
  }
  if (expectation.genUi.required) expect(genUi, `${expectation.id} missing required GenUI`).toBeDefined();
  if (genUi) {
    expect(expectation.genUi.allowedWidgetKinds).toContain(genUi.widgetKind);
    for (const path of expectation.genUi.requiredDataPaths) expect(valueAtPath(genUi, path)).not.toBeUndefined();
    const actionIds = Array.isArray(genUi.actions)
      ? genUi.actions.map((action) => (action as Record<string, unknown>).id)
      : [];
    for (const action of expectation.genUi.requiredActions) expect(actionIds).toContain(action);
    for (const action of expectation.genUi.forbiddenActions) {
      if (action.startsWith('widget:')) expect(genUi.widgetKind).not.toBe(action.slice('widget:'.length));
      else expect(actionIds).not.toContain(action);
    }
  }
  expectRequiredProviderProvenance(expectation, entries);
  expect(durationMs).toBeLessThanOrEqual(expectation.latency.maxTurnMs);
}

function expectRequiredProviderProvenance(expectation: TurnExpectation, entries: ToolTraceEntry[]): void {
  if (!expectation.providerEvidence.requireToolProvenance) return;
  const providerEntries = entries.filter(({ toolName }) => expectation.providerEvidence.providerTools.includes(toolName));
  expect(providerEntries.length, `${expectation.id} missing executed provider work`).toBeGreaterThan(0);
  expect(providerEntries.every(({ provenance }) => provenance.length > 0), `${expectation.id} has provider work without provenance`).toBe(true);
  if (expectation.providerEvidence.requireRevisionOrSource) {
    expect(providerEntries.flatMap(({ provenance }) => provenance).every((source) => Boolean(source.sourceFile || source.sourceUrl || source.sourceApi))).toBe(true);
  }
}

function expectDeployedPlannerOracle(
  expectation: TurnExpectation,
  plans: Array<Record<string, unknown>>,
  executed: ToolTraceEntry[],
) {
  if (!expectation.allowDeterministicExecution || plans.length > 0) {
    expect(plans.length, `${expectation.id} is missing persisted planner evidence`).toBeGreaterThan(0);
  }
  const proposedCalls = plans.flatMap((plan) => Array.isArray(plan.proposedCalls) ? plan.proposedCalls as Array<Record<string, unknown>> : []);
  const proposedTools = proposedCalls.map(({ toolName }) => toolName).filter((value): value is ToolName => typeof value === 'string');
  const observed = [...proposedTools, ...executed.map(({ toolName }) => toolName)];
  expect(unexpectedScenarioTools(expectation.allowedTools, proposedTools, executed.map(({ toolName }) => toolName)), `${expectation.id} proposed a tool outside the ledger`).toEqual([]);
  for (const group of expectation.requiredGroups ?? []) {
    expect(group.some((toolName) => observed.includes(toolName)), `${expectation.id} missed ${group.join('|')}`).toBe(true);
  }
  for (const forbidden of expectation.forbiddenTools ?? []) expect(observed).not.toContain(forbidden);
  for (const constraint of expectation.toolCounts) {
    const count = observed.filter((toolName) => toolName === constraint.toolName).length;
    expect(count).toBeGreaterThanOrEqual(constraint.min);
    if (constraint.max !== undefined) expect(count).toBeLessThanOrEqual(constraint.max);
  }
  let previous = -1;
  for (const toolName of expectation.toolOrder) {
    const next = observed.indexOf(toolName, previous + 1);
    expect(next).toBeGreaterThan(previous);
    previous = next;
  }
  previous = -1;
  for (const group of expectation.toolOrderGroups) {
    const next = observed.findIndex((toolName, index) => index > previous && group.includes(toolName));
    expect(next).toBeGreaterThan(previous);
    previous = next;
  }
  const booleanEntities = Object.assign({}, ...plans.map((plan) => plan.booleanEntities ?? {})) as Record<string, unknown>;
  for (const entity of expectation.requiredBooleanEntities ?? []) expect(booleanEntities[entity]).toBe(true);
  const candidates = plans.flatMap((plan) => Array.isArray(plan.catalogCandidates) ? plan.catalogCandidates as Array<Record<string, unknown>> : []);
  const candidateCodes = candidates.map(({ code }) => code);
  for (const code of expectation.requiredCatalogCodes ?? []) expect(candidateCodes).toContain(code);
  if (expectation.requiredCatalogModifierText) {
    const text = candidates.flatMap((candidate) => [
      ...(Array.isArray(candidate.modifierOptionNames) ? candidate.modifierOptionNames : []),
      ...(Array.isArray(candidate.modifierAliases) ? candidate.modifierAliases : []),
    ]).join(' ').toLocaleLowerCase('vi-VN');
    expect(text).toContain(expectation.requiredCatalogModifierText.toLocaleLowerCase('vi-VN'));
  }
  if (expectation.requiredFulfillmentLocation) {
    const locations = plans.flatMap((plan) => Array.isArray(plan.fulfillmentLocations) ? plan.fulfillmentLocations : []);
    expect(locations).toContainEqual(expectation.requiredFulfillmentLocation);
  }
}

async function deployedJson(path: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  const response = await fetch(`${deployedBackendUrl}${path}`, init);
  const value = await response.json().catch(() => null);
  if (!response.ok || !value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${path} returned HTTP ${response.status}`);
  }
  return value as Record<string, unknown>;
}

async function establishDeployedLifecycle(
  instanceId: string,
  orderId: string,
  paid: boolean,
  headers: Record<string, string>,
) {
  const events = [
    { type: 'order_accepted', orderId },
    { type: 'payment_pending', attemptId: `scenario-payment-${randomUUID()}`, orderId },
    { type: paid ? 'payment_paid' : 'payment_failed' },
    ...(paid ? [{ type: 'order_preparing' }] : []),
  ];
  for (const [expectedRevision, event] of events.entries()) {
    await deployedJson(`/admin/lifecycle/instances/${encodeURIComponent(instanceId)}/events`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ expectedRevision, idempotencyKey: `scenario-${randomUUID()}`, event }),
    });
  }
}

function deployedProviderProfile(
  scenarioCase: LiveScenarioCase,
  scenarioFixtures: ReturnType<typeof liveScenarioFixtures>,
  turnIndex: number,
): Record<string, unknown> | undefined {
  const initialState = scenarioFixtures.initialVerifiedState;
  const initialOrders = scenarioFixtures.mockClientOptions?.initialOrders ?? [];
  const customerContext = initialState?.customerContext;
  const profile: Record<string, unknown> = {
    ...(initialOrders.length > 0 ? {
      orders: initialOrders,
      recentOrderId: initialOrders.at(-1)?.id,
      paymentStatuses: Object.fromEntries(initialOrders.map(({ id, paymentStatus }) => [id, paymentStatus])),
    } : {}),
    ...(customerContext?.savedAddresses?.length ? { savedAddresses: customerContext.savedAddresses } : {}),
    ...(customerContext?.favorites?.length ? { favoriteItems: customerContext.favorites } : {}),
    ...scenarioFixtures.mockedUpstreamApiForTurn?.(turnIndex),
  };
  if (scenarioCase.fileName.startsWith('07-') && scenarioFixtures.transformFixtures) {
    const transformed = scenarioFixtures.transformFixtures(loadBundledGeneratedFixtures());
    profile.menuItems = transformed.menuItems.filter(({ code }) => code === '20698' || code.startsWith('MOCK-'));
    profile.menuModifiers = transformed.menuModifiers.filter(({ itemCode }) => itemCode === '20698');
  }
  return Object.keys(profile).length > 0 ? profile : undefined;
}

describe('consolidated live scenario contract', () => {
  it('covers 44 GenUI customer turns once and keeps scenario 09 planner-only', async () => {
    const genUiCases = liveScenarioCases.filter((scenarioCase) => scenarioCase.targetWidgetKinds);
    const scripts = await Promise.all(
      genUiCases.map((scenarioCase) => loadScenarioScript(join(scenariosRoot, scenarioCase.fileName))),
    );
    expect(scripts.reduce((total, script) => total + script.userTurns.length, 0)).toBe(44);
    expect(new Set(genUiCases.flatMap((scenarioCase) => scenarioCase.targetWidgetKinds))).toEqual(new Set([
      'addressFulfillmentCheck',
      'cartBuilder',
      'orderReviewConfirm',
      'orderTrackingStatus',
      'paymentOrderStatus',
      'smartMenuPicker',
      'supportHandoff',
    ]));
    const plannerOnlyScenario = liveScenarioCases.find((scenarioCase) => scenarioCase.fileName.startsWith('09-'));
    expect(plannerOnlyScenario?.targetWidgetKinds).toBeUndefined();
    expect(plannerOnlyScenario?.forbiddenWidgetKinds).toEqual(['paymentOrderStatus']);
  });

  it('proves the dedicated modifierPicker scenario without mutating the cart', async () => {
    const script = await loadScenarioScript(modifierPickerScenarioPath);
    const result = await runScenario(script, {
      channelOverride: 'kfc',
      toolPlanner: new StaticToolPlanner([{
        intent: 'ordering',
        entities: {},
        toolCalls: [{ toolName: 'getModifierOptions', arguments: { code: '20752' } }],
        responseClaims: [],
      }]),
    });

    expect(result.toolTrace).toEqual(expect.arrayContaining([
      expect.objectContaining({ toolName: 'getModifierOptions', ok: true, arguments: { code: '20752' } }),
    ]));
    expect(result.toolTrace.some((entry) => entry.toolName === 'updateCart')).toBe(false);
    expect(result.cart).toBeUndefined();
    expect(result.transcript.at(-1)?.metadata?.genUi).toMatchObject({
      widgetKind: 'modifierPicker',
      data: { modifierTree: { itemCode: '20752' } },
    });
  });

  it('fails closed when required per-turn GenUI, provenance, or contiguous events are absent', () => {
    const evidence = (expectation: TurnExpectation) => ({
      turnIndex: expectation.turnIndex,
      input: expectation.input,
      durationMs: 1,
      transcriptRevisionBefore: 0,
      transcriptRevisionAfter: 2,
      eventRevisionBefore: 0,
      eventRevisionAfter: 1,
      eventIdsBefore: [],
      eventIds: ['event-1'],
      eventIdsAfter: ['event-1'],
      checkpointId: 'checkpoint-1',
      checkpointNamespace: 'run:test',
      assistantText: 'Đã kiểm tra yêu cầu của bạn.',
      stateBefore: {} as Record<string, unknown>,
      stateAfter: {} as Record<string, unknown>,
    });
    const requiredGenUi = liveScenarioCases.find(({ fileName }) => fileName.startsWith('03-'))!.turnExpectations[0]!;
    expect(() => expectTurnOracle(requiredGenUi, [], [], evidence(requiredGenUi))).toThrow(/missing required GenUI/);

    const providerTurn = liveScenarioCases[0]!.turnExpectations[0]!;
    const providerEvidence = evidence(providerTurn);
    providerEvidence.assistantText = 'Đã cập nhật cart-1.';
    providerEvidence.stateAfter = { cart: { id: 'cart-1' } };
    expect(() => expectTurnOracle(providerTurn, [{
      turnText: providerTurn.input,
      toolNames: ['updateCart'], catalogCandidateCodes: [], activeCatalogCodes: [], catalogCustomerEvidence: [],
      consentAssistantTexts: [], availableTools: [], catalogModifierOptionNames: [], catalogModifierAliases: [], fulfillmentLocations: [],
    }], [{
      toolName: 'updateCart', arguments: { itemCode: '41141', quantity: 1 }, ok: true,
      resultSummary: 'cart updated', provenance: [],
    }], providerEvidence)).toThrow(/provider work without provenance/);

    expect(() => expectRequiredProviderProvenance(providerTurn, [])).toThrow(/missing executed provider work/);

    expect(() => assertScenarioSemanticClaims({
      expectation: providerTurn,
      text: 'Hôm nay thời tiết đẹp.',
      entries: [{
        toolName: 'updateCart', arguments: { itemCode: '41141', quantity: 1 }, ok: true,
        resultSummary: 'cart updated', provenance: [{ fixtureMode: 'test_only', sourceFile: 'test', sourceApi: 'provider-v1' }],
      }],
      state: { cart: { id: 'cart-1', items: [{ name: 'Burger Gà Zinger' }] } },
    })).toThrow(/response is unrelated/);

    const eventTurn = liveScenarioCases[0]!.turnExpectations[4]!;
    const nonContiguous = evidence(eventTurn);
    nonContiguous.eventIds = [];
    expect(() => expectTurnOracle(eventTurn, [], [], nonContiguous)).toThrow();
  });
});

if (liveRequested && deployedBackendUrl) {
  const deployedBindings: Array<{ scenarioId: string; fileName: string; sessionId: string; customerId: string }> = [];

  afterAll(() => {
    if (!deployedBranchOutput) throw new Error('KFC_LIVE_SCENARIO_BRANCH_OUTPUT is required for deployed replay');
    const bindings = deployedBindings.sort((a, b) => a.fileName.localeCompare(b.fileName));
    if (bindings.length !== 8) throw new Error(`Deployed replay produced ${bindings.length} GenUI branches instead of 8`);
    mkdirSync(dirname(resolve(deployedBranchOutput)), { recursive: true });
    writeFileSync(resolve(deployedBranchOutput), `${JSON.stringify({
      schemaVersion: 1,
      artifactKind: 'deployed-live-scenario-sessions',
      bindings,
    }, null, 2)}\n`);
  });

  describe('deployed live OpenAI scenario replay', () => {
    it.concurrent.each(liveScenarioCases)(
      '$fileName satisfies the closed-world ledger on the deployed Worker',
      async (scenarioCase) => {
        if (!proofAdminToken) throw new Error('KFC_PROOF_ADMIN_TOKEN is required for deployed replay');
        const script = await loadScenarioScript(join(scenariosRoot, scenarioCase.fileName));
        const customerId = `scenario-${randomUUID()}`;
        const sessionId = `kfc:${customerId}`;
        const adminHeaders = { authorization: `Bearer ${proofAdminToken}` };
        const scenarioFixtures = liveScenarioFixtures(scenarioCase.fileName);
        await deployedJson(`/dashboard/sessions/${encodeURIComponent(sessionId)}/demo-reset`, { method: 'POST', headers: adminHeaders });
        const lifecycle = await deployedJson(`/admin/lifecycle/sessions/${encodeURIComponent(sessionId)}/instances`, { method: 'POST', headers: adminHeaders });
        const orderId = scenarioCase.seedPaidOrder ? 'KFC-1024' : scenarioCase.seedPendingPayment ? 'KFC-MOCK-1001' : undefined;
        if (orderId) await establishDeployedLifecycle(lifecycle.instanceId as string, orderId, scenarioCase.seedPaidOrder === true, adminHeaders);
        await deployedJson(`/admin/proof/kfc/sessions/${encodeURIComponent(sessionId)}/preconditions`, {
          method: 'POST',
          headers: { ...adminHeaders, 'content-type': 'application/json' },
          body: JSON.stringify({
            customerId,
            authenticated: scenarioCase.requiresCustomerAccess === true,
            orderId,
            verifiedState: scenarioFixtures.initialVerifiedState,
          }),
        });
        let priorState: Record<string, unknown> = {};
        let priorTraceLength = 0;
        let priorEventIds: string[] = [];
        let latestEnvelope: Record<string, unknown> | undefined;
        const countedTurns: Array<{ clientMessageId: string; expectation: TurnExpectation; entries: ToolTraceEntry[] }> = [];
        for (const [turnNumber, turn] of script.userTurns.entries()) {
          const clientMessageId = `scenario-${randomUUID()}`;
          const providerProfile = deployedProviderProfile(scenarioCase, scenarioFixtures, turn.index);
          await deployedJson(`/admin/proof/kfc/sessions/${encodeURIComponent(sessionId)}/preconditions`, {
            method: 'POST',
            headers: { ...adminHeaders, 'content-type': 'application/json' },
            body: JSON.stringify({
              customerId,
              authenticated: scenarioCase.requiresCustomerAccess === true,
              providerProfile: providerProfile ?? null,
            }),
          });
          const startedAt = Date.now();
          const response = await deployedJson('/chat/kfc/message', {
            method: 'POST',
            headers: { ...adminHeaders, 'content-type': 'application/json' },
            body: JSON.stringify({
              sessionId,
              customerId,
              clientMessageId,
              text: turn.text,
            }),
          });
          const state = response.state as Record<string, unknown>;
          const trace = Array.isArray(state.toolTrace) ? state.toolTrace as ToolTraceEntry[] : [];
          const priorTrace = Array.isArray(priorState.toolTrace) ? priorState.toolTrace as ToolTraceEntry[] : [];
          const continuesPriorTrace = trace.length >= priorTraceLength
            && priorTrace.every((entry, index) => JSON.stringify(entry) === JSON.stringify(trace[index]));
          const entries = continuesPriorTrace ? trace.slice(priorTraceLength) : trace;
          const expectation = scenarioCase.turnExpectations[turnNumber]!;
          expectDeployedTurnOracle(expectation, entries, priorState, state, response, Date.now() - startedAt);
          const durable = await deployedJson(`/dashboard/sessions/${encodeURIComponent(sessionId)}/turns?limit=100`, { headers: adminHeaders });
          expect((durable.turns as unknown[]).length).toBe((turnNumber + 1) * expectation.persistenceEvidence.transcriptDelta);
          latestEnvelope = await deployedJson(`/admin/proof/kfc/sessions/${encodeURIComponent(sessionId)}/envelope`, { headers: adminHeaders });
          const eventIds = (latestEnvelope.events as Array<{ id: string }>).map(({ id }) => id);
          expect(eventIds.slice(0, priorEventIds.length), `${expectation.id} changed prior event history`).toEqual(priorEventIds);
          expect(eventIds.length, `${expectation.id} did not append contiguous event evidence`).toBeGreaterThan(priorEventIds.length);
          expect(new Set(eventIds).size, `${expectation.id} contains duplicate event ids`).toBe(eventIds.length);
          priorEventIds = eventIds;
          countedTurns.push({ clientMessageId, expectation, entries });
          priorState = state;
          priorTraceLength = trace.length;
        }
        const envelope = latestEnvelope ?? await deployedJson(`/admin/proof/kfc/sessions/${encodeURIComponent(sessionId)}/envelope`, { headers: adminHeaders });
        expect(envelope.complete).toBe(true);
        expect(envelope.verifiedStateCount).toBeGreaterThanOrEqual(script.userTurns.length);
        expect((envelope.checkpoints as unknown[]).length).toBeGreaterThanOrEqual(script.userTurns.length);
        expect(envelope.turnCount).toBe(script.userTurns.length * 2);
        const plannerPlans = envelope.plannerPlans as Array<{ payload: Record<string, unknown> }>;
        for (const counted of countedTurns) {
          expectDeployedPlannerOracle(
            counted.expectation,
            plannerPlans.filter(({ payload }) => payload.clientMessageId === counted.clientMessageId).map(({ payload }) => payload),
            counted.entries,
          );
        }
        if (scenarioCase.targetWidgetKinds) {
          deployedBindings.push({ scenarioId: script.id, fileName: scenarioCase.fileName, sessionId, customerId });
        }
      },
      10 * 60_000,
    );
  });
} else if (liveRequested && !openAiApiKey) {
  describe('live OpenAI scenario replay', () => {
    it('requires OPENAI_API_KEY when RUN_LIVE_AI_SCENARIOS=1', () => {
      throw new Error('Set OPENAI_API_KEY before running npm run test:live:scenarios');
    });
  });
} else {
  const describeLive = liveRequested ? describe : describe.skip;

  describeLive('live OpenAI scenario replay', () => {
    it('presents verified modifier options without a cart mutation', async () => {
      const script = await loadScenarioScript(modifierPickerScenarioPath);
      const planner = new RecordingToolPlanner(new OpenAIToolPlanner({
        apiKey: openAiApiKey ?? '',
        model: openAiModel,
        timeoutMs: openAiTimeoutMs,
      }));
      const result = await runScenario(script, {
        channelOverride: 'kfc',
        responseComposer: new OpenAIResponseComposer({ apiKey: openAiApiKey ?? '', model: openAiResponseModel }),
        toolPlanner: planner,
      });
      const modifierAttachment = result.transcript.at(-1)?.metadata?.genUi;

      expect(result.toolTrace).toEqual(expect.arrayContaining([
        expect.objectContaining({ toolName: 'getModifierOptions', ok: true, arguments: { code: '20752' } }),
      ]));
      expect(result.toolTrace.some((entry) => entry.toolName === 'updateCart')).toBe(false);
      expect(result.cart).toBeUndefined();
      expect(modifierAttachment).toMatchObject({
        widgetKind: 'modifierPicker',
        data: { modifierTree: { itemCode: '20752' } },
      });
      expect(modifierAttachment?.actions.length).toBeGreaterThan(0);
      expect(modifierAttachment?.actions.every((action) => action.id.startsWith('customize_item:'))).toBe(true);
    }, 120_000);

    it.concurrent.each(liveScenarioCases)(
      '$fileName satisfies planner and consolidated GenUI expectations',
      async (scenarioCase) => {
        const script = await loadScenarioScript(join(scenariosRoot, scenarioCase.fileName));
        const scenarioFixtures = liveScenarioFixtures(scenarioCase.fileName);
        const seededVerifiedState = initialVerifiedStateForScenario(scenarioCase);
        const seededMockOptions = mockClientOptionsForScenario(scenarioCase);
        const planner = new RecordingToolPlanner(
          new OpenAIToolPlanner({
            apiKey: openAiApiKey ?? '',
            model: openAiModel,
            timeoutMs: openAiTimeoutMs,
          }),
        );

        const result = await runScenario(script, {
          ...scenarioFixtures,
          accessContext: scenarioCase.requiresCustomerAccess
            ? controlledCustomerAccess({
                sessionId: `replay_${script.id}`,
                customerId: 'scenario_customer',
                channel: scenarioCase.targetWidgetKinds ? 'kfc' : script.channel,
              })
            : undefined,
          channelOverride: scenarioCase.targetWidgetKinds ? 'kfc' : undefined,
          responseComposer: new OpenAIResponseComposer({ apiKey: openAiApiKey ?? '', model: openAiResponseModel }),
          turnDeadlineMs: openAiTimeoutMs,
          initialVerifiedState: scenarioFixtures.initialVerifiedState || seededVerifiedState
            ? { ...scenarioFixtures.initialVerifiedState, ...seededVerifiedState }
            : undefined,
          toolPlanner: planner,
          mockClientOptions: scenarioFixtures.mockClientOptions || seededMockOptions
            ? { ...scenarioFixtures.mockClientOptions, ...seededMockOptions }
            : undefined,
          testFulfillmentQuoteProvider: async () => ({
            ok: true,
            value: { feeVnd: 18000, etaMinutes: 25 },
            message: 'live_ai_scenario_quote_fixture',
          }),
        });

        expect(result.coveredUseCases).toEqual(script.useCases);
        expect(result.transcript).toHaveLength(script.turns.length);
        expect(result.dashboardEvents.every((event) => !event.id.includes('scenario_'))).toBe(true);
        if (!scenarioCase.targetWidgetKinds && script.channel !== 'kfc') {
          const assistantReplies = result.transcript.filter((turn) => turn.role === 'assistant').map((turn) => turn.text);
          expect(assistantReplies.every((text) => !text.includes('Bước tiếp theo:'))).toBe(true);
          expect(assistantReplies.every((text) => !text.includes(' · '))).toBe(true);
          const standaloneTranscript = assistantReplies.join('\n');
          expect(standaloneTranscript).not.toMatch(
            /payment_failed|not_listed_in_policy|separate_channel_only|cancellation_failed|in_progress|awaiting_confirmation|ambiguous_pos_submission|partial_cancellation|status_conflict|pos_rejected/,
          );
          expect(standaloneTranscript).not.toMatch(
            /(?:Trạng thái đơn|Trạng thái thanh toán(?: \([^)]*\))?):\s*(?:previewed|created|preparing|delivering|completed|cancelled|not_started|pending|paid|failed)(?:\s|$)/,
          );
          expect(standaloneTranscript).not.toMatch(/Trạng thái POS:|Kết quả thương mại:|Trạng thái khách hàng:/);
        }
        if (scenarioCase.targetWidgetKinds) expectGenUi(result, scenarioCase, planner.records);
        const widgetKinds = result.transcript
          .map((turn) => turn.metadata?.genUi?.widgetKind)
          .filter((kind): kind is KfcGenUiWidgetKind => Boolean(kind));
        for (const forbiddenWidgetKind of scenarioCase.forbiddenWidgetKinds ?? []) {
          expect(widgetKinds).not.toContain(forbiddenWidgetKind);
        }
        const records = recordsByTurnIndex(script.userTurns, planner.records, scenarioCase.turnExpectations);
        const toolTraceByTurn = new Map(result.toolTraceByTurn.map(({ turnIndex, entries }) => [turnIndex, entries]));
        const evidenceByTurn = new Map(result.turnEvidence.map((evidence) => [evidence.turnIndex, evidence]));
        for (const expectation of scenarioCase.turnExpectations) {
          const entries = toolTraceByTurn.get(expectation.turnIndex) ?? [];
          const evidence = evidenceByTurn.get(expectation.turnIndex);
          expect(evidence, `${expectation.id} missing turn evidence`).toBeDefined();
          expectTurnToolGroups(records.get(expectation.turnIndex), expectation, {
            allRecords: planner.records,
            cart: result.cart,
            transcript: result.transcript,
            toolTrace: result.toolTrace,
            executedEntries: entries,
          });
          expectTurnOracle(expectation, records.get(expectation.turnIndex), entries, evidence!);
        }
        if (scenarioCase.fileName.startsWith('03-')) {
          const turnTrace = new Map(result.toolTraceByTurn.map(({ turnIndex, entries }) => [turnIndex, entries]));
          expect(
            result.toolTrace.some((entry) => entry.toolName === 'updateCart' && entry.ok),
            `scenario 03 must execute a successful cart update after the verified lookup: ${JSON.stringify({ records: planner.records, toolTrace: result.toolTrace })}`,
          ).toBe(true);
          expect(
            result.cart?.items.some((item) => item.name.toLowerCase().includes('zinger')),
            `scenario 03 must add the verified Zinger selection to the cart after lookup: ${JSON.stringify({ records: planner.records, cart: result.cart, toolTrace: result.toolTrace })}`,
          ).toBe(true);
          expect(result.cart?.items.some((item) => item.itemCode === '41140')).toBe(false);
          expect(turnTrace.get(1)?.some((entry) => entry.toolName === 'updateCart' && entry.ok)).toBe(false);
          expect(turnTrace.get(3)).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                toolName: 'updateCart',
                ok: true,
                arguments: expect.objectContaining({ itemCode: '41141', quantity: 1 }),
              }),
            ]),
          );
          expect(turnTrace.get(5)).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                toolName: 'quoteFulfillment',
                ok: true,
                arguments: expect.objectContaining({
                  address: expect.objectContaining({
                    line1: '123 Nguyễn Trãi',
                    district: 'Quận 5',
                    city: 'Hồ Chí Minh',
                  }),
                }),
              }),
            ]),
          );
          expect(result.dashboardEvents).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                type: 'session_updated',
                payload: expect.objectContaining({ updateType: 'delivery_quote', etaMinutes: 45, feeVnd: 18_000 }),
              }),
            ]),
          );
          expect(turnTrace.get(7)).toEqual(
            expect.arrayContaining([expect.objectContaining({ toolName: 'checkStoreAvailability', ok: true })]),
          );
          expect(turnTrace.get(9)?.some((entry) => entry.toolName === 'quoteFulfillment')).toBe(false);
          expect(result.finalAgentState?.address).toBeUndefined();
          expect(result.finalAgentState?.addressDraft).toMatchObject({ district: 'Quận 3', city: 'Hồ Chí Minh' });
          expect(result.finalAgentState?.addressDraft?.line1).toBeUndefined();
          expect(result.finalAgentState?.fulfillment).toBeUndefined();
          expect(result.order).toBeUndefined();
        }
        if (scenarioCase.fileName.startsWith('01-')) {
          const successfulUpdateIndex = result.toolTrace.findIndex(
            (entry) => entry.toolName === 'updateCart' && entry.ok,
          );
          const successfulQuoteIndex = result.toolTrace.findIndex(
            (entry) => entry.toolName === 'quoteFulfillment' && entry.ok,
          );
          const successfulOrderIndex = result.toolTrace.findIndex(
            (entry) => entry.toolName === 'placeOrder' && entry.ok,
          );
          const successfulPaymentLinkIndex = result.toolTrace.findIndex(
            (entry) => entry.toolName === 'createPaymentLink' && entry.ok,
          );
          const successfulQuote = result.toolTrace[successfulQuoteIndex];

          expect(
            successfulUpdateIndex,
            `scenario 01 must execute its fixture-verified cart mutation: ${JSON.stringify({ records: planner.records, cart: result.cart, toolTrace: result.toolTrace })}`,
          ).toBeGreaterThanOrEqual(0);
          expect(result.cart?.items.length).toBeGreaterThan(0);
          expect(
            result.cart?.items,
            `scenario 01 must preserve every separately requested line item and exact quantity: ${JSON.stringify({ records: planner.records, cart: result.cart, toolTrace: result.toolTrace })}`,
          ).toEqual(
            expect.arrayContaining([
              expect.objectContaining({ itemCode: '41141', quantity: 1 }),
              expect.objectContaining({ itemCode: '41074', quantity: 2 }),
              expect.objectContaining({
                itemCode: '20702',
                quantity: 1,
                category: expect.stringMatching(/combo/i),
                modifiers: expect.arrayContaining([
                  expect.objectContaining({ modifierName: expect.stringMatching(/cay/i) }),
                ]),
              }),
            ]),
          );
          expect(
            successfulQuoteIndex,
            `scenario 01 quote must execute successfully after cart mutation: ${JSON.stringify({ records: planner.records, cart: result.cart, toolTrace: result.toolTrace })}`,
          ).toBeGreaterThan(successfulUpdateIndex);
          expect(successfulQuote?.arguments.address).toEqual(
            expect.objectContaining({
              line1: expect.stringContaining('Nguyễn Hữu Thọ'),
              district: 'Quận 7',
              city: 'Hồ Chí Minh',
            }),
          );
          expect(
            successfulOrderIndex,
            `scenario 01 order must execute after successful fulfillment: ${JSON.stringify({ records: planner.records, order: result.order, toolTrace: result.toolTrace })}`,
          ).toBeGreaterThan(successfulQuoteIndex);
          expect(result.order).toMatchObject({
            status: 'created',
            cart: { items: expect.arrayContaining([expect.objectContaining({ itemCode: '41074', quantity: 2 })]) },
          });
          expect(result.toolTrace.filter((entry) => entry.toolName === 'collectInvoice' && entry.ok)).toEqual([{
            toolName: 'collectInvoice',
            arguments: {
              companyName: 'Công ty ABC',
              taxCode: '0312345678',
              email: 'finance@abc.test',
            },
            ok: true,
            resultSummary: expect.any(String),
            provenance: expect.any(Array),
          }]);
          expect(
            successfulPaymentLinkIndex,
            `scenario 01 ZaloPay link must execute after order creation: ${JSON.stringify({ records: planner.records, order: result.order, toolTrace: result.toolTrace })}`,
          ).toBeGreaterThan(successfulOrderIndex);
          expect(result.toolTrace[successfulPaymentLinkIndex]?.arguments).toEqual({ method: 'zalopay' });
        }
        if (scenarioCase.fileName.startsWith('02-')) {
          expect(result.cart?.items).toEqual([
            expect.objectContaining({
              itemCode: '20752',
              quantity: 2,
              unitPriceVnd: 143_000,
              modifiers: expect.arrayContaining([
                expect.objectContaining({ groupName: 'Drink 1', modifierName: 'Pepsi (Đại)' }),
                expect.objectContaining({ groupName: 'Drink 2', modifierName: 'Pepsi (Đại)' }),
              ]),
            }),
          ]);
          expect(result.cart?.items.some((item) => ['41037', '41035', '41074'].includes(item.itemCode))).toBe(false);
          expect(result.cart?.subtotalVnd).toBe(286_000);
          expect(result.cart?.totalVnd).toBe(286_000);
        }
        if (scenarioCase.fileName.startsWith('07-')) {
          const favoriteCombo = result.cart?.items.find((item) => item.itemCode === '20698');
          expect(
            favoriteCombo?.modifiers,
            `scenario 07 final cart and trace: ${JSON.stringify({ records: planner.records, cart: result.cart, toolTrace: result.toolTrace })}`,
          ).toEqual(expect.arrayContaining([
            expect.objectContaining({ modifierName: 'Trà Đào' }),
          ]));
          expect(
            favoriteCombo?.modifiers?.some((modifier) => modifier.modifierName.toLowerCase().includes('pepsi')),
          ).toBe(false);
          expect(result.cart?.items.some((item) => item.itemCode === 'MOCK-PEACH-TEA')).toBe(false);
        }
      },
      300_000,
    );
  });
}
