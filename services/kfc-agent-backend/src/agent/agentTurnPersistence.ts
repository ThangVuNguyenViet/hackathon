import type {
  AgentTurnInput,
  AgentTurnOutput,
  ReplyIntent,
} from './agentTurn.js';
import type { AgentState } from './agentState.js';
import {
  emitDashboardEvent,
  verifiedStateSnapshotSourceType,
} from './turnSupport.js';
import { buildVerifiedStateSnapshot } from './verifiedState.js';
import { kfcGenUiAttachmentForPersistence } from '../genui/kfcGenUi.js';
import { selectKfcGenUiAttachment } from '../genui/kfcGenUiSelector.js';
import type { AgentTraceSpan } from '../observability/agentTracing.js';
import type { ToolTraceEntry } from '../ordering/types.js';
import {
  buildChannelPresentation,
  buildSocialPresentation,
} from '../presentation/channelPresentation.js';
import { resolveResponseProfile } from '../presentation/responseProfile.js';
import {
  createPackStateEnvelope,
  type PackRef,
} from '../runtime/businessPack.js';

function replyIntentFor(
  state: AgentState,
  trace: ToolTraceEntry[],
): ReplyIntent {
  if (trace.some((entry) => entry.ok && entry.toolName === 'placeOrder')) {
    return 'order_created';
  }
  if (state.handoff) return 'human_review_required';
  if (state.paymentAttempt?.status === 'failed') return 'payment_retry';
  return 'general_reply';
}
export async function persistCompletedTurn(input: {
  turnInput: AgentTurnInput;
  turnTrace: AgentTraceSpan;
  state: AgentState;
  currentTurnToolTrace: ToolTraceEntry[];
  responseText: string;
  packRef: PackRef;
  packStateSchemaVersion: string;
}): Promise<AgentTurnOutput> {
  const responseProfile = resolveResponseProfile(input.turnInput);
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
          responseProfile,
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
  const metadata = {
    ...(input.turnInput.metadata?.release
      ? { release: input.turnInput.metadata.release }
      : {}),
    ...(input.turnInput.responseProfile
      ? { responseProfile: input.turnInput.responseProfile }
      : {}),
    ...(genUi ? { genUi: kfcGenUiAttachmentForPersistence(genUi) } : {}),
  };
  const assistantTurn = {
    sessionId: input.turnInput.sessionId,
    channel: input.turnInput.channel,
    role: 'assistant',
    text: presentation.text,
    externalMessageId: null,
    externalUserId: input.turnInput.customerId,
    deliveryStatus: 'pending',
    metadata: Object.keys(metadata).length > 0 ? metadata : null,
  } as const;
  const fence = input.turnInput.runGuard?.commitFence;
  const verifiedState = buildVerifiedStateSnapshot(input.state);
  const packStateEnvelope = await createPackStateEnvelope({
    packRef: input.packRef,
    schemaVersion: input.packStateSchemaVersion,
    state: verifiedState,
  });
  const turn = fence
    ? await input.turnInput.store
        .commitAssistantTurnIfRunCurrent({
          fence,
          stateEvent: {
            sessionId: input.turnInput.sessionId,
            sourceType: verifiedStateSnapshotSourceType,
            payload: { verifiedState },
          },
          packState: {
            sessionId: input.turnInput.sessionId,
            envelope: packStateEnvelope,
          },
          assistantTurn,
        })
        .then((result) => {
          if (result.status === 'stale')
            throw new Error('customer_run_cancelled');
          return result.turn;
        })
    : await input.turnInput.store
        .commitAssistantTurn({
          stateEvent: {
            sessionId: input.turnInput.sessionId,
            sourceType: verifiedStateSnapshotSourceType,
            payload: { verifiedState },
          },
          packState: {
            sessionId: input.turnInput.sessionId,
            envelope: packStateEnvelope,
          },
          assistantTurn,
        })
        .then((result) => result.turn);

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
    replyIntent: replyIntentFor(input.state, input.currentTurnToolTrace),
    ...(genUi ? { genUi } : {}),
    assistantTurnId: turn.id,
    status: 'completed',
  };
}
