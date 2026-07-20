import type {
  LiveQualityExperimentOutput,
  LiveQualityMode,
  LiveQualityObservation,
} from './liveQualityContracts.js';
import type {
  ScenarioRunResult,
  ScenarioTurnEvidence,
} from '../scenarios/runner.js';
import type { ToolTraceEntry } from '../ordering/types.js';

function paymentStatusObservations(
  turn: ScenarioTurnEvidence,
  entries: ToolTraceEntry[],
): LiveQualityObservation[] {
  return entries.flatMap((entry) => {
    const orderId = entry.arguments.orderId;
    const status =
      entry.toolName === 'checkPaymentStatus' &&
        entry.resultSummary === 'payment_failed'
        ? 'failed'
        : turn.stateAfter.paymentAttempt?.status;
    return entry.toolName === 'checkPaymentStatus' &&
      typeof orderId === 'string' &&
      orderId.trim() &&
      status
      ? [{
          kind: 'payment_status_refreshed' as const,
          toolName: 'checkPaymentStatus' as const,
          orderId,
          status,
        }]
      : [];
  });
}

export function projectStateGraphScenarioRun(
  result: Pick<ScenarioRunResult, 'turnEvidence' | 'toolTraceByTurn'>,
  mode: LiveQualityMode,
): LiveQualityExperimentOutput[] {
  const traceByTurn = new Map(
    result.toolTraceByTurn.map(({ turnIndex, entries }) => [
      turnIndex,
      entries,
    ]),
  );
  return result.turnEvidence.map((turn) => {
    const executedTools = traceByTurn.get(turn.turnIndex) ?? [];
    return {
      responseText: turn.assistantText,
      executedTools,
      observations: paymentStatusObservations(turn, executedTools),
      stateBefore: { ...turn.stateBefore },
      stateAfter: { ...turn.stateAfter },
      ...(mode === 'genui' && turn.genUi ? { genUi: turn.genUi } : {}),
      durationMs: turn.durationMs,
      persistence: {
        transcriptRevisionBefore: turn.transcriptRevisionBefore,
        transcriptRevisionAfter: turn.transcriptRevisionAfter,
        eventRevisionBefore: turn.eventRevisionBefore,
        eventRevisionAfter: turn.eventRevisionAfter,
        eventIdsBefore: turn.eventIdsBefore,
        eventIds: turn.eventIds,
        eventIdsAfter: turn.eventIdsAfter,
        ...(turn.checkpointId
          ? { checkpointId: turn.checkpointId }
          : {}),
        ...(turn.checkpointNamespace !== null
          ? { checkpointNamespace: turn.checkpointNamespace }
          : {}),
        ...(turn.checkpointThreadId
          ? { checkpointThreadId: turn.checkpointThreadId }
          : {}),
        checkpointVerified: turn.checkpointVerified,
      },
    };
  });
}
