import type { CustomerAccessContext } from '../../src/domain/types.js';
import type { GeneratedFixtures } from '../../src/fixtures/schema.js';
import type { AgentGraphState } from '../../src/graph/state.js';
import { DashboardEventBus } from '../../src/dashboard/eventBus.js';
import {
  executeGraphToolCallForPublication,
  type GraphExecutedToolResult,
} from '../../src/agent/graphExecutedToolResult.js';
import type { ModelPublicationAuthority } from '../../src/agent/modelPublicationAuthority.js';
import {
  createAgentTurnExternalCallScope,
  type PendingToolCall,
  type SingleAgentRuntimeContext,
} from '../../src/agent/singleAgentRuntime.js';
import {
  createMockClients,
  type MockClientOptions,
} from '../../src/mock/createMockClients.js';
import { createNoopAgentTracer } from '../../src/observability/agentTracing.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';
import { createTestFixtures } from '../fixtures/testFixtures.js';

export async function executePublicationTool(input: {
  authority: ModelPublicationAuthority;
  state: AgentGraphState;
  accessContext?: CustomerAccessContext;
  call: PendingToolCall;
  clientOptions?: MockClientOptions;
  fixtures?: GeneratedFixtures;
}): Promise<GraphExecutedToolResult> {
  const scope = createAgentTurnExternalCallScope(1_000);
  const runtime: SingleAgentRuntimeContext = {
    turnInput: {
      sessionId: input.state.sessionId,
      customerId: input.state.customerId,
      channel: input.state.channel,
      text: input.state.latestUserMessage,
      externalMessageId:
        input.state.recentTurns?.at(-1)?.externalMessageId,
      accessContext: input.accessContext,
      clients: createMockClients(
        input.fixtures ?? createTestFixtures(),
        input.clientOptions,
      ),
      store: new MemoryStore(),
      dashboard: new DashboardEventBus(),
    },
    turnTrace: await createNoopAgentTracer().startTurn({
      name: 'model_publication_test_execution',
      inputs: {},
    }),
    externalCallContext: scope.context,
    abortExternalCalls: scope.abort,
    disposeExternalCalls: scope.dispose,
    state: input.state,
  };

  try {
    return await executeGraphToolCallForPublication({
      authority: input.authority,
      runtime,
      state: input.state,
      call: input.call,
      currentTurnToolTrace: [],
    });
  } finally {
    scope.dispose();
  }
}
