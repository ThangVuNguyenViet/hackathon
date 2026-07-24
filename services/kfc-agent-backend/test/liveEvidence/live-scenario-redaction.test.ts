import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { startLiveScenarioSession } from '../../src/liveEvidence/liveScenarioSession.js';

describe('live scenario artifact redaction', () => {
  it('redacts configured values and common assignment/header forms from every artifact', async () => {
    const root = await mkdtemp(join(tmpdir(), 'redaction-evidence-'));
    const scenarioPath = join(root, 'scenario.json');
    await writeFile(
      scenarioPath,
      `${JSON.stringify({
        id: 'redaction-evidence',
        title: 'Redaction evidence',
        channel: 'kfc',
        goal: 'Keep local evidence credential-free.',
        preconditions: ['Synthetic data only.'],
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
        risks: ['Credentials must not persist.'],
      })}\n`,
    );
    const configuredSecret = [
      'configured',
      'credential',
      String(Date.now()),
    ].join('-');
    const assignmentSecret = [
      'assignment',
      'credential',
      String(Date.now()),
    ].join('-');
    const headerSecret = ['header', 'credential', String(Date.now())].join('-');
    const identity = {
      candidateId: 'deepseek-v4-flash',
      provider: 'opencode',
      model: 'deepseek-v4-flash',
      profile: 'opencode:deepseek-v4-flash:chat-completions',
      transport: 'openai_compatible_chat',
    } as const;
    const session = await startLiveScenarioSession({
      artifactsRoot: join(root, 'artifacts'),
      runId: 'redaction',
      attempt: 1,
      correlation: {
        externalSessionId: 'live-redaction',
        durableSessionId: 'live-redaction',
      },
      scenarioPath,
      identity,
      configuredSecrets: [configuredSecret],
      runPreflight: async () => ({
        schemaVersion: 'agent-model-capability-preflight-v1',
        identity,
        ordinaryInvocation: { passed: true },
        typedToolCall: { passed: true },
        passed: true,
      }),
      executeTurn: async ({ recordToolEvent }) => {
        await recordToolEvent({
          phase: 'started',
          callId: 'redaction-call',
          toolName: 'searchMenu',
          arguments: {
            note: `password=${assignmentSecret}`,
            header: `X-Api-Key: ${headerSecret}`,
          },
          requestedAt: '2026-07-24T00:00:00.000Z',
        });
        await recordToolEvent({
          phase: 'completed',
          callId: 'redaction-call',
          toolName: 'searchMenu',
          arguments: { note: configuredSecret },
          rawResult: {
            ok: false,
            message: `META_PAGE_ACCESS_TOKEN=${assignmentSecret}`,
          },
          modelFacingResult: `Authorization: Bearer ${configuredSecret}`,
          executionStartedAt: '2026-07-24T00:00:01.000Z',
          completedAt: '2026-07-24T00:00:01.010Z',
          executionDurationMs: 10,
        });
        return {
          responseText: `api_key=${assignmentSecret}; ${configuredSecret}`,
        };
      },
    });

    await session.submitUserMessage(
      `access_token=${assignmentSecret}; X-Meta-Token: ${headerSecret}`,
    );
    await session.finish(`password: ${configuredSecret}`);

    const artifacts: string[] = [];
    for (const fileName of [
      'manifest.json',
      'preflight.json',
      'trace.jsonl',
      'transcript.md',
      'codex-review-packet.md',
    ]) {
      const artifact = await readFile(
        join(session.runDirectory, fileName),
        'utf8',
      );
      artifacts.push(artifact);
      expect(artifact.includes(configuredSecret), fileName).toBe(false);
      expect(artifact.includes(assignmentSecret), fileName).toBe(false);
      expect(artifact.includes(headerSecret), fileName).toBe(false);
    }
    expect(artifacts.join('\n')).toContain('[REDACTED]');
  });
});
