import { readFile, readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { z } from 'zod';
import { KFC_GENUI_WIDGET_KINDS } from '../genui/kfcGenUi.js';
import {
  LIVE_QUALITY_EXPECTED_SCENARIO_COUNT,
  LIVE_QUALITY_EXPECTED_TURN_COUNT,
  type LiveScenarioCase,
  type TurnExpectation,
} from '../evaluation/liveQualityContracts.js';

export const KFC_USE_CASE_DEFINITIONS = [
  { id: 'UC-01', name: 'User đặt món rõ ràng' },
  { id: 'UC-02', name: 'User đặt món mơ hồ' },
  { id: 'UC-03', name: 'User đặt món theo ngân sách hoặc số người' },
  { id: 'UC-04', name: 'User hỏi menu hoặc khuyến mãi' },
  { id: 'UC-05', name: 'User muốn chỉnh sửa giỏ hàng' },
  { id: 'UC-06', name: 'Món user chọn đã hết hàng' },
  { id: 'UC-07', name: 'User thiếu hoặc nhập không rõ địa chỉ giao hàng' },
  { id: 'UC-08', name: 'User ngoài vùng giao hàng' },
  { id: 'UC-09', name: 'User từ chối upsell' },
  { id: 'UC-10', name: 'User đồng ý upsell' },
  { id: 'UC-11', name: 'User không biết ăn gì và cần chatbot tư vấn' },
  { id: 'UC-12', name: 'User hỏi món bán chạy hoặc món được đề xuất' },
  { id: 'UC-13', name: 'User đặt món cho nhóm đông người' },
  { id: 'UC-14', name: 'User có món yêu thích' },
  { id: 'UC-15', name: 'User là khách thân thiết hoặc loyalty member' },
  { id: 'UC-16', name: 'User muốn thanh toán' },
  { id: 'UC-17', name: 'User dùng mã giảm giá hoặc voucher' },
  { id: 'UC-18', name: 'User thanh toán online thất bại' },
  { id: 'UC-19', name: 'User hỏi xuất hóa đơn công ty' },
  { id: 'UC-20', name: 'User muốn hủy đơn' },
  { id: 'UC-21', name: 'User muốn theo dõi đơn hàng và ETA' },
  { id: 'UC-22', name: 'User muốn đặt lại đơn cũ' },
  { id: 'UC-23', name: 'User muốn đổi địa chỉ sau khi đã tạo đơn' },
  { id: 'UC-24', name: 'User hỏi phí giao hàng' },
  { id: 'UC-25', name: 'User muốn ghi chú cho tài xế hoặc cửa hàng' },
  { id: 'UC-26', name: 'User muốn thêm món sau khi đã đặt' },
  { id: 'UC-27', name: 'User khiếu nại thiếu, sai hoặc trễ đơn' },
  { id: 'UC-28', name: 'User đánh giá sau đơn hàng' },
  { id: 'UC-29', name: 'User tức giận hoặc dùng ngôn ngữ tiêu cực' },
  { id: 'UC-30', name: 'User muốn gặp nhân viên thật' },
  { id: 'UC-31', name: 'User dùng tiếng lóng hoặc sai chính tả' },
  { id: 'UC-32', name: 'User có yêu cầu dị ứng hoặc kiêng món' },
  { id: 'UC-33', name: 'User spam hoặc nhập nội dung không liên quan' },
  { id: 'UC-34', name: 'Chatbot không chắc ý định của user' },
  { id: 'UC-35', name: 'User yêu cầu ngoài phạm vi hoặc liên quan an toàn thông tin' },
  { id: 'UC-36', name: 'Chatbot không hiểu yêu cầu' },
  { id: 'UC-37', name: 'Đơn được phân về cửa hàng gần nhất' },
  { id: 'UC-38', name: 'Quá tải đơn hàng giờ cao điểm' },
  { id: 'UC-39', name: 'Đơn có dấu hiệu bất thường' },
] as const;

const nonEmptyString = z.string().refine((value) => value.trim().length > 0, 'must not be blank');
const safePath = z.string().regex(
  /^[A-Za-z][A-Za-z0-9_]*(?:\.(?:[A-Za-z][A-Za-z0-9_]*|\*))*$/,
);
const useCaseId = z.union([z.string().regex(/^UC-\d{2}$/), z.literal('Filler')]);
const unique = <T>(values: T[]): boolean => new Set(values).size === values.length;
const stateKeys = [
  'cart',
  'address',
  'fulfillment',
  'order',
  'paymentAttempt',
  'handoff',
  'customerContext',
  'promotionContext',
  'contentEvidence',
  'paymentMethodEvidence',
  'invoiceRequest',
  'cancellationStatusChecked',
] as const;
const stateKeySchema = z.enum(stateKeys);
const presentationRoots = new Set([
  'availability',
  'cancellation',
  'cart',
  'clarification',
  'complaint',
  'evidenceRefs',
  'feedback',
  'fulfillment',
  'handoff',
  'invoice',
  'orderNotes',
  'paymentMethods',
  'pickup',
  'privacy',
  'promotion',
  'recommendation',
  'reorder',
  'savedAddress',
]);
const forbiddenOracleTerms = [
  'classifier',
  'intent',
  'keyword',
  'message',
  'output',
  'phrase',
  'planner',
  'prose',
  'response',
  'route',
  'text',
  'tool',
];
const effectSchema = z.enum([
  'cart_mutated',
  'fulfillment_changed',
  'order_created',
  'payment_changed',
  'handoff_created',
  'approval_requested',
  'voucher_acquired',
  'reward_redeemed',
  'private_contact_disclosed',
]);
const factSchema = z.object({
  source: z.enum(['state', 'genui', 'presentation']),
  path: safePath,
  operator: z.enum(['present', 'absent', 'equals', 'contains', 'set_equals', 'lte', 'gte']),
  value: z.unknown().optional(),
}).strict().superRefine((fact, context) => {
  const needsValue = fact.operator === 'equals' || fact.operator === 'contains' ||
    fact.operator === 'set_equals' || fact.operator === 'lte' || fact.operator === 'gte';
  if (needsValue && fact.value === undefined) {
    context.addIssue({ code: 'custom', message: `${fact.operator} requires value` });
  }
  if (!needsValue && fact.value !== undefined) {
    context.addIssue({ code: 'custom', message: `${fact.operator} forbids value` });
  }
  if ((fact.operator === 'lte' || fact.operator === 'gte') && typeof fact.value !== 'number') {
    context.addIssue({ code: 'custom', message: `${fact.operator} requires a number` });
  }
  const [root] = fact.path.split('.');
  if (fact.source === 'state' && !stateKeys.includes(root as (typeof stateKeys)[number])) {
    context.addIssue({ code: 'custom', message: 'state fact path must start with observable state' });
  }
  if (fact.source === 'genui' && root !== 'data' && root !== 'widgetKind' && root !== 'actions') {
    context.addIssue({ code: 'custom', message: 'GenUI fact path must start with data, widgetKind, or actions' });
  }
  if (fact.source === 'presentation') {
    const hasForbiddenOracleTerm = fact.path.split('.').some((segment) =>
      forbiddenOracleTerms.some((term) => segment.toLowerCase().includes(term)));
    if (!presentationRoots.has(root!) || hasForbiddenOracleTerm) {
      context.addIssue({ code: 'custom', message: 'presentation fact path is not an outcome domain' });
    }
    const values = collectStrings(fact.value);
    if (values.some((value) => /\s/.test(value))) {
      context.addIssue({ code: 'custom', message: 'presentation fact values must be structured tokens, not phrases' });
    }
  }
});
const collectionSchema = z.object({
  key: nonEmptyString,
  scope: z.enum(['all', 'filtered']),
  minItems: z.number().int().nonnegative().default(1),
  maxItems: z.number().int().positive().optional(),
  exactVerifiedItems: z.boolean().default(false),
  requireComplete: z.boolean().default(false),
  requiredCategories: z.array(nonEmptyString).refine(unique, 'categories must be unique').default([]),
  requireCategoryTabs: z.boolean().default(false),
  selectionLimit: z.number().int().positive().optional(),
}).strict().superRefine((collection, context) => {
  if (collection.maxItems !== undefined && collection.maxItems < collection.minItems) {
    context.addIssue({ code: 'custom', message: 'maxItems cannot be lower than minItems' });
  }
});
export const scenarioTurnOutcomeSchema = z.object({
  state: z.object({
    mustChange: z.array(stateKeySchema).refine(unique, 'state keys must be unique').default([]),
    mustNotChange: z.array(stateKeySchema).refine(unique, 'state keys must be unique').default([]),
    facts: z.array(factSchema).default([]),
  }).strict(),
  effects: z.object({
    required: z.array(effectSchema).refine(unique, 'effects must be unique').default([]),
    forbidden: z.array(effectSchema).refine(unique, 'effects must be unique').default([]),
  }).strict(),
  presentation: z.object({
    genUi: z.object({
      required: z.boolean().default(false),
      allowedWidgetKinds: z.array(z.enum(KFC_GENUI_WIDGET_KINDS))
        .refine(unique, 'widget kinds must be unique')
        .default([]),
      requiredDataPaths: z.array(safePath).refine(unique, 'data paths must be unique').default([]),
      forbiddenActions: z.array(nonEmptyString).refine(unique, 'actions must be unique').default([]),
    }).strict().superRefine((genUi, context) => {
      if (genUi.required && genUi.allowedWidgetKinds.length === 0) {
        context.addIssue({ code: 'custom', message: 'required GenUI needs an allowed widget kind' });
      }
    }).default({}),
    collections: z.array(collectionSchema).default([]),
  }).strict().default({}),
  provenance: z.object({
    requiredEvidenceKinds: z.array(nonEmptyString)
      .refine(unique, 'evidence kinds must be unique')
      .default([]),
    requireOfficialSameReference: z.boolean().default(false),
  }).strict().default({}),
  persistence: z.object({
    transcriptDelta: z.literal(2).default(2),
    contiguousEvents: z.literal(true).default(true),
    checkpointRequired: z.literal(true).default(true),
  }).strict().default({}),
  latency: z.object({
    maxTurnMs: z.number().int().positive().default(10_000),
  }).strict().default({}),
}).strict().superRefine((outcome, context) => {
  const hasObservableOutcome =
    outcome.state.mustChange.length > 0 ||
    outcome.state.facts.length > 0 ||
    outcome.effects.required.length > 0 ||
    outcome.presentation.collections.length > 0;
  if (!hasObservableOutcome) {
    context.addIssue({
      code: 'custom',
      message: 'turn must declare a positive structured outcome, not only negative guards',
    });
  }
});

function collectStrings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(collectStrings);
  if (value && typeof value === 'object') return Object.values(value).flatMap(collectStrings);
  return [];
}
const customerTurnSchema = z.object({
  index: z.number().int().positive(),
  speaker: z.literal('User'),
  text: nonEmptyString,
  useCases: z.array(useCaseId).min(1).refine(unique, 'use cases must be unique'),
  outcome: scenarioTurnOutcomeSchema,
}).strict();
const scenarioSchema = z.object({
  schemaVersion: z.literal('kfc-outcome-scenario-v2'),
  id: z.string().regex(/^\d{2}-[a-z0-9-]+$/),
  title: nonEmptyString,
  channel: z.enum(['messenger_mock', 'zalo_mock', 'kfc']),
  goal: nonEmptyString,
  useCases: z.array(z.string().regex(/^UC-\d{2}$/)).min(1).refine(unique, 'use cases must be unique'),
  finalState: nonEmptyString,
  setup: z.object({
    requiresCustomerAccess: z.boolean().default(false),
    seedPaidOrder: z.boolean().default(false),
    seedPendingPayment: z.boolean().default(false),
  }).strict().default({}),
  turns: z.array(customerTurnSchema).min(1),
}).strict();

