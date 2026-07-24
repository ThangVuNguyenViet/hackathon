import {
  cp,
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXPECTED_MANIFEST_SHA256 =
  '0311e71df1ce34e963723849a76026621f15013d313c05286b5c7ee8c657a28e';

interface CorpusArtifact {
  path: string;
  bytes: number;
  sha256: string;
  source_url?: string;
}

interface CorpusManifest {
  corpus_id: string;
  capture_date: string;
  coverage: {
    artifact_count: number;
    first_party_hosts: string[];
  };
  artifacts: CorpusArtifact[];
}

interface CorpusCustody {
  source_kind: string;
  donor_commit: string | null;
  manifest_sha256: string;
  artifact_count: number;
  artifact_bytes: number;
}

export interface PublicKnowledgeDocument {
  id: string;
  artifactPath: string;
  artifactSha256: string;
  contentSha256: string;
  authorityKind: 'public_first_party_web';
  extractionVersion: 1;
  language: 'vi' | 'en';
  title: string;
  requestedUrl: string;
  sourceUrl: string;
  capturedOn: string;
  text: string;
}

export interface PublicKnowledgeIndex {
  schemaVersion: 1;
  corpusId: string;
  capturedOn: string;
  languages: ['vi', 'en'];
  englishCoverage: 'partial';
  documents: PublicKnowledgeDocument[];
}

export async function verifyPvcfcCorpus(root: string): Promise<{
  corpusId: string;
  artifactCount: number;
  totalBytes: number;
  manifestSha256: string;
  custody: {
    sourceKind: string;
    donorCommit: string | null;
  };
}> {
  const { manifest, manifestSha256, totalBytes } =
    await verifyRawPvcfcCapture(root);

  const custody = JSON.parse(
    await readFile(join(root, 'custody.json'), 'utf8'),
  ) as CorpusCustody;
  if (
    custody.source_kind !== 'untracked_donor_worktree' ||
    custody.donor_commit !== null ||
    custody.manifest_sha256 !== manifestSha256 ||
    custody.artifact_count !== manifest.artifacts.length ||
    custody.artifact_bytes !== totalBytes
  ) {
    throw new Error('pvcfc_corpus_custody_mismatch');
  }

  const expectedIndex = await derivePublicKnowledgeIndex(root, manifest);
  const checkedInIndex = JSON.parse(
    await readFile(join(root, 'derived/public-knowledge-index.json'), 'utf8'),
  ) as PublicKnowledgeIndex;
  if (JSON.stringify(checkedInIndex) !== JSON.stringify(expectedIndex)) {
    throw new Error('pvcfc_corpus_derived_index_stale');
  }

  return {
    corpusId: manifest.corpus_id,
    artifactCount: manifest.artifacts.length,
    totalBytes,
    manifestSha256,
    custody: {
      sourceKind: custody.source_kind,
      donorCommit: custody.donor_commit,
    },
  };
}

export async function installPvcfcCorpus(input: {
  source: string;
  target: string;
  sourceLabel?: string;
  importedOn?: string;
}): Promise<void> {
  const source = resolve(input.source);
  const target = resolve(input.target);
  if (source === target) throw new Error('pvcfc_corpus_in_place_forbidden');
  if (await pathExists(target)) throw new Error('pvcfc_corpus_target_exists');
  const verified = await verifyRawPvcfcCapture(source);
  const temporary = join(
    dirname(target),
    `.${basename(target)}.tmp-${randomUUID()}`,
  );
  await mkdir(dirname(target), { recursive: true });
  try {
    await mkdir(temporary);
    await copyFile(
      join(source, 'manifest.json'),
      join(temporary, 'manifest.json'),
      1,
    );
    await cp(join(source, 'raw'), join(temporary, 'raw'), {
      recursive: true,
      force: false,
      errorOnExist: true,
    });
    await writeFile(
      join(temporary, 'custody.json'),
      `${JSON.stringify(
        {
          schema_version: 1,
          corpus_id: verified.manifest.corpus_id,
          source_kind: 'untracked_donor_worktree',
          donor_commit: null,
          donor_path: input.sourceLabel ?? 'untracked donor path not recorded',
          imported_on: input.importedOn ?? 'not recorded',
          manifest_sha256: verified.manifestSha256,
          artifact_count: verified.manifest.artifacts.length,
          artifact_bytes: verified.totalBytes,
          notes:
            'The donor files were untracked, so there is no truthful donor commit to record. Raw artifacts and manifest are copied byte-for-byte; refreshes require a new versioned corpus directory.',
        },
        null,
        2,
      )}\n`,
      { flag: 'wx' },
    );
    await writePvcfcPublicKnowledgeIndex(temporary);
    await verifyPvcfcCorpus(temporary);
    if (await pathExists(target)) {
      throw new Error('pvcfc_corpus_target_exists');
    }
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
}

export async function writePvcfcPublicKnowledgeIndex(
  root: string,
): Promise<void> {
  const manifest = JSON.parse(
    await readFile(join(root, 'manifest.json'), 'utf8'),
  ) as CorpusManifest;
  const index = await derivePublicKnowledgeIndex(root, manifest);
  const derivedDirectory = join(root, 'derived');
  await mkdir(derivedDirectory, { recursive: true });
  await writeFile(
    join(derivedDirectory, 'public-knowledge-index.json'),
    `${JSON.stringify(index, null, 2)}\n`,
    { flag: 'wx' },
  );
}

async function derivePublicKnowledgeIndex(
  root: string,
  manifest: CorpusManifest,
): Promise<PublicKnowledgeIndex> {
  const allowedHosts = new Set(manifest.coverage.first_party_hosts);
  const documents: PublicKnowledgeDocument[] = [];
  for (const artifact of manifest.artifacts) {
    const payload = JSON.parse(
      await readFile(safeArtifactPath(root, artifact.path), 'utf8'),
    ) as Record<string, unknown>;
    if (Array.isArray(payload.results)) {
      payload.results.forEach((entry, index) => {
        const record = asRecord(entry);
        const sourceUrl = publicSourceUrl(
          record?.final_url ?? record?.url,
          allowedHosts,
        );
        const text = nonEmptyString(record?.text);
        if (!record || !sourceUrl || !text) return;
        documents.push({
          id: `${artifact.path}#${index}`,
          artifactPath: artifact.path,
          artifactSha256: artifact.sha256,
          contentSha256: sha256(new TextEncoder().encode(text)),
          authorityKind: 'public_first_party_web',
          extractionVersion: 1,
          language: record.language === 'en' ? 'en' : 'vi',
          title: nonEmptyString(record.title) ?? basename(sourceUrl),
          requestedUrl: publicSourceUrl(record.url, allowedHosts) ?? sourceUrl,
          sourceUrl,
          capturedOn: manifest.capture_date,
          text,
        });
      });
      continue;
    }

    const result = asRecord(payload.result);
    const sourceUrl = publicSourceUrl(artifact.source_url, allowedHosts);
    if (!result || !sourceUrl) continue;
    const text = publicResultText(result);
    if (!text) continue;
    documents.push({
      id: artifact.path,
      artifactPath: artifact.path,
      artifactSha256: artifact.sha256,
      contentSha256: sha256(new TextEncoder().encode(text)),
      authorityKind: 'public_first_party_web',
      extractionVersion: 1,
      language: sourceUrl.includes('/en-US/') ? 'en' : 'vi',
      title:
        nonEmptyString(result.page_title) ??
        basename(artifact.path, '.json').replaceAll('-', ' '),
      requestedUrl: sourceUrl,
      sourceUrl,
      capturedOn: manifest.capture_date,
      text,
    });
  }
  return {
    schemaVersion: 1,
    corpusId: manifest.corpus_id,
    capturedOn: manifest.capture_date,
    languages: ['vi', 'en'],
    englishCoverage: 'partial',
    documents,
  };
}

async function verifyRawPvcfcCapture(root: string): Promise<{
  manifest: CorpusManifest;
  manifestSha256: string;
  totalBytes: number;
}> {
  await assertTreeHasNoSymlinks(root);
  const manifestBytes = await readFile(join(root, 'manifest.json'));
  const manifestSha256 = sha256(manifestBytes);
  if (manifestSha256 !== EXPECTED_MANIFEST_SHA256) {
    throw new Error('pvcfc_corpus_manifest_hash_mismatch');
  }
  const manifest = JSON.parse(manifestBytes.toString('utf8')) as CorpusManifest;
  if (
    manifest.coverage.artifact_count !== manifest.artifacts.length ||
    manifest.artifacts.length !== 24
  ) {
    throw new Error('pvcfc_corpus_artifact_count_mismatch');
  }

  let totalBytes = 0;
  const expectedPaths = new Set<string>();
  for (const artifact of manifest.artifacts) {
    const artifactPath = safeArtifactPath(root, artifact.path);
    const bytes = await readFile(artifactPath);
    if (bytes.byteLength !== artifact.bytes) {
      throw new Error(`pvcfc_corpus_artifact_size_mismatch:${artifact.path}`);
    }
    if (sha256(bytes) !== artifact.sha256) {
      throw new Error(`pvcfc_corpus_artifact_hash_mismatch:${artifact.path}`);
    }
    expectedPaths.add(artifact.path);
    totalBytes += bytes.byteLength;
  }

  const actualRawPaths = (await regularFiles(join(root, 'raw'))).map((path) =>
    relative(root, path).split(sep).join('/'),
  );
  if (
    actualRawPaths.length !== expectedPaths.size ||
    actualRawPaths.some((path) => !expectedPaths.has(path))
  ) {
    throw new Error('pvcfc_corpus_unmanifested_raw_artifact');
  }
  return { manifest, manifestSha256, totalBytes };
}

function publicResultText(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map(publicResultText).filter(Boolean).join('\n');
  }
  const record = asRecord(value);
  if (record) {
    return Object.entries(record)
      .filter(([key]) => !['run_id', 'run_url'].includes(key))
      .map(([, entry]) => publicResultText(entry))
      .filter(Boolean)
      .join('\n');
  }
  if (typeof value !== 'string') return '';
  const text = value.trim();
  return /^https?:\/\//u.test(text) ? '' : text;
}

function publicSourceUrl(
  value: unknown,
  allowedHosts: ReadonlySet<string>,
): string | undefined {
  const text = nonEmptyString(value);
  if (!text) return undefined;
  try {
    const url = new URL(text);
    return url.protocol === 'https:' && allowedHosts.has(url.hostname)
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

async function assertTreeHasNoSymlinks(root: string): Promise<void> {
  const rootStat = await lstat(root);
  if (rootStat.isSymbolicLink()) {
    throw new Error('pvcfc_corpus_symlink_forbidden');
  }
  if (!rootStat.isDirectory()) throw new Error('pvcfc_corpus_not_directory');
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    const entryStat = await lstat(path);
    if (entryStat.isSymbolicLink()) {
      throw new Error('pvcfc_corpus_symlink_forbidden');
    }
    if (entryStat.isDirectory()) await assertTreeHasNoSymlinks(path);
  }
}

async function regularFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...(await regularFiles(path)));
    else if (entry.isFile()) files.push(path);
  }
  return files.sort();
}

function safeArtifactPath(root: string, artifactPath: string): string {
  const path = resolve(root, artifactPath);
  if (!path.startsWith(`${resolve(root)}${sep}`)) {
    throw new Error('pvcfc_corpus_artifact_path_invalid');
  }
  return path;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ENOENT'
      ? Promise.reject(error)
      : false;
  }
}

function sha256(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

async function main(): Promise<void> {
  const [command = 'verify', rootArg] = process.argv.slice(2);
  const root = resolve(
    rootArg ??
      'fixtures/business-packs/pvcfc-customer-service/pvcfc-public-web-2026-07-21',
  );
  if (command === 'build-index') {
    await writePvcfcPublicKnowledgeIndex(root);
    return;
  }
  if (command === 'verify') {
    console.log(JSON.stringify(await verifyPvcfcCorpus(root), null, 2));
    return;
  }
  throw new Error(`pvcfc_corpus_command_unknown:${command}`);
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  await main();
}
