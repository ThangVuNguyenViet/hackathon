import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { OpenAIToolPlanner, type ToolPlanner, type ToolPlannerInput, type ToolPlannerOutput } from '../../src/llm/toolPlanner.js';
import { runScenario } from '../../src/scenarios/runner.js';
import { loadScenarioScript } from '../../src/scenarios/scenarioScript.js';
import type { ToolName } from '../../src/ordering/types.js';
import { liveScenarioFixtures } from './liveScenarioFixtures.js';

const scenariosRoot = join(process.cwd(), '../../ai-talent-tracks/fnb/conversations');
const liveRequested = process.env.RUN_LIVE_AI_SCENARIOS === '1';
const openAiApiKey = process.env.OPENAI_API_KEY?.trim();
const openAiModel = process.env.OPENAI_TOOL_PLANNER_MODEL?.trim() || process.env.OPENAI_MODEL?.trim() || 'gpt-4.1-mini';

interface LiveScenarioCase {
  fileName: string;
  turnExpectations: TurnExpectation[];
}

interface TurnExpectation {
  turnIndex: number;
  requiredGroups?: ToolName[][];
  forbiddenTools?: ToolName[];
  allowEmptyTools?: boolean;
}

interface PlannerRecord {
  turnText: string;
  plan?: ToolPlannerOutput;
  error?: unknown;
  toolNames: ToolName[];
}

class RecordingToolPlanner implements ToolPlanner {
  readonly supportsMultiStep: boolean;
  readonly records: PlannerRecord[] = [];

  constructor(private readonly delegate: ToolPlanner) {
    this.supportsMultiStep = delegate.supportsMultiStep === true;
  }

  async plan(input: ToolPlannerInput): Promise<ToolPlannerOutput> {
    try {
      const plan = await this.delegate.plan(input);
      this.records.push({
        turnText: input.state.latestUserMessage,
        plan,
        toolNames: plan.toolCalls.map((call) => call.toolName),
      });
      return plan;
    } catch (error) {
      this.records.push({
        turnText: input.state.latestUserMessage,
        error,
        toolNames: [],
      });
      throw error;
    }
  }
}

const cartOrderPaymentTools: ToolName[] = ['updateCart', 'previewOrder', 'placeOrder', 'createPaymentLink', 'checkPaymentStatus'];
const orderPaymentCartMutationTools: ToolName[] = ['updateCart', 'previewOrder', 'placeOrder', 'createPaymentLink'];

