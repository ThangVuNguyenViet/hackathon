import type { ExternalClients } from '../clients/interfaces.js';
import type {
  Channel,
  ConversationTurnMetadata,
  CustomerAccessContext,
} from '../domain/types.js';
import type { GeneratedFixtures } from '../fixtures/schema.js';
import type { KfcGenUiAttachment } from '../genui/kfcGenUi.js';
import type {
  ConversationStore,
  RunCommitFence,
} from '../persistence/contracts.js';
import type { PreparedTurnResources } from '../business/agentPack.js';
import { createAgentTurnExternalCallScope } from './agentExternalCallScope.js';
import type { ExecutableAgentPack } from './agentTurnRunner.js';
import { KFC_AGENT_PROFILE } from './kfcAgentInstructions.js';
import {
  createKfcOpenAiAgentsTools,
  createKfcOpenAiTools,
  createKfcToolSession,
  verifiedKfcToolSessionContext,
  type KfcToolSession,
  type KfcToolSessionState,
} from './kfcOpenAiTools.js';
import {
  hydrateKfcOpenAiToolSession,
  prepareKfcOpenAiToolSessionPublication,
} from './kfcOpenAiToolSessionLifecycle.js';
import {
  OpenAiKfcAgent,
  type OpenAiKfcAgentExecutionResult,
  type OpenAiKfcAgentLifecycleObserver,
  type OpenAiKfcAgentTurnResult,
} from './openAiKfcAgent.js';
import type { OpenAiCompactionEvent } from './observedOpenAiResponsesCompactionSession.js';

export interface PreparedDirectKfcTurn {
  session?: KfcToolSession;
  requiredToolCalls?: Array<{
    name: string;
    arguments: Record<string, unknown>;
  }>;
  allowModelToolCalls?: boolean;
}

export interface DirectAgentTurnInput {
  /** Compatibility only; the runner's trusted pack ID is authoritative. */
  businessId?: 'kfc' | 'pvcfc';
  sessionId: string;
  customerId: string;
  channel: Channel;
  transport?: 'web_chat' | Channel;
  text: string;
  externalMessageId: string | null;
  metadata: ConversationTurnMetadata | null;
  clients?: ExternalClients;
  prepareSession?(
    session: KfcToolSession,
  ): Promise<PreparedDirectKfcTurn> | PreparedDirectKfcTurn;
  selectGenUi?: (
    result: OpenAiKfcAgentExecutionResult,
    session: KfcToolSession,
  ) => KfcGenUiAttachment | undefined;
  fence?: RunCommitFence;
  lifecycle?: OpenAiKfcAgentLifecycleObserver;
}

export interface DirectAgentTurnResult extends OpenAiKfcAgentTurnResult {
  session?: KfcToolSession;
  stateCommit?: 'committed' | 'stale';
}

export interface KfcAgentPackOptions {
  store: ConversationStore;
  openAiAgent: OpenAiKfcAgent;
  getFixtures(): Promise<GeneratedFixtures>;
  createClients(
    sessionId: string,
    metadata: ConversationTurnMetadata | null,
  ): Promise<ExternalClients>;
  getAccessContext(
    sessionId: string,
    customerId: string,
  ): Promise<CustomerAccessContext | undefined>;
}

interface RunMetrics {
  status: 'success' | 'error';
  latencyMs: number;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
}

interface KfcPreparedContext {
  input: DirectAgentTurnInput;
  preparedInput: PreparedDirectKfcTurn | undefined;
  sessionState: KfcToolSessionState;
  dispose(): void;
  serviceStartedAt: number;
  runMetrics?: RunMetrics;
  compactionMetrics?: OpenAiCompactionEvent;
}

function isKfcPreparedContext(value: unknown): value is KfcPreparedContext {
  return (
    typeof value === 'object' &&
    value !== null &&
    'sessionState' in value &&
    'input' in value &&
    'dispose' in value &&
    typeof value.dispose === 'function'
  );
}

function kfcContext(prepared: PreparedTurnResources): KfcPreparedContext {
  if (!isKfcPreparedContext(prepared.context)) {
    throw new Error('kfc_agent_pack_context_invalid');
  }
  return prepared.context;
}

export class KfcAgentPack implements ExecutableAgentPack<
  DirectAgentTurnInput,
  DirectAgentTurnResult
