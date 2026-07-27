import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { LiveScenarioHttpClient } from '../../src/liveEvidence/liveScenarioHttpClient.js';
import {
  createJsonLineWriter,
  type JsonLineWritable,
} from '../../src/liveEvidence/jsonLineWriter.js';
import { runLiveScenarioCommandStream } from '../../src/liveEvidence/liveScenarioProtocol.js';
import { startLiveScenarioSession } from '../../src/liveEvidence/liveScenarioSession.js';

describe('live scenario terminal evidence', () => {
  it('persists protocol errors and terminal abandonment with final artifact hashes', async () => {
    const input = await fixture('abandoned');
    const session = await startLiveScenarioSession(input);

    await session.recordProtocolError('invalid_json');
    await session.recordProtocolError('turn_error', 'TypeError');
    await session.interrupt('stdin_eof');
    await session.finalizeTerminal();

    const manifest = JSON.parse(
      await readFile(join(session.runDirectory, 'manifest.json'), 'utf8'),
    ) as {
      status: string;
      completedAt?: string;
      evidence: { artifactSha256: Record<string, string> };
    };
    expect(manifest.status).toBe('abandoned');
    expect(manifest.completedAt).toBeTypeOf('string');
    for (const fileName of [
      'environment.json',
      'trace.jsonl',
      'transcript.md',
      'evidence-packet.json',
      'codex-review-packet.md',
    ]) {
      expect(manifest.evidence.artifactSha256[fileName]).toBe(
        createHash('sha256')
          .update(await readFile(join(session.runDirectory, fileName)))
          .digest('hex'),
      );
    }
    const trace = (
      await readFile(join(session.runDirectory, 'trace.jsonl'), 'utf8')
    )
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { type: string; reason?: string });
    expect(
      trace.filter(({ type }) =>
        ['protocol_error', 'session_interrupted'].includes(type),
      ),
    ).toMatchObject([
      { type: 'protocol_error' },
      { type: 'protocol_error' },
      { type: 'session_interrupted', reason: 'stdin_eof' },
    ]);
    const transcript = await readFile(
      join(session.runDirectory, 'transcript.md'),
      'utf8',
    );
    expect(transcript).toContain('protocol_error');
    expect(transcript).toContain('session_interrupted');
  });

  it('finalizes immutable completed evidence before the protocol exits', async () => {
    const session = await startLiveScenarioSession(await fixture('completed'));
    const output: string[] = [];

    await runLiveScenarioCommandStream({
      session,
      lines: lines([
        JSON.stringify({
          type: 'user',
          text: 'Complete the terminal attempt.',
        }),
        JSON.stringify({
          type: 'finish',
          note: 'Explicit role-player finish.',
        }),
      ]),
      writeLine(line) {
        output.push(line);
      },
    });
    await session.interrupt('stdin_eof');

    const manifest = JSON.parse(
      await readFile(join(session.runDirectory, 'manifest.json'), 'utf8'),
    ) as {
      status: string;
      evidence: { artifactSha256: Record<string, string> };
    };
    expect(manifest).toMatchObject({ status: 'completed' });
    expect(output.map((line) => JSON.parse(line))).toEqual([
      expect.objectContaining({ type: 'assistant', text: 'unused' }),
      { type: 'finished' },
    ]);
    for (const fileName of [
      'environment.json',
      'trace.jsonl',
      'transcript.md',
      'evidence-packet.json',
      'codex-review-packet.md',
    ]) {
      expect(manifest.evidence.artifactSha256[fileName]).toBe(
        createHash('sha256')
          .update(await readFile(join(session.runDirectory, fileName)))
          .digest('hex'),
      );
    }
  });

  it('abandons complete evidence when the final acknowledgment cannot be written', async () => {
    const session = await startLiveScenarioSession(
      await fixture('finished-ack-failure'),
    );
    const output: string[] = [];
    const stdout = new EventEmitter() as EventEmitter & JsonLineWritable;
    stdout.write = (chunk, callback) => {
      const value = JSON.parse(chunk) as { type: string };
      setImmediate(() => {
        if (value.type === 'finished') {
          callback(new Error('finished_ack_write_failed'));
          return;
        }
        output.push(chunk.trimEnd());
        callback();
      });
      return true;
    };
    const writeLine = createJsonLineWriter(stdout);

    await expect(
      runLiveScenarioCommandStream({
        session,
        lines: lines([
          JSON.stringify({
            type: 'user',
            text: 'Complete before the acknowledgment fails.',
          }),
          JSON.stringify({
            type: 'finish',
            note: 'The evidence itself is complete.',
          }),
        ]),
        writeLine,
      }),
    ).rejects.toThrow('finished_ack_write_failed');

    const manifest = JSON.parse(
      await readFile(join(session.runDirectory, 'manifest.json'), 'utf8'),
    ) as {
      status: string;
      evidence: { artifactSha256: Record<string, string> };
    };
    const packet = JSON.parse(
      await readFile(
        join(session.runDirectory, 'evidence-packet.json'),
        'utf8',
      ),
    ) as {
      status: string;
      timeline: Array<Record<string, unknown>>;
    };
    expect(manifest.status).toBe('abandoned');
    expect(packet.status).toBe('abandoned');
    expect(packet.timeline).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'protocol_error',
          error: 'control_error',
          errorClass: 'Error',
        }),
        expect.objectContaining({
          type: 'session_interrupted',
          reason: 'control_error',
        }),
      ]),
    );
    expect(packet.timeline).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'session_finished' }),
      ]),
    );
    expect(output.map((line) => JSON.parse(line))).toEqual([
      expect.objectContaining({ type: 'assistant', text: 'unused' }),
    ]);
    expect(stdout.listenerCount('error')).toBe(0);
    for (const fileName of [
      'environment.json',
      'trace.jsonl',
      'transcript.md',
      'evidence-packet.json',
      'codex-review-packet.md',
    ]) {
      expect(manifest.evidence.artifactSha256[fileName]).toBe(
        createHash('sha256')
          .update(await readFile(join(session.runDirectory, fileName)))
          .digest('hex'),
      );
    }
  });

  it('recovers a finalization failure as abandoned immutable evidence', async () => {
    const realSession = await startLiveScenarioSession(
      await fixture('finalization-failure'),
    );
    let finalizationAttempts = 0;
    const session = {
      ...realSession,
      async finalizeTerminal() {
        finalizationAttempts += 1;
        if (finalizationAttempts === 1) {
          throw new Error('terminal_artifact_write_failed');
        }
        await realSession.finalizeTerminal();
      },
    };
    const output: string[] = [];

    await expect(
      runLiveScenarioCommandStream({
        session,
        lines: lines([
          JSON.stringify({
            type: 'user',
            text: 'Complete before finalization fails once.',
          }),
          JSON.stringify({ type: 'finish' }),
        ]),
        writeLine(line) {
          output.push(line);
        },
      }),
    ).rejects.toThrow('terminal_artifact_write_failed');

    const manifest = JSON.parse(
      await readFile(join(session.runDirectory, 'manifest.json'), 'utf8'),
    ) as {
      status: string;
      evidence: { artifactSha256: Record<string, string> };
    };
    const packet = JSON.parse(
      await readFile(
        join(session.runDirectory, 'evidence-packet.json'),
        'utf8',
      ),
    ) as {
      status: string;
      timeline: Array<Record<string, unknown>>;
    };
    expect(finalizationAttempts).toBe(2);
    expect(output.map((line) => JSON.parse(line))).toEqual([
      expect.objectContaining({ type: 'assistant', text: 'unused' }),
      { type: 'finished' },
    ]);
    expect(manifest.status).toBe('abandoned');
    expect(packet.status).toBe('abandoned');
    expect(packet.timeline).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'session_finished' }),
        expect.objectContaining({
          type: 'protocol_error',
          error: 'control_error',
          errorClass: 'Error',
        }),
        expect.objectContaining({
          type: 'session_interrupted',
          reason: 'control_error',
        }),
      ]),
    );
    for (const fileName of [
      'environment.json',
      'trace.jsonl',
      'transcript.md',
      'evidence-packet.json',
      'codex-review-packet.md',
    ]) {
      expect(manifest.evidence.artifactSha256[fileName]).toBe(
        createHash('sha256')
          .update(await readFile(join(session.runDirectory, fileName)))
          .digest('hex'),
      );
    }
  });

  it('finalizes immutable failed evidence after an incomplete finish control error', async () => {
    const input = await fixture('incomplete');
    input.gateway.d1Evidence = async () => ({
      proofEnvelope: {
        schemaVersion: 1,
        artifactKind: 'kfc-simple-agent-proof',
        runtime: 'simple-model-tool-loop',
        complete: false,
        missing: ['recommendations.finalState'],
        sessionId: 'kfc:live-incomplete',
        turns: proofTurns(),
        packState: proofPackState(),
        recommendations: noRecommendationProjection(),
      },
    });
    const session = await startLiveScenarioSession(input);
    const output: string[] = [];

    await expect(
      runLiveScenarioCommandStream({
        session,
        lines: lines([
          JSON.stringify({
            type: 'user',
            text: 'Improvised incomplete attempt.',
          }),
          JSON.stringify({
            type: 'finish',
            note: 'Reviewer requested completion.',
          }),
        ]),
        writeLine(line) {
          output.push(line);
        },
      }),
    ).rejects.toThrow('live_scenario_evidence_incomplete');

    const manifest = JSON.parse(
      await readFile(join(session.runDirectory, 'manifest.json'), 'utf8'),
    ) as {
      status: string;
      evidence: { artifactSha256: Record<string, string> };
    };
    const packet = JSON.parse(
      await readFile(
        join(session.runDirectory, 'evidence-packet.json'),
        'utf8',
      ),
    );
    expect(manifest).toMatchObject({ status: 'failed' });
    expect(packet).toMatchObject({
      status: 'failed',
      d1: {
        proofEnvelope: {
          complete: false,
          missing: ['recommendations.finalState'],
        },
      },
      finishNote: 'Reviewer requested completion.',
    });
    expect(packet.timeline).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'session_failed',
          reason: 'evidence_incomplete',
        }),
        expect.objectContaining({
          type: 'protocol_error',
          error: 'control_error',
          errorClass: 'LiveScenarioEvidenceIncompleteError',
        }),
      ]),
    );
    expect(
      await readFile(join(session.runDirectory, 'transcript.md'), 'utf8'),
    ).toContain('evidence_incomplete');
    expect(output.map((line) => JSON.parse(line))).toEqual([
      expect.objectContaining({
        type: 'assistant',
        text: 'unused',
      }),
    ]);
    for (const fileName of [
      'environment.json',
      'trace.jsonl',
      'transcript.md',
      'evidence-packet.json',
      'codex-review-packet.md',
    ]) {
      expect(manifest.evidence.artifactSha256[fileName]).toBe(
        createHash('sha256')
          .update(await readFile(join(session.runDirectory, fileName)))
          .digest('hex'),
      );
    }
  });
});

