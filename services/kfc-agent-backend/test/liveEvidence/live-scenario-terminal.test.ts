import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
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
      'preflight.json',
      'trace.jsonl',
      'transcript.md',
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
    expect(trace.slice(-3)).toMatchObject([
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
  const identity = {
    candidateId: 'deepseek-v4-flash',
    provider: 'opencode',
    model: 'deepseek-v4-flash',
    profile: 'opencode:deepseek-v4-flash:chat-completions',
    transport: 'openai_compatible_chat',
  } as const;
  return {
    artifactsRoot: join(root, 'artifacts'),
    runId,
    attempt: 1,
    correlation: {
      externalSessionId: `live-${runId}`,
      durableSessionId: `live-${runId}`,
    },
    scenarioPath,
    identity,
    runPreflight: async () => ({
      schemaVersion: 'agent-model-capability-preflight-v1' as const,
      identity,
      ordinaryInvocation: { passed: true },
      typedToolCall: { passed: true },
      passed: true,
    }),
    executeTurn: async () => ({ responseText: 'unused' }),
  };
}
