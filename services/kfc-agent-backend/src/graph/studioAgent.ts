import { MemorySaver } from '@langchain/langgraph';
import { buildServerOptionsFromEnv } from '../api/serverOptions.js';
import { DashboardEventBus } from '../dashboard/eventBus.js';
import { loadEnv } from '../config/env.js';
import { loadGeneratedFixtures } from '../fixtures/loadFixtures.js';
import { createMockClients } from '../mock/createMockClients.js';
import { createNoopAgentTracer } from '../observability/agentTracing.js';
import { MemoryStore } from '../persistence/memoryStore.js';
import {
  createAgentTurnStateGraph,
  type AgentTurnGraphRuntimeResolver,
} from './buildGraph.js';

const env = loadEnv();
const options = buildServerOptionsFromEnv(env);
const store = new MemoryStore();
const dashboard = new DashboardEventBus();
const clientsPromise = loadGeneratedFixtures(process.cwd()).then((fixtures) =>
  createMockClients(fixtures, options.mockClientOptions),
);
const noopTracer = createNoopAgentTracer();

const resolveStudioRuntime: AgentTurnGraphRuntimeResolver = async (state) => ({
  input: {
    sessionId: state.sessionId,
    customerId: state.customerId,
    channel: state.channel,
    text: state.text,
    externalMessageId: state.externalMessageId,
    metadata: state.metadata,
    clients: await clientsPromise,
    store,
    dashboard,
    responseComposer: options.responseComposer,
    toolPlanner: options.toolPlanner,
    smallTalkRouter: options.smallTalkRouter,
    workflowRouter: options.workflowRouter,
    commerceAgentPolicy: options.commerceAgentPolicy,
    monitorJudge: options.monitorJudge,
  },
  turnTrace: await noopTracer.startTurn({
    name: 'studio_agent_turn',
    inputs: {
      sessionId: state.sessionId,
      customerId: state.customerId,
      channel: state.channel,
      latestUserMessage: state.text,
    },
    metadata: { source: 'langsmith_studio' },
    tags: ['kfc-agent-turn', 'langsmith-studio'],
  }),
});

/**
 * Studio-facing graph with fixture-backed commerce clients and optional OpenAI
 * planner/composer instances loaded from the repository environment.
 */
export const agent = createAgentTurnStateGraph(resolveStudioRuntime, new MemorySaver());
