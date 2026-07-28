import { describe, expect, it } from 'vitest';
import {
  probeShadowService,
  runLangSmithNoModelProbe,
  validateBackendQualificationEnvironment,
} from '../../src/qualification/externalQualification.js';

describe('external recommendation qualification probes', () => {
  it('probes MLflow health and matches every prediction to the submitted action', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const result = await probeShadowService({
      baseUrl: 'https://qualified-space.example.test',
      modelRevision: 'a'.repeat(40),
      probeRequest: {
        dataframe_records: [
          {
            placement: 'smart_cross_sell',
            action_id: 'item:41173',
            eligible: true,
          },
          {
            placement: 'modifier_upsell',
            action_id: 'modifier:20691:2:41056',
            eligible: true,
          },
        ],
      },
      fetcher: async (url, init) => {
        requests.push({ url: String(url), init });
        if (String(url).endsWith('/health')) {
          return new Response('', { status: 200 });
        }
        return Response.json({
          predictions: [
            {
              action_id: 'item:41173',
              calibrated_probability: 0.1,
              expected_value_score: 1000,
              model_artifact_id: 'smart-model',
              calibration_id: 'smart-calibration',
              feature_schema: 'smart-schema',
            },
            {
              action_id: 'modifier:20691:2:41056',
              calibrated_probability: 0.2,
              expected_value_score: 2000,
              model_artifact_id: 'modifier-model',
              calibration_id: 'modifier-calibration',
              feature_schema: 'modifier-schema',
            },
          ],
        });
      },
    });

    expect(requests.map(({ url }) => url)).toEqual([
      'https://qualified-space.example.test/health',
      'https://qualified-space.example.test/invocations',
    ]);
    expect(requests[1]?.init?.method).toBe('POST');
    expect(result).toEqual({
      ok: true,
      serviceUrl: 'https://qualified-space.example.test',
      modelRevision: 'a'.repeat(40),
      rowCount: 2,
      actionIds: ['item:41173', 'modifier:20691:2:41056'],
      modelArtifactIds: ['smart-model', 'modifier-model'],
      calibrationIds: ['smart-calibration', 'modifier-calibration'],
      featureSchemas: ['smart-schema', 'modifier-schema'],
    });
  });

  it('rejects an invocation response that is reordered or incomplete', async () => {
    await expect(
      probeShadowService({
        baseUrl: 'https://qualified-space.example.test',
        modelRevision: 'a'.repeat(40),
        probeRequest: {
          dataframe_records: [
            { placement: 'smart_cross_sell', action_id: 'item:41173' },
          ],
        },
        fetcher: async (url) =>
          String(url).endsWith('/health')
            ? new Response('', { status: 200 })
            : Response.json({
                predictions: [{ action_id: 'wrong-action' }],
              }),
      }),
    ).rejects.toThrow('prediction action mismatch');
  });

  it('validates callback-reported source, baseline, Sanity, and LangSmith bindings', () => {
    const result = validateBackendQualificationEnvironment(
      {
        ok: true,
        release: {
          gitSha: 'b'.repeat(40),
          deploymentId: 'deployment-1',
          releaseBuiltAt: '2026-07-28T00:00:00Z',
          dirty: false,
        },
        checks: {
          agent: {
            configured: true,
            candidateId: 'openai-gpt-4.1-mini',
          },
          observability: {
            ok: true,
            langsmith: {
              configured: true,
              project: 'kfc-qualification',
              endpoint: 'https://apac.api.smith.langchain.com',
              samplingRate: 1,
            },
          },
          recommendationShadow: {
            ok: true,
            required: false,
            configured: true,
            runtimeProfile: 'local_docker_cloudflare_tunnel',
            outputMode: 'baseline',
          },
          recommendationSanity: {
            ok: true,
            required: true,
            configured: true,
            authority: 'sanity',
            reachable: true,
            policyCount: 5,
            snapshotDigest: 'c'.repeat(64),
          },
        },
        proof: {
          versions: {
            agent: {
              candidateId: 'openai-gpt-4.1-mini',
              provider: 'openai',
              model: 'gpt-4.1-mini',
              profile: 'openai-responses',
              transport: 'responses',
            },
          },
        },
      },
      { expectedSourceCommit: 'b'.repeat(40) },
    );

    expect(result).toEqual({
      ok: true,
      sourceCommit: 'b'.repeat(40),
      deploymentId: 'deployment-1',
      agentCandidate: 'openai-gpt-4.1-mini',
      shadowRuntimeProfile: 'local_docker_cloudflare_tunnel',
      sanitySnapshotDigest: 'c'.repeat(64),
      langsmithProject: 'kfc-qualification',
    });
  });

  it('ingests and reads one no-model LangSmith tool run', async () => {
    const stored = new Map<string, Record<string, unknown>>();
    const client = {
      async createRun(run: Record<string, unknown>) {
        stored.set(String(run.id), structuredClone(run));
      },
      async readRun(runId: string) {
        const run = stored.get(runId);
        if (!run) throw new Error('missing');
        return { ...run, id: runId };
      },
    };

    const result = await runLangSmithNoModelProbe(client, {
      projectName: 'kfc-qualification',
      runId: '018f4d33-3a30-7b82-b7d2-a5c273640000',
      now: () => new Date('2026-07-28T00:00:00.000Z'),
    });

    expect(result).toEqual({
      ok: true,
      projectName: 'kfc-qualification',
      runId: '018f4d33-3a30-7b82-b7d2-a5c273640000',
      runName: 'kfc.recommendation.qualification.no_model_probe',
      runType: 'tool',
      queryable: true,
    });
  });
});
