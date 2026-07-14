import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { OpenAIToolPlanner, type ToolPlanner, type ToolPlannerInput, type ToolPlannerOutput } from '../../src/llm/toolPlanner.js';
import { runScenario } from '../../src/scenarios/runner.js';
import { loadScenarioScript } from '../../src/scenarios/scenarioScript.js';
import type { ToolName, ToolTraceEntry } from '../../src/ordering/types.js';
import { liveScenarioFixtures } from './liveScenarioFixtures.js';

const scenariosRoot = join(process.cwd(), '../../ai-talent-tracks/fnb/conversations');
const liveRequested = process.env.RUN_LIVE_AI_SCENARIOS === '1';
const openAiApiKey = process.env.OPENAI_API_KEY?.trim();
const openAiModel = process.env.OPENAI_TOOL_PLANNER_MODEL?.trim() || process.env.OPENAI_MODEL?.trim() || 'gpt-4.1';

interface LiveScenarioCase {
  fileName: string;
  turnExpectations: TurnExpectation[];
}

interface TurnExpectation {
  turnIndex: number;
  requiredGroups?: ToolName[][];
  requiredCatalogCodes?: string[];
  requiredCatalogModifierText?: string;
  requiredFulfillmentLocation?: { district: string; city: string };
  requiredBooleanEntities?: string[];
  forbiddenTools?: ToolName[];
  allowEmptyTools?: boolean;
  allowDeterministicExecution?: boolean;
}

