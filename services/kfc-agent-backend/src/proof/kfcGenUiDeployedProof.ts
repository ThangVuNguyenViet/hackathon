import { createHash } from 'node:crypto';
const KFC_AGENT_RUNTIME_ID = 'simple-model-tool-loop';
import type { AgentModelIdentity } from '../config/agentModelProfile.js';

export const LEGACY_GENUI_CAPTURE_PLAN_VERSION = 3;
export const LEGACY_GENUI_CAPTURE_SCENARIO_COUNT = 8;
export const LEGACY_GENUI_CAPTURE_TURN_COUNT = 44;

export interface ProofReleaseBinding {
  gitSha: string;
  deploymentId: string;
  releaseBuiltAt: string;
  dirty: false;
}

export interface RuntimeDeploymentBinding {
  gitSha: string;
  deploymentId: string;
  builtAt: string;
  dirty: false;
}

export interface ProofRuntimeBinding {
  deployment: RuntimeDeploymentBinding;
  commerceEnvironment: string;
  providerFingerprint: string;
  catalogObservation: {
    id: string;
    sha256: string;
    observedAt: string;
    expiresAt: string | null;
    itemCount: number;
    modifierTreeCount: number;
  };
  lifecycle: {
    provider: string;
    controlsRegistered: boolean;
  };
  graph: {
    runtime: string;
    checkpoint: string;
  };
  versions: {
    agent: AgentModelIdentity;
    toolCatalog: string;
    ranker: string;
    ledger: string;
  };
}

export interface FlutterReleaseBinding extends ProofReleaseBinding {
  buildId: string;
  releaseUrl: string;
  project: string;
  releaseAssetSha256: string;
}

export interface PersistedTurnInput {
  id: string;
  sessionId: string;
  role: string;
  text: string;
  externalUserId?: string | null;
  deliveryStatus?: string;
  metadata?: {
    genUi?: Record<string, unknown>;
    release?: RuntimeDeploymentBinding;
  } | null;
}

export interface BranchSessionBinding {
  scenarioId: string;
  fileName: string;
  sessionId: string;
  customerId: string;
}

export interface BranchSessionPlan {
  schemaVersion: 1;
  artifactKind: 'deployed-live-scenario-sessions';
  bindings: BranchSessionBinding[];
}

export interface SourceScenario {
  id: string;
  fileName: string;
  userTurns: Array<{ index: number; text: string; useCases: string[] }>;
}

export interface PersistedTurnPair {
  sourceTurnIndex: number;
  useCaseIds: string[];
  user: PersistedTurnInput;
  assistant: PersistedTurnInput;
  genUiSnapshot: Record<string, unknown> | null;
  actions: Array<Record<string, unknown>>;
}

export interface PersistedBranchArtifact {
  schemaVersion: 1;
  artifactKind: 'deployed-persisted-genui-branches';
  generatedAt: string;
  runtime: ProofRuntimeBinding;
  flutter: FlutterReleaseBinding;
  capturePlanVersion: typeof LEGACY_GENUI_CAPTURE_PLAN_VERSION;
  scenarioCount: typeof LEGACY_GENUI_CAPTURE_SCENARIO_COUNT;
  customerTurnCount: typeof LEGACY_GENUI_CAPTURE_TURN_COUNT;
  scenarios: Array<BranchSessionBinding & { pairs: PersistedTurnPair[]; sha256: string }>;
}

