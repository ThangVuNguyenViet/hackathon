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
import { createAgentTurnExternalCallScope } from './agentExternalCallScope.js';
import {
  createKfcOpenAiAgentsTools,
  createKfcOpenAiTools,
  createKfcToolSession,
  verifiedKfcToolSessionContext,
  type KfcToolSession,
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

export interface PreparedDirectKfcTurn {
  requiredToolCalls?: Array<{
    name: string;
    arguments: Record<string, unknown>;
  }>;
  allowModelToolCalls?: boolean;
}

export interface KfcDirectTurnServiceOptions {
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

export interface KfcDirectTurnInput {
  sessionId: string;
  customerId: string;
  channel: Channel;
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

export interface KfcDirectTurnResult extends OpenAiKfcAgentTurnResult {
  session: KfcToolSession;
  stateCommit: 'committed' | 'stale';
}

export class KfcDirectTurnService {
  constructor(private readonly options: KfcDirectTurnServiceOptions) {}

  async run(input: KfcDirectTurnInput): Promise<KfcDirectTurnResult> {
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
      const session = await hydrateKfcOpenAiToolSession({
        store: this.options.store,
        sessionId: input.sessionId,
        freshSession,
      });
      session.externalCallContext = externalCalls.context;
      const prepared = await input.prepareSession?.(session);
      let runMetrics:
        | {
            status: 'success' | 'error';
            latencyMs: number;
            usage?: {
              inputTokens: number;
              outputTokens: number;
              totalTokens: number;
            };
          }
        | undefined;
      let directOutput: OpenAiKfcAgentTurnResult;
      try {
        directOutput = await this.options.openAiAgent.respond({
          sessionId: input.sessionId,
          customerId: input.customerId,
          channel: input.channel,
          text: input.text,
          externalMessageId: input.externalMessageId,
          metadata: input.metadata,
          store: this.options.store,
          verifiedBusinessContext: verifiedKfcToolSessionContext(session),
          tools: createKfcOpenAiAgentsTools(
            createKfcOpenAiTools({
              clients,
              session,
              accessContext: await this.options.getAccessContext(
                input.sessionId,
                input.customerId,
              ),
              fixtures: await this.options.getFixtures(),
            }),
          ),
          requiredToolCalls: prepared?.requiredToolCalls,
          allowModelToolCalls: prepared?.allowModelToolCalls,
          lifecycle: {
            onRunStart: input.lifecycle?.onRunStart,
            onToolEnd: input.lifecycle?.onToolEnd,
            onRunEnd: async (event) => {
              runMetrics = event;
              await input.lifecycle?.onRunEnd?.(event);
            },
          },
          ...(input.selectGenUi
            ? {
                selectGenUi: (result) =>
                  input.selectGenUi?.(
                    result,
                    session,
                  ),
              }
            : {}),
        });
      } catch (error) {
        const payload = {
          schemaVersion: 'openai-redacted-tool-trace-v1',
          assistantTurnId: null,
          run: runMetrics ?? {
            status: 'error' as const,
            latencyMs: Math.max(0, Date.now() - serviceStartedAt),
          },
          calls: [],
        };
        if (input.fence) {
          await this.options.store.appendEventIfRunCurrent({
            sessionId: input.sessionId,
            sourceType: 'openai:tool_trace',
            payload,
            fence: input.fence,
          });
        } else {
          await this.options.store.appendEvent(
            input.sessionId,
            'openai:tool_trace',
            payload,
          );
        }
        throw error;
      }
      const publication = await prepareKfcOpenAiToolSessionPublication({
        session,
        latestUserMessage: input.text,
        toolCalls: directOutput.toolCalls,
        assistantTurnId: directOutput.assistantTurnId,
        customerCommand: input.metadata?.customerCommand,
        runMetrics,
      });
      const commitInput = {
        stateEvent: {
          sessionId: input.sessionId,
          sourceType: 'graph:verified_state',
          payload: { verifiedState: publication.verifiedState },
        },
        assistantTurn: directOutput.assistantTurn,
        sdkSessionItems: directOutput.sdkSessionItems,
        ...(publication.auditPayload
          ? {
              auditEvent: {
                sessionId: input.sessionId,
                sourceType: 'openai:tool_trace',
                payload: publication.auditPayload,
              },
            }
          : {}),
      };
      const commit = input.fence
        ? await this.options.store.commitAssistantTurnIfRunCurrent({
            ...commitInput,
            fence: input.fence,
          })
        : await this.options.store.commitAssistantTurn(commitInput);
      const stateCommit =
        commit.status === 'stale' ? 'stale' : 'committed';
      return { ...directOutput, session, stateCommit };
    } finally {
      externalCalls.dispose();
    }
  }
}