async function fixture(runId: string) {
  const root = await mkdtemp(join(tmpdir(), 'terminal-evidence-'));
  const scenarioPath = join(root, 'scenario.json');
  await writeFile(
    scenarioPath,
    `${JSON.stringify({
      id: 'terminal-evidence',
      title: 'Terminal evidence',
      channel: 'kfc',
      goal: 'Exercise a terminal session.',
      preconditions: ['A fresh session exists.'],
      useCases: ['UC-TEST'],
      finalState: 'reviewed',
      turns: [
        {
          index: 1,
          speaker: 'User',
          text: 'Narrative only.',
          useCases: ['UC-TEST'],
        },
      ],
      risks: ['Abandonment must be visible.'],
    })}\n`,
  );
  const gateway: LiveScenarioHttpClient = {
    environment: async () => ({
      ok: true,
      service: 'kfc-agent-backend',
      release: {
        gitSha: '1'.repeat(40),
        deploymentId: 'deployment-1',
        builtAt: '2026-07-28T00:00:00.000Z',
        dirty: false,
      },
      checks: {
        observability: {
          ok: true,
          langsmith: {
            configured: true,
            project: 'kfc-live',
            endpoint: 'https://api.smith.langchain.com',
            samplingRate: 1,
          },
        },
      },
      proof: {
        versions: {
          agent: {
            candidateId: 'openai-gpt-4.1-mini',
            provider: 'openai',
            model: 'gpt-4.1-mini',
            profile: 'openai:gpt-4.1-mini:responses',
            transport: 'openai_responses',
          },
          recommendationShadow: {
            ok: true,
            required: false,
            configured: true,
            outputMode: 'learned_technical',
          },
          recommendationSanity: {
            authority: 'sanity',
            configured: true,
            reachable: true,
            snapshotDigest: '2'.repeat(64),
          },
        },
      },
    }),
    submitUserMessage: async () => ({
      responseText: 'unused',
      assistantTurnId: 'assistant-unused',
      liveScenarioTrace: {
        authority: 'server_issued_agent_trace_context',
        scenarioId: 'terminal-evidence',
        probeRunId: runId,
      },
    }),
    submitAction: async () => ({
      responseText: 'unused',
      assistantTurnId: 'assistant-action-unused',
    }),
    recordRecommendationImpression: async () => undefined,
    d1Evidence: async () => ({
      proofEnvelope: {
        schemaVersion: 1,
        artifactKind: 'kfc-simple-agent-proof',
        runtime: 'simple-model-tool-loop',
        complete: true,
        missing: [],
        sessionId: `kfc:live-${runId}`,
        turns: proofTurns(),
        packState: proofPackState(),
        recommendations: noRecommendationProjection(),
      },
    }),
  };
  return {
    artifactsRoot: join(root, 'artifacts'),
    runId,
    attempt: 1,
    correlation: {
      sessionId: `kfc:live-${runId}`,
      customerId: `live-${runId}`,
    },
    scenarioPath,
    expectedCandidateId: 'openai-gpt-4.1-mini' as const,
    backendUrl: 'https://worker.example',
    source: { gitSha: '3'.repeat(40), dirty: false },
    gateway,
  };
}

function proofTurns() {
  return [
    {
      id: 'user-1',
      role: 'user',
      content: { characterCount: 10, sha256: '4'.repeat(64) },
    },
    {
      id: 'assistant-unused',
      role: 'assistant',
      content: { characterCount: 6, sha256: '5'.repeat(64) },
    },
  ];
}

function proofPackState() {
  return {
    envelopeVersion: 1,
    packRef: { packId: 'kfc-vietnam', version: '1' },
    schemaVersion: '1',
    state: { toolTrace: [] },
    integrity: { algorithm: 'sha256', digest: '6'.repeat(64) },
  };
}

function noRecommendationProjection() {
  return {
    schemaVersion: 'kfc-recommendation-order-flow-inspection-v1',
    state: null,
    latestDecision: null,
    pendingAction: null,
    correlations: {
      orderFlowId: null,
      recommendationId: null,
      requestId: null,
      traceRef: null,
    },
    eventCounts: {},
    events: [],
  };
}

async function* lines(values: string[]): AsyncIterable<string> {
  yield* values;
}
