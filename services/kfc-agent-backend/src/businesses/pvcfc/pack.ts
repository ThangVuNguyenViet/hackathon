import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import {
  AIMessage,
  HumanMessage,
  type BaseMessage,
} from '@langchain/core/messages';
import {
  createAgent,
  createMiddleware,
  modelCallLimitMiddleware,
  toolCallLimitMiddleware,
} from 'langchain';
import type { BusinessAgentPack } from '../../business/agentPack.js';
import type { ConversationTurnMetadata } from '../../domain/types.js';
import type {
  ConversationStore,
  RunCommitFence,
} from '../../persistence/contracts.js';
import { PVCFC_AGENT_PROFILE } from './instructions.js';
import type { PvcfcPublicDataProvider } from './public-data/pvcfcPublicDataProvider.js';
import { createPvcfcTools, type PvcfcToolTrace } from './tools.js';
import type { TinyFishClient } from '../../web/tinyFishClient.js';
import { createPvcfcWebTools, createPvcfcWebTurnBudget } from './webTools.js';

const MAX_HISTORY_TURNS = 12;
const MAX_HISTORY_TEXT_LENGTH = 4_000;
const MAX_MODEL_CALLS_PER_RUN = 6;
const MAX_TOOL_CALLS_PER_RUN = 8;
const RECURSION_LIMIT = 32;

export interface PvcfcAgentTurnInput {
  readonly sessionId: string;
  readonly customerId: string;
  readonly transport: 'web_chat';
  readonly text: string;
  readonly externalMessageId: string | null;
  readonly metadata: ConversationTurnMetadata | null;
  readonly fence?: RunCommitFence;
}

export interface PvcfcAgentUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
}

export interface PvcfcAgentTurnResult {
  readonly responseText: string;
  readonly userTurnId: string;
  readonly assistantTurnId: string;
  readonly usage: PvcfcAgentUsage;
  readonly toolCalls: readonly PvcfcToolTrace[];
  stateCommit: 'committed' | 'stale';
}

export interface PvcfcAgentPackOptions {
  readonly store: ConversationStore;
  readonly model: BaseChatModel;
  readonly provider: PvcfcPublicDataProvider;
  readonly webEvidence?: {
    readonly client: TinyFishClient;
    readonly inventoryUrls: readonly string[];
  };
}

function textContent(message: BaseMessage): string {
  if (typeof message.content === 'string') return message.content;
  return message.content
    .flatMap((block) =>
      typeof block === 'object' &&
      block !== null &&
      'text' in block &&
      typeof block.text === 'string'
        ? [block.text]
        : [],
    )
    .join('');
}

function usageFrom(messages: readonly BaseMessage[]): PvcfcAgentUsage {
  let inputTokens = 0;
  let outputTokens = 0;
  let totalTokens = 0;
  for (const message of messages) {
    if (!AIMessage.isInstance(message)) continue;
    const usage = message.usage_metadata;
    if (
      typeof usage !== 'object' ||
      usage === null ||
      !('input_tokens' in usage) ||
      !('output_tokens' in usage) ||
      !('total_tokens' in usage) ||
      typeof usage.input_tokens !== 'number' ||
      typeof usage.output_tokens !== 'number' ||
      typeof usage.total_tokens !== 'number'
    ) {
      continue;
    }
    inputTokens += usage.input_tokens;
    outputTokens += usage.output_tokens;
    totalTokens += usage.total_tokens;
  }
  return { inputTokens, outputTokens, totalTokens };
}

function auditPayload(input: {
  status: 'success' | 'error';
  startedAt: number;
  assistantTurnId: string | null;
  calls: readonly PvcfcToolTrace[];
  usage?: PvcfcAgentUsage;
}) {
  return {
    schemaVersion: 'business-tool-trace-v1',
    assistantTurnId: input.assistantTurnId,
    run: {
      status: input.status,
      latencyMs: Math.max(0, Date.now() - input.startedAt),
      ...(input.usage ? { usage: input.usage } : {}),
    },
    calls: input.calls.map(
      ({ name, status, durationMs, sourceUrls, evidenceMode }) => ({
        name,
        status,
        durationMs,
        ...(evidenceMode === undefined ? {} : { evidenceMode }),
        ...(sourceUrls === undefined
          ? {}
          : {
              sourceUrls: sourceUrls
                .slice(0, 5)
                .map((url) => url.slice(0, 2_048)),
            }),
      }),
    ),
  };
}

export class PvcfcAgentPack implements BusinessAgentPack<
  PvcfcAgentTurnInput,
  PvcfcAgentTurnResult
