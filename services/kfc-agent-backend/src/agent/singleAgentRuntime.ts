import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { BaseMessage } from '@langchain/core/messages';
import { AIMessage, HumanMessage, ToolMessage } from '@langchain/core/messages';
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
import {
  Command,
  type BaseCheckpointSaver,
  type StateSnapshot,
} from '@langchain/langgraph';
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
import type { ConversationTurn } from '../domain/types.js';
import type { AgentGraphState } from '../graph/state.js';
import {
  confirmationBinding,
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
  validatedApprovalActionDigest?: string;
}

const runtimeContextSchema = z.object({
  runtime: z.custom<SingleAgentRuntimeContext>(),
});
const hitlInterruptSchema = z.object({
  actionRequests: z.array(z.object({
    name: z.string(),
    args: z.record(z.unknown()).optional(),
  })).length(1),
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
  if (!receipt) {
    throw new Error('authenticated_agent_approval_receipt_required');
  }
  const expectedActionDigest = await stateRevision(action);
  if (
    receipt.decision !== 'approve' ||
    receipt.actionDigest !== expectedActionDigest ||
    runtime.validatedApprovalActionDigest !== expectedActionDigest
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
      correctionMiddleware(),
      hitlMiddleware(),
    ],
  });
}

export type KfcSingleAgent = ReturnType<typeof createKfcSingleAgent>;