export const turnExpectationSchema = z.object({
  id: nonEmptyString,
  turnIndex: z.number().int().positive(),
  input: nonEmptyString,
  useCaseIds: z.array(useCaseId).min(1).refine(unique, 'use cases must be unique'),
  outcome: scenarioTurnOutcomeSchema,
}).strict();

export interface ScenarioTurn {
  index: number;
  speaker: 'User';
  text: string;
  useCases: string[];
  outcome: TurnExpectation['outcome'];
}

export interface ScenarioScript {
  schemaVersion: 'kfc-outcome-scenario-v2';
  id: string;
  title: string;
  channel: 'messenger_mock' | 'zalo_mock' | 'kfc';
  goal: string;
  useCases: string[];
  finalState: string;
  setup: LiveScenarioCase['setup'];
  turns: ScenarioTurn[];
  userTurns: ScenarioTurn[];
}

export async function loadScenarioScript(filePath: string): Promise<ScenarioScript> {
  const parsed = scenarioSchema.parse(JSON.parse(await readFile(filePath, 'utf8')));
  const expectedId = basename(filePath, '.json');
  if (parsed.id !== expectedId) throw new Error(`${filePath} id must be ${expectedId}`);
  const indexes = parsed.turns.map(({ index }) => index);
  if (new Set(indexes).size !== indexes.length || indexes.some((index, offset) => index !== offset * 2 + 1)) {
    throw new Error(`${filePath} customer turn indexes must be unique consecutive odd numbers`);
  }
  for (const turn of parsed.turns) {
    const conflictingState = turn.outcome.state.mustChange
      .filter((key) => turn.outcome.state.mustNotChange.includes(key));
    if (conflictingState.length > 0) {
      throw new Error(`${filePath}#${turn.index} both changes and forbids ${conflictingState.join(', ')}`);
    }
    const conflictingEffects = turn.outcome.effects.required
      .filter((effect) => turn.outcome.effects.forbidden.includes(effect));
    if (conflictingEffects.length > 0) {
      throw new Error(`${filePath}#${turn.index} both requires and forbids ${conflictingEffects.join(', ')}`);
    }
  }
  const turnUseCases = new Set(parsed.turns.flatMap(({ useCases }) =>
    useCases.filter((useCase) => useCase !== 'Filler')));
  if (
    turnUseCases.size !== parsed.useCases.length ||
    parsed.useCases.some((useCase) => !turnUseCases.has(useCase))
  ) {
    throw new Error(`${filePath} top-level use cases must equal its customer-turn use cases`);
  }
  return { ...parsed, userTurns: parsed.turns };
}