> {
  readonly id = 'pvcfc';

  constructor(private readonly options: PvcfcAgentPackOptions) {}

  async runTurn(turn: PvcfcAgentTurnInput): Promise<PvcfcAgentTurnResult> {
    const startedAt = Date.now();
    const toolCalls: PvcfcToolTrace[] = [];
    const userTurn = await this.options.store.appendTurn({
      sessionId: turn.sessionId,
      // The neutral application transport is intentionally not added to the
      // KFC-owned Channel type while the old domain seam is being replaced.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      channel: turn.transport as never,
      role: 'user',
      text: turn.text,
      externalMessageId: turn.externalMessageId,
      externalUserId: turn.customerId,
      deliveryStatus: 'received',
      metadata: turn.metadata,
    });

    try {
      const messages = await this.historyMessages(turn.sessionId);
      const publicData = await this.options.provider.listCollections({
        limit: 20,
      });
      if (publicData.ok === false) {
        throw new Error(`pvcfc_public_data_${publicData.error.code}`);
      }
      const tools = createPvcfcTools(this.options.provider, (trace) =>
        toolCalls.push(trace),
      );
      const providerToolNames = new Set<string>(tools.map(({ name }) => name));
      const webTools = this.options.webEvidence
        ? createPvcfcWebTools({
            client: this.options.webEvidence.client,
            inventoryUrls: this.options.webEvidence.inventoryUrls,
            receipts: toolCalls,
            budget: createPvcfcWebTurnBudget(),
          })
        : [];
      const allTools = [...tools, ...webTools];
      const requireEvidence = createMiddleware({
        name: 'pvcfcEvidenceRequirement',
        wrapModelCall: (request, handler) => {
          const providerAttempted = toolCalls.some(({ name }) =>
            providerToolNames.has(name),
          );
          return handler({
            ...request,
            toolChoice: toolCalls.length === 0 ? 'required' : 'auto',
            tools: providerAttempted
              ? request.tools
              : request.tools.filter(
                  ({ name }) =>
                    typeof name !== 'string' || providerToolNames.has(name),
                ),
          });
        },
      });
      const agent = createAgent({
        model: this.options.model,
        tools: allTools,
        systemPrompt: [
          `# ${PVCFC_AGENT_PROFILE.name}`,
          PVCFC_AGENT_PROFILE.instructions,
          '',
          'Verified current PVCFC public-data index:',
          JSON.stringify(publicData.value),
        ].join('\n'),
        middleware: [
          requireEvidence,
          modelCallLimitMiddleware({
            runLimit: MAX_MODEL_CALLS_PER_RUN,
            exitBehavior: 'error',
          }),
          toolCallLimitMiddleware({
            runLimit: MAX_TOOL_CALLS_PER_RUN,
            exitBehavior: 'error',
          }),
        ],
      });
      const execution = await agent.invoke(
        // LangChain's merged middleware state currently over-constrains this
        // plain built-in messages input; createAgent accepts it at runtime.
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        { messages } as never,
        { recursionLimit: RECURSION_LIMIT },
      );
      const responseMessage = [...execution.messages]
        .reverse()
        .find(
          (message) =>
            AIMessage.isInstance(message) &&
            (message.tool_calls?.length ?? 0) === 0 &&
            textContent(message).trim().length > 0,
        );
      if (!responseMessage || toolCalls.length === 0) {
        throw new Error('pvcfc_evidence_tool_required');
      }
      const responseText = textContent(responseMessage).trim();
      const liveSourceUrls = toolCalls
        .filter(
          ({ evidenceMode, status }) =>
            evidenceMode === 'live_web' && status === 'success',
        )
        .flatMap(({ sourceUrls }) => sourceUrls ?? []);
      if (
        liveSourceUrls.length > 0 &&
        !liveSourceUrls.some((sourceUrl) => responseText.includes(sourceUrl))
      ) {
        throw new Error('pvcfc_web_citation_required');
      }
      const usage = usageFrom(execution.messages);
      const assistantTurnId = `turn_${crypto.randomUUID()}`;
      const commitInput = {
        stateEvent: {
          sessionId: turn.sessionId,
          sourceType: 'conversation:assistant_committed',
          payload: { packId: this.id },
        },
        assistantTurn: {
          id: assistantTurnId,
          sessionId: turn.sessionId,
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- web_chat remains outside the KFC-owned Channel union
          channel: turn.transport as never,
          role: 'assistant' as const,
          text: responseText,
          externalMessageId: null,
          externalUserId: turn.customerId,
          deliveryStatus: 'pending' as const,
          metadata: turn.metadata?.release
            ? { release: turn.metadata.release }
            : null,
        },
        auditEvent: {
          sessionId: turn.sessionId,
          sourceType: 'agent:tool_trace',
          payload: auditPayload({
            status: 'success',
            startedAt,
            assistantTurnId,
            calls: toolCalls,
            usage,
          }),
        },
      };
      const commit = turn.fence
        ? await this.options.store.commitAssistantTurnIfRunCurrent({
            ...commitInput,
            fence: turn.fence,
          })
        : await this.options.store.commitAssistantTurn(commitInput);

      return {
        responseText,
        userTurnId: userTurn.id,
        assistantTurnId,
        usage,
        toolCalls,
        stateCommit: commit.status === 'stale' ? 'stale' : 'committed',
      };
    } catch (error) {
      const payload = auditPayload({
        status: 'error',
        startedAt,
        assistantTurnId: null,
        calls: toolCalls,
      });
      if (turn.fence) {
        await this.options.store.appendEventIfRunCurrent({
          sessionId: turn.sessionId,
          sourceType: 'agent:tool_trace',
          payload,
          fence: turn.fence,
        });
      } else {
        await this.options.store.appendEvent(
          turn.sessionId,
          'agent:tool_trace',
          payload,
        );
      }
      throw error;
    }
  }

  private async historyMessages(sessionId: string): Promise<BaseMessage[]> {
    return (await this.options.store.listTurns(sessionId))
      .filter(
        (turn): turn is typeof turn & { role: 'user' | 'assistant' } =>
          turn.role === 'user' || turn.role === 'assistant',
      )
      .slice(-MAX_HISTORY_TURNS)
      .map((turn) => {
        const text = turn.text.slice(0, MAX_HISTORY_TEXT_LENGTH);
        return turn.role === 'user'
          ? new HumanMessage(text)
          : new AIMessage(text);
      });
  }
}
