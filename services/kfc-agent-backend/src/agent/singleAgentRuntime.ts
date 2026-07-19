import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { BaseMessage } from '@langchain/core/messages';
import { ToolMessage } from '@langchain/core/messages';
import {
  ToolInputParsingException,
  type ToolRuntime,
} from '@langchain/core/tools';
import {
  createAgent,
  createMiddleware,
  humanInTheLoopMiddleware,
  modelCallLimitMiddleware,
  tool,
} from 'langchain';
import { Command, type BaseCheckpointSaver } from '@langchain/langgraph';
import { z } from 'zod';
import { countCustomerTurns } from '../monitor/sessionIntelligence.js';
import { getToolBoundary } from '../ordering/toolBoundaries.js';
import {
  parseToolArguments,
  toolArgumentSchemas,
  toolNames,
} from '../ordering/toolCatalog.js';
import {
  classifyToolSideEffect,
} from '../ordering/toolExecutor.js';
import type {
  ToolCallRequest,
  ToolName,
  ToolTraceEntry,
} from '../ordering/types.js';
import {
  assertPresentationMatchesChannel,
  buildChannelPresentation,
  buildSocialPresentation,
} from '../presentation/channelPresentation.js';
import { responseProfileForChannel } from '../presentation/responseProfile.js';
import { buildBoundedRecentTurns } from '../session/sessionContext.js';
import {
  executeAndApplyTracedToolCall,
  ensureCartForTool,
} from '../graph/commerceExecution.js';
import { emitDerivedEvents } from '../graph/commerceMonitoring.js';
import type {
  AgentTurnInput,
  AgentTurnOutput,
  ReplyIntent,
} from '../graph/agentTurnState.js';
import type { AgentGraphState } from '../graph/state.js';
import {
  emitDashboardEvent,
  isRunStillCurrent,
  stateRevision,
  traceStateSummary,
} from '../graph/turnSupport.js';
import {
  loadPriorVerifiedState,
  persistVerifiedStateSnapshot,
} from '../graph/verifiedState.js';
import { selectKfcGenUiAttachment } from '../genui/kfcGenUiSelector.js';
import type { AgentTraceSpan } from '../observability/agentTracing.js';

const maximumProviderCalls = 6;
const maximumSemanticCorrections = 1;

interface SingleAgentRuntimeContext {
  turnInput: AgentTurnInput;
  state: AgentGraphState;
  currentTurnToolTrace: ToolTraceEntry[];
  turnTrace: AgentTraceSpan;
  semanticCorrections: { used: number };
}

const runtimeContextSchema = z.object({
  runtime: z.custom<SingleAgentRuntimeContext>(),
});
const hitlInterruptSchema = z.object({
  actionRequests: z.array(z.object({
    name: z.string(),
    args: z.record(z.unknown()).optional(),
  })).min(1),
});

const reviewableTools = [
  'placeOrder',
  'createPaymentLink',
  'handoff',
  'acquireVoucher',
  'redeemReward',
] as const satisfies readonly ToolName[];
const toolNameSet = new Set<string>(toolNames);

const systemPrompt = [
  'You are the single semantic decision-maker for a KFC commerce assistant.',
  'Understand the customer request, decide whether tools are needed, call only tools that materially advance the request, inspect their returned verified evidence, and then answer naturally in the customer language.',
  'Never invent product identifiers, prices, availability, addresses, store assignment, promotions, order state, payment state, membership state, or tool success.',
  'Use tool results and verified conversation state as facts. A failed tool result is not success.',
  'Ask a concise clarification when the requested action lacks information that tools and verified state cannot supply.',
  'Do not claim an irreversible action completed until its tool returned success after approval.',
  'For structured companion mode, keep prose concise because verified UI may carry the details. For standalone text mode, include all verified facts needed to understand the result.',
].join('\n');

function toolDescription(name: ToolName): string {
  return [
    `KFC ${getToolBoundary(name)} capability ${name}.`,
    'Use it only when its typed input and returned verified provider evidence are needed for the current customer request.',
    'Do not infer success from issuing the call; inspect the returned result.',
  ].join(' ');
}

function runtimeFromTool(
  runtime: ToolRuntime<unknown, { runtime: SingleAgentRuntimeContext }>,
): SingleAgentRuntimeContext {
  const value = runtime.context?.runtime;
  if (!value) throw new Error('KFC agent tool runtime context is missing');
  return value;
}

