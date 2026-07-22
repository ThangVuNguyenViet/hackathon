import {
  AIMessage,
  SystemMessage,
  type BaseMessage,
} from '@langchain/core/messages';
import {
  createMiddleware,
  humanInTheLoopMiddleware,
  StructuredOutputParsingError,
} from 'langchain';
import { isGraphInterrupt } from '@langchain/langgraph';
import { agentToolCallDisposition } from '../ordering/toolCallDisposition.js';
import {
  agentToolArgumentSchemas,
  toolNames,
} from '../ordering/toolCatalog.js';
import type { ToolName } from '../ordering/types.js';
import { isValidApprovalBatchShape } from './agentApprovalBatchShape.js';
import {
  canonicalToolCallSignature,
  classifyToolCallSignature,
  relevantToolState,
} from './agentToolCallLedger.js';
import type { KfcAcceptedToolCall } from './kfcCreateAgentToolCoordinator.js';
import { prepareModelQuoteFulfillment } from './modelQuoteFulfillmentPreparation.js';
import { parallelReadBatchEligibility } from './parallelReadBatch.js';
import {
  classifyProviderFailure,
  classifyToolExecutionFailure,
  type ClassifiedProviderFailure,
} from './agentBoundaryPolicy.js';
import {
  kfcCreateAgentContextSchema,
  type KfcCreateAgentRuntime,
} from './kfcCreateAgentRuntime.js';
import type { ModelPublicationBundle } from './modelPublicationProjection.js';
import type {
  PendingToolCall,
  SingleAgentRuntimeContext,
} from './singleAgentRuntime.js';
import { buildPrivacySafeLangSmithMetadata } from '../observability/langsmithDiagnosticMetadata.js';

interface AuthoredToolCall {
  id?: string;
  name: string;
  args: Record<string, unknown>;
}

const toolNameSet = new Set<string>(toolNames);

function isToolName(value: string): value is ToolName {
  return toolNameSet.has(value);
}

function hasToolName(value: unknown): value is { name: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'name' in value &&
    typeof value.name === 'string'
  );
}

function errorCause(error: unknown): unknown {
  if (typeof error !== 'object' || error === null || !('cause' in error)) {
    return undefined;
  }
  return error.cause;
}

function causeChain(error: unknown): unknown[] {
  const chain: unknown[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current !== undefined && !seen.has(current)) {
    seen.add(current);
    chain.push(current);
    current = errorCause(current);
  }
  return chain;
}

const preservedBoundaryFailureCodes = new Set([
  'agent_approval_receipt_binding_mismatch',
  'agent_address_authority_mismatch',
  'structured_action_saved_address_ref_unavailable',
  'structured_action_saved_address_payload_invalid',
  'structured_action_verified_state_stale',
  'structured_action_saved_address_conflicts_with_draft',
  'structured_action_cart_required',
  'agent_provider_call_limit_exceeded',
  'agent_turn_deadline_exceeded',
  'customer_run_cancelled',
]);

function preservedBoundaryFailureCode(error: unknown): string | undefined {
  for (const candidate of causeChain(error)) {
    if (
      candidate instanceof Error &&
      preservedBoundaryFailureCodes.has(candidate.message)
    ) {
      return candidate.message;
    }
  }
  return undefined;
}

function classifyNestedProviderFailure(
  error: unknown,
): ClassifiedProviderFailure {
  let fallback: ClassifiedProviderFailure | undefined;
  for (const candidate of causeChain(error)) {
    const classified = classifyProviderFailure(candidate);
    fallback ??= classified;
    if (classified.errorClass !== 'unknown') return classified;
  }
  return fallback ?? classifyProviderFailure(error);
}

function nestedToolExecutionFailure(error: unknown): string {
  for (const candidate of causeChain(error)) {
    const classified = classifyToolExecutionFailure(candidate);
    if (classified !== 'agent_tool_execution_failed') return classified;
  }
  return 'agent_tool_execution_failed';
}

export function hasStructuredOutputParsingCause(error: unknown): boolean {
  return causeChain(error).some(
    (candidate) => candidate instanceof StructuredOutputParsingError,
  );
}