interface PlannerRecord {
  turnText: string;
  plan?: ToolPlannerOutput;
  error?: unknown;
  toolNames: ToolName[];
  catalogCandidateCodes: string[];
  activeCatalogCodes: string[];
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

const cartOrderPaymentTools: ToolName[] = ['updateCart', 'previewOrder', 'placeOrder', 'createPaymentLink', 'checkPaymentStatus'];
const orderPaymentCartMutationTools: ToolName[] = ['updateCart', 'previewOrder', 'placeOrder', 'createPaymentLink'];

const liveScenarioCases: LiveScenarioCase[] = [
  {
    fileName: '01-dat-mon-ro-rang-giao-hang.json',
    turnExpectations: [
      {
        turnIndex: 1,
        requiredGroups: [['updateCart']],
        requiredCatalogCodes: ['41141', '41074'],
        requiredCatalogModifierText: 'cay',
        forbiddenTools: ['placeOrder', 'createPaymentLink'],
      },
      {
        turnIndex: 3,
        requiredGroups: [['quoteFulfillment']],
        requiredFulfillmentLocation: { district: 'Quận 7', city: 'Hồ Chí Minh' },
      },
      { turnIndex: 5, requiredGroups: [['validateVoucher']] },
      { turnIndex: 7, requiredGroups: [['listPaymentMethods']], forbiddenTools: ['placeOrder', 'createPaymentLink'] },
      { turnIndex: 9, allowEmptyTools: true },
      {
        turnIndex: 11,
        requiredGroups: [['collectInvoice'], ['previewOrder'], ['placeOrder'], ['createPaymentLink']],
        allowDeterministicExecution: true,
      },
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
        requiredGroups: [['updateCart']],
        forbiddenTools: ['placeOrder'],
      },
      { turnIndex: 7, requiredGroups: [['updateCart']] },
      { turnIndex: 9, requiredGroups: [['updateCart']] },
    ],
  },
  {
    fileName: '03-ton-kho-dia-chi-va-cua-hang.json',
    turnExpectations: [
      {
        turnIndex: 1,
        allowEmptyTools: true,
        requiredCatalogCodes: ['41140'],
        forbiddenTools: ['updateCart', 'quoteFulfillment', 'placeOrder'],
      },
      {
        turnIndex: 3,
        requiredGroups: [['updateCart']],
        requiredCatalogCodes: ['41141'],
        forbiddenTools: ['quoteFulfillment', 'placeOrder'],
      },
      {
        turnIndex: 5,
        requiredGroups: [['quoteFulfillment']],
        allowDeterministicExecution: true,
        forbiddenTools: ['placeOrder'],
      },
      {
        turnIndex: 7,
        requiredGroups: [['checkStoreAvailability']],
        allowDeterministicExecution: true,
        forbiddenTools: ['placeOrder'],
      },
      { turnIndex: 9, allowEmptyTools: true, forbiddenTools: ['quoteFulfillment', 'placeOrder'] },
    ],
  },
  {
    fileName: '04-sau-khi-dat-don.json',
    turnExpectations: [
      { turnIndex: 1, requiredGroups: [['getOrderStatus']] },
      { turnIndex: 3, requiredGroups: [['getOrderStatus']] },
      { turnIndex: 5, requiredGroups: [['getOrderStatus']] },
      { turnIndex: 7, allowEmptyTools: true, forbiddenTools: ['updateCart', 'placeOrder'] },
      { turnIndex: 9, requiredGroups: [['getOrderStatus']] },
      { turnIndex: 11, requiredGroups: [['getOrderStatus']] },
      { turnIndex: 13, allowEmptyTools: true, forbiddenTools: ['updateCart', 'placeOrder'] },
      { turnIndex: 15, requiredGroups: [['updateCart']], allowDeterministicExecution: true, forbiddenTools: ['placeOrder'] },
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
      { turnIndex: 1, requiredGroups: [['updateCart']] },
      { turnIndex: 3, requiredGroups: [['searchContentPolicy', 'answerAllergenQuestion']], allowDeterministicExecution: true },
      { turnIndex: 5, allowEmptyTools: true, forbiddenTools: cartOrderPaymentTools },
      { turnIndex: 7, allowEmptyTools: true, forbiddenTools: ['updateCart', 'placeOrder'] },
      { turnIndex: 9, allowEmptyTools: true, forbiddenTools: ['placeOrder', 'createPaymentLink'] },
      { turnIndex: 11, allowEmptyTools: true, forbiddenTools: cartOrderPaymentTools },
    ],
  },
  {
    fileName: '07-ca-nhan-hoa-va-loyalty.json',
    turnExpectations: [
      { turnIndex: 1, allowEmptyTools: true, forbiddenTools: orderPaymentCartMutationTools },
      { turnIndex: 3, allowEmptyTools: true, forbiddenTools: orderPaymentCartMutationTools },
      {
        turnIndex: 5,
        requiredGroups: [['updateCart'], ['getMembershipProfile'], ['listMembershipRewards', 'listMembershipWallet', 'getMembershipPointHistory']],
      },
      {
        turnIndex: 7,
        requiredGroups: [['updateCart']],
        requiredCatalogCodes: ['20698'],
        requiredCatalogModifierText: 'trà đào',
      },
      { turnIndex: 9, allowEmptyTools: true, forbiddenTools: ['placeOrder'] },
    ],
  },
  {
    fileName: '08-thanh-toan-loi-va-don-bat-thuong.json',
    turnExpectations: [
      { turnIndex: 1, requiredGroups: [['checkPaymentStatus']] },
      { turnIndex: 3, requiredGroups: [['checkPaymentStatus']] },
      {
        turnIndex: 5,
        requiredGroups: [['handoff']],
        forbiddenTools: ['updateCart', 'placeOrder'],
        allowDeterministicExecution: true,
      },
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
  const executedToolNames = expectation.allowDeterministicExecution
    ? diagnostics?.executedEntries?.map((entry) => entry.toolName) ?? []
    : [];
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
        if (script.channel !== 'kfc') {
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
        const records = recordsByTurnIndex(script.userTurns, planner.records, scenarioCase.turnExpectations);
        const toolTraceByTurn = new Map(result.toolTraceByTurn.map(({ turnIndex, entries }) => [turnIndex, entries]));
        for (const expectation of scenarioCase.turnExpectations) {
          expectTurnToolGroups(records.get(expectation.turnIndex), expectation, {
            allRecords: planner.records,
            cart: result.cart,
            toolTrace: result.toolTrace,
            executedEntries: toolTraceByTurn.get(expectation.turnIndex) ?? [],
          });
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