export async function loadScenarioCorpus(root: string): Promise<LiveScenarioCase[]> {
  const fileNames = (await readdir(root))
    .filter((fileName) => /^\d{2}-[^/]+\.json$/.test(fileName))
    .sort();
  const scripts = await Promise.all(fileNames.map((fileName) => loadScenarioScript(join(root, fileName))));
  if (scripts.length !== LIVE_QUALITY_EXPECTED_SCENARIO_COUNT) {
    throw new Error(`Expected ${LIVE_QUALITY_EXPECTED_SCENARIO_COUNT} scenarios, found ${scripts.length}`);
  }
  const turns = scripts.reduce((total, script) => total + script.turns.length, 0);
  if (turns !== LIVE_QUALITY_EXPECTED_TURN_COUNT) {
    throw new Error(`Expected ${LIVE_QUALITY_EXPECTED_TURN_COUNT} customer turns, found ${turns}`);
  }
  if (new Set(scripts.map(({ id }) => id)).size !== scripts.length) {
    throw new Error('Scenario IDs must be unique');
  }
  const expectedUseCases = KFC_USE_CASE_DEFINITIONS.map(({ id }) => id);
  const actualUseCases = [...new Set(scripts.flatMap(({ useCases }) => useCases))].sort();
  if (actualUseCases.join(',') !== expectedUseCases.join(',')) {
    throw new Error('Scenario corpus must cover UC-01 through UC-39 exactly');
  }
  return scripts.map((script, index) => ({
    schemaVersion: script.schemaVersion,
    fileName: fileNames[index]!,
    id: script.id,
    title: script.title,
    channel: script.channel,
    goal: script.goal,
    useCases: script.useCases,
    finalState: script.finalState,
    setup: script.setup,
    turnExpectations: script.turns.map((turn) => ({
      id: `${fileNames[index]}#${turn.index}`,
      turnIndex: turn.index,
      input: turn.text,
      useCaseIds: turn.useCases,
      outcome: turn.outcome,
    })),
  }));
}