export async function buildPersistedBranchArtifact(input: {
  generatedAt: string;
  runtime: ProofRuntimeBinding;
  flutter: FlutterReleaseBinding;
  plan: BranchSessionPlan;
  sources: SourceScenario[];
  readPersistedTurns: (sessionId: string) => Promise<PersistedTurnInput[]>;
}): Promise<PersistedBranchArtifact> {
  assertRuntimeBinding(input.runtime);
  assertFlutterRelease(input.flutter);
  if (input.plan.schemaVersion !== 1 || input.plan.artifactKind !== 'deployed-live-scenario-sessions') {
    throw new Error('Invalid deployed branch session plan');
  }
  if (
    input.sources.length !== LEGACY_GENUI_CAPTURE_SCENARIO_COUNT ||
    input.plan.bindings.length !== LEGACY_GENUI_CAPTURE_SCENARIO_COUNT
  ) {
    throw new Error('Legacy GenUI branch proof requires scenarios 01-08 exactly once');
  }
  if (
    new Set(input.plan.bindings.map(({ sessionId }) => sessionId)).size !==
    LEGACY_GENUI_CAPTURE_SCENARIO_COUNT
  ) {
    throw new Error('Legacy GenUI branch proof requires eight unique sessions');
  }

  const scenarios = [] as PersistedBranchArtifact['scenarios'];
  for (const [index, source] of input.sources.entries()) {
    const binding = input.plan.bindings[index]!;
    if (binding.scenarioId !== source.id || binding.fileName !== source.fileName) {
      throw new Error(`Branch session binding mismatch at ${source.fileName}`);
    }
    if (!binding.sessionId.startsWith('kfc:') || /replay_|integration/i.test(binding.sessionId)) {
      throw new Error(`${source.id} is not bound to a real durable KFC session`);
    }
    const turns = await input.readPersistedTurns(binding.sessionId);
    const relevantTurns = turns.filter(({ role }) => role === 'user' || role === 'assistant');
    if (relevantTurns.length !== source.userTurns.length * 2) {
      throw new Error(`${source.id} durable session is not clean or complete`);
    }
    const durableSessionId = relevantTurns[0]?.sessionId;
    const durableCustomerId = relevantTurns[0]?.externalUserId;
    if (durableSessionId !== binding.sessionId || durableCustomerId !== binding.customerId) {
      throw new Error(`${source.id} plan does not match its durable session binding`);
    }
    const pairs: PersistedTurnPair[] = [];
    for (const [turnIndex, expected] of source.userTurns.entries()) {
      const user = relevantTurns[turnIndex * 2]!;
      const assistant = relevantTurns[turnIndex * 2 + 1]!;
      if (user.role !== 'user' || user.text !== expected.text || assistant.role !== 'assistant') {
        throw new Error(`${source.id} does not match source turn ${expected.index} exactly`);
      }
      if (user.sessionId !== binding.sessionId || assistant.sessionId !== binding.sessionId) {
        throw new Error(`${source.id} contains a cross-session turn`);
      }
      if (user.externalUserId !== binding.customerId) {
        throw new Error(`${source.id} customer binding does not match its durable user turn`);
      }
      if (user.deliveryStatus !== 'received' || assistant.deliveryStatus !== 'sent') {
        throw new Error(`${source.id} turn ${expected.index} is not durably received and sent`);
      }
      if (!sameDeployment(user.metadata?.release, input.runtime.deployment)
          || !sameDeployment(assistant.metadata?.release, input.runtime.deployment)) {
        throw new Error(`${source.id} turn ${expected.index} was not produced by the qualified deployment`);
      }
      const snapshot = assistant.metadata?.genUi ?? null;
      const actions = assertGenUiSnapshot(snapshot, source.id, expected.index);
      pairs.push({
        sourceTurnIndex: expected.index,
        useCaseIds: expected.useCases,
        user,
        assistant,
        genUiSnapshot: snapshot,
        actions,
      });
    }
    const scenario = {
      scenarioId: source.id,
      fileName: source.fileName,
      sessionId: durableSessionId,
      customerId: durableCustomerId,
      pairs,
    };
    scenarios.push({ ...scenario, sha256: sha256Json(scenario) });
  }
  const customerTurnCount = scenarios.reduce((sum, scenario) => sum + scenario.pairs.length, 0);
  if (customerTurnCount !== LEGACY_GENUI_CAPTURE_TURN_COUNT) {
    throw new Error(
      `Legacy GenUI branch proof requires exactly ${LEGACY_GENUI_CAPTURE_TURN_COUNT} source turns`,
    );
  }
  return {
    schemaVersion: 1,
    artifactKind: 'deployed-persisted-genui-branches',
    generatedAt: input.generatedAt,
    runtime: input.runtime,
    flutter: input.flutter,
    capturePlanVersion: LEGACY_GENUI_CAPTURE_PLAN_VERSION,
    scenarioCount: LEGACY_GENUI_CAPTURE_SCENARIO_COUNT,
    customerTurnCount: LEGACY_GENUI_CAPTURE_TURN_COUNT,
    scenarios,
  };
}

function sameDeployment(
  actual: RuntimeDeploymentBinding | undefined,
  expected: RuntimeDeploymentBinding,
): boolean {
  return actual?.gitSha === expected.gitSha
    && actual.deploymentId === expected.deploymentId
    && actual.builtAt === expected.builtAt
    && actual.dirty === expected.dirty;
}