function portableCommerceTools() {
  return toolNames.map((name) =>
    tool(
      async (
        rawArguments: unknown,
        toolRuntime: ToolRuntime<unknown, { runtime: SingleAgentRuntimeContext }>,
      ) => {
        const runtime = runtimeFromTool(toolRuntime);
        const parsed = parseToolArguments(
          name,
          (rawArguments ?? {}) as Record<string, unknown>,
        );
        if (!parsed.success) {
          return semanticToolFailure(runtime, {
            toolName: name,
            errorCode: 'invalid_tool_arguments',
          });
        }

        const call: ToolCallRequest = {
          toolName: name,
          arguments: parsed.data as Record<string, unknown>,
        };
        if (!(await ensureCartForTool(runtime.turnInput, runtime.state, call))) {
          return semanticToolFailure(runtime, {
            toolName: name,
            errorCode: 'cart_initialization_failed',
          });
        }
        if (classifyToolSideEffect(name, call.arguments) === 'irreversible') {
          await requireValidApprovalReceipt(runtime, call);
          if (name === 'placeOrder') runtime.state.userConfirmedOrder = true;
        }
        const result = await executeAndApplyTracedToolCall({
          turnInput: runtime.turnInput,
          turnTrace: runtime.turnTrace,
          state: runtime.state,
          call,
          currentTurnToolTrace: runtime.currentTurnToolTrace,
        });
        if (!result.ok) {
          return semanticToolFailure(runtime, {
            toolName: name,
            errorCode: result.errorCode ?? 'tool_execution_failed',
            message: result.message,
          });
        }
        await persistVerifiedStateSnapshot(
          runtime.turnInput.store,
          runtime.state,
        );
        return JSON.stringify(result);
      },
      {
        name,
        description: toolDescription(name),
        // #51 owns the schema cleanup. The runtime consumes the current
        // repository schemas and the executor parses them again before use.
        schema: toolArgumentSchemas[name] as never,
      },
    ),
  );
}

async function verifiedApprovalStateRevision(
  state: AgentGraphState,
): Promise<string> {
  return stateRevision({
    cart: state.cart ?? null,
    fulfillment: state.fulfillment ?? null,
    orderPreview: state.orderPreview ?? null,
    order: state.order ?? null,
    paymentAttempt: state.paymentAttempt ?? null,
    selectedPaymentMethod: state.selectedPaymentMethod ?? null,
  });
}

async function requireValidApprovalReceipt(
  runtime: SingleAgentRuntimeContext,
  action: ToolCallRequest,
): Promise<void> {
  const receipt = runtime.turnInput.confirmationResume?.receipt;
  const authority =
    runtime.turnInput.confirmationAuthority ??
    runtime.turnInput.clients.confirmationAuthority;
  if (!receipt || !authority) {
    throw new Error('authenticated_agent_approval_receipt_required');
  }
  const expectedActionDigest = await stateRevision(action);
  const expectedStateRevision = await verifiedApprovalStateRevision(
    runtime.state,
  );
  if (
    receipt.decision !== 'approve' ||
    receipt.requestId !== runtime.turnInput.confirmationResume?.requestId ||
    receipt.sessionId !== runtime.turnInput.sessionId ||
    receipt.customerId !== runtime.turnInput.customerId ||
    receipt.channel !== runtime.turnInput.channel ||
    receipt.capability !== action.toolName ||
    receipt.actionDigest !== expectedActionDigest ||
    receipt.verifiedStateRevision !== expectedStateRevision ||
    receipt.providerRevision !== authority.providerRevision ||
    !receipt.principalId.trim() ||
    !isUnexpiredTimestamp(receipt.expiresAt)
  ) {
    throw new Error('agent_approval_receipt_binding_mismatch');
  }
}

function isUnexpiredTimestamp(value: string): boolean {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp > Date.now();
}

function semanticToolFailure(
  runtime: SingleAgentRuntimeContext,
  failure: {
    toolName: ToolName;
    errorCode: string;
    message?: string;
  },
): string {
  runtime.semanticCorrections.used += 1;
  if (runtime.semanticCorrections.used > maximumSemanticCorrections) {
    throw new Error('agent_semantic_correction_limit_exceeded');
  }
  return JSON.stringify({
    ok: false,
    toolName: failure.toolName,
    errorCode: failure.errorCode,
    ...(failure.message ? { message: failure.message } : {}),
    correctionAllowed: true,
  });
}

