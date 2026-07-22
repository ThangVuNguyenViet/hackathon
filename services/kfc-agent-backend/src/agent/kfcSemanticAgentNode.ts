import type { RunnableConfig } from '@langchain/core/runnables';
import { SystemMessage, type BaseMessage } from '@langchain/core/messages';
import {
  isGraphInterrupt,
  type LangGraphRunnableConfig,
} from '@langchain/langgraph';
import type { z } from 'zod';
import {
  boundedStructuredOutputFeedback,
  consumeSemanticCorrection,
  hasStructuredOutputParsingCause,
} from './kfcCreateAgentMiddleware.js';
import {
  createKfcCreateAgentRuntime,
  type KfcCreateAgentContext,
} from './kfcCreateAgentRuntime.js';
import type {
  KfcAgentStateUpdate,
  KfcAgentStateValue,
} from './agentStateSchema.js';
import {
  boundedGroundedResponseFeedback,
  groundedResponseSchema,
} from './responseGrounding.js';
import type { SingleAgentRuntimeContext } from './singleAgentRuntime.js';
import type { ToolName } from '../ordering/types.js';
import type { PublicationToolBatchResult } from './agentPublicationRuntime.js';
import {
  createKfcCreateAgentToolCoordinator,
  type KfcCreateAgentToolCoordinatorInput,
} from './kfcCreateAgentToolCoordinator.js';
import { privateDisclosureEvidenceIds } from './modelPublicationProjection.js';

type GroundedResponse = z.infer<typeof groundedResponseSchema>;

export type KfcStructuredResponseValidation =
  | { ok: true }
  | {
      ok: false;
      errorCode: string;
      correctable: boolean;
    };

export interface KfcSemanticAgentLike {
  invoke(
    input: { messages: BaseMessage[] } | null,
    config: RunnableConfig & { context: KfcCreateAgentContext },
  ): Promise<{
    messages: BaseMessage[];
    structuredResponse?: GroundedResponse;
  }>;
}

export interface KfcSemanticAgentNodeDependencies {
  agent: KfcSemanticAgentLike;
  runtimeContextForState(
    state: KfcAgentStateValue,
    config: LangGraphRunnableConfig<{
      runtime?: SingleAgentRuntimeContext;
    }>,
  ): SingleAgentRuntimeContext | Promise<SingleAgentRuntimeContext>;
  hydrateState?(
    state: KfcAgentStateValue,
    runtime: SingleAgentRuntimeContext,
  ): Partial<KfcAgentStateValue> | Promise<Partial<KfcAgentStateValue>>;
  resolveActiveToolNames(
    state: KfcAgentStateValue,
    runtime: SingleAgentRuntimeContext,
  ): ToolName[];
  resolveModelSystemContext?(
    state: KfcAgentStateValue,
    runtime: SingleAgentRuntimeContext,
    domainState: KfcCreateAgentContext['state'],
    currentTurnToolTrace: KfcCreateAgentContext['currentTurnToolTrace'],
  ): string | undefined | Promise<string | undefined>;
  validateStructuredResponse?(input: {
    state: KfcAgentStateValue;
    response: GroundedResponse;
    runtime: SingleAgentRuntimeContext;
  }):
    KfcStructuredResponseValidation | Promise<KfcStructuredResponseValidation>;
  assertRuntimeActive(state: KfcAgentStateValue): void | Promise<void>;
  createToolCoordinator?(
    input: KfcCreateAgentToolCoordinatorInput,
  ): ReturnType<typeof createKfcCreateAgentToolCoordinator>;
}

function failureCode(error: unknown): string {
  return error instanceof Error && error.message.length > 0
    ? error.message
    : 'agent_failed_closed';
}

