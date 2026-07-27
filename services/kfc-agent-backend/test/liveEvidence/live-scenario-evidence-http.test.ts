import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createLiveScenarioHttpClient } from '../../src/liveEvidence/liveScenarioHttpClient.js';
import { startLiveScenarioSession } from '../../src/liveEvidence/liveScenarioSession.js';
import {
  bridgeGitSha,
  completeLiveEnvironment,
  completeRecommendationD1,
  completeToolTraceEntry,
  sanitySnapshotDigest,
  serverTrace,
} from './live-scenario-test-evidence.js';

describe('live scenario evidence packet over HTTP', () => {
  it('assembles the final packet exclusively from chat and protected D1 HTTP responses', async () => {
    const root = await mkdtemp(join(tmpdir(), 'live-evidence-http-'));
    const scenarioPath = join(root, 'scenario.json');
    await writeFile(
      scenarioPath,
      `${JSON.stringify({
        id: 'http-evidence',
        title: 'HTTP evidence',
        channel: 'kfc',
        goal: 'Collect remote evidence.',
        preconditions: ['A fresh remote session exists.'],
        useCases: ['UC-TEST'],
        finalState: 'reviewed',
        turns: [
          {
            index: 1,
            speaker: 'User',
            text: 'Narrative only; never replay.',
            useCases: ['UC-TEST'],
          },
        ],
        risks: ['Remote evidence may be incomplete.'],
      })}\n`,
    );
    const remoteEvidence = completeRecommendationD1({
      sessionId: 'kfc:live-http-evidence',
      recommendationId: 'recommendation-http-1',
      orderFlowId: 'order-flow-http-1',
      traceRef: 'trace-http-1',
      toolTrace: [completeToolTraceEntry()],
    });
    remoteEvidence.recommendationInspection.technical.shadowComparison.modelRevision =
      'hf-http-revision';
    const fetchImpl = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const path = new URL(String(input)).pathname;
        if (path === '/ready') {
          return Response.json(completeLiveEnvironment());
        }
        if (path === '/admin/live-scenarios/chat/kfc/message') {
          expect(JSON.parse(String(init?.body))).toMatchObject({
            request: { text: 'Improvised remote turn.' },
            trace: {
              scenarioId: 'http-evidence',
              probeRunId: 'http-evidence',
            },
          });
          return Response.json({
            responseText: 'Remote assistant response.',
            assistantTurnId: 'assistant-http-1',
            liveScenarioTrace: serverTrace(
              'http-evidence',
              'http-evidence',
            ),
          });
        }
        if (path.endsWith('/envelope')) {
          return Response.json(remoteEvidence.proofEnvelope);
        }
        if (path.endsWith('/inspection')) {
          return Response.json(remoteEvidence.recommendationInspection);
        }
        if (path.endsWith('/state')) {
          return Response.json(remoteEvidence.orderFlowState);
        }
        return Response.json({ errorCode: 'not_found' }, { status: 404 });
      },
    );
    const session = await startLiveScenarioSession({
      artifactsRoot: join(root, 'artifacts'),
      runId: 'http-evidence',
      attempt: 1,
      correlation: {
        sessionId: 'kfc:live-http-evidence',
        customerId: 'live-http-evidence',
      },
      scenarioPath,
      expectedCandidateId: 'openai-gpt-4.1-mini',
      backendUrl: 'https://worker.example',
      source: { gitSha: bridgeGitSha, dirty: false },
      gateway: createLiveScenarioHttpClient({
        baseUrl: 'https://worker.example',
        adminToken: 'admin-secret-value',
        fetchImpl,
      }),
    });

    await session.submitUserMessage('Improvised remote turn.');
    await session.finish();
    await session.finalizeTerminal();

    const packet = JSON.parse(
      await readFile(
        join(session.runDirectory, 'evidence-packet.json'),
        'utf8',
      ),
    );
    expect(packet).toMatchObject({
      bindings: {
        langsmithCorrelation: {
          scenarioId: 'http-evidence',
          probeRunId: 'http-evidence',
        },
      },
      environment: {
        proof: {
          versions: {
            recommendationSanity: {
              snapshotDigest: sanitySnapshotDigest,
            },
          },
        },
      },
      d1: {
        proofEnvelope: {
          packState: {
            state: { toolTrace: [{ toolName: 'recommendStarter' }] },
          },
        },
        recommendationInspection: {
          technical: {
            shadowComparison: { modelRevision: 'hf-http-revision' },
          },
        },
        orderFlowState: {
          events: [{ eventType: 'decision_completed' }],
        },
      },
    });
  });
});