> {
  readonly id = 'kfc';
  readonly profile = KFC_AGENT_PROFILE;
  readonly lifecycle = {
    onRunSucceeded: async (input: {
      prepared: PreparedTurnResources;
      result: DirectAgentTurnResult;
    }) => {
      const context = kfcContext(input.prepared);
      try {
        const session = context.sessionState.current;
        const publication = await prepareKfcOpenAiToolSessionPublication({
          session,
          latestUserMessage: context.input.text,
          toolCalls: input.result.toolCalls,
          assistantTurnId: input.result.assistantTurnId,
          customerCommand: context.input.metadata?.customerCommand,
          runMetrics: context.runMetrics,
          compactionMetrics: context.compactionMetrics,
        });
        const commitInput = {
          stateEvent: {
            sessionId: context.input.sessionId,
            sourceType: 'graph:verified_state',
            payload: { verifiedState: publication.verifiedState },
          },
          assistantTurn: input.result.assistantTurn,
          sdkSessionMutation: input.result.sdkSessionMutation,
          ...(publication.auditPayload
            ? {
                auditEvent: {
                  sessionId: context.input.sessionId,
                  sourceType: 'openai:tool_trace',
                  payload: publication.auditPayload,
                },
              }
            : {}),
        };
        const commit = context.input.fence
          ? await this.options.store.commitAssistantTurnIfRunCurrent({
              ...commitInput,
              fence: context.input.fence,
            })
          : await this.options.store.commitAssistantTurn(commitInput);
        input.result.session = session;
        input.result.stateCommit =
          commit.status === 'stale' ? 'stale' : 'committed';
      } finally {
        context.dispose();
      }
    },
    onRunFailed: async (input: {
      prepared: PreparedTurnResources;
      error: unknown;
    }) => {
      const context = kfcContext(input.prepared);
      try {
        const payload = {
          schemaVersion: 'openai-redacted-tool-trace-v1',
          assistantTurnId: null,
          run: context.runMetrics ?? {
            status: 'error' as const,
            latencyMs: Math.max(0, Date.now() - context.serviceStartedAt),
          },
          ...(context.compactionMetrics
            ? { compaction: context.compactionMetrics }
            : {}),
          calls: [],
        };
        if (context.input.fence) {
          await this.options.store.appendEventIfRunCurrent({
            sessionId: context.input.sessionId,
            sourceType: 'openai:tool_trace',
            payload,
            fence: context.input.fence,
          });
        } else {
          await this.options.store.appendEvent(
            context.input.sessionId,
            'openai:tool_trace',
            payload,
          );
        }
      } finally {
        context.dispose();
      }
    },
  };

  constructor(private readonly options: KfcAgentPackOptions) {}

  async prepareTurn(
    input: DirectAgentTurnInput,
  ): Promise<PreparedTurnResources> {
    const externalCalls = createAgentTurnExternalCallScope(120_000);
    const serviceStartedAt = Date.now();
    try {
      const clients =
        input.clients ??
        (await this.options.createClients(input.sessionId, input.metadata));
      const freshSession = await createKfcToolSession(
        clients,
        input.sessionId,
        input.customerId,
        input.channel,
        externalCalls.context,
      );
      const hydratedSession = await hydrateKfcOpenAiToolSession({
        store: this.options.store,
        sessionId: input.sessionId,
        freshSession,
      });
      const initialSession = {
        ...hydratedSession,
        externalCallContext: externalCalls.context,
      };
      const preparedInput = await input.prepareSession?.(initialSession);
      const sessionState: KfcToolSessionState = {
        current: preparedInput?.session ?? initialSession,
      };
      const tools = createKfcOpenAiAgentsTools(
        createKfcOpenAiTools({
          clients,
          sessionState,
          accessContext: await this.options.getAccessContext(
            input.sessionId,
            input.customerId,
          ),
          fixtures: await this.options.getFixtures(),
        }),
      );
      const context: KfcPreparedContext = {
        input,
        preparedInput,
        sessionState,
        serviceStartedAt,
        dispose: () => externalCalls.dispose(),
      };
      return { tools, context };
    } catch (error) {
      externalCalls.dispose();
      throw error;
    }
  }

  async execute(input: {
    turn: DirectAgentTurnInput;
    profile: typeof KFC_AGENT_PROFILE;
    prepared: PreparedTurnResources;
  }): Promise<DirectAgentTurnResult> {
    const context = kfcContext(input.prepared);
    return this.options.openAiAgent.respond({
      profile: input.profile,
      sessionId: input.turn.sessionId,
      customerId: input.turn.customerId,
      channel: input.turn.channel,
      transport: input.turn.transport,
      text: input.turn.text,
      externalMessageId: input.turn.externalMessageId,
      metadata: input.turn.metadata,
      store: this.options.store,
      verifiedBusinessContext: verifiedKfcToolSessionContext(
        context.sessionState.current,
      ),
      tools: [...input.prepared.tools],
      requiredToolCalls: context.preparedInput?.requiredToolCalls,
      allowModelToolCalls: context.preparedInput?.allowModelToolCalls,
      lifecycle: {
        onRunStart: input.turn.lifecycle?.onRunStart,
        onToolEnd: input.turn.lifecycle?.onToolEnd,
        onCompactionEnd: async (event) => {
          context.compactionMetrics = event;
          await input.turn.lifecycle?.onCompactionEnd?.(event);
        },
        onRunEnd: async (event) => {
          context.runMetrics = event;
          await input.turn.lifecycle?.onRunEnd?.(event);
        },
      },
      ...(input.turn.selectGenUi
        ? {
            selectGenUi: (result) =>
              input.turn.selectGenUi?.(result, context.sessionState.current),
          }
        : {}),
    });
  }
}
