import { createHash } from 'node:crypto';
import { join } from 'node:path';
import {
  AIMessage,
  type BaseMessage,
  type ToolCall,
} from '@langchain/core/messages';
import { fakeModel } from '@langchain/core/testing';
import { describe, expect, it } from 'vitest';
import type {
  LiveQualityExperimentOutput,
  TurnExpectation,
} from '../../src/evaluation/liveQualityContracts.js';
import {
  createLiveQualityV3ExperimentEvaluator,
} from '../../src/evaluation/liveQualityEvaluators.js';
import {
  projectStateGraphScenarioRun,
} from '../../src/evaluation/liveQualityStateGraph.js';
import type {
  SemanticResponseJudge,
} from '../../src/evaluation/semanticResponseJudge.js';
import {
  semanticResponseRequirementIds,
} from '../../src/evaluation/semanticResponseJudge.js';
import type { Channel } from '../../src/domain/types.js';
import { loadGeneratedFixtures } from '../../src/fixtures/loadFixtures.js';
import { stateRevision } from '../../src/graph/turnSupport.js';
import {
  createAgentToolCapabilitySnapshot,
  deriveAgentToolProfile,
} from '../../src/agent/agentToolProfile.js';
import {
  createNoopAgentTracer,
  type AgentTraceSpanInput,
  type AgentTracer,
} from '../../src/observability/agentTracing.js';
import {
  TOOL_NAMES,
  type CommerceApprovalCapability,
  type ToolName,
} from '../../src/ordering/types.js';
import {
  approvalCapabilityScopes,
  approvalCapabilitySupportsGuestCheckout,
} from '../../src/ordering/toolBoundaries.js';
import {
  issueControlledMessengerMockGuestCheckoutAuthority,
} from '../../src/security/guestCheckoutAuthority.js';
import {
  runScenario,
  type ScenarioRunResult,
} from '../../src/scenarios/runner.js';
import {
  loadScenarioScript,
  type ScenarioScript,
} from '../../src/scenarios/scenarioScript.js';
import {
  groundedResponseModelReply,
} from '../fixtures/groundedResponse.js';
import {
  controlledScenarioCustomerAccess,
} from './controlledScenarioCustomerAccess.js';
import {
  liveQualityV3CandidateCases as datasetCases,
  liveScenarioCasesV3Candidate as liveScenarioCases,
} from './scenarioCoverageLedgerV3Candidate.js';
import {
  liveScenarioFixtures,
} from './liveScenarioFixtures.js';

const serviceRoot = process.cwd();
const scenariosRoot = join(
  serviceRoot,
  '../../ai-talent-tracks/fnb/conversations',
);
const confirmationSigningSecret =
  'offline-stategraph-scenario-replay-secret-v1';
const controlledHandoffReplayIdentities =
  new Map<string, string>([
  [
    '04-sau-khi-dat-don.json',
    '04-sau-khi-dat-don',
  ],
  [
    '05-khieu-nai-va-human-handoff.json',
    '05-khieu-nai-va-human-handoff',
  ],
  [
    '08-thanh-toan-loi-va-don-bat-thuong.json',
    '08-thanh-toan-loi-va-don-bat-thuong',
  ],
  ]);

interface ScriptedToolCall extends ToolCall {
  name: ToolName;
  args: Record<string, unknown>;
}

/**
 * One entry is one provider-authored tool-call batch. Separate entries model
 * the provider observing a returned tool result before authoring the next
 * batch. Empty turns proceed directly to the typed final-response call.
 */
type TurnPlan = ScriptedToolCall[][];
type ScenarioPlan = Record<number, TurnPlan>;

const call = (
  name: ToolName,
  args: Record<string, unknown>,
): ScriptedToolCall => ({ name, args });

const update = (
  ...changes: Array<{
    itemCode: string;
    quantity: number;
    modifiers?: Array<{
      groupId: string;
      modifierId: string;
      quantity?: number | null;
    }>;
  }>
): ScriptedToolCall => call('updateCart', {
  changes: changes.map((change) => ({
    ...change,
    modifiers: change.modifiers ?? [],
  })),
});

const filtered = (query: string) => ({
  scope: 'filtered',
  query,
});

const pendingSavedAddressRefSentinel = {
  id: '00000000-0000-4000-8000-000000000000',
  kind: 'saved_address',
} as const;

