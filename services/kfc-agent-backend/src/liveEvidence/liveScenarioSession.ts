import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { basename, join, resolve } from 'node:path';
import type { AgentModelIdentity } from '../config/agentModelProfile.js';
import type { ModelCapabilityPreflightResult } from '../config/modelCapabilityPreflight.js';
import type { LocalToolEvidenceEvent } from '../agent/localToolEvidence.js';
import {
  loadScenarioScript,
  type ScenarioScript,
} from '../scenarios/scenarioScript.js';

const TRACE_SCHEMA_VERSION = 'kfc-live-scenario-trace-v1';
const MANIFEST_SCHEMA_VERSION = 'kfc-live-scenario-manifest-v1';

export type { LocalToolEvidenceEvent } from '../agent/localToolEvidence.js';

export type LiveScenarioTurnExecutor = (input: {
  text: string;
  recordToolEvent(event: LocalToolEvidenceEvent): Promise<void>;
}) => Promise<{ responseText: string }>;

type SessionStatus =
  'ready' | 'preflight_failed' | 'running' | 'completed' | 'failed';

interface TraceEvent {
  schemaVersion: typeof TRACE_SCHEMA_VERSION;
  sequence: number;
  at: string;
  type: string;
  [key: string]: unknown;
}

interface Manifest {
  schemaVersion: typeof MANIFEST_SCHEMA_VERSION;
  runId: string;
  attempt: number;
  status: SessionStatus;
  startedAt: string;
  completedAt?: string;
  correlation: {
    sessionId: string;
    scenarioId: string;
    probeRunId: string;
  };
  scenario: {
    id: string;
    title: string;
    goal: string;
    preconditions: string[];
    risks: string[];
    finalState: string;
    sourceFile: string;
    sourcePath: string;
    sourceSha256: string;
  };
  model: AgentModelIdentity;
  evidence: {
    trace: 'trace.jsonl';
    transcript: 'transcript.md';
    preflight: 'preflight.json';
    reviewPacket: 'codex-review-packet.md';
    artifactSha256?: Record<string, string>;
  };
  finishNote?: string;
}

export interface LiveScenarioSession {
  readonly runDirectory: string;
  readonly preflightPassed: boolean;
  readonly scenario: Readonly<{
    id: string;
    title: string;
    goal: string;
    preconditions: readonly string[];
    risks: readonly string[];
    finalState: string;
  }>;
  readonly identity: AgentModelIdentity;
  submitUserMessage(text: string): Promise<{ responseText: string }>;
  finish(note?: string): Promise<void>;
}

