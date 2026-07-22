import type { OutcomeEvidenceBundle } from '../../src/evaluation/outcomeJudge.js';
import type { LiveScenarioAdvisoryMetadata } from '../../src/evaluation/liveQualityContracts.js';
import type { ScenarioRunResult } from '../../src/scenarios/runner.js';
import type { ScenarioScript } from '../../src/scenarios/scenarioScript.js';

const sensitiveKeyPattern =
  /(?:^id$|authorization|api[ _-]?key|access[ _-]?token|refresh[ _-]?token|token|secret|password|(?:customer|user|order|session|conversation|message|external|item)[ _-]?(?:id|identifier))$/iu;
const sensitiveAssignmentPattern = new RegExp(
  String.raw`\b((?:authorization|api[ _-]?key|access[ _-]?token|refresh[ _-]?token|token|secret|password|(?:customer|user|order|session|conversation|message|external|item)[ _-]?(?:id|identifier)))(\s*(?::|=)\s*|\s+is\s+)("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;\]}]+)`,
  'giu',
);

function redactText(value: string): string {
  return value
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/giu, '$1[REDACTED]')
    .replace(sensitiveAssignmentPattern, '$1$2[REDACTED]');
}

function redactValue(value: unknown, key?: string): unknown {
  if (key && sensitiveKeyPattern.test(key)) return '[REDACTED]';
  if (typeof value === 'string') return redactText(value);
  if (Array.isArray(value)) return value.map((entry) => redactValue(entry));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entry]) => [
        entryKey,
        redactValue(entry, entryKey),
      ]),
    );
  }
  return value;
}

function summarized(value: unknown): string | undefined {
  if (
    value === undefined ||
    value === null ||
    (typeof value === 'object' && Object.keys(value).length === 0)
  ) {
    return undefined;
  }
  return JSON.stringify(redactValue(value));
}

export function buildScenarioOutcomeEvidence(
  script: ScenarioScript,
  result: ScenarioRunResult,
  advisory: LiveScenarioAdvisoryMetadata,
): OutcomeEvidenceBundle {
  const phaseTurns = result.turnEvidence.filter(
    ({ turnIndex }) => turnIndex <= advisory.phaseEndTurnIndex,
  );
  const phaseTurnIndexes = new Set(
    phaseTurns.map(({ turnIndex }) => turnIndex),
  );
  const phaseEventIds = new Set(phaseTurns.flatMap(({ eventIds }) => eventIds));
  const phaseScriptTurns = script.userTurns.filter(({ index }) =>
    phaseTurnIndexes.has(index),
  );

  return {
    scenarioId: redactText(script.id),
    finalState: redactText(script.finalState),
    useCases: [
      ...new Set(
        phaseScriptTurns.flatMap(({ useCases }) => useCases.map(redactText)),
      ),
    ],
    expectations: advisory.criteria.map(({ description }) =>
      redactText(description),
    ),
    turns: phaseTurns.flatMap((turn) => [
      { role: 'user' as const, text: redactText(turn.input) },
      { role: 'assistant' as const, text: redactText(turn.assistantText) },
    ]),
    toolTrace: result.toolTraceByTurn
      .filter(({ turnIndex }) => phaseTurnIndexes.has(turnIndex))
      .flatMap(({ entries }) =>
        entries.map((entry) => ({
          toolName: entry.toolName,
          status: entry.ok ? 'succeeded' : 'failed',
          ...(entry.resultSummary
            ? { resultSummary: redactText(entry.resultSummary) }
            : {}),
        })),
      ),
    genUiAttachments: phaseTurns.flatMap(({ genUi }) =>
      genUi
        ? [
            {
              widgetKind: genUi.widgetKind,
              actionIds: genUi.actions.map(({ id }) => redactText(id)),
            },
          ]
        : [],
    ),
    monitorEvents: result.dashboardEvents
      .filter(({ id }) => phaseEventIds.has(id))
      .map(({ type, payload }) => ({
        type,
        ...(summarized(payload) ? { payloadSummary: summarized(payload) } : {}),
      })),
  };
}