const plans: Record<string, ScenarioPlan> = {
  '01-dat-mon-ro-rang-giao-hang.json': {
    1: [
      [call('searchMenu', { scope: 'all', query: null })],
      [
        call('getItemDetails', { code: '20702' }),
        call('getModifierOptions', { code: '20702' }),
      ],
      [update(
        {
          itemCode: '20702',
          quantity: 1,
          modifiers: [
            {
              groupId: '1',
              modifierId: '41036',
              quantity: 1,
            },
            {
              groupId: '2',
              modifierId: '41042',
              quantity: 1,
            },
            {
              groupId: '3',
              modifierId: '41063',
              quantity: 1,
            },
            {
              groupId: '60254',
              modifierId: '70012',
              quantity: 2,
            },
            {
              groupId: '60258',
              modifierId: '70443',
              quantity: 1,
            },
            {
              groupId: '4',
              modifierId: '41090',
              quantity: 1,
            },
            {
              groupId: '5',
              modifierId: '41090',
              quantity: 1,
            },
          ],
        },
        { itemCode: '41141', quantity: 1 },
        { itemCode: '41074', quantity: 2 },
      )],
    ],
    3: [[call('quoteFulfillment', {
      address: {
        label: 'Chung cư Sunrise City',
        line1:
          'Chung cư Sunrise City, 23 Nguyễn Hữu Thọ, phường Tân Hưng',
        district: 'Quận 7',
        city: null,
      },
      method: 'delivery',
    })]],
    5: [[call('validateVoucher', { voucherText: 'KFC50' })]],
    7: [[call('listPaymentMethods', {
      query: null,
      paymentSurface: null,
    })]],
    9: [],
    11: [
      [
        call('collectInvoice', {
          companyName: 'Công ty ABC',
          taxCode: '0312345678',
          email: 'finance@abc.test',
        }),
        call('checkStoreAvailability', {
          storeId: 'KFCVN0318',
          disposition: 'delivery',
        }),
      ],
      [call('previewOrder', {})],
      [call('placeOrder', {})],
      [call('createPaymentLink', { methodId: 'zalopay_wallet' })],
    ],
  },
  '02-tu-van-combo-va-upsell.json': {
    1: [[call('searchMenu', { scope: 'all', query: null })]],
    3: [[
      call('searchMenu', { scope: 'all', query: null }),
      call('searchPromotions', filtered('ưu đãi phù hợp hôm nay')),
    ]],
    5: [[
      call('getItemDetails', { code: '20752' }),
      update(
        { itemCode: '41037', quantity: 3 },
        { itemCode: '41035', quantity: 1 },
        { itemCode: '41074', quantity: 4 },
      ),
    ]],
    7: [[
      call('getModifierOptions', { code: '20752' }),
      update(
        { itemCode: '41037', quantity: 0 },
        { itemCode: '41035', quantity: 0 },
        { itemCode: '41074', quantity: 0 },
        { itemCode: '20752', quantity: 2 },
      ),
    ]],
    9: [[update({
      itemCode: '20752',
      quantity: 2,
      modifiers: [
        { groupId: '2', modifierId: '41091', quantity: null },
        { groupId: '3', modifierId: '41091', quantity: null },
      ],
    })]],
  },
  '03-ton-kho-dia-chi-va-cua-hang.json': {
    1: [[call('searchMenu', filtered('Burger Tôm'))]],
    3: [
      [
        call('searchMenu', filtered('Zinger Burger')),
        call('getSavedAddresses', {}),
      ],
      [update({ itemCode: '41141', quantity: 1 })],
    ],
    5: [[call('quoteFulfillment', {
      savedAddressRef: pendingSavedAddressRefSentinel,
      method: 'delivery',
    })]],
    7: [[call('checkStoreAvailability', {
      storeId: 'KFCVN0257',
      disposition: 'delivery',
    })]],
    9: [[call('findStores', {
      query: null,
      city: 'Hồ Chí Minh',
      district: 'Quận 3',
    })]],
  },
  '04-sau-khi-dat-don.json': {
    1: [[call('getOrderStatus', {})]],
    3: [[call('getOrderStatus', {})]],
    5: [[call('getOrderStatus', {})]],
    7: [],
    9: [[call('getOrderStatus', {})]],
    11: [[
      call('getOrderStatus', {}),
    ], [
      call('handoff', {
        reasons: ['order_cancellation_after_preparation'],
      }),
    ]],
    13: [[call('resolveHandoff', {})]],
    15: [
      [call('searchMenu', { scope: 'all', query: null })],
      [update({ itemCode: '20751', quantity: 1 })],
    ],
  },
  '05-khieu-nai-va-human-handoff.json': {
    1: [],
    3: [],
    5: [],
    7: [[call('handoff', {
      reasons: [
        'missing_item',
        'wrong_item',
        'late_delivery',
        'angry_customer',
        'human_requested',
      ],
    })]],
    9: [],
  },
  '06-ngon-ngu-tu-nhien-va-an-toan.json': {
    1: [[call('searchMenu', filtered('2 gà cay 1 Pepsi'))]],
    3: [[
      call('searchContentPolicy', {
        kind: 'allergen',
        scope: 'filtered',
        query: 'không cay không phô mai',
      }),
      call('answerAllergenQuestion', {
        query: 'không cay không phô mai',
      }),
    ]],
    5: [],
    7: [],
    9: [],
    11: [],
  },
  '07-ca-nhan-hoa-va-loyalty.json': {
    1: [],
    3: [],
    5: [
      [
        call('searchMenu', filtered('Combo Burger Zinger')),
        call('getMembershipProfile', {}),
        call('listMembershipRewards', { scope: 'all', query: null }),
        call('listMembershipWallet', { status: 'active' }),
        call('getMembershipPointHistory', { days: 30 }),
        call('listMembershipTools', { sideEffect: null }),
      ],
      [update({ itemCode: '20698', quantity: 1 })],
    ],
    7: [
      [call('getModifierOptions', { code: '20698' })],
      [update({
        itemCode: '20698',
        quantity: 1,
        modifiers: [{
          groupId: '3',
          modifierId: 'MOCK-PEACH-TEA-MODIFIER',
          quantity: 1,
        }],
      })],
    ],
    9: [
      [call('acquireVoucher', {
        rewardId: 'reward-discount-10k',
      })],
      [call('redeemReward', {
        voucherId: 'wallet-new-member-25k',
        channel: 'zalo_miniapp',
      })],
    ],
  },
  '08-thanh-toan-loi-va-don-bat-thuong.json': {
    1: [[call('checkPaymentStatus', {})]],
    3: [[call('checkPaymentStatus', {})]],
    5: [[call('handoff', {
      reasons: [
        'payment_failed',
        'abnormal_large_order',
        'human_review_required',
      ],
    })]],
    7: [],
  },
  '09-phuong-thuc-thanh-toan.json': {
    1: [[call('listPaymentMethods', {
      query: null,
      paymentSurface: null,
    })]],
    3: [[call('listPaymentMethods', {
      query: 'MoMo',
      paymentSurface: null,
    })]],
  },
};

const expectedFinalStates: Record<string, string> = {
  '01-dat-mon-ro-rang-giao-hang.json': 'order_created',
  '02-tu-van-combo-va-upsell.json': 'cart_ready',
  '03-ton-kho-dia-chi-va-cua-hang.json': 'needs_customer_decision',
  '04-sau-khi-dat-don.json': 'post_order_handled',
  '05-khieu-nai-va-human-handoff.json': 'human_handoff_created',
  '06-ngon-ngu-tu-nhien-va-an-toan.json': 'clarification_needed',
  '07-ca-nhan-hoa-va-loyalty.json': 'cart_updated',
  '08-thanh-toan-loi-va-don-bat-thuong.json': 'human_review_required',
  '09-phuong-thuc-thanh-toan.json': 'payment_methods_answered',
};