export async function startLiveScenarioSession(input: {
  artifactsRoot: string;
  runId: string;
  attempt: number;
  scenarioPath: string;
  identity: AgentModelIdentity;
  runPreflight(): Promise<ModelCapabilityPreflightResult>;
  executeTurn: LiveScenarioTurnExecutor;
  now?: () => Date;
}): Promise<LiveScenarioSession> {
  assertRunId(input.runId);
  if (!Number.isInteger(input.attempt) || input.attempt < 1) {
    throw new Error('live_scenario_attempt_invalid');
  }
  const now = input.now ?? (() => new Date());
  const scenarioPath = resolve(input.scenarioPath);
  const scenarioRaw = await readFile(scenarioPath);
  const scenario = await loadScenarioScript(scenarioPath);
  const scenarioSourceSha256 = await sha256(scenarioRaw);
  const artifactsRoot = resolve(input.artifactsRoot);
  await mkdir(artifactsRoot, { recursive: true });
  const runDirectory = join(artifactsRoot, input.runId);
  try {
    await mkdir(runDirectory);
  } catch (error) {
    if (isAlreadyExists(error)) {
      throw new Error('live_scenario_run_exists');
    }
    throw error;
  }

  const events: TraceEvent[] = [];
  let sequence = 0;
  const startedAt = now().toISOString();
  const manifest: Manifest = {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    runId: input.runId,
    attempt: input.attempt,
    status: 'ready',
    startedAt,
    correlation: {
      sessionId: `live-${input.runId}`,
      scenarioId: scenario.id,
      probeRunId: input.runId,
    },
    scenario: {
      id: scenario.id,
      title: scenario.title,
      goal: scenario.goal,
      preconditions: [...scenario.preconditions],
      risks: [...scenario.risks],
      finalState: scenario.finalState,
      sourceFile: basename(scenarioPath),
      sourcePath: scenarioPath,
      sourceSha256: scenarioSourceSha256,
    },
    model: { ...input.identity },
    evidence: {
      trace: 'trace.jsonl',
      transcript: 'transcript.md',
      preflight: 'preflight.json',
      reviewPacket: 'codex-review-packet.md',
    },
  };

  const persistManifest = () =>
    writeJson(join(runDirectory, 'manifest.json'), manifest);
  const recordTerminalArtifactHashes = async (): Promise<void> => {
    manifest.evidence.artifactSha256 = Object.fromEntries(
      await Promise.all(
        [
          'preflight.json',
          'trace.jsonl',
          'transcript.md',
          'codex-review-packet.md',
        ].map(async (fileName) => [
          fileName,
          await sha256(await readFile(join(runDirectory, fileName))),
        ]),
      ),
    );
  };
  const recordTraceEvidence = async (
    type: string,
    details: Record<string, unknown> = {},
  ): Promise<void> => {
    const event = sanitize({
      schemaVersion: TRACE_SCHEMA_VERSION,
      sequence: ++sequence,
      at: now().toISOString(),
      type,
      ...details,
    }) as TraceEvent;
    events.push(event);
    await appendFile(
      join(runDirectory, 'trace.jsonl'),
      `${JSON.stringify(event)}\n`,
      'utf8',
    );
    await renderReadableEvidence({
      runDirectory,
      manifest,
      scenario,
      events,
    });
  };

  await persistManifest();
  await recordTraceEvidence('session_started');

  let preflight: ModelCapabilityPreflightResult;
  try {
    preflight = await input.runPreflight();
    assertSameIdentity(input.identity, preflight.identity);
  } catch (error) {
    const failed = {
      schemaVersion: 'agent-model-capability-preflight-v1',
      identity: input.identity,
      passed: false,
      error: serializedError(error),
    };
    await writeJson(join(runDirectory, 'preflight.json'), failed);
    manifest.status = 'preflight_failed';
    manifest.completedAt = now().toISOString();
    await recordTraceEvidence('preflight_failed', {
      error: serializedError(error),
    });
    await recordTerminalArtifactHashes();
    await persistManifest();
    return createSession();
  }
  await writeJson(join(runDirectory, 'preflight.json'), preflight);
  if (!preflight.passed) {
    manifest.status = 'preflight_failed';
    manifest.completedAt = now().toISOString();
  }
  await recordTraceEvidence('preflight_completed', {
    passed: preflight.passed,
    ordinaryInvocation: preflight.ordinaryInvocation,
    typedToolCall: preflight.typedToolCall,
  });
  if (!preflight.passed) await recordTerminalArtifactHashes();
  await persistManifest();

  return createSession();

  function createSession(): LiveScenarioSession {
    return {
      runDirectory,
      preflightPassed: manifest.status !== 'preflight_failed',
      scenario: Object.freeze({
        id: scenario.id,
        title: scenario.title,
        goal: scenario.goal,
        preconditions: Object.freeze([...scenario.preconditions]),
        risks: Object.freeze([...scenario.risks]),
        finalState: scenario.finalState,
      }),
      identity: Object.freeze({ ...input.identity }),
      async submitUserMessage(text) {
        if (manifest.status === 'preflight_failed') {
          throw new Error('live_scenario_preflight_failed');
        }
        if (manifest.status === 'completed' || manifest.status === 'failed') {
          throw new Error('live_scenario_session_closed');
        }
        const normalized = text.trim();
        if (!normalized) throw new Error('live_scenario_message_empty');
        manifest.status = 'running';
        await persistManifest();
        await recordTraceEvidence('user_message', { text: normalized });
        try {
          const output = await input.executeTurn({
            text: normalized,
            recordToolEvent: async (toolEvent) => {
              if (toolEvent.phase === 'started') {
                await recordTraceEvidence('tool_started', {
                  callId: toolEvent.callId,
                  toolName: toolEvent.toolName,
                  arguments: toolEvent.arguments,
                  startedAt: toolEvent.startedAt,
                });
                return;
              }
              const common = {
                callId: toolEvent.callId,
                toolName: toolEvent.toolName,
                arguments: toolEvent.arguments,
                startedAt: toolEvent.startedAt,
                completedAt: toolEvent.completedAt,
                durationMs: toolEvent.durationMs,
              };
              await recordTraceEvidence(
                toolEvent.phase === 'completed'
                  ? 'tool_completed'
                  : 'tool_failed',
                toolEvent.phase === 'completed'
                  ? {
                      ...common,
                      rawResult: toolEvent.rawResult,
                      modelFacingResult: toolEvent.modelFacingResult,
                    }
                  : { ...common, error: serializedError(toolEvent.error) },
              );
            },
          });
          await recordTraceEvidence('assistant_message', {
            text: output.responseText,
          });
          return output;
        } catch (error) {
          manifest.status = 'failed';
          manifest.completedAt = now().toISOString();
          await recordTraceEvidence('turn_failed', {
            error: serializedError(error),
          });
          await recordTerminalArtifactHashes();
          await persistManifest();
          throw error;
        }
      },
      async finish(note) {
        if (
          manifest.status === 'preflight_failed' ||
          manifest.status === 'failed'
        ) {
          return;
        }
        if (manifest.status === 'completed') {
          throw new Error('live_scenario_session_closed');
        }
        manifest.status = 'completed';
        manifest.completedAt = now().toISOString();
        if (note?.trim()) manifest.finishNote = note.trim();
        await recordTraceEvidence('session_finished', {
          ...(manifest.finishNote ? { note: manifest.finishNote } : {}),
        });
        await recordTerminalArtifactHashes();
        await persistManifest();
      },
    };
  }
}