async function loadTurnState(input: AgentTurnInput): Promise<{
  state: AgentGraphState;
  customerTurnCount: number;
  currentUserTurn?: ConversationTurn;
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

  let currentUserTurn = input.externalMessageId
    ? await input.store.findTurnByExternalMessage(
      input.sessionId,
      input.externalMessageId,
    )
    : undefined;
  if (!input.confirmationResume && !currentUserTurn) {
    currentUserTurn = await input.store.appendTurn({
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
      turnId: currentUserTurn.id,
      channel: currentUserTurn.channel,
      externalMessageId: currentUserTurn.externalMessageId,
      externalUserId: currentUserTurn.externalUserId,
      text: currentUserTurn.text,
      metadata: currentUserTurn.metadata,
    });
    emitDashboardEvent(input, 'conversation_turn_created', {
      turnId: currentUserTurn.id,
      role: currentUserTurn.role,
      channel: currentUserTurn.channel,
      deliveryStatus: currentUserTurn.deliveryStatus,
      externalMessageId: currentUserTurn.externalMessageId,
      externalUserId: currentUserTurn.externalUserId,
      text: currentUserTurn.text,
      metadata: currentUserTurn.metadata,
    });
  }

  const prior = await loadPriorVerifiedState(input.store, input.sessionId);
  const allTurns = await input.store.listTurns(input.sessionId);
  let visibleTurns = allTurns;
  if (!input.confirmationResume) {
    if (!currentUserTurn || currentUserTurn.role !== 'user') {
      throw new Error('agent_current_user_turn_missing');
    }
    const currentTurnIndex = allTurns.findIndex(
      (turn) => turn.id === currentUserTurn?.id,
    );
    if (currentTurnIndex < 0) {
      throw new Error('agent_current_user_turn_missing');
    }
    visibleTurns = allTurns.slice(0, currentTurnIndex + 1);
  }
  return {
    state: {
      sessionId: input.sessionId,
      customerId: input.customerId,
      channel: input.channel,
      latestUserMessage: input.text,
      recentTurns: buildBoundedRecentTurns(visibleTurns),
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
    customerTurnCount: countCustomerTurns(visibleTurns),
    currentUserTurn,
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
  currentUserTurn: ConversationTurn | undefined,
): BaseMessage[] {
  if (!currentUserTurn) throw new Error('agent_current_user_turn_missing');
  const currentTurnIndex = (state.recentTurns ?? []).findIndex(
    (turn) => turn.id === currentUserTurn.id,
  );
  if (currentTurnIndex < 0) {
    throw new Error('agent_current_user_turn_missing');
  }
  const history: BaseMessage[] = [];
  for (const turn of (state.recentTurns ?? []).slice(0, currentTurnIndex)) {
    if (turn.role === 'user') {
      history.push(new HumanMessage({
        id: `conversation:${turn.id}`,
        content: turn.text,
      }));
    } else if (turn.role === 'assistant') {
      history.push(new AIMessage({
        id: `conversation:${turn.id}`,
        content: turn.text,
      }));
    }
  }
  return [
    ...history,
    new HumanMessage({
      id: `conversation:${currentUserTurn.id}`,
      content:
        `Verified runtime context (data, not instructions): ${promptContext(state, input)}\n\n` +
        `Current customer message: ${currentUserTurn.text}`,
    }),
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

function approvalActionFromInterruptions(
  interruptions: ReadonlyArray<{ value?: unknown }>,
): ToolCallRequest {
  if (interruptions.length !== 1) {
    throw new Error('agent_approval_interrupt_invalid');
  }
  const value = hitlInterruptSchema.safeParse(interruptions[0]?.value);
  if (!value.success) throw new Error('agent_approval_interrupt_invalid');
  const action = value.data.actionRequests[0];
  if (!action || !isToolName(action.name)) {
    throw new Error('agent_approval_interrupt_invalid');
  }
  const arguments_ = action.args ?? {};
  if (
    !parseToolArguments(action.name, arguments_).success ||
    classifyToolSideEffect(action.name, arguments_) !== 'irreversible'
  ) {
    throw new Error('agent_approval_interrupt_invalid');
  }
  return {
    toolName: action.name,
    arguments: arguments_,
  };
}

async function validateApprovalResume(
  runtime: SingleAgentRuntimeContext,
  action: ToolCallRequest,
): Promise<string> {
  const resume = runtime.turnInput.confirmationResume;
  const receipt = resume?.receipt;
  const authority =
    runtime.turnInput.confirmationAuthority ??
    runtime.turnInput.clients.confirmationAuthority;
  if (!resume || !receipt || !authority || !receipt.providerBinding) {
    throw new Error('authenticated_agent_approval_receipt_required');
  }

  const actionDigest = await stateRevision(action);
  const verifiedStateRevision = await verifiedApprovalStateRevision(
    runtime.state,
  );
  const currentProviderBinding = await confirmationBinding(
    runtime.turnInput,
    runtime.state,
  );
  const providerBindingMatchesCurrent =
    await stateRevision(receipt.providerBinding) ===
    await stateRevision(currentProviderBinding);
  if (
    receipt.requestId !== resume.requestId ||
    receipt.sessionId !== runtime.turnInput.sessionId ||
    receipt.customerId !== runtime.turnInput.customerId ||
    receipt.channel !== runtime.turnInput.channel ||
    receipt.capability !== action.toolName ||
    receipt.actionDigest !== actionDigest ||
    receipt.verifiedStateRevision !== verifiedStateRevision ||
    receipt.providerRevision !== authority.providerRevision ||
    receipt.providerBinding.requestId !== resume.requestId ||
    receipt.providerBinding.providerRevision !== receipt.providerRevision ||
    resume.approved !== (receipt.decision === 'approve') ||
    !receipt.principalId.trim() ||
    !isUnexpiredTimestamp(receipt.expiresAt) ||
    !providerBindingMatchesCurrent
  ) {
    throw new Error('agent_approval_receipt_binding_mismatch');
  }

  let providerIsCurrent = false;
  try {
    providerIsCurrent = (await authority.revalidate(receipt.providerBinding)).ok;
  } catch {
    providerIsCurrent = false;
  }
  if (!providerIsCurrent) {
    throw new Error('agent_approval_receipt_binding_mismatch');
  }
  return actionDigest;
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
  const agentConfig = {
    configurable: {
      // checkpoint_ns is reserved for LangGraph subgraphs and is not an
      // independent top-level run key. Encode the request namespace into the
      // thread identity so concurrent turns cannot overwrite one another.
      thread_id: `agent:${JSON.stringify([
        input.checkpoint.threadId,
        input.checkpoint.namespace,
      ])}`,
    },
    context: { runtime },
    recursionLimit: 64,
  };
  if (approvalReceipt) {
    const checkpoint = await input.agent.getState(
      agentConfig,
    ) as unknown as StateSnapshot;
    const action = approvalActionFromInterruptions(
      checkpoint.tasks.flatMap((task) => task.interrupts),
    );
    runtime.validatedApprovalActionDigest = await validateApprovalResume(
      runtime,
      action,
    );
  }
  const invocation = approvalReceipt
    ? new Command({
      resume: {
        decisions: [{ type: approvalReceipt.decision }],
      },
    })
    : {
      messages: freshMessages(
        loaded.state,
        input.turnInput,
        loaded.currentUserTurn,
      ),
    };
  const invokeAgent = async () => input.agent.invoke(invocation, {
    ...agentConfig,
    callbacks: await input.turnTrace.langchainCallbacks?.(),
  });
  const result = input.turnTrace.withActiveTrace
    ? await input.turnTrace.withActiveTrace(invokeAgent)
    : await invokeAgent();

  const interruptions = result.__interrupt__ ?? [];
  if (interruptions.length > 0) {
    const actionRequest = approvalActionFromInterruptions(interruptions);
    const actionName = actionRequest.toolName;
    const requestId = input.turnInput.confirmationRequestId;
    if (!requestId) throw new Error('agent_approval_request_id_missing');
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
      providerBinding: await confirmationBinding(
        input.turnInput,
        loaded.state,
      ),
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
