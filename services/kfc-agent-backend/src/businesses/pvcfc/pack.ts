import type { PreparedTurnResources } from '../../business/agentPack.js';
import type { ExecutableAgentPack } from '../../agent/agentTurnRunner.js';
import type { DirectAgentTurnInput } from '../../agent/directAgentTurn.js';
import type {
  OpenAiKfcAgent,
  OpenAiKfcAgentTurnResult,
} from '../../agent/openAiKfcAgent.js';
import type { OpenAiCompactionEvent } from '../../agent/observedOpenAiResponsesCompactionSession.js';
import type { ConversationStore } from '../../persistence/contracts.js';
import type { Channel } from '../../domain/types.js';
import type { PvcfcPublicDataProvider } from './public-data/pvcfcPublicDataProvider.js';
import { PVCFC_AGENT_PROFILE, PVCFC_EVIDENCE_POLICY } from './instructions.js';
import { createPvcfcOpenAiTools } from './tools.js';

export interface PvcfcAgentPackOptions {
  store: ConversationStore;
  openAiAgent: OpenAiKfcAgent;
  provider: PvcfcPublicDataProvider;
}

export type PvcfcAgentTurnResult = Omit<OpenAiKfcAgentTurnResult, 'genUi'> & {
  stateCommit?: 'committed' | 'stale';
};

interface PvcfcPreparedContext {
  input: DirectAgentTurnInput;
  runMetrics?: {
    status: 'success' | 'error';
    latencyMs: number;
    usage?: {
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
    };
  };
  compactionMetrics?: OpenAiCompactionEvent;
  serviceStartedAt: number;
}

function isPvcfcPreparedContext(value: unknown): value is PvcfcPreparedContext {
  return (
    typeof value === 'object' &&
    value !== null &&
    'input' in value &&
    'serviceStartedAt' in value &&
    typeof value.serviceStartedAt === 'number'
  );
}

function contextFrom(prepared: PreparedTurnResources): PvcfcPreparedContext {
  if (!isPvcfcPreparedContext(prepared.context)) {
    throw new Error('pvcfc_agent_pack_context_invalid');
  }
  return prepared.context;
}

function auditPayload(input: {
  result: PvcfcAgentTurnResult;
  context: PvcfcPreparedContext;
}) {
  return {
    schemaVersion: 'openai-redacted-tool-trace-v1',
    assistantTurnId: input.result.assistantTurnId,
    run: input.context.runMetrics ?? {
      status: 'success' as const,
      latencyMs: Math.max(0, Date.now() - input.context.serviceStartedAt),
      usage: input.result.usage,
    },
    ...(input.context.compactionMetrics
      ? { compaction: input.context.compactionMetrics }
      : {}),
    calls: input.result.toolCalls.map((call) => ({
      name: call.name,
      status: call.status ?? 'success',
      ...(call.durationMs === undefined ? {} : { durationMs: call.durationMs }),
    })),
  };
}

export class PvcfcAgentPack implements ExecutableAgentPack<
  DirectAgentTurnInput,
  PvcfcAgentTurnResult
> {
  readonly id = 'pvcfc';
  readonly profile = PVCFC_AGENT_PROFILE;
  readonly lifecycle = {
    onRunSucceeded: async (input: {
      prepared: PreparedTurnResources;
      result: PvcfcAgentTurnResult;
    }) => {
      const context = contextFrom(input.prepared);
      const commitInput = {
        stateEvent: {
          sessionId: context.input.sessionId,
          sourceType: 'conversation:assistant_committed',
          payload: { packId: this.id },
        },
        assistantTurn: input.result.assistantTurn,
        sdkSessionMutation: input.result.sdkSessionMutation,
        auditEvent: {
          sessionId: context.input.sessionId,
          sourceType: 'openai:tool_trace',
          payload: auditPayload({ result: input.result, context }),
        },
      };
      const commit = context.input.fence
        ? await this.options.store.commitAssistantTurnIfRunCurrent({
            ...commitInput,
            fence: context.input.fence,
          })
        : await this.options.store.commitAssistantTurn(commitInput);
      input.result.stateCommit =
        commit.status === 'stale' ? 'stale' : 'committed';
    },
    onRunFailed: async (input: {
      prepared: PreparedTurnResources;
      error: unknown;
    }) => {
      const context = contextFrom(input.prepared);
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
    },
  };

  constructor(private readonly options: PvcfcAgentPackOptions) {}

  prepareTurn(input: DirectAgentTurnInput): PreparedTurnResources {
    return {
      tools: createPvcfcOpenAiTools(this.options.provider),
      context: {
        input,
        serviceStartedAt: Date.now(),
      } satisfies PvcfcPreparedContext,
    };
  }

  async execute(input: {
    turn: DirectAgentTurnInput;
    profile: typeof PVCFC_AGENT_PROFILE;
    prepared: PreparedTurnResources;
  }): Promise<PvcfcAgentTurnResult> {
    const context = contextFrom(input.prepared);
    const publicData = await this.options.provider.listCollections({
      limit: 20,
    });
    if (!publicData.ok) {
      throw new Error(`pvcfc_public_data_${publicData.error.code}`);
    }
    const searchableRecordCount = publicData.value.collections
      .filter(({ access }) => access === 'searchable')
      .reduce((total, { count }) => total + count, 0);
    return this.options.openAiAgent.respond({
      profile: input.profile,
      sessionId: input.turn.sessionId,
      customerId: input.turn.customerId,
      // The persisted transport remains web_chat without widening KFC's
      // business-channel domain at the shared route boundary.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- adapter from the neutral web transport to the legacy persistence channel
      channel: input.turn.transport as Channel,
      transport: input.turn.transport,
      text: input.turn.text,
      externalMessageId: input.turn.externalMessageId,
      metadata: input.turn.metadata,
      store: this.options.store,
      verifiedBusinessContext: {
        schemaVersion: 'pvcfc_public_data_v2',
        revision: publicData.value.revision,
        capturedAt: publicData.value.capturedAt,
        organization: publicData.value.organization,
        collections: publicData.value.collections,
        searchableRecordCount,
      },
      tools: [...input.prepared.tools],
      requireEvidenceTool: PVCFC_EVIDENCE_POLICY.requireToolOnFirstModelTurn,
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
    });
  }
}
