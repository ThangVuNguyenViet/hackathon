import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { runAgentTurn } from '../agent/kfcAgent.js';
import { DashboardEventBus } from '../dashboard/eventBus.js';
import type {
  Cart,
  Channel,
  CustomerAccessContext,
  DashboardEvent,
  Order,
} from '../domain/types.js';
import { loadGeneratedFixtures } from '../fixtures/loadFixtures.js';
import type { GeneratedFixtures } from '../fixtures/schema.js';
import type { KfcGenUiAttachment } from '../genui/kfcGenUi.js';
import type { AgentState } from '../agent/agentState.js';
import {
  createMockClients,
  type MockClientOptions,
  type MockedUpstreamApiProfile,
} from '../mock/createMockClients.js';
import type { ToolTraceEntry } from '../ordering/types.js';
import type { AgentTracer } from '../observability/agentTracing.js';
import { MemoryStore, type StoredEvent } from '../persistence/memoryStore.js';
import type { ResponseProfile } from '../presentation/responseProfile.js';
import type { ScenarioScript } from './scenarioScript.js';

export interface ScenarioTurnEvidence {
  turnIndex: number;
  input: string;
  durationMs: number;
  assistantText: string;
  genUi?: KfcGenUiAttachment;
  stateBefore: ScenarioEvidenceState;
  stateAfter: ScenarioEvidenceState;
}
export type ScenarioEvidenceState = Partial<
  Pick<
    AgentState,
    | 'cart'
    | 'address'
    | 'addressDraft'
    | 'fulfillment'
    | 'orderPreview'
    | 'order'
    | 'paymentAttempt'
    | 'handoff'
    | 'menuSearchResults'
    | 'menuItemDetail'
    | 'menuModifierOptions'
    | 'promotionContext'
    | 'promotionOffers'
    | 'customerContext'
    | 'paymentMethodEvidence'
    | 'contentEvidence'
    | 'invoiceRequest'
  >
>;

export interface ScenarioRunResult {
  preconditions: string[];
  finalState: string;
  coveredUseCases: string[];
  dashboardEvents: DashboardEvent[];
  escalationReasons: string[];
  transcript: Awaited<ReturnType<MemoryStore['listTurns']>>;
  eventsBeforeFinalUserTurn: DashboardEvent[];
  toolTrace: ToolTraceEntry[];
  toolTraceByTurn: Array<{ turnIndex: number; entries: ToolTraceEntry[] }>;
  turnEvidence: ScenarioTurnEvidence[];
  persistedEvents: StoredEvent[];
  finalAgentState?: AgentState;
  cart?: Cart;
  order?: Order;
}

export interface RunScenarioOptions {
  agentModel: BaseChatModel;
  accessContext?: CustomerAccessContext;
  channelOverride?: Channel;
  responseProfileOverride?: ResponseProfile;
  fixturesRoot?: string;
  initialVerifiedState?: Partial<AgentState>;
  mockClientOptions?: MockClientOptions;
  tracer?: AgentTracer;
  mockedUpstreamApiForTurn?: (
    turnIndex: number,
  ) => MockedUpstreamApiProfile | undefined;
  transformFixtures?: (fixtures: GeneratedFixtures) => GeneratedFixtures;
}

function defaultFixturesRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '../..');
}

function sameTrace(
  left: ToolTraceEntry,
  right: ToolTraceEntry | undefined,
): boolean {
  return Boolean(right) && JSON.stringify(left) === JSON.stringify(right);
}

function scenarioAccessContext(
  sessionId: string,
  channel: Channel,
): CustomerAccessContext {
  const customerSurface = channel.startsWith('messenger')
    ? 'messenger'
    : channel.startsWith('zalo')
      ? 'zalo'
      : 'kfc-app-chat';
  const external = customerSurface !== 'kfc-app-chat';
  return {
    tenantScope: 'kfc-vietnam',
    customerSurface,
    sessionRef: sessionId,
    surfaceSubjectRef: external ? 'scenario_customer' : 'not-applicable',
    kfcSubjectRef: 'scenario_customer',
    authenticationState: 'authenticated',
    membershipState: 'member',
    channelAccountLinkState: external ? 'linked' : 'not-applicable',
    subjectBindingState: 'verified',
    authenticationEvidence: {
      state: 'verified',
      method: 'fixture',
      issuer: 'scenario-runner',
      audience: 'kfc-agent-backend',
      authenticatedAt: '2026-01-01T00:00:00.000Z',
      expiresAt: '2036-01-01T00:00:00.000Z',
      evidenceRef: `scenario:${sessionId}`,
    },
    authorizedScopes: [
      'customer:read',
      'membership:read',
      'membership:write',
      'order:read',
      'order:write',
      'payment:read',
      'payment:write',
      'handoff:write',
    ],
  };
}