async function renderReadableEvidence(input: {
  runDirectory: string;
  manifest: Manifest;
  scenario: ScenarioScript;
  events: TraceEvent[];
}): Promise<void> {
  const transcript = [
    `# Live transcript: ${input.scenario.title}`,
    '',
    `- Run: \`${input.manifest.runId}\` (attempt ${input.manifest.attempt})`,
    `- Model: \`${input.manifest.model.candidateId}\` via \`${input.manifest.model.transport}\``,
    `- Scenario source SHA-256: \`${input.manifest.scenario.sourceSha256}\``,
    '',
    ...input.events.flatMap(renderEvent),
    '',
  ].join('\n');
  await writeFile(
    join(input.runDirectory, 'transcript.md'),
    transcript,
    'utf8',
  );

  const reviewPacket = [
    `# Codex review packet: ${input.scenario.title}`,
    '',
    '## Held-out narrative',
    '',
    `Goal: ${input.scenario.goal}`,
    '',
    'Preconditions:',
    ...input.scenario.preconditions.map((value) => `- ${value}`),
    '',
    'Risks:',
    ...input.scenario.risks.map((value) => `- ${value}`),
    '',
    `Intended outcome state: ${input.scenario.finalState}`,
    '',
    '## Review guidance',
    '',
    'Evaluate the improvised transcript as a whole. Judge whether the assistant handled the narrative goal, grounded claims in tool evidence, preserved customer authority, and recovered naturally from failures. Do not require exact wording or an exact tool sequence.',
    '',
    '## Transcript',
    '',
    ...input.events.flatMap(renderEvent),
    '',
  ].join('\n');
  await writeFile(
    join(input.runDirectory, 'codex-review-packet.md'),
    reviewPacket,
    'utf8',
  );
}

function renderEvent(event: TraceEvent): string[] {
  switch (event.type) {
    case 'user_message':
      return [`## User`, '', String(event.text), ''];
    case 'assistant_message':
      return [`## Assistant`, '', String(event.text), ''];
    case 'tool_completed':
    case 'tool_failed':
      return [
        `### Tool ${event.type === 'tool_completed' ? 'result' : 'failure'}: ${String(event.toolName)}`,
        '',
        '```json',
        JSON.stringify(
          {
            callId: event.callId,
            arguments: event.arguments,
            ...(event.type === 'tool_completed'
              ? {
                  rawResult: event.rawResult,
                  modelFacingResult: event.modelFacingResult,
                }
              : { error: event.error }),
            startedAt: event.startedAt,
            completedAt: event.completedAt,
            durationMs: event.durationMs,
          },
          null,
          2,
        ),
        '```',
        '',
      ];
    case 'tool_started':
      return [
        `### Tool call: ${String(event.toolName)}`,
        '',
        '```json',
        JSON.stringify(
          {
            callId: event.callId,
            arguments: event.arguments,
            startedAt: event.startedAt,
          },
          null,
          2,
        ),
        '```',
        '',
      ];
    case 'turn_failed':
    case 'preflight_failed':
      return [
        `### ${event.type}`,
        '',
        '```json',
        JSON.stringify(event.error, null, 2),
        '```',
        '',
      ];
    default:
      return [];
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(
    path,
    `${JSON.stringify(sanitize(value), null, 2)}\n`,
    'utf8',
  );
}

function sanitize(value: unknown, key = ''): unknown {
  if (sensitiveKey(key)) return '[REDACTED]';
  if (value instanceof Error) return sanitize(serializedError(value));
  if (Array.isArray(value)) return value.map((entry) => sanitize(entry));
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entry]) => [
        entryKey,
        sanitize(entry, entryKey),
      ]),
    );
  }
  if (typeof value !== 'string') return value;
  return value
    .replace(/\bBearer\s+[^\s"',}]+/giu, 'Bearer [REDACTED]')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/gu, '[REDACTED]');
}

function sensitiveKey(key: string): boolean {
  return /(?:authorization|api[-_]?key|access[-_]?token|secret|password|cookie|signature)/iu.test(
    key,
  );
}

function serializedError(error: unknown): { name: string; message: string } {
  return error instanceof Error
    ? { name: error.name, message: error.message }
    : { name: 'UnknownError', message: String(error) };
}

function assertSameIdentity(
  expected: AgentModelIdentity,
  actual: AgentModelIdentity,
): void {
  for (const key of [
    'candidateId',
    'provider',
    'model',
    'profile',
    'transport',
  ] as const) {
    if (expected[key] !== actual[key]) {
      throw new Error(`live_scenario_preflight_identity_mismatch:${key}`);
    }
  }
}

function assertRunId(runId: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(runId)) {
    throw new Error('live_scenario_run_id_invalid');
  }
}

function isAlreadyExists(error: unknown): boolean {
  return isRecord(error) && error.code === 'EEXIST';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function sha256(value: Uint8Array): Promise<string> {
  return createHash('sha256').update(value).digest('hex');
}