const expectedHandoffReasons: Record<string, string[]> = {
  '05-khieu-nai-va-human-handoff.json': [
    'missing_item',
    'wrong_item',
    'late_delivery',
    'angry_customer',
    'human_requested',
  ],
  '08-thanh-toan-loi-va-don-bat-thuong.json': [
    'payment_failed',
    'abnormal_large_order',
    'human_review_required',
  ],
};

/**
 * Scripted prose is never accepted as semantic evidence. The evaluator still
 * loads every canonical obligation, but this offline replay asserts only its
 * structural scores, including grounded tool-outcome polarity and evidence.
 * Customer-prose semantics belong to the independent model judge in
 * paid/live qualification.
 */
const deferredSemanticJudge: SemanticResponseJudge = {
  async judge({ expectation }) {
    return {
      passed: false,
      requirements: semanticResponseRequirementIds(expectation).map(
        (requirementId) => ({
          requirementId,
          passed: false,
          reason: 'missing' as const,
        }),
      ),
    };
  },
};

function pendingSavedAddressRef(
  messages: BaseMessage[],
): { id: string; kind: 'saved_address' } | undefined {
  for (const message of [...messages].reverse()) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(message.text);
    } catch {
      continue;
    }
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('publication' in parsed)
    ) {
      continue;
    }
    const publication = parsed.publication;
    if (
      typeof publication !== 'object' ||
      publication === null ||
      !('modelState' in publication)
    ) {
      continue;
    }
    const modelState = publication.modelState;
    if (
      typeof modelState !== 'object' ||
      modelState === null ||
      !('pendingSavedAddressRef' in modelState)
    ) {
      continue;
    }
    const ref = modelState.pendingSavedAddressRef;
    if (
      typeof ref === 'object' &&
      ref !== null &&
      'id' in ref &&
      typeof ref.id === 'string' &&
      'kind' in ref &&
      ref.kind === 'saved_address'
    ) {
      return { id: ref.id, kind: ref.kind };
    }
  }
  return undefined;
}

function dynamicToolBatch(
  batch: ScriptedToolCall[],
  messages: BaseMessage[],
): AIMessage | Error {
  const ref = batch.some((toolCall) =>
    toolCall.name === 'quoteFulfillment' &&
    toolCall.args.savedAddressRef === pendingSavedAddressRefSentinel)
    ? pendingSavedAddressRef(messages)
    : undefined;
  if (
    batch.some((toolCall) =>
      toolCall.name === 'quoteFulfillment' &&
      toolCall.args.savedAddressRef === pendingSavedAddressRefSentinel) &&
    !ref
  ) {
    return new Error('offline_pending_saved_address_ref_missing');
  }
  return new AIMessage({
    content: '',
    tool_calls: batch.map((toolCall, index) => ({
      name: toolCall.name,
      args: toolCall.args.savedAddressRef === pendingSavedAddressRefSentinel
        ? { ...toolCall.args, savedAddressRef: ref }
        : toolCall.args,
      id: `offline_dynamic_tool_${index}`,
      type: 'tool_call' as const,
    })),
  });
}

function scriptedModel(
  expectationByTurn: ReadonlyMap<number, TurnExpectation>,
  scenarioPlan: ScenarioPlan,
) {
  const model = fakeModel();
  for (const [turnIndex, expectation] of [...expectationByTurn.entries()]
    .sort(([left], [right]) => left - right)) {
    const batches = scenarioPlan[turnIndex];
    if (!batches) {
      throw new Error(`offline_scenario_plan_missing:${expectation.id}`);
    }
    for (const batch of batches) {
      if (batch.some((toolCall) =>
        toolCall.args.savedAddressRef === pendingSavedAddressRefSentinel)) {
        model.respond((messages) => dynamicToolBatch(batch, messages));
      } else {
        model.respondWithTools(batch);
      }
    }
    model.respond(groundedResponseModelReply({
      // This identifier is correlation text, not semantic quality evidence.
      customerText: `Offline StateGraph replay completed ${expectation.id}.`,
    }));
  }
  return model;
}

function initialState(fileName: string) {
  return structuredClone(
    liveScenarioFixtures(fileName).initialVerifiedState ?? {},
  );
}

function accessFor(
  fileName: string,
  script: ScenarioScript,
  channel: Channel,
) {
  const access = controlledScenarioCustomerAccess({
    sessionId: `replay_${script.id}`,
    customerId: 'scenario_customer',
    channel,
  });
  const handoffScenarioId =
    controlledHandoffReplayIdentities.get(fileName);
  return handoffScenarioId === script.id
    ? {
        ...access,
        authorizedScopes: [
          ...new Set([
            ...access.authorizedScopes,
            'handoff:write' as const,
          ]),
        ],
      }
    : access;
}

function expectedSuccessfulApprovalCapabilities(
  expectation: TurnExpectation | undefined,
  hasCustomerAccess: boolean,
  hasGuestCheckoutAuthority = false,
): string[] {
  if (!expectation) return [];
  return [...new Set(expectation.claims.required.flatMap((claim) =>
    claim.kind === 'grounded_tool_outcome' &&
    claim.expectedOk === true
      ? claim.anyOf.filter((toolName) =>
          isApprovalCapability(toolName) &&
          (
            hasCustomerAccess ||
            (
              hasGuestCheckoutAuthority &&
              approvalCapabilitySupportsGuestCheckout(toolName)
            )
          ))
      : []))];
}

function isApprovalCapability(
  toolName: ToolName,
): toolName is CommerceApprovalCapability {
  return toolName in approvalCapabilityScopes;
}

interface ModeReplay {
  result: ScenarioRunResult;
  traces: Array<Omit<AgentTraceSpanInput, 'runType'>>;
}

