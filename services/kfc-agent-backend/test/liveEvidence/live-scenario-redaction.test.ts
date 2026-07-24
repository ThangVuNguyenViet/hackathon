import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createEvidenceSanitizer,
  serializeEvidenceJsonLine,
} from '../../src/liveEvidence/evidenceRedaction.js';
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
    const basicCredential = Buffer.from(
      `customer:${String(Date.now())}`,
    ).toString('base64');
    const cookieCredential = [
      'session',
      'credential',
      String(Date.now()),
    ].join('-');
    const genericSecret = [
      'generic',
      'credential',
      String(Date.now()),
    ].join('-');
    const clientSecret = [
      'client',
      'credential',
      String(Date.now()),
    ].join('-');
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
            authorization: `Authorization: Basic ${basicCredential}`,
            cookie: `Cookie: session=${cookieCredential}; theme=dark`,
            setCookie: `Set-Cookie: sid=${cookieCredential}; HttpOnly`,
            genericAssignments: `secret=${genericSecret}; client_secret="${clientSecret}"`,
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
      expect(artifact.includes(basicCredential), fileName).toBe(false);
      expect(artifact.includes(cookieCredential), fileName).toBe(false);
      expect(artifact.includes(genericSecret), fileName).toBe(false);
      expect(artifact.includes(clientSecret), fileName).toBe(false);
    }
    expect(artifacts.join('\n')).toContain('[REDACTED]');
  });

  it('sanitizes every field in a JSON output envelope while retaining nonsecret metadata', () => {
    const configuredSecret = `configured-${String(Date.now())}`;
    const secretShapedRunId = `sk-${'r'.repeat(24)}`;
    const sanitize = createEvidenceSanitizer([configuredSecret]);
    const line = serializeEvidenceJsonLine(
      {
        type: 'session_ready',
        runId: secretShapedRunId,
        attempt: 7,
        runDirectory: `/tmp/${configuredSecret}/${secretShapedRunId}`,
        protocol: {
          finish: { type: 'finish', note: '<optional reviewer note>' },
        },
      },
      sanitize,
    );

    expect(line).not.toContain(configuredSecret);
    expect(line).not.toContain(secretShapedRunId);
    expect(JSON.parse(line)).toEqual({
      type: 'session_ready',
      runId: '[REDACTED]',
      attempt: 7,
      runDirectory: '/tmp/[REDACTED]/[REDACTED]',
      protocol: {
        finish: { type: 'finish', note: '<optional reviewer note>' },
      },
    });

    expect(
      sanitize(
        [
          'Authorization: Basic dXNlcjpwYXNzd29yZA==',
          'Cookie: session=private-cookie; theme=dark',
          'Set-Cookie: sid=private-cookie; HttpOnly',
          'secret=private-generic',
          'client_secret="private-client"',
          'status=useful',
        ].join('\n'),
      ),
    ).toBe(
      [
        'Authorization: [REDACTED]',
        'Cookie: [REDACTED]',
        'Set-Cookie: [REDACTED]',
        'secret=[REDACTED]',
        'client_secret=[REDACTED]',
        'status=useful',
      ].join('\n'),
    );
  });
});