export type GoldenOperation =
  | { operation: 'ask_discovery'; text: 'Có combo gà cay không?' }
  | { operation: 'add_approved_combo'; actionId: 'add_items'; itemCode: '20702'; quantity: 1; modifierIds: string[] }
  | { operation: 'upsize_drink_1'; actionId: 'customize_item:4:41091' }
  | { operation: 'upsize_drink_2'; actionId: 'customize_item:5:41091' }
  | { operation: 'continue_fulfillment'; actionId: 'continue_to_fulfillment' }
  | { operation: 'submit_approved_address'; actionId: 'submit_address'; address: ApprovedAddress }
  | { operation: 'accept_fulfillment'; actionId: 'accept_fulfillment' }
  | { operation: 'ask_payment_method'; text: 'ZaloPay được không?' }
  | { operation: 'select_zalopay'; actionId: 'select_payment_method'; methodId: 'zalopay_wallet' }
  | { operation: 'confirm_order'; actionId: 'confirm_order' }
  | { operation: 'advance_payment_paid'; expectedRevision: number }
  | { operation: 'ask_payment_status'; text: 'Thanh toán xong chưa?' }
  | { operation: 'advance_order_preparing'; expectedRevision: number }
  | { operation: 'ask_order_status'; text: 'Đơn đang làm chưa?' }
  | { operation: 'advance_order_delivering'; expectedRevision: number; remainingEtaMinutes: 15 }
  | { operation: 'ask_delivery_status'; text: 'Bao giờ giao tới?' };

export interface ApprovedAddress {
  line1: 'Chung cư Sunrise City, 23 Nguyễn Hữu Thọ';
  ward: 'phường Tân Hưng';
  district: 'Quận 7';
  city: 'Hồ Chí Minh';
}

export interface ApprovedGoldenPlan {
  schemaVersion: 1;
  artifactKind: 'approved-kfc-golden-plan';
  sessionId: string;
  customerId: string;
  lifecycleScenarioId: string;
  operations: GoldenOperation[];
}

const approvedModifierIds = [
  '41036', '41042', '41063',
  '60254:70012', '60254:70012', '60258:70443', '4:41090', '5:41090',
];
const approvedOperations = [
  'ask_discovery', 'add_approved_combo', 'upsize_drink_1', 'upsize_drink_2', 'continue_fulfillment',
  'submit_approved_address', 'accept_fulfillment', 'ask_payment_method', 'select_zalopay', 'confirm_order',
  'advance_payment_paid', 'ask_payment_status', 'advance_order_preparing', 'ask_order_status',
  'advance_order_delivering', 'ask_delivery_status',
];

export function assertApprovedGoldenPlan(plan: ApprovedGoldenPlan): void {
  if (plan.schemaVersion !== 1 || plan.artifactKind !== 'approved-kfc-golden-plan') {
    throw new Error('Invalid approved golden plan');
  }
  if (!plan.sessionId.startsWith('kfc:') || !plan.customerId || !plan.lifecycleScenarioId) {
    throw new Error('Golden plan is missing its trusted session binding');
  }
  if (JSON.stringify(plan.operations.map(({ operation }) => operation)) !== JSON.stringify(approvedOperations)) {
    throw new Error('Golden operations must match the approved sequence exactly');
  }
  const add = plan.operations[1] as Extract<GoldenOperation, { operation: 'add_approved_combo' }>;
  if (add.itemCode !== '20702' || add.quantity !== 1 || JSON.stringify(add.modifierIds) !== JSON.stringify(approvedModifierIds)) {
    throw new Error('Golden combo selection does not match the approved 20702 configuration');
  }
  const address = (plan.operations[5] as Extract<GoldenOperation, { operation: 'submit_approved_address' }>).address;
  if (JSON.stringify(address) !== JSON.stringify({
    line1: 'Chung cư Sunrise City, 23 Nguyễn Hữu Thọ',
    ward: 'phường Tân Hưng',
    district: 'Quận 7',
    city: 'Hồ Chí Minh',
  })) throw new Error('Golden address does not match the approved address');
  for (const operation of plan.operations.filter(({ operation }) => operation.startsWith('advance_'))) {
    if (!Number.isInteger((operation as { expectedRevision: number }).expectedRevision)
        || (operation as { expectedRevision: number }).expectedRevision < 0) {
      throw new Error('Golden lifecycle controls require a non-negative expected revision');
    }
  }
}

