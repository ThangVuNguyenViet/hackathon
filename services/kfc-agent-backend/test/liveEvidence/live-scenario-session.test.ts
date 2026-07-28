import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { LiveScenarioHttpClient } from '../../src/liveEvidence/liveScenarioHttpClient.js';
import { startLiveScenarioSession } from '../../src/liveEvidence/liveScenarioSession.js';
import {
  bridgeGitSha,
  completeLiveEnvironment,
  completeNoRecommendationProof,
  completeRecommendationD1,
  completeToolTraceEntry,
  deployedGitSha,
  sanitySnapshotDigest,
  serverTrace,
} from './live-scenario-test-evidence.js';

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

const environment = completeLiveEnvironment();

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'live-scenario-http-'));
  const scenarioPath = join(root, 'scenario.json');
  await writeFile(scenarioPath, `${JSON.stringify(scenario)}\n`);
  return { root, scenarioPath };
}

describe('live scenario HTTP/D1 evidence session', () => {
  it('forwards an exact rendered menu payload without choosing or inferring selections', async () => {
    const { root, scenarioPath } = await fixture();
    const offeredPayload = {
      items: [{ itemCode: '41173', quantity: 2 }],
    };
    const gateway: LiveScenarioHttpClient = {
      environment: vi.fn(async () => environment),
      submitUserMessage: vi.fn(async () => ({
        responseText: 'Bạn chọn món nhé.',
        assistantTurnId: 'assistant-menu-1',
        liveScenarioTrace: serverTrace(scenario.id, 'menu-payload'),
        genUi: {
          id: 'attachment-menu-1',
          widgetKind: 'smartMenuPicker',
          status: 'active',
          data: {
            items: [
              { code: '41173', name: 'Xô Zui Zẻ 139K', available: true },
              { code: '41174', name: 'Xô Zòn Zã 179K', available: true },
            ],
          },
          actions: [{ id: 'add_items', label: 'Xác nhận món' }],
        },
      })),
      submitAction: vi.fn(async () => ({
        responseText: 'Đã thêm món.',
        assistantTurnId: 'assistant-menu-2',
        liveScenarioTrace: serverTrace(scenario.id, 'menu-payload'),
      })),
      recordRecommendationImpression: vi.fn(async () => undefined),
      d1Evidence: vi.fn(async () => ({
        proofEnvelope: completeNoRecommendationProof(
          'kfc:menu-payload-customer',
          [],
        ),
      })),
    };
    const session = await startLiveScenarioSession({
      artifactsRoot: join(root, 'artifacts'),
      runId: 'menu-payload',
      attempt: 1,
      correlation: {
        sessionId: 'kfc:menu-payload-customer',
        customerId: 'menu-payload-customer',
      },
      scenarioPath,
      expectedCandidateId: 'openai-gpt-4.1-mini',
      backendUrl: 'https://worker.example',
      source: { gitSha: bridgeGitSha, dirty: false },
      gateway,
      now: sequenceClock(),
    });

    await session.submitUserMessage('Cho mình xem món.');
    await session.submitAction({
      assistantTurnId: 'assistant-menu-1',
      attachmentId: 'attachment-menu-1',
      actionId: 'add_items',
      payload: offeredPayload,
    });

    expect(gateway.submitAction).toHaveBeenCalledWith(
      expect.objectContaining({ payload: offeredPayload }),
    );
  });

  it('rejects a missing or mismatched generic-widget payload before HTTP forwarding', async () => {
    const { root, scenarioPath } = await fixture();
    const gateway: LiveScenarioHttpClient = {
      environment: vi.fn(async () => environment),
      submitUserMessage: vi.fn(async () => ({
        responseText: 'Bạn chọn món nhé.',
        assistantTurnId: 'assistant-menu-1',
        liveScenarioTrace: serverTrace(scenario.id, 'menu-rejection'),
        genUi: {
          id: 'attachment-menu-1',
          widgetKind: 'smartMenuPicker',
          status: 'active',
          data: {
            items: [{ code: '41173', name: 'Xô Zui Zẻ 139K', available: true }],
          },
          actions: [{ id: 'add_items', label: 'Xác nhận món' }],
        },
      })),
      submitAction: vi.fn(),
      recordRecommendationImpression: vi.fn(async () => undefined),
      d1Evidence: vi.fn(async () => ({
        proofEnvelope: completeNoRecommendationProof(
          'kfc:menu-rejection-customer',
          [],
        ),
      })),
    };
    const session = await startLiveScenarioSession({
      artifactsRoot: join(root, 'artifacts'),
      runId: 'menu-rejection',
      attempt: 1,
      correlation: {
        sessionId: 'kfc:menu-rejection-customer',
        customerId: 'menu-rejection-customer',
      },
      scenarioPath,
      expectedCandidateId: 'openai-gpt-4.1-mini',
      backendUrl: 'https://worker.example',
      source: { gitSha: bridgeGitSha, dirty: false },
      gateway,
      now: sequenceClock(),
    });

    await session.submitUserMessage('Cho mình xem món.');
    await expect(
      session.submitAction({
        assistantTurnId: 'assistant-menu-1',
        attachmentId: 'attachment-menu-1',
        actionId: 'add_items',
      }),
    ).rejects.toThrow('live_scenario_action_payload_invalid');
    await expect(
      session.submitAction({
        assistantTurnId: 'assistant-menu-1',
        attachmentId: 'attachment-menu-1',
        actionId: 'add_items',
        payload: {
          items: [{ itemCode: 'not-rendered', quantity: 1 }],
        },
      }),
    ).rejects.toThrow('live_scenario_action_payload_invalid');

    expect(gateway.submitAction).not.toHaveBeenCalled();
  });

  it('validates observed action references and writes a self-contained evidence packet', async () => {
    const { root, scenarioPath } = await fixture();
    const gateway: LiveScenarioHttpClient = {
      environment: vi.fn(async () => environment),
      submitUserMessage: vi.fn(async () => ({
        responseText: 'Mình có một gợi ý.',
        assistantTurnId: 'assistant-turn-1',
        liveScenarioTrace: serverTrace(scenario.id, 'run-1'),
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
        liveScenarioTrace: serverTrace(scenario.id, 'run-1'),
      })),
      recordRecommendationImpression: vi.fn(async () => undefined),
      d1Evidence: vi.fn(async () => {
        const evidence = completeRecommendationD1({
          sessionId: 'kfc:live-run-1',
          recommendationId: 'recommendation-1',
          orderFlowId: 'order-flow-1',
          traceRef: 'langsmith-trace-1',
          toolTrace: [
            {
              ...completeToolTraceEntry(),
              result: { recommendationId: 'recommendation-1' },
            },
          ],
        });
        evidence.orderFlowState.events.push({
          eventType: 'selected',
          recommendationId: 'recommendation-1',
          requestId: 'request-1',
        });
        return evidence;
      }),
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
      source: { gitSha: bridgeGitSha, dirty: false },
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
    await session.commitFinish();
    await session.finalizeTerminal();

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
        bridge: { gitSha: bridgeGitSha, dirty: false },
        service: {
          gitSha: deployedGitSha,
          deploymentId: 'worker-deployment-1',
        },
      },
      environment,
      d1: {
        proofEnvelope: {
          packState: {
            state: {
              toolTrace: [{ toolName: 'recommendStarter' }],
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
    expect(JSON.stringify(packet)).toContain(sanitySnapshotDigest);
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
        liveScenarioTrace: serverTrace(scenario.id, 'redacted'),
      })),
      submitAction: vi.fn(),
      recordRecommendationImpression: vi.fn(),
      d1Evidence: vi.fn(async () => ({
        proofEnvelope: {
          ...completeNoRecommendationProof('kfc:live-redacted'),
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
      source: { gitSha: bridgeGitSha, dirty: true },
      configuredSecrets: [credential],
      gateway,
      now: sequenceClock(),
    });

    await session.submitUserMessage('Narrative prose remains.');
    await session.finish();
    await session.commitFinish();
    await session.finalizeTerminal();

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

  it('fails completion when the deployed source commit is missing', async () => {
    const { root, scenarioPath } = await fixture();
    const environmentWithoutSource = structuredClone(environment);
    delete (environmentWithoutSource.release as { gitSha?: string }).gitSha;
    const gateway: LiveScenarioHttpClient = {
      environment: vi.fn(async () => environmentWithoutSource),
      submitUserMessage: vi.fn(async () => ({
        responseText: 'Safe response',
        assistantTurnId: 'assistant-turn-1',
        liveScenarioTrace: serverTrace(
          scenario.id,
          'missing-service-source',
        ),
      })),
      submitAction: vi.fn(),
      recordRecommendationImpression: vi.fn(),
      d1Evidence: vi.fn(async () => ({
        proofEnvelope: completeNoRecommendationProof(
          'kfc:live-missing-service-source',
        ),
      })),
    };
    const session = await startLiveScenarioSession({
      artifactsRoot: join(root, 'artifacts'),
      runId: 'missing-service-source',
      attempt: 1,
      correlation: {
        sessionId: 'kfc:live-missing-service-source',
        customerId: 'live-missing-service-source',
      },
      scenarioPath,
      expectedCandidateId: 'openai-gpt-4.1-mini',
      backendUrl: 'https://worker.example',
      source: { gitSha: 'a'.repeat(40), dirty: false },
      gateway,
    });
    await session.submitUserMessage('Complete this attempt.');

    await expect(session.finish()).rejects.toThrow(
      'live_scenario_evidence_incomplete',
    );
  });
});

function sequenceClock(): () => Date {
  let tick = 0;
  return () => new Date(Date.UTC(2026, 6, 28, 0, 0, tick++));
}
