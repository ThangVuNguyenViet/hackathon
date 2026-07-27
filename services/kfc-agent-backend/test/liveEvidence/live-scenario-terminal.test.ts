import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { LiveScenarioHttpClient } from '../../src/liveEvidence/liveScenarioHttpClient.js';
import { startLiveScenarioSession } from '../../src/liveEvidence/liveScenarioSession.js';

describe('live scenario terminal evidence', () => {
  it('persists protocol errors and terminal abandonment with final artifact hashes', async () => {
    const input = await fixture('abandoned');
    const session = await startLiveScenarioSession(input);

    await session.recordProtocolError('invalid_json');
    await session.recordProtocolError('turn_error', 'TypeError');
    await session.interrupt('stdin_eof');

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

  it('does not relabel an explicitly completed attempt as abandoned', async () => {
    const session = await startLiveScenarioSession(await fixture('completed'));
    await session.finish('Explicit role-player finish.');
    await session.interrupt('stdin_eof');

    expect(
      JSON.parse(
        await readFile(join(session.runDirectory, 'manifest.json'), 'utf8'),
      ),
    ).toMatchObject({ status: 'completed' });
  });

  it('fails closed while preserving an incomplete protected D1 envelope', async () => {
    const input = await fixture('incomplete');
    input.gateway.d1Evidence = async () => ({
      proofEnvelope: {
        complete: false,
        missing: ['recommendations.finalState'],
        sessionId: 'kfc:live-incomplete',
      },
    });
    const session = await startLiveScenarioSession(input);

    await expect(session.finish('Reviewer requested completion.')).rejects.toThrow(
      'live_scenario_d1_evidence_incomplete',
    );
    await session.interrupt('control_error');

    const manifest = JSON.parse(
      await readFile(join(session.runDirectory, 'manifest.json'), 'utf8'),
    );
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
    expect(
      await readFile(join(session.runDirectory, 'transcript.md'), 'utf8'),
    ).toContain('d1_evidence_incomplete');
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
      release: { gitSha: 'service-commit' },
      proof: {
        versions: {
          agent: { candidateId: 'openai-gpt-4.1-mini' },
        },
      },
    }),
    submitUserMessage: async () => ({
      responseText: 'unused',
      assistantTurnId: 'assistant-unused',
    }),
    submitAction: async () => ({
      responseText: 'unused',
      assistantTurnId: 'assistant-action-unused',
    }),
    recordRecommendationImpression: async () => undefined,
    d1Evidence: async () => ({
      proofEnvelope: {
        complete: true,
        missing: [],
        sessionId: `kfc:live-${runId}`,
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
    source: { gitSha: 'bridge-commit', dirty: false },
    gateway,
  };
}
