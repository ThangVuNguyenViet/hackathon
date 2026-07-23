import type {
  LiveQualityExperimentOutput,
  LiveQualityMode,
  LiveQualityObservation,
} from './liveQualityContracts.js';
import type {
  ScenarioRunResult,
  ScenarioTurnEvidence,
} from '../scenarios/runner.js';
import {
  verifiedStateToolTraceForPersistence,
} from '../graph/verifiedState.js';
import type { ToolTraceEntry } from '../ordering/types.js';

function paymentStatusObservations(
  turn: ScenarioTurnEvidence,
  entries: ToolTraceEntry[],
): LiveQualityObservation[] {
  return entries.flatMap((entry) => {
    const privateArgumentsDigest =
      entry.arguments.privateArgumentsDigest;
    const status =
      entry.toolName === 'checkPaymentStatus' &&
        entry.resultSummary === 'payment_failed'
        ? 'failed'
        : turn.stateAfter.paymentAttempt?.status;
    return entry.toolName === 'checkPaymentStatus' &&
      typeof privateArgumentsDigest === 'string' &&
      /^[0-9a-f]{64}$/u.test(privateArgumentsDigest) &&
      status
      ? [{
          kind: 'payment_status_refreshed' as const,
          toolName: 'checkPaymentStatus' as const,
          privateArgumentsDigest,
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
    const rawExecutedTools = traceByTurn.get(turn.turnIndex) ?? [];
    const executedTools = rawExecutedTools.map((entry) =>
      verifiedStateToolTraceForPersistence(entry));
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
