import type { PendingCustomerTurn, AgentRun } from '../domain/types.js';
import type {
  ConversationStore,
  RunCommitFence,
} from '../persistence/contracts.js';
import type { MessengerWebhookEventProcessingResult } from './routeHandlerContracts.js';

export function runtimeErrorDetails(
  error: unknown,
  depth = 0,
): Record<string, unknown> {
  if (error instanceof Error) {
    const cause = error.cause;
    return {
      name: error.name,
      message: error.message,
      ...(error.stack === undefined ? {} : { stack: error.stack }),
      ...(cause === undefined
        ? {}
        : {
            cause:
              depth >= 4
                ? String(cause)
                : runtimeErrorDetails(cause, depth + 1),
          }),
    };
  }
  if (typeof error === 'string') return { name: 'Error', message: error };
  try {
    const serialized = JSON.stringify(error);
    return {
      name: typeof error,
      message: serialized === undefined ? String(error) : serialized,
    };
  } catch {
    return { name: typeof error, message: String(error) };
  }
}

export async function recordRetryableMessengerAgentRunError(input: {
  store: ConversationStore;
  run: AgentRun;
  commitFence: Extract<RunCommitFence, { kind: 'agent_run' }>;
  linkedTurns: readonly PendingCustomerTurn[];
  error: unknown;
}): Promise<MessengerWebhookEventProcessingResult> {
  const details = runtimeErrorDetails(input.error);
  const errorCode = 'agent_run_processing_failed';
  const errorMessage = String(details.message);
  try {
    await input.store.appendEventIfRunCurrent({
      sessionId: input.run.sessionId,
      sourceType: 'agent:runtime_error',
      payload: {
        schemaVersion: 'agent-runtime-error-v1',
        runId: input.run.id,
        errorCode,
        error: details,
      },
      fence: input.commitFence,
    });
  } catch (recordingError) {
    console.error('agent_run_error_recording_failed', {
      runId: input.run.id,
      error: details,
      recordingError: runtimeErrorDetails(recordingError),
    });
  }
  const updated = await input.store.updateAgentRunIfExecutionCurrent({
    sessionId: input.run.sessionId,
    fence: input.commitFence,
    patch: {
      status: 'running',
      deliveryStatus: 'pending',
      errorCode,
      errorMessage,
      completedAt: null,
    },
  });
  if (updated.status !== 'committed') {
    return { status: 'skipped', errorCode: 'stale_agent_run' };
  }
  for (const turn of input.linkedTurns) {
    if (
      await input.store.getWebhookDelivery(
        input.run.channel,
        turn.externalMessageId,
      )
    ) {
      await input.store.markWebhookDeliveryFailed(
        input.run.channel,
        turn.externalMessageId,
        errorCode,
      );
    }
  }
  return { status: 'failed', errorCode, errorMessage };
}