const liveScenarioCases: LiveScenarioCase[] = [
  {
    fileName: '01-dat-mon-ro-rang-giao-hang.json',
    turnExpectations: [
      { turnIndex: 1, requiredGroups: [['searchMenu'], ['updateCart']], forbiddenTools: ['placeOrder', 'createPaymentLink'] },
      { turnIndex: 3, requiredGroups: [['quoteFulfillment']] },
      { turnIndex: 5, requiredGroups: [['validateVoucher']] },
      { turnIndex: 7, requiredGroups: [['listPaymentMethods']], forbiddenTools: ['placeOrder', 'createPaymentLink'] },
      { turnIndex: 9, allowEmptyTools: true, forbiddenTools: ['collectInvoice'] },
      { turnIndex: 11, requiredGroups: [['collectInvoice'], ['previewOrder', 'placeOrder'], ['createPaymentLink']] },
    ],
  },
  {
    fileName: '02-tu-van-combo-va-upsell.json',
    turnExpectations: [
      { turnIndex: 1, requiredGroups: [['searchMenu', 'recommendAddOns']], forbiddenTools: ['updateCart'] },
      {
        turnIndex: 3,
        requiredGroups: [['searchPromotions', 'explainPromotion', 'validateVoucher']],
        forbiddenTools: ['updateCart'],
      },
      {
        turnIndex: 5,
        requiredGroups: [['updateCart'], ['getItemDetails', 'recommendAddOns']],
      },
      { turnIndex: 7, requiredGroups: [['updateCart'], ['getModifierOptions'], ['previewCart']] },
      { turnIndex: 9, requiredGroups: [['updateCart'], ['previewCart']] },
    ],
  },
  {
    fileName: '03-ton-kho-dia-chi-va-cua-hang.json',
    turnExpectations: [
      { turnIndex: 1, requiredGroups: [['searchMenu'], ['findStores']] },
      { turnIndex: 3, requiredGroups: [['searchMenu']] },
      { turnIndex: 5, requiredGroups: [['quoteFulfillment', 'checkStoreAvailability']] },
      { turnIndex: 7, requiredGroups: [['checkStoreAvailability', 'quoteFulfillment']], forbiddenTools: ['placeOrder'] },
      { turnIndex: 9, requiredGroups: [['findStores', 'quoteFulfillment', 'checkStoreAvailability']] },
    ],
  },
  {
    fileName: '04-sau-khi-dat-don.json',
    turnExpectations: [
      { turnIndex: 1, requiredGroups: [['getOrderStatus']] },
      { turnIndex: 3, requiredGroups: [['getOrderStatus']] },
      { turnIndex: 5, requiredGroups: [['getOrderStatus']] },
      { turnIndex: 7, requiredGroups: [['getOrderStatus'], ['searchMenu', 'updateCart', 'previewCart']] },
      { turnIndex: 9, requiredGroups: [['getOrderStatus']] },
      { turnIndex: 11, requiredGroups: [['getOrderStatus']] },
      { turnIndex: 13, requiredGroups: [['getOrderStatus'], ['searchMenu', 'updateCart', 'previewCart']] },
      { turnIndex: 15, allowEmptyTools: true, forbiddenTools: ['placeOrder'] },
    ],
  },
  {
    fileName: '05-khieu-nai-va-human-handoff.json',
    turnExpectations: [
      { turnIndex: 1, allowEmptyTools: true, forbiddenTools: orderPaymentCartMutationTools },
      { turnIndex: 3, allowEmptyTools: true, forbiddenTools: orderPaymentCartMutationTools },
      { turnIndex: 5, allowEmptyTools: true, forbiddenTools: orderPaymentCartMutationTools },
      { turnIndex: 7, requiredGroups: [['handoff']] },
      { turnIndex: 9, allowEmptyTools: true, forbiddenTools: ['placeOrder', 'createPaymentLink'] },
    ],
  },
  {
    fileName: '06-ngon-ngu-tu-nhien-va-an-toan.json',
    turnExpectations: [
      { turnIndex: 1, requiredGroups: [['searchMenu'], ['updateCart']] },
      { turnIndex: 3, requiredGroups: [['searchContentPolicy', 'answerAllergenQuestion']] },
      { turnIndex: 5, allowEmptyTools: true, forbiddenTools: cartOrderPaymentTools },
      { turnIndex: 7, allowEmptyTools: true, forbiddenTools: ['updateCart', 'placeOrder'] },
      { turnIndex: 9, allowEmptyTools: true, forbiddenTools: ['placeOrder', 'createPaymentLink'] },
      { turnIndex: 11, allowEmptyTools: true, forbiddenTools: cartOrderPaymentTools },
    ],
  },
  {
    fileName: '07-ca-nhan-hoa-va-loyalty.json',
    turnExpectations: [
      { turnIndex: 1, requiredGroups: [['getOrderStatus', 'updateCart', 'searchMenu']] },
      { turnIndex: 3, requiredGroups: [['getMembershipProfile', 'searchMenu', 'updateCart']] },
      {
        turnIndex: 5,
        requiredGroups: [['updateCart'], ['getMembershipProfile'], ['listMembershipRewards', 'listMembershipWallet', 'getMembershipPointHistory']],
      },
      { turnIndex: 7, requiredGroups: [['updateCart', 'previewCart'], ['searchMenu', 'getModifierOptions']] },
      { turnIndex: 9, allowEmptyTools: true, forbiddenTools: ['placeOrder'] },
    ],
  },
  {
    fileName: '08-thanh-toan-loi-va-don-bat-thuong.json',
    turnExpectations: [
      { turnIndex: 1, requiredGroups: [['checkPaymentStatus']] },
      { turnIndex: 3, requiredGroups: [['checkPaymentStatus']] },
      { turnIndex: 5, requiredGroups: [['searchMenu', 'updateCart'], ['handoff']] },
      { turnIndex: 7, allowEmptyTools: true, forbiddenTools: orderPaymentCartMutationTools },
    ],
  },
  {
    fileName: '09-phuong-thuc-thanh-toan.json',
    turnExpectations: [
      { turnIndex: 1, requiredGroups: [['listPaymentMethods']], forbiddenTools: orderPaymentCartMutationTools },
      { turnIndex: 3, requiredGroups: [['listPaymentMethods']], forbiddenTools: orderPaymentCartMutationTools },
    ],
  },
];

function recordsByTurnIndex(scriptUserTurns: Array<{ index: number; text: string }>, records: PlannerRecord[]) {
  const byTurn = new Map<number, PlannerRecord[]>();
  let cursor = 0;

  for (const turn of scriptUserTurns) {
    const turnRecords: PlannerRecord[] = [];
    while (records[cursor]?.turnText === turn.text) {
      turnRecords.push(records[cursor]!);
      cursor += 1;
    }
    expect(turnRecords.length, `live planner should be invoked for scenario turn ${turn.index}`).toBeGreaterThan(0);
    byTurn.set(turn.index, turnRecords);
  }

  expect(records.slice(cursor), 'live planner should not contain records after the final scenario turn').toEqual([]);
  return byTurn;
}