export function lifecycleControlRequests(plan: ApprovedGoldenPlan, operation: GoldenOperation): Array<{
  path: string;
  body: Record<string, unknown>;
}> {
  assertApprovedGoldenPlan(plan);
  const expectedRevision = (operation as { expectedRevision?: number }).expectedRevision;
  const events = operation.operation === 'advance_payment_paid'
    ? [{ type: 'payment_paid' }]
    : operation.operation === 'advance_order_preparing'
      ? [{ type: 'order_preparing' }]
      : operation.operation === 'advance_order_delivering'
        ? [
            { type: 'order_ready' },
            { type: 'delivery_pending', attemptId: `golden-delivery-${plan.lifecycleScenarioId}` },
            { type: 'delivery_assigned' },
            { type: 'delivery_started' },
          ]
        : undefined;
  if (!events || expectedRevision === undefined) throw new Error(`${operation.operation} is not a lifecycle control operation`);
  return events.map((event, index) => ({
    path: `/admin/lifecycle/instances/${encodeURIComponent(plan.lifecycleScenarioId)}/events`,
    body: {
      expectedRevision: expectedRevision + index,
      idempotencyKey: `golden:${operation.operation}:${expectedRevision + index}`,
      event,
    },
  }));
}

export function lifecycleControlRequest(plan: ApprovedGoldenPlan, operation: GoldenOperation): {
  path: string;
  body: Record<string, unknown>;
} {
  const requests = lifecycleControlRequests(plan, operation);
  if (requests.length !== 1) throw new Error(`${operation.operation} requires multiple lifecycle control requests`);
  return requests[0]!;
}

export function assertRuntimeBinding(value: ProofRuntimeBinding): void {
  if (!value.deployment.gitSha || !value.deployment.deploymentId || !value.deployment.builtAt || value.deployment.dirty !== false) {
    throw new Error('backend proof binding is not a clean deployed release');
  }
  if (
    !isRecord(value.versions.agent)
    || !['openai', 'google'].includes(String(value.versions.agent.provider))
    || typeof value.versions.agent.model !== 'string'
    || !value.versions.agent.model
    || typeof value.versions.agent.profile !== 'string'
    || !value.versions.agent.profile
    || JSON.stringify(Object.keys(value.versions.agent).sort()) !== JSON.stringify(['model', 'profile', 'provider'])
  ) {
    throw new Error('Runtime proof binding contains an invalid agent identity');
  }
  if (
    JSON.stringify(Object.keys(value.versions).sort())
    !== JSON.stringify(['agent', 'ledger', 'ranker', 'toolCatalog'])
  ) {
    throw new Error('Runtime proof binding contains a mixed or unknown version identity');
  }
  if (value.graph.runtime !== KFC_AGENT_RUNTIME_ID) {
    throw new Error('Runtime proof binding is not the simple agent runtime');
  }
  for (const field of [
    value.commerceEnvironment,
    value.providerFingerprint,
    value.catalogObservation.id,
    value.catalogObservation.sha256,
    value.catalogObservation.observedAt,
    value.lifecycle.provider,
    value.graph.runtime,
    value.graph.checkpoint,
    value.versions.agent.provider,
    value.versions.agent.model,
    value.versions.agent.profile,
    value.versions.toolCatalog,
    value.versions.ranker,
    value.versions.ledger,
  ]) if (!field) throw new Error('Runtime proof binding contains an empty field');
  if (!Number.isInteger(value.catalogObservation.itemCount) || value.catalogObservation.itemCount < 1
      || !Number.isInteger(value.catalogObservation.modifierTreeCount) || value.catalogObservation.modifierTreeCount < 1) {
    throw new Error('Runtime proof binding contains invalid catalog counts');
  }
}

export function assertProofRuntimeMatches(
  actual: ProofRuntimeBinding,
  expected: ProofRuntimeBinding,
): void {
  assertRuntimeBinding(actual);
  assertRuntimeBinding(expected);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error('Current readiness proof binding does not match the expected runtime');
  }
}

export function assertFlutterRelease(value: FlutterReleaseBinding): void {
  assertRelease(value, 'Flutter');
  if (!value.buildId) throw new Error('Flutter proof binding is missing buildId');
  if (!value.project) throw new Error('Flutter proof binding is missing project');
  const releaseUrl = URL.parse(value.releaseUrl);
  if (!releaseUrl || releaseUrl.protocol !== 'https:') {
    throw new Error('Flutter proof binding is missing an HTTPS releaseUrl');
  }
  if (!/^[a-f0-9]{64}$/.test(value.releaseAssetSha256)) {
    throw new Error('Flutter proof binding is missing a valid releaseAssetSha256');
  }
}