function correctionMiddleware() {
  return createMiddleware({
    name: 'KfcSingleSemanticCorrection',
    contextSchema: runtimeContextSchema,
    wrapToolCall: async (request, handler) => {
      const runtime = request.runtime.context?.runtime;
      const name = request.toolCall.name;
      if (runtime && isToolName(name)) {
        const parsed = parseToolArguments(name, request.toolCall.args);
        if (!parsed.success) {
          return correctionToolMessage(
            request.toolCall.id,
            name,
            semanticToolFailure(runtime, {
              toolName: name,
              errorCode: 'invalid_tool_arguments',
            }),
          );
        }
      }
      try {
        return await handler(request);
      } catch (error) {
        if (!(error instanceof ToolInputParsingException)) throw error;
        if (!runtime) throw error;
        if (!isToolName(name)) throw error;
        const content = semanticToolFailure(runtime, {
          toolName: name,
          errorCode: 'tool_call_rejected',
        });
        return correctionToolMessage(request.toolCall.id, name, content);
      }
    },
  });
}

function correctionToolMessage(
  toolCallId: string | undefined,
  name: ToolName,
  content: string,
): ToolMessage {
  return new ToolMessage({
    content,
    tool_call_id: toolCallId ?? crypto.randomUUID(),
    name,
    status: 'error',
  });
}

function tracingMiddleware() {
  return createMiddleware({
    name: 'KfcSingleAgentTracing',
    contextSchema: runtimeContextSchema,
    wrapModelCall: async (request, handler) => {
      const runtime = request.runtime.context?.runtime;
      if (!runtime) return handler(request);
      const span = await runtime.turnTrace.startSpan({
        name: 'agent_model',
        runType: 'llm',
        inputs: { messageCount: request.messages.length },
        metadata: { component: 'LangChainCreateAgent' },
        tags: ['agent-model'],
      });
      try {
        const response = await handler(request);
        await span.end({
          toolCallCount: response.tool_calls?.length ?? 0,
          hasText: messageText(response).length > 0,
        });
        return response;
      } catch (error) {
        await span.fail(error);
        throw error;
      }
    },
  });
}

function hitlMiddleware() {
  return humanInTheLoopMiddleware({
    interruptOn: Object.fromEntries(
      reviewableTools.map((name) => [
        name,
        {
          allowedDecisions: ['approve', 'reject'] as const,
          when: (request: { toolCall: { args: Record<string, unknown> } }) =>
            classifyToolSideEffect(name, request.toolCall.args) === 'irreversible',
        },
      ]),
    ),
  });
}

export function createKfcSingleAgent(input: {
  model: BaseChatModel;
  checkpointer: BaseCheckpointSaver;
}) {
  return createAgent({
    model: input.model,
    tools: portableCommerceTools(),
    systemPrompt,
    contextSchema: runtimeContextSchema,
    checkpointer: input.checkpointer,
    version: 'v2',
    middleware: [
      modelCallLimitMiddleware({
        runLimit: maximumProviderCalls,
        exitBehavior: 'error',
      }),
      tracingMiddleware(),
      correctionMiddleware(),
      hitlMiddleware(),
    ],
  });
}

export type KfcSingleAgent = ReturnType<typeof createKfcSingleAgent>;