function expectTurnToolGroups(records: PlannerRecord[] | undefined, expectation: TurnExpectation) {
  expect(records?.length, `missing planner record for turn ${expectation.turnIndex}`).toBeGreaterThan(0);
  const errors = (records ?? []).flatMap((record) => (record.error ? [record.error] : []));
  expect(errors, `planner failed on turn ${expectation.turnIndex}: ${errors.map(String).join('; ')}`).toEqual([]);

  const actual = new Set((records ?? []).flatMap((record) => record.toolNames));
  const missing = (expectation.requiredGroups ?? []).filter((group) => !group.some((toolName) => actual.has(toolName)));
  const forbidden = (expectation.forbiddenTools ?? []).filter((toolName) => actual.has(toolName));

  expect(
    missing.map((group) => group.join(' | ')),
    `model planner missed required tool group(s) on turn ${expectation.turnIndex}; actual tools: ${[...actual].join(', ')}`,
  ).toEqual([]);
  expect(
    forbidden,
    `model planner chose forbidden tool(s) on turn ${expectation.turnIndex}; actual tools: ${[...actual].join(', ')}`,
  ).toEqual([]);

  if (!expectation.allowEmptyTools && (expectation.requiredGroups?.length ?? 0) > 0) {
    expect(actual.size, `turn ${expectation.turnIndex} should include at least one planned tool`).toBeGreaterThan(0);
  }
}

if (liveRequested && !openAiApiKey) {
  describe('live OpenAI scenario replay', () => {
    it('requires OPENAI_API_KEY when RUN_LIVE_AI_SCENARIOS=1', () => {
      throw new Error('Set OPENAI_API_KEY before running npm run test:live:scenarios');
    });
  });
} else {
  const describeLive = liveRequested ? describe : describe.skip;

  describeLive('live OpenAI scenario replay', () => {
    it.each(liveScenarioCases)(
      '$fileName has the live model choose the expected tool groups on the expected turns',
      async (scenarioCase) => {
        const script = await loadScenarioScript(join(scenariosRoot, scenarioCase.fileName));
        const scenarioFixtures = liveScenarioFixtures(scenarioCase.fileName);
        const planner = new RecordingToolPlanner(
          new OpenAIToolPlanner({
            apiKey: openAiApiKey ?? '',
            model: openAiModel,
          }),
        );

        const result = await runScenario(script, {
          ...scenarioFixtures,
          toolPlanner: planner,
          testFulfillmentQuoteProvider: async () => ({
            ok: true,
            value: { feeVnd: 18000, etaMinutes: 25 },
            message: 'live_ai_scenario_quote_fixture',
          }),
        });

        expect(result.coveredUseCases).toEqual(script.useCases);
        expect(result.transcript).toHaveLength(script.turns.length);
        expect(result.dashboardEvents.every((event) => !event.id.includes('scenario_'))).toBe(true);
        if (scenarioCase.fileName.startsWith('03-')) {
          expect(
            result.toolTrace.some((entry) => entry.toolName === 'updateCart' && entry.ok),
            'scenario 03 must execute a successful cart update after the verified lookup',
          ).toBe(true);
          expect(
            result.cart?.items.some((item) => item.name.toLowerCase().includes('zinger')),
            'scenario 03 must add the verified Zinger selection to the cart after lookup',
          ).toBe(true);
        }
        const records = recordsByTurnIndex(script.userTurns, planner.records);
        for (const expectation of scenarioCase.turnExpectations) {
          expectTurnToolGroups(records.get(expectation.turnIndex), expectation);
        }
      },
      300_000,
    );

    it('all live-eval scenario scripts cover exactly UC-01 through UC-39', async () => {
      expect(liveScenarioCases).toHaveLength(9);

      const scripts = await Promise.all(
        liveScenarioCases.map((scenarioCase) => loadScenarioScript(join(scenariosRoot, scenarioCase.fileName))),
      );
      const actualUseCases = [...new Set(scripts.flatMap((script) => script.useCases).filter((useCase) => useCase !== 'Filler'))].sort();
      const expectedUseCases = Array.from({ length: 39 }, (_, index) => `UC-${String(index + 1).padStart(2, '0')}`);

      expect(actualUseCases).toEqual(expectedUseCases);
    });
  });
}