interface Replay {
  text: ModeReplay;
  genUi: ModeReplay;
  script: ScenarioScript;
}

async function replayMode(input: {
  fileName: string;
  script: ScenarioScript;
  expectationByTurn: ReadonlyMap<number, TurnExpectation>;
  requiresCustomerAccess: boolean;
  mode: 'text' | 'genui';
}): Promise<ModeReplay> {
  const {
    fileName,
    script,
    expectationByTurn,
    requiresCustomerAccess,
    mode,
  } = input;
  const hasGuestCheckoutAuthority =
    fileName === '01-dat-mon-ro-rang-giao-hang.json';
  const channel: Channel =
    mode === 'text' || hasGuestCheckoutAuthority
      ? 'messenger_mock'
      : 'kfc';
  const fixtureOptions = liveScenarioFixtures(fileName);
  const traces: Array<Omit<AgentTraceSpanInput, 'runType'>> = [];
  const noop = createNoopAgentTracer();
  const tracer: AgentTracer = {
    async startTurn(input) {
      traces.push(input);
      return noop.startTurn(input);
    },
    async flush() {},
  };
  const model = scriptedModel(expectationByTurn, plans[fileName] ?? {});
  let result: ScenarioRunResult;
  try {
    result = await runScenario(script, {
      agentModel: model,
      accessContext: requiresCustomerAccess
        ? accessFor(fileName, script, channel)
        : undefined,
      channelOverride: channel,
      responseProfileOverride:
        mode === 'genui' ? 'genui' : 'social',
      ...(hasGuestCheckoutAuthority
        ? {
            guestCheckoutAuthorityForTurn: async (authorityInput) =>
              issueControlledMessengerMockGuestCheckoutAuthority(
                authorityInput,
              ),
          }
        : {}),
      initialVerifiedState: await initialState(fileName),
      mockClientOptions: fixtureOptions.mockClientOptions,
      mockedUpstreamApiForTurn: (turnIndex) =>
        fileName === '03-ton-kho-dia-chi-va-cua-hang.json' &&
          turnIndex === 1
          ? undefined
          : fixtureOptions.mockedUpstreamApiForTurn?.(turnIndex),
      transformFixtures: (fixtures) => {
        const transformed =
          fixtureOptions.transformFixtures?.(fixtures) ?? fixtures;
        return fileName === '03-ton-kho-dia-chi-va-cua-hang.json'
          ? {
              ...transformed,
              menuItems: transformed.menuItems.map((item) =>
                item.code === '41140'
                  ? { ...item, available: false }
                  : item),
            }
          : transformed;
      },
      tracer,
      traceRunId: `offline-stategraph:${script.id}:${mode}`,
      autoApproveConfirmations:
        requiresCustomerAccess || hasGuestCheckoutAuthority
        ? ({ turnIndex, capability }) =>
            expectedSuccessfulApprovalCapabilities(
              expectationByTurn.get(turnIndex),
              requiresCustomerAccess,
              hasGuestCheckoutAuthority,
            ).includes(capability)
        : false,
      ...(requiresCustomerAccess || hasGuestCheckoutAuthority
        ? { confirmationSigningSecret }
        : {}),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `${fileName}:${mode}:model_call_${model.callCount}:${message}`,
      { cause: error },
    );
  }
  return { result, traces };
}

async function replayScenario(fileName: string): Promise<Replay> {
  const scenarioCase = liveScenarioCases.find(
    (candidate) => candidate.fileName === fileName,
  );
  if (!scenarioCase) throw new Error(`offline_scenario_case_missing:${fileName}`);
  const script = await loadScenarioScript(join(scenariosRoot, fileName));
  const expectationByTurn = new Map(
    scenarioCase.turnExpectations.map((expectation) => [
      expectation.turnIndex,
      expectation,
    ]),
  );
  const [text, genUi] = await Promise.all([
    replayMode({
      fileName,
      script,
      expectationByTurn,
      requiresCustomerAccess:
        scenarioCase.requiresCustomerAccess === true,
      mode: 'text',
    }),
    replayMode({
      fileName,
      script,
      expectationByTurn,
      requiresCustomerAccess:
        scenarioCase.requiresCustomerAccess === true,
      mode: 'genui',
    }),
  ]);
  return { text, genUi, script };
}

const nonStructuralScoreKeys = new Set([
  'semantic_response',
  'acceptance',
]);

async function structuralEvaluationIssues(
  textResult: ScenarioRunResult,
  genUiResult: ScenarioRunResult,
  scenarioFile: string,
): Promise<string[]> {
  const scenarioCase = liveScenarioCases.find(
    (candidate) => candidate.fileName === scenarioFile,
  );
  if (!scenarioCase) throw new Error('offline_scenario_case_missing');
  const evaluator = createLiveQualityV3ExperimentEvaluator(datasetCases, {
    semanticJudge: deferredSemanticJudge,
  });
  const textOutputs = projectStateGraphScenarioRun(textResult, 'text');
  const genUiOutputs = projectStateGraphScenarioRun(
    genUiResult,
    'genui',
  );
  const issues: string[] = [];
  for (const [index, expectation] of scenarioCase.turnExpectations.entries()) {
    const modes: Array<
      readonly ['text' | 'genui', LiveQualityExperimentOutput[]]
    > = [['text', textOutputs]];
    if (expectation.genUi.required) modes.push(['genui', genUiOutputs]);
    for (const [mode, outputs] of modes) {
      const output = outputs[index];
      if (!output) {
        issues.push(`${expectation.id}:${mode}:missing output`);
        continue;
      }
      const scores = await evaluator({
        inputs: { caseId: `${expectation.id}:${mode}` },
        outputs: { ...output },
      });
      issues.push(...scores.flatMap(({ key, score, comment }) =>
        score === 1 || nonStructuralScoreKeys.has(key)
          ? []
          : [`${expectation.id}:${mode}:${key}:${comment ?? 'failed'}`]));
    }
  }
  return issues;
}

function toolNames(result: ScenarioRunResult): ToolName[] {
  return result.toolTrace.map(({ toolName }) => toolName);
}

function eventPayloads(result: ScenarioRunResult, type: string): unknown[] {
  return result.dashboardEvents
    .filter((event) => event.type === type)
    .map(({ payload }) => payload);
}

function expectApprovalResumes(
  fileName: string,
  result: ScenarioRunResult,
) {
  const scenarioCase = liveScenarioCases.find(
    (candidate) => candidate.fileName === fileName,
  );
  if (!scenarioCase) throw new Error('offline_scenario_case_missing');
  const expectationByTurn = new Map(
    scenarioCase.turnExpectations.map((expectation) => [
      expectation.turnIndex,
      expectation,
    ]),
  );
  for (const evidence of result.turnEvidence) {
    const expected = expectedSuccessfulApprovalCapabilities(
      expectationByTurn.get(evidence.turnIndex),
      scenarioCase.requiresCustomerAccess === true,
      fileName === '01-dat-mon-ro-rang-giao-hang.json',
    );
    expect(evidence.approvalResumes.map(({ capability }) => capability))
      .toEqual(expected);
    expect(evidence.approvalRequested).toBe(expected.length > 0);
  }
}

function expectReadableCheckpoints(result: ScenarioRunResult) {
  for (const evidence of result.turnEvidence) {
    expect(evidence.checkpointId?.trim()).toBeTruthy();
    expect(typeof evidence.checkpointNamespace).toBe('string');
    expect(evidence.checkpointThreadId?.trim()).toBeTruthy();
    expect(evidence.checkpointVerified).toBe(true);
  }
}

function expectTraceCorrelation(input: {
  modeReplay: ModeReplay;
  mode: 'text' | 'genui';
  script: ScenarioScript;
  turnExpectations: TurnExpectation[];
}) {
  const { modeReplay, mode, script, turnExpectations } = input;
  expect(new Set(modeReplay.traces.map(({ metadata }) =>
    metadata?.clientMessageId))).toEqual(new Set(
    turnExpectations.map(({ turnIndex }) =>
      `${script.id}:${turnIndex}`),
  ));
  expect(modeReplay.traces.length)
    .toBeGreaterThanOrEqual(turnExpectations.length);
  for (const trace of modeReplay.traces) {
    expect(trace.metadata).toMatchObject({
      scenarioId: script.id,
      probeRunId: `offline-stategraph:${script.id}:${mode}`,
    });
    expect(trace.tags).toEqual(expect.arrayContaining([
      `scenario:${script.id}`,
      `session:replay_${script.id}`,
    ]));
  }
}

async function expectScenarioTwoContracts(replay: Replay) {
  const fixtureOptions = liveScenarioFixtures(
    '02-tu-van-combo-va-upsell.json',
  );
  const generated = await loadGeneratedFixtures(serviceRoot);
  const expectedFixtures =
    fixtureOptions.transformFixtures?.(generated) ?? generated;
  const second = replay.text.result;
  const secondGenUi = replay.genUi.result;
  expect(second.cart).toMatchObject({
    items: [{
      itemCode: '20752',
      quantity: 2,
      unitPriceVnd: 143_000,
    }],
    subtotalVnd: 286_000,
    totalVnd: 286_000,
  });
  expect(second.cart?.items.some(({ itemCode }) =>
    ['41037', '41035', '41074'].includes(itemCode))).toBe(false);
  const allMenuTurn = secondGenUi.turnEvidence.find(
    ({ turnIndex }) => turnIndex === 3,
  )!;
  const allMenuTrace = second.toolTraceByTurn.find(
    ({ turnIndex }) => turnIndex === 3,
  )!.entries;
  expect(allMenuTrace).toEqual(expect.arrayContaining([
    expect.objectContaining({
      toolName: 'searchMenu',
      arguments: { scope: 'all', query: null },
    }),
    expect.objectContaining({ toolName: 'searchPromotions' }),
  ]));
  expect(allMenuTurn.stateAfter.cart).toEqual(allMenuTurn.stateBefore.cart);
  expect(allMenuTurn.stateAfter.activeMenuCollection?.result)
    .toMatchObject({ complete: true });
  expect(allMenuTurn.genUi).toMatchObject({
    widgetKind: 'smartMenuPicker',
    data: {
      complete: true,
      items: expect.any(Array),
      categories: expect.any(Array),
    },
  });
  const menuData = allMenuTurn.genUi?.data;
  if (
    !Array.isArray(menuData?.items) ||
    !Array.isArray(menuData.categories)
  ) {
    throw new Error('offline_all_menu_genui_collection_missing');
  }
  const expectedMenuItems =
    allMenuTurn.stateAfter.activeMenuCollection?.result.items ?? [];
  expect(expectedMenuItems.length).toBeGreaterThan(0);
  expect(menuData.items).toEqual(expectedMenuItems);
  const projectedCodes = menuData.items.flatMap((item) =>
    typeof item === 'object' &&
    item !== null &&
    'code' in item &&
    typeof item.code === 'string'
      ? [item.code]
      : []);
  expect(projectedCodes).toHaveLength(menuData.items.length);
  expect(new Set(projectedCodes)).toEqual(new Set(
    expectedFixtures.menuItems.map(({ code }) => code),
  ));
  expect(menuData.categories).toEqual([
    ...new Map(expectedFixtures.menuItems.map(
      ({ categoryId, category }) => [
        categoryId,
        { categoryId, label: category },
      ],
    )).values(),
  ]);
  expect(menuData.promotions).toEqual(
    allMenuTurn.stateAfter.promotionOffers,
  );

  const modifierTurn = secondGenUi.turnEvidence.find(
    ({ turnIndex }) => turnIndex === 7,
  )!;
  expect(modifierTurn.genUi).toMatchObject({
    widgetKind: 'modifierPicker',
    data: {
      modifierTree: { itemCode: '20752' },
    },
    authority: {
      schemaVersion: 'kfc-genui-v1',
      sessionId: 'replay_02-tu-van-combo-va-upsell',
      customerId: 'scenario_customer',
      verifiedRevision: expect.stringMatching(/^[0-9a-f]{64}$/u),
      actionLifecycle: 'replayable',
    },
  });
  const modifierTree = modifierTurn.stateAfter.menuModifierOptions;
  expect(modifierTree).toBeDefined();
  expect(modifierTurn.genUi?.data.modifierTree).toEqual(
    modifierTree,
  );
  const modifierActions = modifierTurn.genUi?.actions ?? [];
  const expectedModifierActions = (
    modifierTree?.modifierGroups ?? []
  ).flatMap((group) =>
    group.options.map((option) => ({
      id:
        `customize_item:${encodeURIComponent(group.groupId)}` +
        `:${encodeURIComponent(option.modifierId)}`,
      payload: {
        itemCode: modifierTree!.itemCode,
        groupId: group.groupId,
        modifierId: option.modifierId,
      },
    })));
  expect(expectedModifierActions.length).toBeGreaterThan(0);
  expect(modifierActions).toEqual(expectedModifierActions.map((action) =>
    expect.objectContaining(action)));
  expect(new Set(modifierActions.map(({ id }) => id)).size)
    .toBe(modifierActions.length);
}

describe('offline canonical StateGraph scenario replay', () => {
  it('grants handoff only to exact controlled scenario identities', async () => {
    const handoffFile =
      '05-khieu-nai-va-human-handoff.json';
    const handoffScript = await loadScenarioScript(
      join(scenariosRoot, handoffFile),
    );
    const wrongFile =
      '02-tu-van-combo-va-upsell.json';
    const wrongScript = await loadScenarioScript(
      join(scenariosRoot, wrongFile),
    );
    const handoffAccess = accessFor(
      handoffFile,
      handoffScript,
      'kfc',
    );
    const wrongScenarioAccess = accessFor(
      wrongFile,
      wrongScript,
      'kfc',
    );
    const mismatchedIdentityAccess = accessFor(
      handoffFile,
      wrongScript,
      'kfc',
    );
    const advertised = (
      accessContext: ReturnType<typeof accessFor>,
      script: ScenarioScript,
    ) => deriveAgentToolProfile({
      lifecycle: {
        sessionId: `replay_${script.id}`,
        customerId: 'scenario_customer',
        channel: 'kfc',
      },
      accessContext,
      capabilities: createAgentToolCapabilitySnapshot({
        channel: 'kfc',
        enabledTools: TOOL_NAMES,
        durableApprovalResumeSupported: true,
        handoffResolutionSupported: true,
      }),
      now: Date.parse('2026-07-20T00:00:00.000Z'),
    });

    expect(advertised(handoffAccess, handoffScript))
      .toContain('handoff');
    expect(advertised(wrongScenarioAccess, wrongScript))
      .not.toContain('handoff');
    expect(advertised(mismatchedIdentityAccess, wrongScript))
      .not.toContain('handoff');

    const probeTurn = {
      index: 1,
      speaker: 'User' as const,
      text: 'Please connect me to support.',
      useCases: ['handoff-scope-probe'],
    };
    const probeScript: ScenarioScript = {
      id: wrongScript.id,
      title: 'Wrong-scenario handoff scope probe',
      channel: 'kfc',
      goal: 'Prove handoff is not executable outside its exact scope',
      useCases: probeTurn.useCases,
      finalState: 'handoff_not_executed',
      turns: [probeTurn],
      userTurns: [probeTurn],
      expectations: [],
    };
    const probeModel = fakeModel()
      .respondWithTools([{
        name: 'handoff',
        args: { reasons: ['customer_requested_support'] },
      }])
      .respond(groundedResponseModelReply({
        customerText: 'Support handoff was not created.',
      }));
    const result = await runScenario(probeScript, {
      agentModel: probeModel,
      accessContext: wrongScenarioAccess,
    });

    expect(result.toolTrace.map(({ toolName }) => toolName))
      .not.toContain('handoff');
    expect(result.finalAgentState?.handoff).toBeUndefined();
  });

  it('pins the canonical nine-scenario, 46-turn corpus', () => {
    expect(liveScenarioCases).toHaveLength(9);
    expect(liveScenarioCases.reduce(
      (total, scenarioCase) =>
        total + scenarioCase.turnExpectations.length,
      0,
    )).toBe(46);
  });

  it.each(liveScenarioCases)(
    '$fileName executes every canonical structural contract through the graph',
    async ({ fileName, turnExpectations }) => {
      const { text, genUi, script } = await replayScenario(fileName);
      const expectedFinalState = expectedFinalStates[fileName];
      const handoffReasons = expectedHandoffReasons[fileName];
      expect(expectedFinalState).toBeDefined();
      for (const { result } of [text, genUi]) {
        expect(result.finalState).toBe(script.finalState);
        expect(result.finalState).toBe(expectedFinalState);
        expect(result.turnEvidence).toHaveLength(turnExpectations.length);
        expect(result.transcript).toHaveLength(script.turns.length);
        expect(result.coveredUseCases).toEqual(script.useCases);
        expect(result.dashboardEvents.every(
          (event) => !event.id.includes('scenario_'),
        )).toBe(true);
        if (handoffReasons) {
          expect(eventPayloads(result, 'handoff_required')).toEqual([
            expect.objectContaining({
              escalationId: expect.stringMatching(/^handoff_/u),
              reasons: handoffReasons,
            }),
          ]);
        }
        if (fileName === '04-sau-khi-dat-don.json') {
          const resolution = result.turnEvidence.find(
            ({ turnIndex }) => turnIndex === 13,
          );
          const escalationId =
            resolution?.stateBefore.handoff?.escalationId;
          expect(escalationId).toMatch(/^handoff_/u);
          expect(result.toolTrace.filter(
            ({ toolName }) => toolName === 'resolveHandoff',
          )).toEqual([
            expect.objectContaining({
              arguments: { escalationId },
              ok: true,
              provenance: expect.arrayContaining([
                expect.objectContaining({
                  sourceApi: 'mock-commerce-provider',
                }),
              ]),
              publicationEvidenceAudit: expect.objectContaining({
                argumentsDigest: createHash('sha256')
                  .update(JSON.stringify({ escalationId }))
                  .digest('hex'),
              }),
            }),
          ]);
          expect(result.finalAgentState?.handoff).toBeUndefined();
          expect(eventPayloads(result, 'session_updated').filter(
            (payload) =>
              (payload as { updateType?: unknown }).updateType ===
              'handoff_resolved',
          )).toEqual([
            expect.objectContaining({
              escalationId: expect.stringMatching(/^handoff_/u),
            }),
          ]);
          expect(resolution?.stateBefore.handoff).toBeDefined();
          expect(resolution?.stateAfter.handoff).toBeUndefined();
          expect(resolution?.approvalRequested).toBe(true);
        }
        expectApprovalResumes(fileName, result);
        expectReadableCheckpoints(result);
      }
      expect(
        await structuralEvaluationIssues(
          text.result,
          genUi.result,
          fileName,
        ),
      ).toEqual([]);
      expectTraceCorrelation({
        modeReplay: text,
        mode: 'text',
        script,
        turnExpectations,
      });
      expectTraceCorrelation({
        modeReplay: genUi,
        mode: 'genui',
        script,
        turnExpectations,
      });
    },
    60_000,
  );

  it('preserves full-menu and exact modifier authorities', async () => {
    await expectScenarioTwoContracts(
      await replayScenario('02-tu-van-combo-va-upsell.json'),
    );
  });

  it('restores the nine cross-turn postconditions', async () => {
    const runs = new Map<string, Replay>();
    for (const { fileName } of liveScenarioCases) {
      runs.set(fileName, await replayScenario(fileName));
    }

    const firstReplay = runs.get(
      '01-dat-mon-ro-rang-giao-hang.json',
    )!;
    const first = firstReplay.text.result;
    for (const { result } of [firstReplay.text, firstReplay.genUi]) {
      expect(result.eventsBeforeFinalUserTurn.some(
        (event) => event.type === 'order_created',
      )).toBe(false);
      expect(eventPayloads(result, 'order_created')).toHaveLength(1);
      expect(eventPayloads(result, 'payment_link_created')).toEqual([
        {
          method: 'zalopay_wallet',
          status: 'pending',
          url: result.finalAgentState?.paymentAttempt?.paymentUrl,
        },
      ]);
      expect(eventPayloads(result, 'voucher_applied')).toHaveLength(1);
      expect(eventPayloads(result, 'voucher_rejected')).toEqual([]);
      expect(eventPayloads(result, 'voucher_applied')[0]).toMatchObject({
        validation: expect.objectContaining({
          ok: true,
          publicCode: 'KFC50',
          discountVnd: 50_000,
        }),
      });
      expect(eventPayloads(result, 'session_updated')).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            updateType: 'store_assigned',
            storeId: 'KFCVN0318',
          }),
          expect.objectContaining({
            updateType: 'delivery_quote',
            feeVnd: 18_000,
            etaMinutes: 35,
            method: 'delivery',
          }),
          expect.objectContaining({
            updateType: 'invoice_requested',
          }),
        ]),
      );
      expect(JSON.stringify(eventPayloads(result, 'session_updated')))
        .not.toContain('finance@abc.test');
      expect(JSON.stringify(eventPayloads(result, 'session_updated')))
        .not.toContain('0312345678');
      expect(result.order).toMatchObject({
        status: 'created',
        paymentStatus: 'pending',
        assignedStoreId: 'KFCVN0318',
      });
      // V3 pins the provider-resolved quote, not the legacy default quote.
      expect(result.finalAgentState?.fulfillment).toMatchObject({
        storeId: 'KFCVN0318',
        feeVnd: 18_000,
        etaMinutes: 35,
        method: 'delivery',
      });
      expect(eventPayloads(result, 'order_created')).toEqual([
        { order: result.order },
      ]);
    }
    expect(toolNames(first).filter((name) => name === 'placeOrder'))
      .toHaveLength(1);
    expect(first.order).toMatchObject({
      status: 'created',
      paymentStatus: 'pending',
    });
    expect(first.finalAgentState).toMatchObject({
      invoiceRequest: {
        taxCode: '0312345678',
        email: 'finance@abc.test',
      },
      paymentAttempt: { status: 'pending' },
    });
    expect(eventPayloads(first, 'order_created')).toHaveLength(1);
    expect(eventPayloads(first, 'payment_link_created')).toHaveLength(1);
    expect(eventPayloads(first, 'voucher_applied')).toHaveLength(1);

    await expectScenarioTwoContracts(runs.get(
      '02-tu-van-combo-va-upsell.json',
    )!);

    const third = runs.get(
      '03-ton-kho-dia-chi-va-cua-hang.json',
    )!.text.result;
    expect(third.order).toBeUndefined();
    expect(toolNames(third)).toEqual(expect.arrayContaining([
      'getSavedAddresses',
      'quoteFulfillment',
      'checkStoreAvailability',
    ]));
    expect(toolNames(third).filter(
      (name) => name === 'getSavedAddresses',
    )).toHaveLength(1);
    const savedAddressQuote = third.toolTrace.find(
      ({ toolName }) => toolName === 'quoteFulfillment',
    );
    expect(savedAddressQuote?.arguments).toEqual({
      savedAddressRef: expect.objectContaining({
        id: expect.any(String),
        kind: 'saved_address',
      }),
      method: 'delivery',
    });
    expect(third.finalAgentState?.pendingSavedAddressRef).toBeUndefined();

    const fourth = runs.get(
      '04-sau-khi-dat-don.json',
    )!.text.result;
    expect(toolNames(fourth).filter((name) => name === 'getOrderStatus'))
      .toHaveLength(5);
    expect(toolNames(fourth).filter((name) => name === 'resolveHandoff'))
      .toHaveLength(1);
    expect(fourth.finalAgentState?.handoff).toBeUndefined();
    expect(fourth.cart?.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ itemCode: '20751' }),
    ]));

    const fifth = runs.get(
      '05-khieu-nai-va-human-handoff.json',
    )!.text.result;
    expect(fifth.finalAgentState?.handoff?.reasons).toEqual([
      'missing_item',
      'wrong_item',
      'late_delivery',
      'angry_customer',
      'human_requested',
    ]);

    const sixth = runs.get(
      '06-ngon-ngu-tu-nhien-va-an-toan.json',
    )!.text.result;
    expect(sixth.order).toBeUndefined();
    expect(sixth.finalAgentState?.contentEvidence?.length)
      .toBeGreaterThan(0);

    const seventh = runs.get(
      '07-ca-nhan-hoa-va-loyalty.json',
    )!.text.result;
    expect(seventh.cart?.items.some(({ itemCode }) => itemCode === '41086'))
      .toBe(false);
    expect(seventh.cart?.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        itemCode: '20698',
        modifiers: expect.arrayContaining([
          expect.objectContaining({ modifierName: 'Trà Đào' }),
        ]),
      }),
    ]));
    expect(toolNames(seventh)).not.toContain('placeOrder');
    expect(seventh.turnEvidence.find(
      ({ turnIndex }) => turnIndex === 7,
    )?.approvalRequested).toBe(false);
    const acquiredReward = seventh.toolTrace.find(
      ({ toolName }) => toolName === 'acquireVoucher',
    );
    const redeemedReward = seventh.toolTrace.find(
      ({ toolName }) => toolName === 'redeemReward',
    );
    expect(acquiredReward).toMatchObject({
      toolName: 'acquireVoucher',
      ok: true,
      publicationEvidenceAudit: {
        argumentsDigest: await stateRevision({
          rewardId: 'reward-discount-10k',
        }),
      },
    });
    expect(redeemedReward).toMatchObject({
      toolName: 'redeemReward',
      ok: true,
      publicationEvidenceAudit: {
        argumentsDigest: await stateRevision({
          voucherId: 'wallet-new-member-25k',
          channel: 'zalo_miniapp',
        }),
      },
    });
    expect(seventh.toolTrace.filter(
      ({ toolName }) => toolName === 'acquireVoucher',
    )).toHaveLength(1);

    const eighth = runs.get(
      '08-thanh-toan-loi-va-don-bat-thuong.json',
    )!.text.result;
    expect(eighth.cart).toBeUndefined();
    expect(eighth.finalAgentState).toMatchObject({
      paymentAttempt: { status: 'pending' },
      handoff: expect.any(Object),
    });
    expect(projectStateGraphScenarioRun(eighth, 'text')[0]?.observations)
      .toContainEqual({
        kind: 'payment_status_refreshed',
        toolName: 'checkPaymentStatus',
        privateArgumentsDigest: await stateRevision({
          orderId: 'KFC-MOCK-1001',
        }),
        status: 'failed',
      });

    const ninth = runs.get(
      '09-phuong-thuc-thanh-toan.json',
    )!.text.result;
    expect(toolNames(ninth).filter((name) => name === 'listPaymentMethods'))
      .toHaveLength(2);
    expect(ninth.cart).toBeUndefined();
    expect(ninth.order).toBeUndefined();
    expect(ninth.finalAgentState?.paymentAttempt).toBeUndefined();
  }, 120_000);

  it('executes an insufficient advertised safe call without synthesizing a mutation', async () => {
    const canonical = liveScenarioCases[0]!;
    const expectation = canonical.turnExpectations[0]!;
    const turn = {
      index: expectation.turnIndex,
      speaker: 'User' as const,
      text: expectation.input,
      useCases: expectation.useCaseIds,
    };
    const script: ScenarioScript = {
      id: 'offline-underplanning-proof',
      title: 'Model-authored underplanning proof',
      channel: 'kfc',
      goal: 'Prove the graph never synthesizes a missing cart mutation',
      useCases: expectation.useCaseIds,
      finalState: 'clarification_needed',
      turns: [turn],
      userTurns: [turn],
      expectations: [],
    };
    const model = fakeModel()
      .respondWithTools([call('searchMenu', filtered('combo gà cay'))])
      .respond(groundedResponseModelReply({
        customerText: 'Offline underplanning response.',
      }));
    const result = await runScenario(script, {
      agentModel: model,
      channelOverride: 'messenger_mock',
      initialVerifiedState: await initialState(canonical.fileName),
    });
    const [output] = projectStateGraphScenarioRun(result, 'text');
    expect(output).toBeDefined();
    const evaluator = createLiveQualityV3ExperimentEvaluator(datasetCases, {
      semanticJudge: deferredSemanticJudge,
    });
    const scores = await evaluator({
      inputs: { caseId: `${expectation.id}:text` },
      outputs: { ...output },
    });

    expect(result.toolTrace).toEqual([
      expect.objectContaining({
        toolName: 'searchMenu',
        arguments: filtered('combo gà cay'),
        ok: true,
      }),
    ]);
    expect(scores.find(({ key }) => key === 'tool_contract')?.score).toBe(0);
    expect(scores.find(({ key }) => key === 'acceptance')?.score).toBe(0);
    expect(result.cart).toBeUndefined();
    expect(result.order).toBeUndefined();
    expect(eventPayloads(result, 'cart_changed')).toEqual([]);
    expect(eventPayloads(result, 'order_created')).toEqual([]);
    expect(eventPayloads(result, 'payment_link_created')).toEqual([]);
    const toolCallBoundaries = result.dashboardEvents
      .filter(
        (event) =>
          event.type === 'session_updated' &&
          event.payload.updateType === 'tool_called',
      )
      .map((event) => event.payload.boundary);
    expect(toolCallBoundaries).toEqual(['catalog']);
  });
});