function isTransientProviderFailure(error: unknown): boolean {
  if (hasStructuredOutputParsingCause(error)) return false;
  return causeChain(error).some((candidate) => {
    if (typeof candidate !== 'object' || candidate === null) return false;
    const status = 'status' in candidate ? candidate.status : undefined;
    if (status === 408 || status === 409 || status === 429) return true;
    if (typeof status === 'number' && status >= 500 && status <= 599) {
      return true;
    }
    const code = 'code' in candidate ? candidate.code : undefined;
    return (
      typeof code === 'string' &&
      new Set(['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN']).has(
        code,
      )
    );
  });
}

export function boundedStructuredOutputFeedback(error: unknown): string {
  const parsing = causeChain(error).find(
    (candidate): candidate is StructuredOutputParsingError =>
      candidate instanceof StructuredOutputParsingError,
  );
  const detail = parsing?.errors.join('; ') ?? 'schema validation failed';
  const prefix =
    'Return provider-native structured output matching the required schema. ';
  return `${prefix}${detail}`.slice(0, 512);
}

export function consumeSemanticCorrection(
  runtime: KfcCreateAgentRuntime,
): void {
  if (runtime.semanticCorrections.used >= runtime.semanticCorrections.limit) {
    throw new Error('agent_semantic_correction_limit_exceeded');
  }
  runtime.semanticCorrections.used += 1;
}

function visibleKfcToolNames(
  activeToolNames: readonly string[],
): readonly ToolName[] {
  return activeToolNames.filter(isToolName);
}

export function visibleKfcTools<Tool extends { name: string }>(
  registeredTools: readonly Tool[],
  activeToolNames: readonly ToolName[],
): Tool[] {
  const visible = new Set(visibleKfcToolNames(activeToolNames));
  return registeredTools.filter(
    ({ name }) => isToolName(name) && visible.has(name),
  );
}

function isKfcModelSystemContext(message: BaseMessage): boolean {
  if (
    !SystemMessage.isInstance(message) ||
    typeof message.content !== 'string'
  ) {
    return false;
  }
  try {
    const parsed: unknown = JSON.parse(message.content);
    return (
      typeof parsed === 'object' &&
      parsed !== null &&
      'publication' in parsed &&
      'responseContract' in parsed
    );
  } catch {
    return false;
  }
}

export function replaceKfcModelSystemContext(
  messages: readonly BaseMessage[],
  modelSystemContext: string,
): BaseMessage[] {
  return [
    ...messages.filter((message) => !isKfcModelSystemContext(message)),
    new SystemMessage(modelSystemContext),
  ];
}

function rejectAuthoredBatch(_runtime: KfcCreateAgentRuntime): never {
  throw new Error('agent_authored_tool_batch_invalid');
}

export function validateAuthoredToolBatch<Call extends AuthoredToolCall>(
  calls: readonly Call[],
  advertisedToolNames: readonly ToolName[],
  runtime: KfcCreateAgentRuntime,
): readonly Call[] {
  if (calls.length === 0) return calls;
  const advertised = new Set(advertisedToolNames);
  const dispositions = calls.map((call) => {
    if (!isToolName(call.name) || !advertised.has(call.name)) {
      rejectAuthoredBatch(runtime);
    }
    const disposition = agentToolCallDisposition(call.name, call.args);
    if (!disposition.success) rejectAuthoredBatch(runtime);
    return disposition.data;
  });
  if (!isValidApprovalBatchShape(dispositions)) rejectAuthoredBatch(runtime);
  if (calls.length > 1) {
    const parallel = parallelReadBatchEligibility(
      calls.map((call) => {
        if (!isToolName(call.name)) rejectAuthoredBatch(runtime);
        return {
          id: call.id ?? '',
          toolName: call.name,
          arguments: call.args,
        };
      }),
    );
    if (!parallel.ok) rejectAuthoredBatch(runtime);
  }
  return calls;
}