export async function runScenario(
  script: ScenarioScript,
  options: RunScenarioOptions,
): Promise<ScenarioRunResult> {
  const sessionId = `replay_${script.id}`;
  const store = new MemoryStore();
  const dashboard = new DashboardEventBus();
  const loadedFixtures = await loadGeneratedFixtures(
    options.fixturesRoot ?? defaultFixturesRoot(),
  );
  const fixtures =
    options.transformFixtures?.(loadedFixtures) ?? loadedFixtures;
  const mockOptions: MockClientOptions = {
    ...(options.mockClientOptions ?? {}),
  };
  let currentMockedUpstreamApi: MockedUpstreamApiProfile | undefined;
  if (options.mockedUpstreamApiForTurn) {
    mockOptions.mockedUpstreamApiProvider = () => currentMockedUpstreamApi;
  }
  const clients = createMockClients(fixtures, mockOptions);
  if (options.initialVerifiedState) {
    await store.appendEvent(sessionId, 'agent:verified_state', {
      verifiedState: options.initialVerifiedState,
    });
  }

  const turnEvidence: ScenarioTurnEvidence[] = [];
  const toolTrace: ToolTraceEntry[] = [];
  const toolTraceByTurn: Array<{
    turnIndex: number;
    entries: ToolTraceEntry[];
  }> = [];
  const escalationReasons = new Set<string>();
  let priorTrace: ToolTraceEntry[] = [];
  let priorState: ScenarioEvidenceState = selectEvidenceState(
    options.initialVerifiedState,
  );
  let finalAgentState: AgentState | undefined;
  let eventsBeforeFinalUserTurn: DashboardEvent[] = [];

  for (const [position, turn] of script.userTurns.entries()) {
    if (position === script.userTurns.length - 1) {
      eventsBeforeFinalUserTurn = dashboard.getEvents(sessionId);
    }
    currentMockedUpstreamApi = options.mockedUpstreamApiForTurn?.(turn.index);
    const startedAt = performance.now();
    const channel = options.channelOverride ?? script.channel;
    const output = await runAgentTurn({
      sessionId,
      customerId: 'scenario_customer',
      channel,
      responseProfile: options.responseProfileOverride,
      text: turn.text,
      externalMessageId: `${script.id}:${turn.index}`,
      accessContext:
        options.accessContext ?? scenarioAccessContext(sessionId, channel),
      clients,
      store,
      dashboard,
      agentModel: options.agentModel,
      tracer: options.tracer,
    });
    const durationMs = performance.now() - startedAt;
    const completeTrace = output.state.toolTrace ?? [];
    const currentTrace =
      completeTrace.length >= priorTrace.length &&
      priorTrace.every((entry, index) => sameTrace(entry, completeTrace[index]))
        ? completeTrace.slice(priorTrace.length)
        : completeTrace;
    priorTrace = completeTrace;
    toolTrace.push(...currentTrace);
    toolTraceByTurn.push({ turnIndex: turn.index, entries: currentTrace });
    for (const reason of output.state.escalationReasons) {
      escalationReasons.add(reason);
    }
    const stateAfter = selectEvidenceState(output.state);
    turnEvidence.push({
      turnIndex: turn.index,
      input: turn.text,
      durationMs,
      assistantText: output.responseText,
      ...(output.genUi ? { genUi: output.genUi } : {}),
      stateBefore: priorState,
      stateAfter,
    });
    priorState = stateAfter;
    finalAgentState = output.state;
  }

  return {
    preconditions: script.preconditions,
    finalState: script.finalState,
    coveredUseCases: script.useCases,
    dashboardEvents: dashboard.getEvents(sessionId),
    escalationReasons: [...escalationReasons],
    transcript: await store.listTurns(sessionId),
    eventsBeforeFinalUserTurn,
    toolTrace,
    toolTraceByTurn,
    turnEvidence,
    persistedEvents: await store.listEvents(sessionId),
    finalAgentState,
    ...(finalAgentState?.cart ? { cart: finalAgentState.cart } : {}),
    ...(finalAgentState?.order ? { order: finalAgentState.order } : {}),
  };
}

function selectEvidenceState(
  state: Partial<AgentState> | undefined,
): ScenarioEvidenceState {
  if (!state) return {};
  return structuredClone({
    cart: state.cart,
    address: state.address,
    addressDraft: state.addressDraft,
    fulfillment: state.fulfillment,
    orderPreview: state.orderPreview,
    order: state.order,
    paymentAttempt: state.paymentAttempt,
    handoff: state.handoff,
    menuSearchResults: state.menuSearchResults,
    menuItemDetail: state.menuItemDetail,
    menuModifierOptions: state.menuModifierOptions,
    promotionContext: state.promotionContext,
    promotionOffers: state.promotionOffers,
    customerContext: state.customerContext,
    paymentMethodEvidence: state.paymentMethodEvidence,
    contentEvidence: state.contentEvidence,
    invoiceRequest: state.invoiceRequest,
  });
}
