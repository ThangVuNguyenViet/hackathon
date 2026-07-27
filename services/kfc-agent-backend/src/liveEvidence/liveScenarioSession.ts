import { createHash } from 'node:crypto';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import {
  loadScenarioScript,
  type ScenarioScript,
} from '../scenarios/scenarioScript.js';
import type { AgentModelCandidateId } from '../config/agentModelProfile.js';
import type { LiveScenarioHttpClient } from './liveScenarioHttpClient.js';
import {
  createEvidenceSanitizer,
  type EvidenceSanitizer,
} from './evidenceRedaction.js';
import type { LiveScenarioAssistantObservation } from './liveScenarioProtocol.js';
import { liveScenarioEvidenceMissing } from './liveScenarioEvidenceCompleteness.js';

const TRACE_SCHEMA_VERSION = 'kfc-live-scenario-http-trace-v1';
const MANIFEST_SCHEMA_VERSION = 'kfc-live-scenario-manifest-v2';
const EVIDENCE_PACKET_SCHEMA_VERSION = 'kfc-live-scenario-evidence-packet-v1';

type SessionStatus = 'ready' | 'running' | 'completed' | 'failed' | 'abandoned';

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
  transport: 'http_d1';
  correlation: {
    sessionId: string;
    customerId: string;
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
  source: {
    bridge: { gitSha: string; dirty: boolean };
    service: Record<string, unknown>;
  };
  backend: {
    baseUrl: string;
    expectedCandidateId: AgentModelCandidateId;
  };
  bindings: {
    versions: Record<string, unknown>;
    observability: Record<string, unknown>;
    langsmithCorrelation: {
      scenarioId: string;
      probeRunId: string;
    };
  };
  evidence: {
    environment: 'environment.json';
    trace: 'trace.jsonl';
    transcript: 'transcript.md';
    packet: 'evidence-packet.json';
    reviewPacket: 'codex-review-packet.md';
    artifactSha256?: Record<string, string>;
  };
  finishNote?: string;
}

interface D1Evidence {
  proofEnvelope: Record<string, unknown>;
  recommendationInspection?: Record<string, unknown>;
  orderFlowState?: Record<string, unknown>;
}

export interface LiveScenarioSession {
  readonly runDirectory: string;
  readonly scenario: Readonly<{
    id: string;
    title: string;
    goal: string;
    preconditions: readonly string[];
    risks: readonly string[];
    finalState: string;
  }>;
  readonly environment: Readonly<Record<string, unknown>>;
  submitUserMessage(text: string): Promise<LiveScenarioAssistantObservation>;
  submitAction(input: {
    assistantTurnId: string;
    attachmentId: string;
    actionId: string;
  }): Promise<LiveScenarioAssistantObservation>;
  recordAssistantRendered(
    observation: LiveScenarioAssistantObservation,
  ): Promise<void>;
  recordProtocolError(
    error: 'invalid_json' | 'invalid_command' | 'turn_error' | 'control_error',
    errorClass?: string,
  ): Promise<void>;
  interrupt(reason: 'stdin_eof' | 'control_error'): Promise<void>;
  finish(note?: string): Promise<void>;
  commitFinish(): Promise<void>;
  finalizeTerminal(): Promise<void>;
}