async function acceptedToolCalls(input: {
  calls: readonly AuthoredToolCall[];
  advertisedToolNames: readonly ToolName[];
  runtime: KfcCreateAgentRuntime;
  state: Parameters<typeof relevantToolState>[1];
  publicationBundle?: ModelPublicationBundle;
  singleRuntime: SingleAgentRuntimeContext;
}): Promise<{
  calls: KfcAcceptedToolCall[];
  state: Parameters<typeof relevantToolState>[1];
}> {
  const seen = new Set<string>();
  let preparedState = input.state;
  const accepted: KfcAcceptedToolCall[] = [];
  for (const call of input.calls) {
    if (!call.id || !isToolName(call.name)) {
      rejectAuthoredBatch(input.runtime);
    }
    const disposition = agentToolCallDisposition(call.name, call.args);
    if (!disposition.success) rejectAuthoredBatch(input.runtime);
    let preparedCall: PendingToolCall = {
      id: call.id,
      toolName: disposition.data.toolName,
      arguments: disposition.data.arguments,
      ...(disposition.data.toolName === 'quoteFulfillment'
        ? { auditArguments: structuredClone(call.args) }
        : {}),
    };
    if (disposition.data.toolName === 'quoteFulfillment') {
      if (!input.publicationBundle) {
        throw new Error('agent_model_publication_authority_invalid');
      }
      const currentUserTurn = preparedState.recentTurns
        ?.filter(({ role }) => role === 'user')
        .at(-1);
      const prepared = await prepareModelQuoteFulfillment({
        call: preparedCall,
        callCount: input.calls.length,
        publicationBundle: input.publicationBundle,
        currentUserTurn,
        runtime: input.singleRuntime,
        state: preparedState,
        useId: `create-agent-tool:${currentUserTurn?.id ?? 'missing'}:${call.id}`,
      });
      if (!prepared.ok) throw new Error(prepared.errorCode);
      preparedCall = prepared.call;
      preparedState = prepared.state;
    }
    const signatureDigest = await canonicalToolCallSignature({
      sessionId: preparedState.sessionId,
      customerId: preparedState.customerId,
      channel: preparedState.channel,
      toolName: preparedCall.toolName,
      arguments: preparedCall.arguments,
      activeToolNames: input.advertisedToolNames,
      relevantState: relevantToolState(preparedCall.toolName, preparedState),
    });
    if (seen.has(signatureDigest)) {
      throw new Error('agent_authored_tool_batch_no_progress');
    }
    seen.add(signatureDigest);
    const handling = classifyToolCallSignature({
      entries: input.runtime.toolCallLedger,
      signatureDigest,
      toolName: preparedCall.toolName,
      effect: disposition.data.effect,
    });
    if (handling.kind === 'no_progress') {
      throw new Error('agent_authored_tool_batch_no_progress');
    }
    accepted.push({
      ...preparedCall,
      signatureDigest,
      effect: disposition.data.effect,
      handling,
    });
  }
  return { calls: accepted, state: preparedState };
}

async function invokePhysicalProviderAttempt<Request>(input: {
  request: Request;
  handler: (request: Request) => Promise<AIMessage> | AIMessage;
  runtime: KfcCreateAgentRuntime;
  purpose?: 'agent_decision' | 'response_composition';
}): Promise<AIMessage> {
  if (
    input.runtime.providerAttempts.used >= input.runtime.providerAttempts.limit
  ) {
    throw new Error('agent_provider_call_limit_exceeded');
  }
  input.runtime.providerAttempts.used += 1;
  const attempt = input.runtime.providerAttempts.used;
  const purpose = input.purpose ?? 'agent_decision';
  let attemptSpan:
    | Awaited<
        ReturnType<
          NonNullable<KfcCreateAgentRuntime['startProviderAttemptSpan']>
        >
      >
    | undefined;
  try {
    attemptSpan = await input.runtime.startProviderAttemptSpan?.({
      attempt,
      purpose,
    });
  } catch {
    attemptSpan = undefined;
  }
  const endAttemptSpan = async (
    provider: Parameters<
      typeof buildPrivacySafeLangSmithMetadata
    >[0]['provider'],
    outputs: Record<string, unknown>,
  ): Promise<void> => {
    try {
      const diagnostics = await buildPrivacySafeLangSmithMetadata({ provider });
      await attemptSpan?.end({ ...outputs, diagnostics });
    } catch {
      // Observability is diagnostic-only and must never change agent behavior.
    }
  };
  input.runtime.trace?.('physical_guard');
  await input.runtime.assertRuntimeActive();
  input.runtime.trace?.('provider');
  try {
    const result = await input.handler(input.request);
    input.runtime.providerAttemptEvidence.push({
      attempt,
      outcome: 'success',
      purpose,
    });
    input.runtime.providerFailure = null;
    input.runtime.providerFailureDiagnostic = null;
    await endAttemptSpan(
      { attempt, outcome: 'success' },
      {
        attempt,
        purpose,
        outcome: 'success',
        toolCallCount: result.tool_calls?.length ?? 0,
      },
    );
    return result;
  } catch (error) {
    const classified = classifyNestedProviderFailure(error);
    input.runtime.providerAttemptEvidence.push({
      attempt,
      outcome: 'error',
      errorClass: classified.errorClass,
      retryable: classified.retryable,
      purpose,
    });
    input.runtime.providerFailure = {
      errorClass: classified.errorClass,
      retryable: classified.retryable,
    };
    input.runtime.providerFailureDiagnostic = classified.diagnostic;
    await endAttemptSpan(
      {
        attempt,
        outcome: 'error',
        httpStatus: classified.diagnostic.httpStatus,
        errorCode: classified.diagnostic.errorType,
        retryable: classified.retryable,
      },
      {
        attempt,
        purpose,
        outcome: 'error',
        errorClass: classified.errorClass,
        retryable: classified.retryable,
        toolCallCount: 0,
      },
    );
    throw error;
  }
}

