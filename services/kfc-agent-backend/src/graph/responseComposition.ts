import { selectKfcGenUiAttachment } from '../genui/kfcGenUiSelector.js';
import {
  validateGenUiCompanionResponse,
  validateStandaloneSocialResponse,
} from '../llm/responseComposer.js';
import type { AgentTraceSpan } from '../observability/agentTracing.js';
import type { ToolTraceEntry } from '../ordering/types.js';
import {
  assertPresentationMatchesChannel,
  buildChannelPresentation,
  buildSocialPresentation,
} from '../presentation/channelPresentation.js';
import { responseProfileForChannel } from '../presentation/responseProfile.js';
import type { AgentTurnInput, AgentTurnOutput, ReplyIntent } from './agentTurnState.js';
import {
  shouldPreserveCurrentCartOrderPaymentContext,
  shouldPreserveCurrentHandoff,
  shouldPreserveCurrentMenuSearchResults,
  shouldPreserveCurrentPaymentContext,
} from './commerceLifecycle.js';
import {
  buildContextPolicyState,
  contextPolicyFromMetadata,
  contextPolicyIsActive,
  type ContextPolicyDirective,
} from './contextPolicy.js';
import type { AgentGraphState } from './state.js';
import {
  hasPlannerBooleanEntity,
  isRunStillCurrent,
  traceStateSummary,
} from './turnSupport.js';

export async function composeAssistantResponse(input: {
  turnInput: AgentTurnInput;
  state: AgentGraphState;
  fallbackText: string;
  replyIntent: ReplyIntent;
  currentTurnToolTrace: ToolTraceEntry[];
  contextPolicy?: ContextPolicyDirective;
  turnTrace?: AgentTraceSpan;
  suppressGenUi?: boolean;
}): Promise<AgentTurnOutput> {
  const responseProfile = input.turnInput.responseProfile ?? responseProfileForChannel(input.turnInput.channel);
  const contextPolicy = input.contextPolicy ?? contextPolicyFromMetadata(input.turnInput.metadata);
  const preserveCurrentMenuResults =
    shouldPreserveCurrentMenuSearchResults(input.currentTurnToolTrace) ||
    hasPlannerBooleanEntity(input.state, 'keepMenuSurface');
  const preserveHandoffContext =
    shouldPreserveCurrentHandoff(input.currentTurnToolTrace) ||
    Boolean(input.state.handoff);

  const genUi = input.suppressGenUi || responseProfile !== 'genui'
    ? undefined
    : selectKfcGenUiAttachment({
      state: buildContextPolicyState(input.state, {
        metadata: input.turnInput.metadata,
        policy: contextPolicy,
        preserveCartOrderPaymentContext: shouldPreserveCurrentCartOrderPaymentContext(input.currentTurnToolTrace),
        preserveMenuSearchResults: preserveCurrentMenuResults,
        preservePaymentContext: shouldPreserveCurrentPaymentContext(input.currentTurnToolTrace),
        preserveHandoff: preserveHandoffContext,
      }),
      turnToolNames: input.currentTurnToolTrace.filter((entry) => entry.ok).map((entry) => entry.toolName),
      reuseVerifiedMenuResults: contextPolicyIsActive(contextPolicy, 'menuSearchResults'),
    });

  const composerInput = {
    channel: input.turnInput.channel,
    presentationMode: responseProfile === 'genui' ? 'structured_companion' as const : 'standalone_text' as const,
    state: buildContextPolicyState(
      { ...input.state, toolTrace: input.currentTurnToolTrace },
      {
        metadata: input.turnInput.metadata,
        policy: contextPolicy,
        preserveCartOrderPaymentContext: shouldPreserveCurrentCartOrderPaymentContext(input.currentTurnToolTrace),
        preserveMenuSearchResults: preserveCurrentMenuResults,
        preservePaymentContext: shouldPreserveCurrentPaymentContext(input.currentTurnToolTrace),
        preserveHandoff: preserveHandoffContext,
        preserveRecentTurns: true,
        preserveToolTrace: true,
        compactMenuSearchResults: true,
      },
    ),
    replyIntent: input.replyIntent,
    fallbackText: input.fallbackText.trim(),
  };
  const contentLookupFailed =
    input.currentTurnToolTrace.some((entry) =>
      entry.toolName === 'searchContentPolicy' || entry.toolName === 'answerAllergenQuestion',
    ) && !(composerInput.state.contentEvidence?.length);

  if (!(await isRunStillCurrent(input.turnInput))) throw new Error('customer_run_cancelled');
  await input.turnInput.observeRun?.({ kind: 'response_composition' });

  const responseSpan = input.turnTrace && input.turnInput.responseComposer
    ? await input.turnTrace.startSpan({
      name: 'response_compose',
      runType: 'llm',
      inputs: { composerInput },
      metadata: {
        component: responseProfile === 'genui' ? 'GenUiCompanionComposer' : 'StandaloneSocialComposer',
        responseProfile,
      },
      tags: ['agent-response', `profile:${responseProfile}`],
    })
    : undefined;

  let responseText = contentLookupFailed
    ? 'Mình chưa thể xác minh thông tin này từ nguồn chính thức của KFC. Mình có thể chuyển bạn sang nhân viên hỗ trợ.'
    : composerInput.fallbackText;
  if (input.turnInput.responseComposer && !contentLookupFailed) {
    try {
      const specializedInput = {
        state: composerInput.state,
        replyIntent: composerInput.replyIntent,
        fallbackText: composerInput.fallbackText,
      };
      responseText = responseProfile === 'genui'
        ? input.turnInput.responseComposer.composeGenUiCompanion
          ? await input.turnInput.responseComposer.composeGenUiCompanion(specializedInput)
          : await input.turnInput.responseComposer.composeResponse(composerInput)
        : input.turnInput.responseComposer.composeStandaloneSocial
          ? await input.turnInput.responseComposer.composeStandaloneSocial(specializedInput)
          : await input.turnInput.responseComposer.composeResponse(composerInput);
    } catch (error) {
      await input.turnInput.store.appendEvent(input.turnInput.sessionId, 'llm:response_composer_failed', {
        message: error instanceof Error ? error.message : 'Unknown response composer failure',
        replyIntent: input.replyIntent,
      });
      if (!responseText) throw new Error('response_composition_failed');
    }
  }

  const valid = responseProfile === 'genui'
    ? validateGenUiCompanionResponse(responseText, composerInput.state)
    : validateStandaloneSocialResponse(responseText, composerInput.state);
  if (!valid) throw new Error(`invalid_${responseProfile}_response`);

  const presentation = responseProfile === 'genui'
    ? buildChannelPresentation({
      channel: input.turnInput.channel,
      graphResponseText: responseText,
      genUi,
    })
    : input.turnInput.channel === 'kfc'
      ? { profile: 'social' as const, text: responseText }
      : buildSocialPresentation({
        channel: input.turnInput.channel,
        standaloneText: responseText,
        state: composerInput.state,
      });
  assertPresentationMatchesChannel(input.turnInput.channel, presentation, responseProfile);

  const output: AgentTurnOutput = {
    state: input.state,
    responseText: presentation.text,
    presentation,
    replyIntent: input.replyIntent,
    genUi: presentation.profile === 'genui' ? genUi : undefined,
  };
  await responseSpan?.end({
    replyIntent: input.replyIntent,
    genUiKind: genUi?.widgetKind ?? null,
    state: traceStateSummary(input.state),
    responseText: output.responseText,
  });
  return output;
}
