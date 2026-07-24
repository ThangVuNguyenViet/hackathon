import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import {
  startLiveScenarioSession,
  type LiveScenarioTurnExecutor,
} from '../../src/liveEvidence/liveScenarioSession.js';

const identity = {
  candidateId: 'deepseek-v4-flash',
  provider: 'opencode',
  model: 'deepseek-v4-flash',
  profile: 'opencode:deepseek-v4-flash:chat-completions',
  transport: 'openai_compatible_chat',
} as const;

const scenario = {
  id: 'scenario-improvised',
  title: 'Improvised ordering',
  channel: 'kfc',
  goal: 'Explore a menu and build a suitable cart.',
  preconditions: ['The cart starts empty.'],
  useCases: ['UC-02'],
  finalState: 'cart_ready',
  turns: [
    {
      index: 1,
      speaker: 'User',
      text: 'This narrative example must never be replayed.',
      useCases: ['UC-02'],
    },
  ],
  risks: ['Recommendations need evidence.'],
} as const;

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'live-scenario-'));
  const scenarioPath = join(root, 'scenario.json');
  await writeFile(scenarioPath, `${JSON.stringify(scenario)}\n`);
  return { root, scenarioPath };
}

describe('live scenario evidence session', () => {
  it('runs preflight first and sends only improvised user messages to the pinned turn executor', async () => {
    const { root, scenarioPath } = await fixture();
    const order: string[] = [];
    const executeTurn: LiveScenarioTurnExecutor = vi.fn(
      async ({ text, recordToolEvent }) => {
        order.push(`turn:${text}`);
        await recordToolEvent({
          phase: 'started',
          callId: 'call-1',
          toolName: 'searchMenu',
          arguments: { queries: ['gà'] },
          requestedAt: '2026-07-24T00:00:01.000Z',
        });
        await recordToolEvent({
          phase: 'completed',
          callId: 'call-1',
          toolName: 'searchMenu',
          arguments: { queries: ['gà'] },
          rawResult: { ok: true, items: [{ itemCode: '150078' }] },
          modelFacingResult: {
            ok: true,
            items: [{ itemCode: '150078' }],
          },
          executionStartedAt: '2026-07-24T00:00:01.000Z',
          completedAt: '2026-07-24T00:00:01.025Z',
          executionDurationMs: 25,
        });
        return { responseText: 'Mình tìm thấy một lựa chọn phù hợp.' };
      },
    );

    const session = await startLiveScenarioSession({
      artifactsRoot: join(root, 'artifacts'),
      runId: 'run-1',
      attempt: 1,
      correlation: {
        externalSessionId: 'live-run-1',
        durableSessionId: 'live-run-1',
      },
      scenarioPath,
      identity,
      runPreflight: async () => {
        order.push('preflight');
        return {
          schemaVersion: 'agent-model-capability-preflight-v1',
          identity,
          ordinaryInvocation: { passed: true },
          typedToolCall: { passed: true },
          passed: true,
        };
      },
      executeTurn,
      now: sequenceClock(),
    });

    await session.submitUserMessage('Tôi muốn tự chọn món cho hai người.');
    await session.finish('Role-player ended the improvised session.');

    expect(order).toEqual([
      'preflight',
      'turn:Tôi muốn tự chọn món cho hai người.',
    ]);
    expect(executeTurn).toHaveBeenCalledTimes(1);
    expect(executeTurn).not.toHaveBeenCalledWith(
      expect.objectContaining({ text: scenario.turns[0].text }),
    );

    const runDirectory = join(root, 'artifacts', 'run-1');
    const manifest = JSON.parse(
      await readFile(join(runDirectory, 'manifest.json'), 'utf8'),
    ) as Record<string, unknown>;
    expect(manifest).toMatchObject({
      schemaVersion: 'kfc-live-scenario-manifest-v1',
      runId: 'run-1',
      attempt: 1,
      status: 'completed',
      correlation: {
        externalSessionId: 'live-run-1',
        durableSessionId: 'live-run-1',
        scenarioId: scenario.id,
        probeRunId: 'run-1',
      },
      scenario: {
        id: scenario.id,
        goal: scenario.goal,
        preconditions: scenario.preconditions,
        risks: scenario.risks,
      },
      model: identity,
    });
    expect(manifest).toHaveProperty('scenario.sourceSha256');
    for (const fileName of [
      'preflight.json',
      'trace.jsonl',
      'transcript.md',
      'codex-review-packet.md',
    ]) {
      expect(
        (
          manifest.evidence as {
            artifactSha256: Record<string, string>;
          }
        ).artifactSha256[fileName],
      ).toBe(
        createHash('sha256')
          .update(await readFile(join(runDirectory, fileName)))
          .digest('hex'),
      );
    }

    const trace = (await readFile(join(runDirectory, 'trace.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(trace.map(({ type }) => type)).toEqual([
      'session_started',
      'preflight_completed',
      'user_message',
      'tool_started',
      'tool_completed',
      'assistant_message',
      'session_finished',
    ]);
    expect(trace[4]).toMatchObject({
      toolName: 'searchMenu',
      arguments: { queries: ['gà'] },
      rawResult: { ok: true, items: [{ itemCode: '150078' }] },
      modelFacingResult: {
        ok: true,
        items: [{ itemCode: '150078' }],
      },
      executionDurationMs: 25,
    });

    const transcript = await readFile(
      join(runDirectory, 'transcript.md'),
      'utf8',
    );
    expect(transcript).toContain('Tôi muốn tự chọn món cho hai người.');
    expect(transcript).toContain('searchMenu');
    expect(transcript).toContain('150078');
    expect(transcript).not.toContain(scenario.turns[0].text);
    expect(
      await readFile(join(runDirectory, 'codex-review-packet.md'), 'utf8'),
    ).toContain(scenario.goal);
  });

  it('retains a failed preflight and refuses to start model turns', async () => {
    const { root, scenarioPath } = await fixture();
    const executeTurn = vi.fn<LiveScenarioTurnExecutor>();
    const session = await startLiveScenarioSession({
      artifactsRoot: join(root, 'artifacts'),
      runId: 'failed-preflight',
      attempt: 2,
      correlation: {
        externalSessionId: 'live-failed-preflight',
        durableSessionId: 'live-failed-preflight',
      },
      scenarioPath,
      identity,
      runPreflight: async () => ({
        schemaVersion: 'agent-model-capability-preflight-v1',
        identity,
        ordinaryInvocation: { passed: true },
        typedToolCall: { passed: false, failure: 'tool_call_missing' },
        passed: false,
      }),
      executeTurn,
      now: sequenceClock(),
    });

    await expect(session.submitUserMessage('Do not run')).rejects.toThrow(
      'live_scenario_preflight_failed',
    );
    expect(executeTurn).not.toHaveBeenCalled();

    const runDirectory = join(root, 'artifacts', 'failed-preflight');
    expect(
      JSON.parse(await readFile(join(runDirectory, 'manifest.json'), 'utf8')),
    ).toMatchObject({ status: 'preflight_failed', attempt: 2 });
    expect(
      JSON.parse(await readFile(join(runDirectory, 'preflight.json'), 'utf8')),
    ).toMatchObject({ passed: false });
  });

  it('redacts credentials and refuses to overwrite an existing run directory', async () => {
    const { root, scenarioPath } = await fixture();
    const input = {
      artifactsRoot: join(root, 'artifacts'),
      runId: 'collision',
      attempt: 1,
      correlation: {
        externalSessionId: 'live-collision',
        durableSessionId: 'live-collision',
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
      executeTurn: async ({
        recordToolEvent,
      }: Parameters<LiveScenarioTurnExecutor>[0]) => {
        await recordToolEvent({
          phase: 'failed' as const,
          callId: 'call-secret',
          toolName: 'searchMenu',
          arguments: {
            authorization: 'Bearer live-token',
            harmless: 'sk-test-1234567890',
          },
          error: new Error('request used sk-test-1234567890'),
          requestedAt: '2026-07-24T00:00:00.900Z',
          executionStartedAt: '2026-07-24T00:00:01.000Z',
          completedAt: '2026-07-24T00:00:01.025Z',
          totalDurationMs: 125,
          executionDurationMs: 25,
        });
        throw new Error('Authorization: Bearer live-token');
      },
      now: sequenceClock(),
    };
    const session = await startLiveScenarioSession(input);
    await expect(session.submitUserMessage('trigger')).rejects.toThrow();

    const trace = await readFile(
      join(root, 'artifacts', 'collision', 'trace.jsonl'),
      'utf8',
    );
    expect(trace).not.toContain('live-token');
    expect(trace).not.toContain('sk-test-1234567890');
    expect(trace).toContain('[REDACTED]');

    await expect(startLiveScenarioSession(input)).rejects.toThrow(
      'live_scenario_run_exists',
    );
  });
});

function sequenceClock(): () => Date {
  let tick = 0;
  return () => new Date(Date.UTC(2026, 6, 24, 0, 0, tick++));
}