async function loadTurnState(input: AgentTurnInput): Promise<{
  state: AgentGraphState;
  customerTurnCount: number;
}> {
  const responseProfile =
    input.responseProfile ?? responseProfileForChannel(input.channel);
  const existingTurns = await input.store.listTurns(input.sessionId);
  const conflictingTurn = existingTurns.find(
    (turn) =>
      (turn.metadata?.responseProfile ??
        responseProfileForChannel(turn.channel)) !== responseProfile,
  );
  if (conflictingTurn) {
    throw new Error(
      `session_response_profile_mismatch:${input.sessionId}:` +
      `${conflictingTurn.metadata?.responseProfile ??
        responseProfileForChannel(conflictingTurn.channel)}:${responseProfile}`,
    );
  }

  const existingUserTurn = input.externalMessageId
    ? await input.store.findTurnByExternalMessage(
      input.sessionId,
      input.externalMessageId,
    )
    : undefined;
  if (!input.confirmationResume && !existingUserTurn) {
    const userTurn = await input.store.appendTurn({
      sessionId: input.sessionId,
      channel: input.channel,
      role: 'user',
      text: input.text,
      externalMessageId: input.externalMessageId ?? null,
      externalUserId: input.customerId,
      deliveryStatus: 'received',
      metadata: input.metadata ?? null,
    });
    emitDashboardEvent(input, 'customer_message_received', {
      turnId: userTurn.id,
      channel: userTurn.channel,
      externalMessageId: userTurn.externalMessageId,
      externalUserId: userTurn.externalUserId,
      text: userTurn.text,
      metadata: userTurn.metadata,
    });
    emitDashboardEvent(input, 'conversation_turn_created', {
      turnId: userTurn.id,
      role: userTurn.role,
      channel: userTurn.channel,
      deliveryStatus: userTurn.deliveryStatus,
      externalMessageId: userTurn.externalMessageId,
      externalUserId: userTurn.externalUserId,
      text: userTurn.text,
      metadata: userTurn.metadata,
    });
  }

  const prior = await loadPriorVerifiedState(input.store, input.sessionId);
  const allTurns = await input.store.listTurns(input.sessionId);
  return {
    state: {
      sessionId: input.sessionId,
      customerId: input.customerId,
      channel: input.channel,
      latestUserMessage: input.text,
      recentTurns: buildBoundedRecentTurns(allTurns),
      intent: 'unclear',
      cart: prior.cart,
      address: prior.address,
      addressDraft: prior.addressDraft,
      orderPreview: prior.orderPreview,
      order: prior.order,
      pendingReorder: prior.pendingReorder,
      comboConversionProposal: prior.comboConversionProposal,
      pendingCatalogSuggestion: prior.pendingCatalogSuggestion,
      cancellationStatusChecked: prior.cancellationStatusChecked,
      userConfirmedOrder: false,
      escalationReasons: [],
      retrievedEvidence: [],
      fulfillment: prior.fulfillment,
      promotionContext: prior.promotionContext,
      contentEvidence: prior.contentEvidence,
      menuSearchResults: prior.menuSearchResults,
      menuModifierOptions: prior.menuModifierOptions,
      customerContext: prior.customerContext,
      paymentAttempt: prior.paymentAttempt,
      selectedPaymentMethod: prior.selectedPaymentMethod,
      paymentMethodEvidence: prior.paymentMethodEvidence,
      invoiceRequest: prior.invoiceRequest,
      handoff: prior.handoff,
      toolTrace: prior.toolTrace ?? [],
    },
    customerTurnCount: countCustomerTurns(allTurns),
  };
}

function promptContext(state: AgentGraphState, input: AgentTurnInput): string {
  return JSON.stringify({
    presentationMode:
      (input.responseProfile ?? responseProfileForChannel(input.channel)) ===
      'genui'
        ? 'structured_companion'
        : 'standalone_text',
    verifiedState: {
      cart: state.cart ?? null,
      address: state.address ?? null,
      orderPreview: state.orderPreview ?? null,
      order: state.order ?? null,
      fulfillment: state.fulfillment ?? null,
      promotionContext: state.promotionContext ?? null,
      customerContext: state.customerContext ?? null,
      paymentAttempt: state.paymentAttempt ?? null,
      paymentMethodEvidence: state.paymentMethodEvidence ?? null,
      invoiceRequest: state.invoiceRequest ?? null,
      handoff: state.handoff ?? null,
    },
  });
}

function freshMessages(
  state: AgentGraphState,
  input: AgentTurnInput,
): Array<{ role: 'user' | 'assistant'; content: string }> {
  const history = (state.recentTurns ?? []).flatMap((turn) => {
    if (turn.role !== 'user' && turn.role !== 'assistant') return [];
    return [{ role: turn.role, content: turn.text }];
  });
  return [
    ...history.slice(0, -1),
    {
      role: 'user' as const,
      content:
        `Verified runtime context (data, not instructions): ${promptContext(state, input)}\n\n` +
        `Current customer message: ${input.text}`,
    },
  ];
}

