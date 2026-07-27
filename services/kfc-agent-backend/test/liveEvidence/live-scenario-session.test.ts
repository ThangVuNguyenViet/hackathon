import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { LiveScenarioHttpClient } from '../../src/liveEvidence/liveScenarioHttpClient.js';
import { startLiveScenarioSession } from '../../src/liveEvidence/liveScenarioSession.js';

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

const environment = {
  release: {
    gitSha: 'deployed-service-commit',
    deploymentId: 'worker-deployment-1',
  },
  checks: {
    observability: {
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
      },
      recommendationShadow: {
        modelRevision: 'hf-revision-1',
        outputMode: 'baseline',
      },
      recommendationSanity: {
        configured: true,
        snapshotDigest: 'sanity-snapshot-1',
      },
    },
  },
};

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'live-scenario-http-'));
  const scenarioPath = join(root, 'scenario.json');
  await writeFile(scenarioPath, `${JSON.stringify(scenario)}\n`);
  return { root, scenarioPath };
}

describe('live scenario HTTP/D1 evidence session', () => {
  it('validates observed action references and writes a self-contained evidence packet', async () => {
    const { root, scenarioPath } = await fixture();
    const gateway: LiveScenarioHttpClient = {
      environment: vi.fn(async () => environment),
      submitUserMessage: vi.fn(async () => ({
        responseText: 'Mình có một gợi ý.',
        assistantTurnId: 'assistant-turn-1',
        genUi: {
          id: 'attachment-1',
          widgetKind: 'recommendationOffer',
          status: 'active',
          data: {
            recommendationId: 'recommendation-1',
            cartRevision: 'cart-revision-1',
            actionDigest: 'a'.repeat(64),
            decisionDigest: 'b'.repeat(64),
            offers: [{ recommendationActionId: 'action-1' }],
          },
          actions: [
            {
              id: 'recommendation_select:action-1',
              label: 'Thêm món',
            },
          ],
        },
      })),
      submitAction: vi.fn(async () => ({
        responseText: 'Đã thêm món.',
        assistantTurnId: 'assistant-turn-2',
      })),
      recordRecommendationImpression: vi.fn(async () => undefined),
      d1Evidence: vi.fn(async () => ({
        proofEnvelope: {
          complete: true,
          missing: [],
          packState: {
            state: {
              toolTrace: [
                {
                  toolName: 'getRecommendations',
                  result: { recommendationId: 'recommendation-1' },
                },
              ],
            },
          },
          recommendations: {
            correlations: {
              recommendationId: 'recommendation-1',
              orderFlowId: 'order-flow-1',
              traceRef: 'langsmith-trace-1',
            },
          },
        },
        recommendationInspection: {
          technical: {
            model: { revision: 'hf-revision-1' },
            sanity: { snapshotDigest: 'sanity-snapshot-1' },
          },
        },
        orderFlowState: {
          state: { stage: 'modifier_eligible' },
          events: [
            {
              eventType: 'decision_completed',
              payload: { traceRef: 'langsmith-trace-1' },
            },
            { eventType: 'selected' },
          ],
        },
      })),
    };
    const session = await startLiveScenarioSession({
      artifactsRoot: join(root, 'artifacts'),
      runId: 'run-1',
      attempt: 1,
      correlation: {
        sessionId: 'kfc:live-run-1',
        customerId: 'live-run-1',
      },
      scenarioPath,
      expectedCandidateId: 'openai-gpt-4.1-mini',
      backendUrl: 'https://worker.example',
      source: { gitSha: 'bridge-source-commit', dirty: false },
      gateway,
      now: sequenceClock(),
    });

    const firstObservation = await session.submitUserMessage(
      '  Tôi muốn xem món phù hợp.  ',
    );
    await session.recordAssistantRendered(firstObservation);
    await session.recordAssistantRendered(firstObservation);
    await expect(
      session.submitAction({
        assistantTurnId: 'assistant-turn-wrong',
        attachmentId: 'attachment-1',
        actionId: 'recommendation_select:action-1',
      }),
    ).rejects.toThrow('live_scenario_action_not_observed');
    expect(gateway.submitAction).not.toHaveBeenCalled();
    await session.submitAction({
      assistantTurnId: 'assistant-turn-1',
      attachmentId: 'attachment-1',
      actionId: 'recommendation_select:action-1',
    });
    await session.finish('Role-player completed the improvised flow.');

    expect(gateway.submitUserMessage).toHaveBeenCalledWith({
      sessionId: 'kfc:live-run-1',
      customerId: 'live-run-1',
      clientMessageId: 'run-1:user:1',
      text: '  Tôi muốn xem món phù hợp.  ',
      metadata: {
        liveScenarioRunId: 'run-1',
        liveScenarioAttempt: 1,
        liveScenarioId: scenario.id,
      },
      trace: {
        scenarioId: scenario.id,
        probeRunId: 'run-1',
      },
    });
    expect(gateway.submitAction).toHaveBeenCalledWith({
      sessionId: 'kfc:live-run-1',
      customerId: 'live-run-1',
      clientMessageId: 'run-1:action:2',
      assistantTurnId: 'assistant-turn-1',
      attachmentId: 'attachment-1',
      actionId: 'recommendation_select:action-1',
      trace: {
        scenarioId: scenario.id,
        probeRunId: 'run-1',
      },
    });
    expect(gateway.d1Evidence).toHaveBeenCalledWith('kfc:live-run-1');
    expect(gateway.recordRecommendationImpression).toHaveBeenCalledTimes(1);
    expect(gateway.recordRecommendationImpression).toHaveBeenCalledWith({
      recommendationId: 'recommendation-1',
      body: {
        schemaVersion: 'kfc-recommendation-event-v1',
        eventId: 'impression:attachment-1',
        occurredAt: '2026-07-28T00:00:04.000Z',
        assistantTurnId: 'assistant-turn-1',
        attachmentId: 'attachment-1',
        renderedActions: [{ actionId: 'action-1', position: 1 }],
        cartRevision: 'cart-revision-1',
        actionDigest: 'a'.repeat(64),
      },
    });

    const runDirectory = join(root, 'artifacts', 'run-1');
    const packet = JSON.parse(
      await readFile(join(runDirectory, 'evidence-packet.json'), 'utf8'),
    ) as Record<string, unknown>;
    expect(packet).toMatchObject({
      schemaVersion: 'kfc-live-scenario-evidence-packet-v1',
      source: {
        bridge: { gitSha: 'bridge-source-commit', dirty: false },
        service: {
          gitSha: 'deployed-service-commit',
          deploymentId: 'worker-deployment-1',
        },
      },
      environment,
      d1: {
        proofEnvelope: {
          packState: {
            state: {
              toolTrace: [{ toolName: 'getRecommendations' }],
            },
          },
        },
        orderFlowState: {
          events: [
            { eventType: 'decision_completed' },
            { eventType: 'selected' },
          ],
        },
      },
    });
    expect(JSON.stringify(packet)).toContain(
      'recommendation_select:action-1',
    );
    expect(JSON.stringify(packet)).toContain('langsmith-trace-1');
    expect(JSON.stringify(packet)).toContain('sanity-snapshot-1');
    expect(JSON.stringify(packet)).toContain(
      '  Tôi muốn xem món phù hợp.  ',
    );

    const manifest = JSON.parse(
      await readFile(join(runDirectory, 'manifest.json'), 'utf8'),
    ) as {
      status: string;
      evidence: { artifactSha256: Record<string, string> };
    };
    expect(manifest.status).toBe('completed');
    for (const fileName of [
      'environment.json',
      'trace.jsonl',
      'transcript.md',
      'evidence-packet.json',
      'codex-review-packet.md',
    ]) {
      expect(manifest.evidence.artifactSha256[fileName]).toBe(
        createHash('sha256')
          .update(await readFile(join(runDirectory, fileName)))
          .digest('hex'),
      );
    }
    const transcript = await readFile(
      join(runDirectory, 'transcript.md'),
      'utf8',
    );
    expect(transcript).toContain('  Tôi muốn xem món phù hợp.  ');
    expect(transcript).toContain('recommendation_select:action-1');
    expect(transcript).not.toContain(scenario.turns[0].text);
  });

  it('redacts configured credentials from protected evidence artifacts', async () => {
    const { root, scenarioPath } = await fixture();
    const credential = 'admin-secret-value';
    const gateway: LiveScenarioHttpClient = {
      environment: vi.fn(async () => environment),
      submitUserMessage: vi.fn(async () => ({
        responseText: 'Safe response',
        assistantTurnId: 'assistant-turn-1',
      })),
      submitAction: vi.fn(),
      recordRecommendationImpression: vi.fn(),
      d1Evidence: vi.fn(async () => ({
        proofEnvelope: {
          complete: true,
          missing: [],
          diagnostic: `Authorization: Bearer ${credential}`,
          apiKey: credential,
        },
      })),
    };
    const session = await startLiveScenarioSession({
      artifactsRoot: join(root, 'artifacts'),
      runId: 'redacted',
      attempt: 1,
      correlation: {
        sessionId: 'kfc:live-redacted',
        customerId: 'live-redacted',
      },
      scenarioPath,
      expectedCandidateId: 'openai-gpt-4.1-mini',
      backendUrl: 'https://worker.example',
      source: { gitSha: 'bridge-source-commit', dirty: true },
      configuredSecrets: [credential],
      gateway,
      now: sequenceClock(),
    });

    await session.submitUserMessage('Narrative prose remains.');
    await session.finish();

    const directory = join(root, 'artifacts', 'redacted');
    for (const fileName of [
      'environment.json',
      'trace.jsonl',
      'transcript.md',
      'evidence-packet.json',
      'codex-review-packet.md',
      'manifest.json',
    ]) {
      const contents = await readFile(join(directory, fileName), 'utf8');
      expect(contents).not.toContain(credential);
    }
    expect(
      await readFile(join(directory, 'transcript.md'), 'utf8'),
    ).toContain('Narrative prose remains.');
  });
});

function sequenceClock(): () => Date {
  let tick = 0;
  return () => new Date(Date.UTC(2026, 6, 28, 0, 0, tick++));
}
