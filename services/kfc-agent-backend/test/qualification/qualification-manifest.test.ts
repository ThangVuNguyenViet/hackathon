import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildQualificationManifest } from '../../src/qualification/qualificationManifest.js';

describe('qualification manifest', () => {
  it('pins evidence bytes and preserves the independent verdict citations', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'kfc-qualification-'));
    const evidence = resolve(root, 's1-evidence');
    await mkdir(evidence);
    await writeFile(resolve(evidence, 'evidence-packet.json'), 'evidence\n');
    await writeFile(resolve(evidence, 'codex-review-packet.md'), 'review\n');
    const evaluationPath = resolve(root, 's1-evaluation.json');
    await writeFile(
      evaluationPath,
      JSON.stringify({
        schemaVersion: 'kfc-recommendation-independent-evaluation-v1',
        scenarioId: 's1',
        verdict: 'successful',
        evaluatorTaskId: 'controller-owned-evaluator-s1',
        evidencePacketSha256:
          'bdcf4c994585af6dd6cb1cfbff78bcc73ab27dc30a299db5bb83766ca05b5de4',
        citations: [
          {
            artifact: 'evidence-packet.json',
            pointer: '$.timeline[2]',
            note: 'The observed action is bound to the rendered offer.',
          },
        ],
        concerns: [],
      }),
    );

    const manifest = await buildQualificationManifest({
      sourceCommit: 'a'.repeat(40),
      expectedScenarioIds: ['s1'],
      requiredEvidenceFiles: [
        'evidence-packet.json',
        'codex-review-packet.md',
      ],
      publicProvenancePath: resolve(root, 'public-provenance.json'),
      externalProbePath: resolve(root, 'external-probe.json'),
      langsmithProbePath: resolve(root, 'langsmith-probe.json'),
      scenarios: [
        {
          scenarioId: 's1',
          narrativeSha256: 'b'.repeat(64),
          evidenceDirectory: evidence,
          evaluationPath,
        },
      ],
      readGlobalFile: async (path) => {
        if (path.endsWith('public-provenance.json')) {
          return Buffer.from('provenance\n');
        }
        if (path.endsWith('external-probe.json')) {
          return Buffer.from('external\n');
        }
        return Buffer.from('langsmith\n');
      },
    });

    expect(manifest.scenarios[0]).toMatchObject({
      scenarioId: 's1',
      verdict: 'successful',
      evaluatorTaskId: 'controller-owned-evaluator-s1',
      evidencePacketSha256:
        'bdcf4c994585af6dd6cb1cfbff78bcc73ab27dc30a299db5bb83766ca05b5de4',
      citations: [
        {
          artifact: 'evidence-packet.json',
          pointer: '$.timeline[2]',
          note: 'The observed action is bound to the rendered offer.',
        },
      ],
    });
    expect(manifest.scenarios[0]?.artifacts).toEqual([
      {
        path: 'codex-review-packet.md',
        sha256:
          '452b7b642e325cb2b5b20ac28536ada8b0ad312217a98ab7ff23330603b63126',
        sizeBytes: 7,
      },
      {
        path: 'evidence-packet.json',
        sha256:
          'bdcf4c994585af6dd6cb1cfbff78bcc73ab27dc30a299db5bb83766ca05b5de4',
        sizeBytes: 9,
      },
    ]);
    expect(manifest.contentDigest).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('rejects an evaluator verdict that cites different evidence bytes', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'kfc-qualification-'));
    const evidence = resolve(root, 'evidence');
    await mkdir(evidence);
    await writeFile(resolve(evidence, 'evidence-packet.json'), 'evidence\n');
    const evaluationPath = resolve(root, 'evaluation.json');
    await writeFile(
      evaluationPath,
      JSON.stringify({
        schemaVersion: 'kfc-recommendation-independent-evaluation-v1',
        scenarioId: 's1',
        verdict: 'partial',
        evaluatorTaskId: 'evaluator-s1',
        evidencePacketSha256: 'f'.repeat(64),
        citations: [
          {
            artifact: 'evidence-packet.json',
            pointer: '$.timeline',
            note: 'Incomplete customer-visible evidence.',
          },
        ],
        concerns: ['The final action was not observed.'],
      }),
    );

    await expect(
      buildQualificationManifest({
        sourceCommit: 'a'.repeat(40),
        expectedScenarioIds: ['s1'],
        requiredEvidenceFiles: ['evidence-packet.json'],
        publicProvenancePath: resolve(root, 'public.json'),
        externalProbePath: resolve(root, 'external.json'),
        langsmithProbePath: resolve(root, 'langsmith.json'),
        scenarios: [
          {
            scenarioId: 's1',
            narrativeSha256: 'b'.repeat(64),
            evidenceDirectory: evidence,
            evaluationPath,
          },
        ],
        readGlobalFile: async () => Buffer.from('global\n'),
      }),
    ).rejects.toThrow('evidence packet digest mismatch');
  });
});