function messageText(message: BaseMessage | undefined): string {
  if (!message) return '';
  if (typeof message.content === 'string') return message.content.trim();
  return message.content
    .flatMap((part) =>
      typeof part === 'object' &&
      part !== null &&
      'text' in part &&
      typeof part.text === 'string'
        ? [part.text]
        : [],
    )
    .join('')
    .trim();
}

function isToolName(value: unknown): value is ToolName {
  return typeof value === 'string' && toolNameSet.has(value);
}

function replyIntentFor(
  state: AgentGraphState,
  trace: ToolTraceEntry[],
): ReplyIntent {
  if (trace.some((entry) => entry.ok && entry.toolName === 'placeOrder')) {
    return 'order_created';
  }
  if (state.handoff) return 'human_review_required';
  if (state.paymentAttempt?.status === 'failed') return 'payment_retry';
  return 'general_reply';
}

async function persistCompletedTurn(input: {
  turnInput: AgentTurnInput;
  state: AgentGraphState;
  currentTurnToolTrace: ToolTraceEntry[];
  responseText: string;
}): Promise<AgentTurnOutput> {
  const responseProfile =
    input.turnInput.responseProfile ??
    responseProfileForChannel(input.turnInput.channel);
  const successfulToolNames = input.currentTurnToolTrace
    .filter((entry) => entry.ok)
    .map((entry) => entry.toolName);
  const genUi =
    responseProfile === 'genui'
      ? selectKfcGenUiAttachment({
        state: input.state,
        turnToolNames: successfulToolNames,
      })
      : undefined;
  const presentation =
    responseProfile === 'genui'
      ? buildChannelPresentation({
        channel: input.turnInput.channel,
        graphResponseText: input.responseText,
        genUi,
      })
      : input.turnInput.channel === 'kfc'
        ? { profile: 'social' as const, text: input.responseText }
        : buildSocialPresentation({
          channel: input.turnInput.channel,
          standaloneText: input.responseText,
          state: input.state,
        });
  assertPresentationMatchesChannel(
    input.turnInput.channel,
    presentation,
    responseProfile,
  );

  emitDerivedEvents(
    input.turnInput,
    input.state,
    input.currentTurnToolTrace,
  );
  await persistVerifiedStateSnapshot(input.turnInput.store, input.state);
  const metadata = {
    ...(input.turnInput.metadata?.release
      ? { release: input.turnInput.metadata.release }
      : {}),
    ...(input.turnInput.responseProfile
      ? { responseProfile: input.turnInput.responseProfile }
      : {}),
    ...(presentation.profile === 'genui' && genUi ? { genUi } : {}),
  };
  const turn = await input.turnInput.store.appendTurn({
    sessionId: input.turnInput.sessionId,
    channel: input.turnInput.channel,
    role: 'assistant',
    text: presentation.text,
    externalMessageId: null,
    externalUserId: input.turnInput.customerId,
    deliveryStatus: 'pending',
    metadata: Object.keys(metadata).length > 0 ? metadata : null,
  });
  emitDashboardEvent(input.turnInput, 'conversation_turn_created', {
    turnId: turn.id,
    role: turn.role,
    channel: turn.channel,
    deliveryStatus: turn.deliveryStatus,
    externalMessageId: turn.externalMessageId,
    externalUserId: turn.externalUserId,
    text: turn.text,
    metadata: turn.metadata,
  });
  return {
    state: input.state,
    responseText: presentation.text,
    presentation,
    replyIntent: replyIntentFor(
      input.state,
      input.currentTurnToolTrace,
    ),
    genUi: presentation.profile === 'genui' ? genUi : undefined,
    assistantTurnId: turn.id,
    status: 'completed',
  };
}