async function defaultRetryDelay(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 50));
}

function throwTerminalProviderFailure(
  error: unknown,
  runtime: KfcCreateAgentRuntime,
): never {
  if (isGraphInterrupt(error) || hasStructuredOutputParsingCause(error)) {
    throw error;
  }
  const preserved = preservedBoundaryFailureCode(error);
  if (preserved) throw new Error(preserved);
  const classified = classifyNestedProviderFailure(error);
  const failure = runtime.providerFailure ?? {
    errorClass: classified.errorClass,
    retryable: classified.retryable,
  };
  runtime.providerFailure = failure;
  runtime.providerFailureDiagnostic ??= classified.diagnostic;
  throw new Error(`agent_provider_call_failed:${failure.errorClass}`);
}

export async function invokeProviderWithRetry<Request>(input: {
  request: Request;
  handler: (request: Request) => Promise<AIMessage> | AIMessage;
  runtime: KfcCreateAgentRuntime;
  delay?: () => Promise<void>;
}): Promise<AIMessage> {
  input.runtime.trace?.('retry');
  try {
    return await invokePhysicalProviderAttempt(input);
  } catch (error) {
    if (
      !isTransientProviderFailure(error) ||
      input.runtime.providerRetry.used >= input.runtime.providerRetry.limit
    ) {
      throw error;
    }
    input.runtime.providerRetry.used += 1;
    await input.runtime.assertRuntimeActive();
    await (input.delay ?? defaultRetryDelay)();
    await input.runtime.assertRuntimeActive();
    input.runtime.trace?.('retry');
    return invokePhysicalProviderAttempt(input);
  }
}

function kfcContext(value: unknown) {
  const parsed = kfcCreateAgentContextSchema.safeParse(value);
  if (!parsed.success) throw new Error('kfc_create_agent_context_missing');
  return parsed.data;
}

export const KFC_HITL_INTERRUPT_ON = {
  acquireVoucher: { allowedDecisions: ['approve', 'reject'] },
  redeemReward: { allowedDecisions: ['approve', 'reject'] },
  placeOrder: { allowedDecisions: ['approve', 'reject'] },
  createPaymentLink: { allowedDecisions: ['approve', 'reject'] },
  handoff: { allowedDecisions: ['approve', 'reject'] },
  resolveHandoff: { allowedDecisions: ['approve', 'reject'] },
} satisfies Record<string, { allowedDecisions: Array<'approve' | 'reject'> }>;

