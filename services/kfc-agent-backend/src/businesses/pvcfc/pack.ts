import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import {
  AIMessage,
  HumanMessage,
  ToolMessage,
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
import { admittedPvcfcWebInventoryUrls } from './webPolicy.js';
import {
  createAgentTurnExternalCallScope,
  defaultAgentTurnDeadlineMs,
} from '../../agent/agentExternalCallScope.js';

const MAX_HISTORY_TURNS = 12;
const MAX_HISTORY_TEXT_LENGTH = 4_000;
const MAX_MODEL_CALLS_PER_RUN = 6;
// Broad public-data questions legitimately require one detail lookup per
// record (the urban-agriculture demo currently has 15 records). These tools
// are read-only, so keep a bounded but collection-sized allowance.
const MAX_TOOL_CALLS_PER_RUN = 20;
const RECURSION_LIMIT = 64;

export interface PvcfcAgentTurnInput {
  readonly sessionId: string;
  readonly customerId: string;
  readonly transport: 'web_chat' | 'messenger' | 'zalo';
  readonly text: string;
  readonly externalMessageId: string | null;
  readonly metadata: ConversationTurnMetadata | null;
  readonly fence?: RunCommitFence;
  readonly existingUserTurnIds?: readonly string[];
  readonly existingUserExternalMessageIds?: readonly string[];
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
    readonly now?: () => number;
  };
  readonly turnDeadlineMs?: number;
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
    const webBudget = this.options.webEvidence
      ? createPvcfcWebTurnBudget({ now: this.options.webEvidence.now })
      : undefined;
    const userTurns = turn.existingUserTurnIds
      ? await this.existingUserTurns(turn)
      : [
          await this.options.store.appendTurn({
            sessionId: turn.sessionId,
            // The neutral application transport is intentionally not added to
            // the KFC-owned Channel type while the old domain seam is replaced.
            // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
            channel: turn.transport as never,
            role: 'user',
            text: turn.text,
            externalMessageId: turn.externalMessageId,
            externalUserId: turn.customerId,
            deliveryStatus: 'received',
            metadata: turn.metadata,
          }),
        ];
    const userTurn = userTurns[0]!;

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
      const sourceInventory = this.options.webEvidence
        ? await this.options.provider.listSourceUrls()
        : undefined;
      if (sourceInventory?.ok === false) {
        throw new Error(`pvcfc_public_data_${sourceInventory.error.code}`);
      }
      const inventoryUrls = sourceInventory?.ok
        ? admittedPvcfcWebInventoryUrls(sourceInventory.value)
        : [];
      const webTools = this.options.webEvidence
        ? createPvcfcWebTools({
            client: this.options.webEvidence.client,
            inventoryUrls,
            receipts: toolCalls,
            budget: webBudget!,
          })
        : [];
      const webToolNames = new Set<string>(webTools.map(({ name }) => name));
      const inventoriedUrls = new Set(inventoryUrls);
      const allTools = [...tools, ...webTools];
      let liveWebUnavailable = false;
      const pendingCanonicalSourceUrls = () =>
        new Set(
          toolCalls
            .filter(
              ({ evidenceMode, status }) =>
                evidenceMode === 'canonical' && status === 'success',
            )
            .flatMap(({ sourceUrls }) => sourceUrls ?? [])
            .filter((url) => inventoriedUrls.has(url)),
        );
      const webAttempted = () =>
        toolCalls.some(({ name }) => webToolNames.has(name));
      const requireEvidence = createMiddleware({
        name: 'pvcfcEvidenceRequirement',
        wrapToolCall: async (request, handler) => {
          const toolName =
            typeof request.tool?.name === 'string'
              ? request.tool.name
              : request.toolCall.name;
          if (webToolNames.has(toolName) && liveWebUnavailable) {
            const toolCallId =
              typeof request.toolCall.id === 'string'
                ? request.toolCall.id
                : 'pvcfc-live-unavailable';
            return new ToolMessage({
              content: JSON.stringify({
                ok: false,
                errorCode: 'pvcfc_web_live_unavailable',
              }),
              tool_call_id: toolCallId,
              name: toolName,
              status: 'error',
            });
          }
          if (
            webToolNames.has(toolName) &&
            !toolCalls.some(({ name }) => providerToolNames.has(name))
          ) {
            throw new Error('pvcfc_web_provider_evidence_required');
          }
          const requiredSourceUrls = pendingCanonicalSourceUrls();
          if (
            webToolNames.has(toolName) &&
            requiredSourceUrls.size > 0 &&
            !webAttempted()
          ) {
            if (toolName !== 'fetchPvcfcPage') {
              throw new Error('pvcfc_web_exact_source_fetch_required');
            }
            const requestedUrl = Reflect.get(request.toolCall.args, 'url');
            if (
              typeof requestedUrl !== 'string' ||
              !requiredSourceUrls.has(requestedUrl)
            ) {
              throw new Error('pvcfc_web_canonical_source_required');
            }
          }
          const traceCountBefore = toolCalls.length;
          try {
            const result = await handler(request);
            if (
              webToolNames.has(toolName) &&
              toolCalls
                .slice(traceCountBefore)
                .some(({ status }) => status === 'error')
            ) {
              // TinyFish failures are an optional evidence degradation, not a
              // reason to keep retrying the same web tool until the turn dies.
              // The next model call must answer from the canonical provider
              // evidence already collected in this turn.
              liveWebUnavailable = true;
            }
            return result;
          } catch (error) {
            if (webToolNames.has(toolName)) liveWebUnavailable = true;
            throw error;
          }
        },
        wrapModelCall: (request, handler) => {
          const providerAttempted = toolCalls.some(({ name }) =>
            providerToolNames.has(name),
          );
          const requireCanonicalSourceFetch =
            this.options.webEvidence !== undefined &&
            pendingCanonicalSourceUrls().size > 0 &&
            !webAttempted();
          const availableTools = liveWebUnavailable
            ? request.tools.filter(
                ({ name }) =>
                  typeof name !== 'string' || providerToolNames.has(name),
              )
            : request.tools;
          return handler({
            ...request,
            toolChoice: liveWebUnavailable
              ? 'auto'
              : toolCalls.length === 0 || requireCanonicalSourceFetch
                ? 'required'
                : 'auto',
            tools: liveWebUnavailable
              ? availableTools
              : requireCanonicalSourceFetch
                ? request.tools.filter(({ name }) => name === 'fetchPvcfcPage')
                : providerAttempted
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
          this.options.webEvidence
            ? 'Start with canonical PVCFC public data. When a relevant canonical result contains an admitted official source URL, fetch that exact page to enrich the answer with current context. Use official-site search when canonical evidence needs a freshness check or a missing detail.'
            : "Use the newest canonical PVCFC record as the answer baseline and keep the response focused on the customer's question.",
          'When the user asks for a summary or comparison of one bounded collection, call listPvcfcRecords with includeDetails=true and an appropriate limit instead of retrieving every record with separate getPvcfcRecord calls.',
          '',
          'Verified current PVCFC public-data index:',
          JSON.stringify({
            revision: publicData.value.revision,
            capturedAt: publicData.value.capturedAt,
            organization: { name: publicData.value.organization.name },
            collections: publicData.value.collections,
          }),
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
      const externalCalls = createAgentTurnExternalCallScope(
        this.options.turnDeadlineMs ?? defaultAgentTurnDeadlineMs,
      );
      let execution: Awaited<ReturnType<typeof agent.invoke>>;
      try {
        execution = await agent.invoke(
          // LangChain's merged middleware state currently over-constrains this
          // plain built-in messages input; createAgent accepts it at runtime.
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
          { messages } as never,
          {
            recursionLimit: RECURSION_LIMIT,
            signal: externalCalls.context.signal,
          },
        );
      } finally {
        externalCalls.dispose();
      }
      const responseMessage = [...execution.messages]
        .reverse()
        .find(
          (message) =>
            AIMessage.isInstance(message) &&
            (message.tool_calls?.length ?? 0) === 0,
        );
      if (!responseMessage || toolCalls.length === 0) {
        throw new Error('pvcfc_evidence_tool_required');
      }
      const responseText = textContent(responseMessage).trim();
      if (responseText.length === 0) {
        throw new Error('pvcfc_response_text_required');
      }
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
          metadata: {
            ...(turn.metadata?.release
              ? { release: turn.metadata.release }
              : {}),
            rawEvent: {
              pvcfcRequestUserTurnId: userTurn.id,
              pvcfcRequestUserTurnIds: userTurns.map(({ id }) => id),
              pvcfcClientMessageId: turn.externalMessageId,
            },
          },
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

  private async existingUserTurns(turn: PvcfcAgentTurnInput) {
    const expectedIds = turn.existingUserTurnIds ?? [];
    const expectedExternalMessageIds =
      turn.existingUserExternalMessageIds ?? [];
    if (
      expectedIds.length === 0 ||
      new Set(expectedIds).size !== expectedIds.length ||
      expectedExternalMessageIds.length !== expectedIds.length
    ) {
      throw new Error('pvcfc_existing_user_turns_invalid');
    }
    const turns = await this.options.store.listTurns(turn.sessionId);
    const selected = expectedIds.map((id) =>
      turns.find((turn) => turn.id === id),
    );
    if (
      selected.some(
        (candidate, index) =>
          candidate === undefined ||
          candidate.role !== 'user' ||
          candidate.sessionId !== turn.sessionId ||
          candidate.channel !== turn.transport ||
          candidate.externalUserId !== turn.customerId ||
          candidate.externalMessageId !== expectedExternalMessageIds[index],
      )
    ) {
      throw new Error('pvcfc_existing_user_turns_invalid');
    }
    const existing = selected.filter(
      (candidate): candidate is NonNullable<typeof candidate> =>
        candidate !== undefined,
    );
    const expectedText =
      existing.length === 1
        ? existing[0]!.text
        : existing.map(({ text }, index) => `${index + 1}. ${text}`).join('\n');
    if (
      expectedText !== turn.text ||
      expectedExternalMessageIds[0] !== turn.externalMessageId
    ) {
      throw new Error('pvcfc_existing_user_turns_invalid');
    }
    return existing;
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