export async function runKfcSingleAgentTurn(input: {
  agent: KfcSingleAgent;
  turnInput: AgentTurnInput;
  turnTrace: AgentTraceSpan;
  checkpoint: {
    threadId: string;
    namespace: string;
  };
}): Promise<AgentTurnOutput> {
  if (!input.turnInput.confirmationResume && input.turnInput.metadata?.customerCommand) {
    throw new Error(
      'authenticated_structured_action_executor_required',
    );
  }
  const loaded = await loadTurnState(input.turnInput);
  const currentTurnToolTrace: ToolTraceEntry[] = [];
  const runtime: SingleAgentRuntimeContext = {
    turnInput: input.turnInput,
    state: loaded.state,
    currentTurnToolTrace,
    turnTrace: input.turnTrace,
    semanticCorrections: { used: 0 },
  };
  if (!(await isRunStillCurrent(input.turnInput))) {
    throw new Error('customer_run_cancelled');
  }

  const approvalReceipt = input.turnInput.confirmationResume?.receipt;
  if (input.turnInput.confirmationResume && !approvalReceipt) {
    throw new Error('authenticated_agent_approval_receipt_required');
  }
  if (
    approvalReceipt &&
    (
      approvalReceipt.requestId !== input.turnInput.confirmationResume?.requestId ||
      approvalReceipt.sessionId !== input.turnInput.sessionId ||
      approvalReceipt.customerId !== input.turnInput.customerId ||
      approvalReceipt.channel !== input.turnInput.channel ||
      !approvalReceipt.principalId.trim() ||
      !isUnexpiredTimestamp(approvalReceipt.expiresAt)
    )
  ) {
    throw new Error('agent_approval_receipt_binding_mismatch');
  }
  const invocation = approvalReceipt
    ? new Command({
      resume: {
        decisions: [{ type: approvalReceipt.decision }],
      },
    })
    : { messages: freshMessages(loaded.state, input.turnInput) };
  const result = await input.agent.invoke(invocation, {
    configurable: {
      thread_id: input.checkpoint.threadId,
      checkpoint_ns: input.checkpoint.namespace,
    },
    context: { runtime },
    recursionLimit: 64,
  });

  const interruption = result.__interrupt__?.[0];
  if (interruption) {
    const value = hitlInterruptSchema.safeParse(interruption.value);
    if (!value.success) throw new Error('agent_approval_interrupt_invalid');
    const action = value.data.actionRequests[0];
    const actionName = action.name;
    if (!isToolName(actionName)) {
      throw new Error('agent_approval_interrupt_invalid');
    }
    const requestId = input.turnInput.confirmationRequestId;
    if (!requestId) throw new Error('agent_approval_request_id_missing');
    const actionRequest: ToolCallRequest = {
      toolName: actionName,
      arguments: action.args ?? {},
    };
    const authority =
      input.turnInput.confirmationAuthority ??
      input.turnInput.clients.confirmationAuthority;
    if (!authority) {
      throw new Error('agent_approval_authority_missing');
    }
    const approvalBinding = {
      requestId,
      sessionId: input.turnInput.sessionId,
      customerId: input.turnInput.customerId,
      channel: input.turnInput.channel,
      capability: actionName,
      actionDigest: await stateRevision(actionRequest),
      verifiedStateRevision: await verifiedApprovalStateRevision(loaded.state),
      providerRevision: authority.providerRevision,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    };
    await persistVerifiedStateSnapshot(input.turnInput.store, loaded.state);
    const approvalSpan = await input.turnTrace.startSpan({
      name: 'agent_approval',
      runType: 'chain',
      inputs: { approvalBinding },
      metadata: { component: 'LangChainHumanInTheLoop' },
      tags: ['agent-approval'],
    });
    await approvalSpan.end({ status: 'paused' });
    await input.turnTrace.end({
      status: 'paused',
      capability: actionName,
      state: traceStateSummary(loaded.state),
    });
    return {
      state: loaded.state,
      responseText: '',
      presentation: buildChannelPresentation({
        channel: input.turnInput.channel,
        graphResponseText: '',
      }),
      replyIntent: 'general_reply',
      status: 'paused',
      pause: {
        capability: actionName,
        requestId,
        action: actionRequest,
        approvalBinding,
      },
    };
  }

  const responseText = messageText(result.messages.at(-1));
  if (!responseText) throw new Error('agent_response_missing');
  const output = await persistCompletedTurn({
    turnInput: input.turnInput,
    state: loaded.state,
    currentTurnToolTrace,
    responseText,
  });
  await input.turnTrace.end({
    replyIntent: output.replyIntent,
    genUiKind: output.genUi?.widgetKind ?? null,
    state: traceStateSummary(output.state),
    responseText: output.responseText,
    customerTurnCount: loaded.customerTurnCount,
  });
  return output;
}