export function assertLocalFlutterRelease(input: {
  expected: FlutterReleaseBinding;
  releaseAsset: ProofReleaseAsset;
  releaseAssetSha256: string;
  gitSha: string;
  dirty: boolean;
}): void {
  assertFlutterRelease(input.expected);
  if (input.dirty || input.gitSha !== input.expected.gitSha) {
    throw new Error('Local Flutter source does not match the expected clean release');
  }
  if (input.releaseAssetSha256 !== input.expected.releaseAssetSha256
      || input.releaseAsset.gitSha !== input.expected.gitSha
      || input.releaseAsset.deploymentId !== input.expected.deploymentId
      || input.releaseAsset.buildId !== input.expected.buildId
      || input.releaseAsset.canonicalUrl !== new URL(input.expected.releaseUrl).origin
      || input.releaseAsset.project !== input.expected.project
      || input.releaseAsset.releaseBuiltAt !== input.expected.releaseBuiltAt
      || input.releaseAsset.dirty !== false) {
    throw new Error('Local Flutter build release asset does not match the expected release');
  }
}

export interface ProofReleaseAsset {
  gitSha: string;
  deploymentId: string;
  buildId: string;
  canonicalUrl: string;
  project: string;
  releaseBuiltAt: string;
  dirty: false;
}

function assertRelease(value: ProofReleaseBinding, label: string): void {
  if (!value.gitSha || !value.deploymentId || !value.releaseBuiltAt || value.dirty !== false) {
    throw new Error(`${label} proof binding is not a clean deployed release`);
  }
}

export function sha256Json(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(sortJson(value))).digest('hex');
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortJson(value[key])]));
}

function assertGenUiSnapshot(
  value: Record<string, unknown> | null,
  scenarioId: string,
  turnIndex: number,
): Array<Record<string, unknown>> {
  if (value === null) return [];
  const allowedSnapshotKeys = new Set([
    'id', 'lifecycleStage', 'widgetKind', 'status', 'title', 'summary', 'data', 'actions',
    'selectedAction', 'expiresAt',
  ]);
  const widgetKinds = new Set([
    'smartMenuPicker', 'productDetailCard', 'modifierPicker', 'promotionGallery', 'allergenEvidence',
    'cartBuilder', 'addressFulfillmentCheck', 'orderReviewConfirm', 'paymentOrderStatus',
    'orderTrackingStatus', 'supportHandoff', 'paymentMethodPicker',
  ]);
  if (!isRecord(value)
      || Object.keys(value).some((key) => !allowedSnapshotKeys.has(key))
      || !nonEmptyString(value.id)
      || !nonEmptyString(value.lifecycleStage)
      || typeof value.widgetKind !== 'string'
      || !widgetKinds.has(value.widgetKind)
      || !['active', 'answered', 'expired', 'blocked'].includes(String(value.status))
      || !nonEmptyString(value.title)
      || !isRecord(value.data)
      || !Array.isArray(value.actions)
      || (value.summary !== undefined && typeof value.summary !== 'string')
      || (value.selectedAction !== undefined && typeof value.selectedAction !== 'string')
      || (value.expiresAt !== undefined && typeof value.expiresAt !== 'string')) {
    throw new Error(`${scenarioId} turn ${turnIndex} has an invalid GenUI snapshot`);
  }
  const actions = value.actions as unknown[];
  if (!actions.every(isExactGenUiAction)) {
    throw new Error(`${scenarioId} turn ${turnIndex} has an invalid GenUI action schema`);
  }
  return actions as Array<Record<string, unknown>>;
}

function isExactGenUiAction(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const allowedKeys = new Set(['id', 'label', 'intent', 'value', 'payload', 'destructive']);
  return Object.keys(value).every((key) => allowedKeys.has(key))
    && nonEmptyString(value.id)
    && nonEmptyString(value.label)
    && (value.intent === undefined || ['primary', 'secondary', 'destructive', 'recovery'].includes(String(value.intent)))
    && (value.value === undefined || typeof value.value === 'string')
    && (value.payload === undefined || isRecord(value.payload))
    && (value.destructive === undefined || typeof value.destructive === 'boolean');
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
