import {
  access,
  cp,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  installPvcfcCorpus,
  verifyPvcfcCorpus,
} from '../../scripts/pvcfc-corpus.js';

const corpusRoot = resolve(
  process.cwd(),
  'fixtures/business-packs/pvcfc-customer-service/pvcfc-public-web-2026-07-21',
);

describe('PVCFC production-like public corpus', () => {
  it('matches the captured manifest, every artifact hash, and the derived index', async () => {
    await expect(verifyPvcfcCorpus(corpusRoot)).resolves.toMatchObject({
      corpusId: 'pvcfc-public-web-2026-07-21',
      artifactCount: 24,
      totalBytes: 1_243_751,
      manifestSha256:
        '0311e71df1ce34e963723849a76026621f15013d313c05286b5c7ee8c657a28e',
      custody: {
        sourceKind: 'untracked_donor_worktree',
        donorCommit: null,
      },
    });

    const index = JSON.parse(
      await readFile(
        join(corpusRoot, 'derived/public-knowledge-index.json'),
        'utf8',
      ),
    ) as {
      schemaVersion: number;
      corpusId: string;
      capturedOn: string;
      documents: Array<{
        artifactPath: string;
        artifactSha256: string;
        contentSha256: string;
        sourceUrl: string;
      }>;
    };
    expect(index).toMatchObject({
      schemaVersion: 1,
      corpusId: 'pvcfc-public-web-2026-07-21',
      capturedOn: '2026-07-21',
    });
    expect(index.documents.length).toBeGreaterThan(0);
    expect(
      index.documents.every(
        (document) =>
          document.artifactPath.startsWith('raw/') &&
          /^[a-f0-9]{64}$/u.test(document.artifactSha256) &&
          /^[a-f0-9]{64}$/u.test(document.contentSha256) &&
          document.sourceUrl.startsWith('https://'),
      ),
    ).toBe(true);
  });

  it('refuses overwrite, in-place installation, and symbolic-link input', async () => {
    const scratch = await mkdtemp(join(tmpdir(), 'pvcfc-corpus-'));
    const source = join(scratch, 'source');
    const existingTarget = join(scratch, 'existing');
    await mkdir(source);
    await mkdir(existingTarget);

    await expect(
      installPvcfcCorpus({ source, target: existingTarget }),
    ).rejects.toThrow('pvcfc_corpus_target_exists');
    await expect(
      installPvcfcCorpus({ source, target: source }),
    ).rejects.toThrow('pvcfc_corpus_in_place_forbidden');

    const realFile = join(scratch, 'real.json');
    const linkedFile = join(source, 'linked.json');
    await writeFile(realFile, '{}');
    await symlink(realFile, linkedFile);
    await expect(
      installPvcfcCorpus({ source, target: join(scratch, 'new-target') }),
    ).rejects.toThrow('pvcfc_corpus_symlink_forbidden');
  });

  it('preflights hashes before atomically publishing a complete fresh install', async () => {
    const scratch = await mkdtemp(join(tmpdir(), 'pvcfc-install-'));
    const installed = join(scratch, 'installed');
    await installPvcfcCorpus({
      source: corpusRoot,
      target: installed,
      sourceLabel:
        '.claude/worktrees/wayfinder-pvcfc-multivendor/docs/wayfinder/pvcfc-multibusiness-chatbot/assets/pvcfc-crawl',
      importedOn: '2026-07-24',
    });
    await expect(verifyPvcfcCorpus(installed)).resolves.toMatchObject({
      artifactCount: 24,
      totalBytes: 1_243_751,
    });
    await expect(
      readFile(join(installed, '.ready.json'), 'utf8').then(JSON.parse),
    ).resolves.toMatchObject({
      status: 'ready',
      manifestSha256:
        '0311e71df1ce34e963723849a76026621f15013d313c05286b5c7ee8c657a28e',
    });

    const corruptSource = join(scratch, 'corrupt-source');
    const rejectedTarget = join(scratch, 'rejected');
    await mkdir(corruptSource);
    await writeFile(join(corruptSource, 'manifest.json'), '{}');
    await expect(
      installPvcfcCorpus({
        source: corruptSource,
        target: rejectedTarget,
        importedOn: '2026-07-24',
      }),
    ).rejects.toThrow('pvcfc_corpus_manifest_hash_mismatch');
    await expect(access(rejectedTarget)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('never replaces an empty target created while staging', async () => {
    const scratch = await mkdtemp(join(tmpdir(), 'pvcfc-race-'));
    const target = join(scratch, 'contended');
    const installation = installPvcfcCorpus({
      source: corpusRoot,
      target,
      importedOn: '2026-07-24',
    });
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const stagingStarted = (await readdir(scratch)).some((entry) =>
        entry.startsWith('.contended.tmp-'),
      );
      if (stagingStarted) break;
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    await mkdir(target);

    await expect(installation).rejects.toThrow('pvcfc_corpus_target_exists');
    expect(await readdir(target)).toEqual([]);
  });

  it('rejects unpublished, installing, and mismatched-ready corpus trees', async () => {
    const scratch = await mkdtemp(join(tmpdir(), 'pvcfc-readiness-'));

    const unpublished = join(scratch, 'unpublished');
    await cp(corpusRoot, unpublished, { recursive: true });
    await rm(join(unpublished, '.ready.json'));
    await expect(verifyPvcfcCorpus(unpublished)).rejects.toThrow(
      'pvcfc_corpus_not_ready',
    );

    const crashLeft = join(scratch, 'crash-left');
    await cp(corpusRoot, crashLeft, { recursive: true });
    await writeFile(
      join(crashLeft, '.installing.json'),
      '{"status":"installing","reservationToken":"crashed"}\n',
    );
    await expect(verifyPvcfcCorpus(crashLeft)).rejects.toThrow(
      'pvcfc_corpus_install_incomplete',
    );

    const mismatched = join(scratch, 'mismatched');
    await cp(corpusRoot, mismatched, { recursive: true });
    await writeFile(
      join(mismatched, '.ready.json'),
      '{"status":"ready","manifestSha256":"wrong"}\n',
    );
    await expect(verifyPvcfcCorpus(mismatched)).rejects.toThrow(
      'pvcfc_corpus_ready_mismatch',
    );
  });
});