export async function startLiveScenarioSession(input: {
  artifactsRoot: string;
  runId: string;
  attempt: number;
  correlation: {
    sessionId: string;
    customerId: string;
  };
  scenarioPath: string;
  expectedCandidateId: AgentModelCandidateId;
  backendUrl: string;
  source: { gitSha: string; dirty: boolean };
  gateway: LiveScenarioHttpClient;
  configuredSecrets?: readonly string[];
  now?: () => Date;
}): Promise<LiveScenarioSession> {
  assertRunId(input.runId);
  if (!Number.isInteger(input.attempt) || input.attempt < 1) {
    throw new Error('live_scenario_attempt_invalid');
  }
  const now = input.now ?? (() => new Date());
  const sanitize = createEvidenceSanitizer(input.configuredSecrets);
  const scenarioPath = resolve(input.scenarioPath);
  const scenarioRaw = await readFile(scenarioPath);
  const scenario = await loadScenarioScript(scenarioPath);
  const environment = sanitize(await input.gateway.environment()) as Record<
    string,
    unknown
  >;
  assertExpectedCandidate(environment, input.expectedCandidateId);

  const artifactsRoot = resolve(input.artifactsRoot);
  await mkdir(artifactsRoot, { recursive: true });
  const runDirectory = join(artifactsRoot, input.runId);
  try {
    await mkdir(runDirectory);
  } catch (error) {
    if (isAlreadyExists(error)) throw new Error('live_scenario_run_exists');
    throw error;
  }

  const events: TraceEvent[] = [];
  const observedActions = new Set<string>();
  const recordedImpressions = new Set<string>();
  let traceSequence = 0;
  let commandSequence = 0;
  let d1: D1Evidence | undefined;
  let finishPrepared = false;
  let terminalArtifactsWritten = false;
  const startedAt = now().toISOString();
  const manifest: Manifest = {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    runId: input.runId,
    attempt: input.attempt,
    status: 'ready',
    startedAt,
    transport: 'http_d1',
    correlation: {
      sessionId: input.correlation.sessionId,
      customerId: input.correlation.customerId,
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
      sourceSha256: await sha256(scenarioRaw),
    },
    source: {
      bridge: { ...input.source },
      service: serviceRelease(environment),
    },
    backend: {
      baseUrl: normalizedEvidenceUrl(input.backendUrl),
      expectedCandidateId: input.expectedCandidateId,
    },
    bindings: {
      versions: environmentVersions(environment),
      observability: environmentObservability(environment),
      langsmithCorrelation: {
        scenarioId: scenario.id,
        probeRunId: input.runId,
      },
    },
    evidence: {
      environment: 'environment.json',
      trace: 'trace.jsonl',
      transcript: 'transcript.md',
      packet: 'evidence-packet.json',
      reviewPacket: 'codex-review-packet.md',
    },
  };

  await writeJson(
    join(runDirectory, 'environment.json'),
    environment,
    sanitize,
  );
  await persistManifest();
  await recordTrace('session_started', {
    transport: manifest.transport,
    source: manifest.source,
    bindings: manifest.bindings,
  });

  return {
    runDirectory,
    scenario: Object.freeze({
      id: scenario.id,
      title: scenario.title,
      goal: scenario.goal,
      preconditions: Object.freeze([...scenario.preconditions]),
      risks: Object.freeze([...scenario.risks]),
      finalState: scenario.finalState,
    }),
    environment: Object.freeze(structuredClone(environment)),
    async submitUserMessage(text) {
      assertOpen();
      if (text.length === 0) throw new Error('live_scenario_message_empty');
      manifest.status = 'running';
      await persistManifest();
      const clientMessageId = `${input.runId}:user:${++commandSequence}`;
      await recordTrace('user_message', { text, clientMessageId });
      try {
        const response = await input.gateway.submitUserMessage({
          sessionId: input.correlation.sessionId,
          customerId: input.correlation.customerId,
          clientMessageId,
          text,
          metadata: {
            liveScenarioRunId: input.runId,
            liveScenarioAttempt: input.attempt,
            liveScenarioId: scenario.id,
          },
          trace: {
            scenarioId: scenario.id,
            probeRunId: input.runId,
          },
        });
        return await recordAssistantResponse('user', response);
      } catch (error) {
        await recordTrace('http_turn_failed', {
          operation: 'user',
          error: serializedError(error),
        });
        throw error;
      }
    },
    async submitAction(action) {
      assertOpen();
      if (!observedActions.has(actionKey(action))) {
        await recordTrace('action_reference_rejected', action);
        throw new Error('live_scenario_action_not_observed');
      }
      manifest.status = 'running';
      await persistManifest();
      const clientMessageId = `${input.runId}:action:${++commandSequence}`;
      await recordTrace('action_submitted', { ...action, clientMessageId });
      try {
        const response = await input.gateway.submitAction({
          sessionId: input.correlation.sessionId,
          customerId: input.correlation.customerId,
          clientMessageId,
          ...action,
          trace: {
            scenarioId: scenario.id,
            probeRunId: input.runId,
          },
        });
        return await recordAssistantResponse('action', response);
      } catch (error) {
        await recordTrace('http_turn_failed', {
          operation: 'action',
          references: action,
          error: serializedError(error),
        });
        throw error;
      }
    },
    async recordAssistantRendered(observation) {
      assertOpen();
      const impression = recommendationImpression({
        observation,
        occurredAt: now().toISOString(),
      });
      if (!impression || recordedImpressions.has(impression.body.eventId)) {
        return;
      }
      await input.gateway.recordRecommendationImpression(impression);
      recordedImpressions.add(impression.body.eventId);
      await recordTrace('recommendation_impression_recorded', {
        recommendationId: impression.recommendationId,
        ...impression.body,
      });
    },
    async recordProtocolError(error, errorClass) {
      if (terminalArtifactsWritten) return;
      await recordTrace('protocol_error', {
        error,
        ...(errorClass ? { errorClass } : {}),
      });
    },
    async interrupt(reason) {
      if (
        terminalArtifactsWritten ||
        manifest.status === 'failed' ||
        manifest.status === 'abandoned'
      ) {
        return;
      }
      if (d1 === undefined) {
        try {
          d1 = sanitize(
            await input.gateway.d1Evidence(input.correlation.sessionId),
          ) as D1Evidence;
          await recordTrace('d1_evidence_collected', evidenceSummary(d1));
        } catch (error) {
          await recordTrace('d1_evidence_collection_failed', {
            error: serializedError(error),
          });
        }
      }
      finishPrepared = false;
      manifest.status = 'abandoned';
      manifest.completedAt = now().toISOString();
      await recordTrace('session_interrupted', { reason });
    },
    async finish(note) {
      assertOpen();
      d1 = sanitize(
        await input.gateway.d1Evidence(input.correlation.sessionId),
      ) as D1Evidence;
      await recordTrace('d1_evidence_collected', evidenceSummary(d1));
      if (note?.trim()) manifest.finishNote = note.trim();
      const missingEvidence = liveScenarioEvidenceMissing({
        environment,
        bridgeSource: input.source,
        scenarioSourceSha256: manifest.scenario.sourceSha256,
        correlation: manifest.correlation,
        timeline: events,
        d1,
      });
      if (missingEvidence.length > 0) {
        manifest.completedAt = now().toISOString();
        manifest.status = 'failed';
        await recordTrace('session_failed', {
          reason: 'evidence_incomplete',
          missing: missingEvidence,
        });
        throw new LiveScenarioEvidenceIncompleteError();
      }
      finishPrepared = true;
    },
    async commitFinish() {
      if (
        terminalArtifactsWritten ||
        isTerminal(manifest.status) ||
        !finishPrepared
      ) {
        throw new Error('live_scenario_finish_not_prepared');
      }
      finishPrepared = false;
      manifest.status = 'completed';
      manifest.completedAt = now().toISOString();
      await recordTrace('session_finished', {
        ...(manifest.finishNote ? { note: manifest.finishNote } : {}),
      });
    },
    async finalizeTerminal() {
      if (terminalArtifactsWritten) return;
      if (!isTerminal(manifest.status)) {
        throw new Error('live_scenario_session_not_terminal');
      }
      await writeTerminalArtifacts();
      terminalArtifactsWritten = true;
    },
  };

  async function recordAssistantResponse(
    operation: 'user' | 'action',
    rawResponse: Record<string, unknown>,
  ): Promise<LiveScenarioAssistantObservation> {
    const response = sanitize(rawResponse) as Record<string, unknown>;
    if (typeof response.responseText !== 'string') {
      throw new Error('live_scenario_http_response_invalid');
    }
    const assistantTurnId =
      typeof response.assistantTurnId === 'string'
        ? response.assistantTurnId
        : response.assistantTurnId === null
          ? null
          : undefined;
    const genUi = response.genUi;
    const renderedActionReferences = actionReferences({
      assistantTurnId,
      genUi,
    });
    for (const reference of renderedActionReferences) {
      observedActions.add(actionKey(reference));
    }
    await recordTrace('assistant_message', {
      operation,
      text: response.responseText,
      ...(assistantTurnId === undefined ? {} : { assistantTurnId }),
      ...(genUi === undefined ? {} : { genUi }),
      renderedActionReferences,
      response,
    });
    return {
      responseText: response.responseText,
      ...(assistantTurnId === undefined ? {} : { assistantTurnId }),
      ...(genUi === undefined ? {} : { genUi }),
      ...(renderedActionReferences.length === 0
        ? {}
        : { renderedActionReferences }),
    };
  }

  function assertOpen(): void {
    if (isTerminal(manifest.status) || finishPrepared) {
      throw new Error('live_scenario_session_closed');
    }
  }

  async function persistManifest(): Promise<void> {
    await writeJson(join(runDirectory, 'manifest.json'), manifest, sanitize);
  }

  async function recordTrace(
    type: string,
    details: Record<string, unknown> = {},
  ): Promise<void> {
    const event = sanitize({
      schemaVersion: TRACE_SCHEMA_VERSION,
      sequence: ++traceSequence,
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
    await writeFile(
      join(runDirectory, 'transcript.md'),
      String(sanitize(renderTranscript({ manifest, events }))),
      'utf8',
    );
  }

  async function writeTerminalArtifacts(): Promise<void> {
    const packet = sanitize({
      schemaVersion: EVIDENCE_PACKET_SCHEMA_VERSION,
      runId: input.runId,
      attempt: input.attempt,
      status: manifest.status,
      completedAt: manifest.completedAt,
      source: manifest.source,
      backend: manifest.backend,
      bindings: manifest.bindings,
      correlation: manifest.correlation,
      scenario: {
        id: scenario.id,
        title: scenario.title,
        goal: scenario.goal,
        preconditions: scenario.preconditions,
        risks: scenario.risks,
        finalState: scenario.finalState,
        sourceSha256: manifest.scenario.sourceSha256,
      },
      environment,
      timeline: events,
      d1: d1 ?? null,
      ...(manifest.finishNote ? { finishNote: manifest.finishNote } : {}),
    });
    await writeJson(
      join(runDirectory, 'evidence-packet.json'),
      packet,
      sanitize,
    );
    await writeFile(
      join(runDirectory, 'codex-review-packet.md'),
      String(
        sanitize(
          renderReviewPacket({
            scenario,
            packet,
          }),
        ),
      ),
      'utf8',
    );
    manifest.evidence.artifactSha256 = Object.fromEntries(
      await Promise.all(
        [
          'environment.json',
          'trace.jsonl',
          'transcript.md',
          'evidence-packet.json',
          'codex-review-packet.md',
        ].map(async (fileName) => [
          fileName,
          await sha256(await readFile(join(runDirectory, fileName))),
        ]),
      ),
    );
    await persistManifest();
  }
}

function actionReferences(input: {
  assistantTurnId?: string | null;
  genUi: unknown;
}): Array<{
  assistantTurnId: string;
  attachmentId: string;
  actionId: string;
}> {
  if (input.genUi === undefined) return [];
  if (
    typeof input.assistantTurnId !== 'string' ||
    !isRecord(input.genUi) ||
    typeof input.genUi.id !== 'string' ||
    !Array.isArray(input.genUi.actions)
  ) {
    throw new Error('live_scenario_rendered_action_reference_invalid');
  }
  const assistantTurnId = input.assistantTurnId;
  const attachmentId = input.genUi.id;
  return input.genUi.actions.map((action) => {
    if (!isRecord(action) || typeof action.id !== 'string') {
      throw new Error('live_scenario_rendered_action_reference_invalid');
    }
    return {
      assistantTurnId,
      attachmentId,
      actionId: action.id,
    };
  });
}

function actionKey(input: {
  assistantTurnId: string;
  attachmentId: string;
  actionId: string;
}): string {
  return JSON.stringify([
    input.assistantTurnId,
    input.attachmentId,
    input.actionId,
  ]);
}

function recommendationImpression(input: {
  observation: LiveScenarioAssistantObservation;
  occurredAt: string;
}):
  | {
      recommendationId: string;
      body: {
        schemaVersion: 'kfc-recommendation-event-v1';
        eventId: string;
        occurredAt: string;
        assistantTurnId: string;
        attachmentId: string;
        renderedActions: Array<{ actionId: string; position: number }>;
        cartRevision: string;
        actionDigest: string;
      };
    }
  | undefined {
  const attachment = input.observation.genUi;
  if (
    typeof input.observation.assistantTurnId !== 'string' ||
    !isRecord(attachment) ||
    attachment.widgetKind !== 'recommendationOffer' ||
    attachment.status !== 'active' ||
    typeof attachment.id !== 'string' ||
    !isRecord(attachment.data)
  ) {
    return undefined;
  }
  const data = attachment.data;
  if (
    typeof data.recommendationId !== 'string' ||
    typeof data.cartRevision !== 'string' ||
    typeof data.actionDigest !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(data.actionDigest) ||
    typeof data.decisionDigest !== 'string' ||
    !Array.isArray(data.offers) ||
    data.offers.length < 1 ||
    data.offers.length > 4
  ) {
    throw new Error('live_scenario_recommendation_impression_invalid');
  }
  const renderedActions = data.offers.map((offer, index) => {
    if (!isRecord(offer) || typeof offer.recommendationActionId !== 'string') {
      throw new Error('live_scenario_recommendation_impression_invalid');
    }
    return {
      actionId: offer.recommendationActionId,
      position: index + 1,
    };
  });
  const directEventId = `impression:${attachment.id}`;
  const eventId = attachment.id.startsWith('recommendation-attachment:')
    ? `recommendation-impression:${attachment.id.slice(
        'recommendation-attachment:'.length,
      )}`
    : directEventId.length <= 128
      ? directEventId
      : `impression:${data.decisionDigest}`;
  return {
    recommendationId: data.recommendationId,
    body: {
      schemaVersion: 'kfc-recommendation-event-v1',
      eventId,
      occurredAt: input.occurredAt,
      assistantTurnId: input.observation.assistantTurnId,
      attachmentId: attachment.id,
      renderedActions,
      cartRevision: data.cartRevision,
      actionDigest: data.actionDigest,
    },
  };
}

function renderTranscript(input: {
  manifest: Manifest;
  events: TraceEvent[];
}): string {
  return [
    `# Live transcript: ${input.manifest.scenario.title}`,
    '',
    `- Run: \`${input.manifest.runId}\` (attempt ${input.manifest.attempt})`,
    `- Transport: \`${input.manifest.transport}\``,
    `- Service commit: \`${String(input.manifest.source.service.gitSha ?? 'unknown')}\``,
    `- Bridge commit: \`${input.manifest.source.bridge.gitSha}\``,
    `- Scenario source SHA-256: \`${input.manifest.scenario.sourceSha256}\``,
    '',
    ...input.events.flatMap(renderEvent),
    '',
  ].join('\n');
}

function renderEvent(event: TraceEvent): string[] {
  if (event.type === 'user_message') {
    return ['## User', '', String(event.text), ''];
  }
  if (event.type === 'action_submitted') {
    return [
      '## User action',
      '',
      '```json',
      JSON.stringify(
        {
          assistantTurnId: event.assistantTurnId,
          attachmentId: event.attachmentId,
          actionId: event.actionId,
        },
        null,
        2,
      ),
      '```',
      '',
    ];
  }
  if (event.type === 'assistant_message') {
    return [
      '## Assistant',
      '',
      String(event.text),
      '',
      ...(event.genUi === undefined
        ? []
        : [
            '### Rendered GenUI and action references',
            '',
            '```json',
            JSON.stringify(
              {
                assistantTurnId: event.assistantTurnId,
                genUi: event.genUi,
                renderedActionReferences: event.renderedActionReferences,
              },
              null,
              2,
            ),
            '```',
            '',
          ]),
    ];
  }
  if (
    event.type === 'protocol_error' ||
    event.type === 'action_reference_rejected' ||
    event.type === 'http_turn_failed' ||
    event.type === 'd1_evidence_collection_failed' ||
    event.type === 'session_failed' ||
    event.type === 'session_interrupted'
  ) {
    return [
      `### ${event.type}`,
      '',
      '```json',
      JSON.stringify(event, null, 2),
      '```',
      '',
    ];
  }
  return [];
}

function renderReviewPacket(input: {
  scenario: ScenarioScript;
  packet: unknown;
}): string {
  return [
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
    'Evaluate the improvised transcript and protected evidence as a whole. Judge the narrative outcome, evidence grounding, customer authority, and recovery. Do not require exact wording or an exact tool sequence. Return successful, partial, unsuccessful, or insufficient_evidence with evidence citations.',
    '',
    '## Complete evidence packet',
    '',
    '```json',
    JSON.stringify(input.packet, null, 2),
    '```',
    '',
  ].join('\n');
}

function assertExpectedCandidate(
  environment: Record<string, unknown>,
  expected: AgentModelCandidateId,
): void {
  const agent = environmentVersions(environment).agent;
  if (!isRecord(agent) || agent.candidateId !== expected) {
    throw new Error('live_scenario_agent_binding_mismatch');
  }
}

function environmentVersions(
  environment: Record<string, unknown>,
): Record<string, unknown> {
  const proof = isRecord(environment.proof) ? environment.proof : {};
  return isRecord(proof.versions) ? proof.versions : {};
}

function environmentObservability(
  environment: Record<string, unknown>,
): Record<string, unknown> {
  const checks = isRecord(environment.checks) ? environment.checks : {};
  return isRecord(checks.observability) ? checks.observability : {};
}

function serviceRelease(
  environment: Record<string, unknown>,
): Record<string, unknown> {
  return isRecord(environment.release) ? environment.release : {};
}

function normalizedEvidenceUrl(value: string): string {
  const url = new URL(value);
  url.username = '';
  url.password = '';
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/u, '');
}

function evidenceSummary(evidence: D1Evidence): Record<string, unknown> {
  return {
    proofEnvelope: true,
    recommendationInspection: Boolean(evidence.recommendationInspection),
    orderFlowState: Boolean(evidence.orderFlowState),
  };
}

function isTerminal(status: SessionStatus): boolean {
  return (
    status === 'completed' || status === 'failed' || status === 'abandoned'
  );
}

class LiveScenarioEvidenceIncompleteError extends Error {
  constructor() {
    super('live_scenario_evidence_incomplete');
    this.name = 'LiveScenarioEvidenceIncompleteError';
  }
}

function serializedError(error: unknown): { name: string; message: string } {
  return error instanceof Error
    ? { name: error.name, message: error.message }
    : { name: 'UnknownError', message: String(error) };
}

async function writeJson(
  path: string,
  value: unknown,
  sanitize: EvidenceSanitizer,
): Promise<void> {
  await writeFile(
    path,
    `${JSON.stringify(sanitize(value), null, 2)}\n`,
    'utf8',
  );
}

async function sha256(value: Uint8Array): Promise<string> {
  return createHash('sha256').update(value).digest('hex');
}

function assertRunId(value: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value)) {
    throw new Error('live_scenario_run_id_invalid');
  }
}

function isAlreadyExists(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'EEXIST'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