export function createKfcCreateAgentMiddleware() {
  const dynamicToolPolicy = createMiddleware({
    name: 'KfcDynamicToolPolicy',
    contextSchema: kfcCreateAgentContextSchema,
    wrapModelCall: async (request, handler) => {
      const context = kfcContext(request.runtime.context);
      context.createAgentRuntime.trace?.('dynamic');
      await context.createAgentRuntime.assertRuntimeActive();
      try {
        await context.runtime.turnInput?.observeRun?.({
          kind:
            context.createAgentRuntime.providerAttemptPurpose ===
            'response_composition'
              ? 'response_composition'
              : 'planning',
        });
      } catch {
        throw new Error('agent_run_observer_failed');
      }
      await context.createAgentRuntime.assertRuntimeActive();
      const visibleTools = visibleKfcTools(
        request.tools.filter(hasToolName),
        context.resolveActiveToolNames(),
      );
      context.createAgentRuntime.advertisedToolNames = visibleTools
        .map(({ name }) => name)
        .filter(isToolName);
      const modelSystemContext = await context.resolveModelSystemContext?.();
      return handler({
        ...request,
        tools: visibleTools,
        ...(modelSystemContext
          ? {
              messages: replaceKfcModelSystemContext(
                request.messages,
                modelSystemContext,
              ),
            }
          : {}),
      });
    },
  });
  const retry = createMiddleware({
    name: 'KfcOneTurnProviderRetry',
    contextSchema: kfcCreateAgentContextSchema,
    wrapModelCall: async (request, handler) => {
      const context = kfcContext(request.runtime.context);
      context.createAgentRuntime.trace?.('retry');
      try {
        return await handler(request);
      } catch (error) {
        const ledger = context.createAgentRuntime.providerRetry;
        if (!isTransientProviderFailure(error) || ledger.used >= ledger.limit) {
          throwTerminalProviderFailure(error, context.createAgentRuntime);
        }
        ledger.used += 1;
        await context.createAgentRuntime.assertRuntimeActive();
        await defaultRetryDelay();
        await context.createAgentRuntime.assertRuntimeActive();
        context.createAgentRuntime.trace?.('retry');
        try {
          return await handler(request);
        } catch (retryError) {
          throwTerminalProviderFailure(retryError, context.createAgentRuntime);
        }
      }
    },
  });
  const physicalGuard = createMiddleware({
    name: 'KfcPhysicalProviderAttemptGuard',
    contextSchema: kfcCreateAgentContextSchema,
    wrapModelCall: async (request, handler) => {
      const context = kfcContext(request.runtime.context);
      return invokePhysicalProviderAttempt({
        request,
        handler,
        runtime: context.createAgentRuntime,
        purpose: context.createAgentRuntime.providerAttemptPurpose,
      });
    },
  });
  const hitl = humanInTheLoopMiddleware({
    interruptOn: KFC_HITL_INTERRUPT_ON,
  });
  const wholeBatchValidation = createMiddleware({
    name: 'KfcWholeBatchValidation',
    contextSchema: kfcCreateAgentContextSchema,
    afterModel: async (state, graphRuntime) => {
      const context = kfcContext(graphRuntime.context);
      const last = [...state.messages].reverse().find(AIMessage.isInstance);
      if (!last?.tool_calls?.length) return;
      const advertisedToolNames =
        context.createAgentRuntime.advertisedToolNames;
      const calls = validateAuthoredToolBatch(
        last.tool_calls,
        advertisedToolNames,
        context.createAgentRuntime,
      );
      if (context.toolCoordinator) {
        const snapshot = context.toolCoordinator.snapshot();
        const currentState = snapshot?.state ?? context.state;
        const accepted = await acceptedToolCalls({
          calls,
          advertisedToolNames,
          runtime: context.createAgentRuntime,
          state: currentState,
          publicationBundle: snapshot?.bundle,
          singleRuntime: context.runtime,
        });
        context.toolCoordinator.acceptBatch(
          accepted.calls,
          ...(accepted.state === currentState ? [] : [accepted.state]),
        );
      }
    },
  });
  const failClosedToolExecution = createMiddleware({
    name: 'KfcFailClosedToolExecution',
    contextSchema: kfcCreateAgentContextSchema,
    wrapToolCall: async (request, handler) => {
      try {
        if (request.toolCall.name !== 'quoteFulfillment') {
          return await handler(request);
        }
        const parsed = agentToolArgumentSchemas.quoteFulfillment.safeParse(
          request.toolCall.args,
        );
        if (!parsed.success) {
          throw new Error('invalid_tool_arguments');
        }
        return await handler({
          ...request,
          toolCall: {
            ...request.toolCall,
            args: parsed.data,
          },
        });
      } catch (error) {
        if (isGraphInterrupt(error)) throw error;
        const preserved = preservedBoundaryFailureCode(error);
        const classified = preserved ?? nestedToolExecutionFailure(error);
        throw new Error(classified);
      }
    },
  });
  const lifecycleTracing = createMiddleware({
    name: 'KfcLifecycleTracing',
  });
  return [
    dynamicToolPolicy,
    retry,
    physicalGuard,
    hitl,
    wholeBatchValidation,
    failClosedToolExecution,
    lifecycleTracing,
  ] as const;
}