function publicationCorrectionFeedback(state: KfcAgentStateValue): string {
  const bundle = state.modelPublicationBundle;
  const privateEvidenceIds = bundle
    ? privateDisclosureEvidenceIds(bundle)
    : [];
  if (privateEvidenceIds.length === 0) {
    return 'Return only a corrected final structured response. publication.privateEvidenceIds is empty. Set publicationDeclaration.privateDataDisclosure to "none" and publicationDeclaration.disclosureAuthorities to []. Public evidence citations never receive disclosure authorities. Do not call tools.';
  }
  return `Return only a corrected final structured response. publicationDeclaration.disclosureAuthorities may contain publication_evidence entries only for cited IDs in publication.privateEvidenceIds: ${JSON.stringify(privateEvidenceIds)}. Include each cited private ID exactly once, include no public or uncited evidence, and set privateDataDisclosure consistently. Do not call tools.`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasNestedAgentCheckpoint(config: RunnableConfig): boolean {
  const configurable = config.configurable;
  if (!configurable) return false;
  if (
    typeof configurable.checkpoint_id === 'string' &&
    configurable.checkpoint_id.length > 0
  ) {
    return true;
  }
  const namespace = configurable.checkpoint_ns;
  const checkpointMap = configurable.checkpoint_map;
  const scratchpad = configurable.__pregel_scratchpad;
  const activeNodeResume =
    configurable.__pregel_resuming === true &&
    typeof namespace === 'string' &&
    namespace.length > 0 &&
    isRecord(scratchpad) &&
    scratchpad.nullResume !== undefined;
  return (
    activeNodeResume ||
    (typeof namespace === 'string' &&
      isRecord(checkpointMap) &&
      typeof checkpointMap[namespace] === 'string' &&
      checkpointMap[namespace].length > 0)
  );
}

export function createKfcSemanticAgentNode(
  dependencies: KfcSemanticAgentNodeDependencies,
): (
  state: KfcAgentStateValue,
  config: RunnableConfig,
) => Promise<KfcAgentStateUpdate> {
  return async (state, config) => {
    const runtime = await dependencies.runtimeContextForState(state, config);
    const hydratedUpdate = await dependencies.hydrateState?.(state, runtime);
    const activeState = hydratedUpdate
      ? { ...state, ...hydratedUpdate }
      : state;
    const domainState = activeState.domainState ?? runtime.state;
    if (!domainState) {
      return { failure: 'agent_domain_state_missing' };
    }
    const createAgentRuntime = createKfcCreateAgentRuntime({
      assertRuntimeActive: () => dependencies.assertRuntimeActive(state),
      providerAttempts: { used: activeState.providerAttempts, limit: 6 },
      providerAttemptEvidence: [...activeState.providerAttemptEvidence],
      providerFailure: activeState.providerFailure,
      providerFailureDiagnostic: activeState.providerFailureDiagnostic,
      providerRetry: { used: activeState.providerRetries, limit: 1 },
      semanticCorrections: { used: activeState.semanticCorrections, limit: 1 },
      providerAttemptPurpose: activeState.structuredAction
        ? 'response_composition'
        : 'agent_decision',
      advertisedToolNames: [],
      toolCallLedger: [...activeState.toolCallLedger],
      startProviderAttemptSpan: ({ attempt, purpose }) =>
        runtime.turnTrace.startSpan({
          name: 'agent_model_attempt',
          runType: 'llm',
          inputs: { attempt, purpose },
          metadata: {},
          tags: ['agent-model-attempt'],
        }),
    });
    const publicationState = (
      snapshot: PublicationToolBatchResult,
    ): KfcAgentStateValue => ({
      ...activeState,
      domainState: snapshot.state,
      currentTurnToolTrace: snapshot.currentTurnToolTrace,
      modelPublicationBundle: snapshot.bundle,
      graphExecutedToolResults: snapshot.executions,
      currentTurnResponseEvidence: snapshot.evidence,
      toolEvidenceReceipts: snapshot.receipts,
    });
    const toolCoordinator =
      activeState.modelPublicationAuthority &&
      activeState.modelPublicationBundle
        ? (
            dependencies.createToolCoordinator ??
            createKfcCreateAgentToolCoordinator
          )({
            authority: activeState.modelPublicationAuthority,
            runtime,
            createAgentRuntime,
            state: domainState,
            currentTurnToolTrace: activeState.currentTurnToolTrace ?? [],
            executions: activeState.graphExecutedToolResults ?? [],
            evidence: activeState.currentTurnResponseEvidence ?? [],
            receipts: activeState.toolEvidenceReceipts ?? [],
            bundle: activeState.modelPublicationBundle,
            resolveActiveToolNames: (snapshot) =>
              dependencies.resolveActiveToolNames(
                publicationState(snapshot),
                runtime,
              ),
          })
        : undefined;
    const currentPublicationState = (): KfcAgentStateValue => {
      const snapshot = toolCoordinator?.snapshot();
      if (!snapshot) {
        return {
          ...activeState,
          domainState,
          currentTurnToolTrace: activeState.currentTurnToolTrace ?? [],
        };
      }
      return publicationState(snapshot);
    };
    const context: KfcCreateAgentContext = {
      runtime,
      state: domainState,
      currentTurnToolTrace: activeState.currentTurnToolTrace ?? [],
      ...(domainState.order
        ? { currentTurnStatusOrder: domainState.order }
        : {}),
      createAgentRuntime,
      ...(toolCoordinator ? { toolCoordinator } : {}),
      resolveActiveToolNames: () =>
        dependencies.resolveActiveToolNames(currentPublicationState(), runtime),
      ...(dependencies.resolveModelSystemContext
        ? {
            resolveModelSystemContext: () => {
              const current = currentPublicationState();
              return dependencies.resolveModelSystemContext!(
                current,
                runtime,
                current.domainState ?? domainState,
                current.currentTurnToolTrace ?? [],
              );
            },
          }
        : {}),
    };
    const agentConfig: RunnableConfig & { context: KfcCreateAgentContext } = {
      ...config,
      signal: runtime.externalCallContext.signal,
      context,
    };
    const responseOnlyAgentConfig = (): RunnableConfig & {
      context: KfcCreateAgentContext;
    } => {
      const { toolCoordinator: _toolCoordinator, ...responseOnlyContext } =
        context;
      return {
        ...agentConfig,
        context: {
          ...responseOnlyContext,
          resolveActiveToolNames: () => [],
        },
      };
    };
    const agentInput = { messages: activeState.messages ?? [] };
    const resumeFromCheckpoint = hasNestedAgentCheckpoint(config);

    const recordDeadlineObservation = async (error: unknown): Promise<void> => {
      const errorCode = failureCode(error);
      if (
        errorCode !== 'agent_turn_deadline_exceeded' &&
        errorCode !== 'customer_run_cancelled'
      ) {
        return;
      }
      try {
        const span = await runtime.turnTrace.startSpan({
          name: 'agent_deadline_observation',
          runType: 'chain',
          inputs: { stage: 'deadline_observation' },
          metadata: {},
          tags: ['agent-deadline-observation'],
        });
        await span.end({
          stage: 'deadline_observation',
          errorCode,
          remainingMs: Math.max(
            0,
            runtime.externalCallContext.deadlineAt - Date.now(),
          ),
          signalAborted: runtime.externalCallContext.signal.aborted,
        });
      } catch {
        // Diagnostics never reinterpret the established runtime failure.
      }
    };
    const runtimeUpdate = (): KfcAgentStateUpdate => ({
      turnDeadlineAt: runtime.externalCallContext.deadlineAt,
      providerAttempts: createAgentRuntime.providerAttempts.used,
      providerAttemptEvidence: [...createAgentRuntime.providerAttemptEvidence],
      providerFailure: createAgentRuntime.providerFailure,
      providerFailureDiagnostic: createAgentRuntime.providerFailureDiagnostic,
      providerRetries: createAgentRuntime.providerRetry.used,
      semanticCorrections: createAgentRuntime.semanticCorrections.used,
      toolCallLedger: structuredClone(createAgentRuntime.toolCallLedger),
    });
    const publicationUpdate = (): KfcAgentStateUpdate => {
      const current = currentPublicationState();
      return {
        domainState: current.domainState,
        currentUserTurn: current.currentUserTurn,
        currentTurnToolTrace: current.currentTurnToolTrace,
        modelPublicationAuthority: current.modelPublicationAuthority,
        modelPublicationBundle: current.modelPublicationBundle,
        graphExecutedToolResults: current.graphExecutedToolResults,
        currentTurnResponseEvidence: current.currentTurnResponseEvidence,
        toolEvidenceReceipts: current.toolEvidenceReceipts,
      };
    };
    const resultUpdate = (
      result: Awaited<ReturnType<KfcSemanticAgentLike['invoke']>>,
    ): KfcAgentStateUpdate => {
      return {
        ...runtimeUpdate(),
        ...publicationUpdate(),
        messages: result.messages,
        ...(result.structuredResponse
          ? {
              responseText: result.structuredResponse.customerText,
              responseProjectionDigest:
                result.structuredResponse.projectionDigest,
              responseFactualClaims: result.structuredResponse.factualClaims,
              responsePublicationDeclaration:
                result.structuredResponse.publicationDeclaration,
              selectedActionResponseReference:
                result.structuredResponse.selectedActionResponse,
            }
          : {}),
      };
    };
    const failureUpdate = (error: unknown): KfcAgentStateUpdate => ({
      ...runtimeUpdate(),
      ...publicationUpdate(),
      failure: failureCode(error),
    });

    const validateStructuredResult = async (
      result: Awaited<ReturnType<KfcSemanticAgentLike['invoke']>>,
    ): Promise<KfcStructuredResponseValidation> => {
      if (
        !result.structuredResponse ||
        !dependencies.validateStructuredResponse
      ) {
        return { ok: true };
      }
      return dependencies.validateStructuredResponse({
        state: currentPublicationState(),
        response: result.structuredResponse,
        runtime,
      });
    };
    const invokeCorrection = async (
      feedback: string,
    ): Promise<KfcAgentStateUpdate> => {
      try {
        consumeSemanticCorrection(createAgentRuntime);
      } catch {
        return failureUpdate(
          new Error('agent_semantic_correction_limit_exceeded'),
        );
      }
      await dependencies.assertRuntimeActive(state);

      try {
        const correctedResult = await dependencies.agent.invoke(
          {
            messages: [...agentInput.messages, new SystemMessage(feedback)],
          },
          responseOnlyAgentConfig(),
        );
        const correctedValidation =
          await validateStructuredResult(correctedResult);
        if (!correctedValidation.ok) {
          return failureUpdate(
            new Error(
              correctedValidation.correctable
                ? 'agent_semantic_correction_limit_exceeded'
                : correctedValidation.errorCode,
            ),
          );
        }
        return resultUpdate(correctedResult);
      } catch (correctedError) {
        if (isGraphInterrupt(correctedError)) throw correctedError;
        await recordDeadlineObservation(correctedError);
        return failureUpdate(
          hasStructuredOutputParsingCause(correctedError)
            ? new Error('agent_semantic_correction_limit_exceeded')
            : correctedError,
        );
      }
    };

    try {
      const result = await dependencies.agent.invoke(
        resumeFromCheckpoint ? null : agentInput,
        agentConfig,
      );
      const validation = await validateStructuredResult(result);
      if (validation.ok) return resultUpdate(result);
      if (!validation.correctable) {
        return failureUpdate(new Error(validation.errorCode));
      }
      return invokeCorrection(
        validation.errorCode === 'agent_response_publication_rejected'
          ? publicationCorrectionFeedback(currentPublicationState())
          : boundedGroundedResponseFeedback(validation.errorCode),
      );
    } catch (error) {
      if (isGraphInterrupt(error)) {
        runtime.disposeExternalCalls();
        throw error;
      }
      if (!hasStructuredOutputParsingCause(error)) {
        await recordDeadlineObservation(error);
        return failureUpdate(error);
      }
      return invokeCorrection(boundedStructuredOutputFeedback(error));
    }
  };
}
