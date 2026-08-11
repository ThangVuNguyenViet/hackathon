import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const FRAGMENT_SCHEMA_VERSION = 'pvcfc-public-fixture-fragment-v1';
const MANIFEST_SCHEMA_VERSION = 'pvcfc_fragment_manifest_v1';
const BUNDLE_SCHEMA_VERSION = 'pvcfc_public_data_v2';
const FORBIDDEN_FULL_TEXT_FIELDS = new Set([
  'articleText',
  'fullArticleText',
  'fullText',
  'rawArticleText',
  'rawHtml',
  'rawMarkdown',
  'rawText',
]);

type JsonRecord = Record<string, unknown>;

interface Fragment extends JsonRecord {
  schemaVersion: string;
  kind: string;
  records: JsonRecord[];
}

interface FragmentManifestEntry {
  path: string;
  kind: string;
  schemaVersion: string;
  rawSha256: string;
  recordCount: number;
  recordKeysSha256: string;
}

interface CollectionDeclaration {
  name: string;
  access: 'searchable' | 'discovery_only';
  recordCount: number;
}

interface ManifestDeclaration {
  schemaVersion: string;
  businessId: string;
  capturedAt: string;
  organization: { collection: string; recordId: string };
  collections: CollectionDeclaration[];
}

export interface BuildPvcfcPublicDataOptions {
  backendRoot?: string;
  check?: boolean;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value).sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
  return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`).join(',')}}`;
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function requireString(
  record: JsonRecord,
  field: string,
  context: string,
): string {
  const value = record[field];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${context}.${field} must be a non-empty string`);
  }
  return value;
}

function isPvcfcUrl(value: string): boolean {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return hostname === 'pvcfc.com.vn' || hostname.endsWith('.pvcfc.com.vn');
  } catch {
    return false;
  }
}

function isAppStoreUrl(value: string): boolean {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return hostname === 'apps.apple.com' || hostname === 'play.google.com';
  } catch {
    return false;
  }
}

function sanitizeApprovedData(
  value: unknown,
  allowLinkedSources: boolean,
): unknown {
  if (value === null) return undefined;
  if (typeof value === 'string' && /^https?:\/\//iu.test(value)) {
    if (isPvcfcUrl(value) || isAppStoreUrl(value) || allowLinkedSources)
      return value;
    return undefined;
  }
  if (Array.isArray(value)) {
    return value
      .map((entry) => sanitizeApprovedData(entry, allowLinkedSources))
      .filter((entry) => entry !== undefined);
  }
  if (!isRecord(value)) return value;
  const sanitized: JsonRecord = {};
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_FULL_TEXT_FIELDS.has(key)) continue;
    const sanitizedChild = sanitizeApprovedData(child, allowLinkedSources);
    if (sanitizedChild !== undefined) sanitized[key] = sanitizedChild;
  }
  return sanitized;
}

function sourceClassification(
  sourceUrl: string,
  allowLinkedSources: boolean,
): 'official_pvcfc_domain' | 'official_app_store' | 'official_linked_source' {
  if (isPvcfcUrl(sourceUrl)) return 'official_pvcfc_domain';
  if (isAppStoreUrl(sourceUrl)) return 'official_app_store';
  if (allowLinkedSources) return 'official_linked_source';
  throw new Error(
    `Non-authoritative source URL in searchable data: ${sourceUrl}`,
  );
}

function parseManifestDeclaration(input: unknown): ManifestDeclaration {
  if (!isRecord(input)) throw new Error('PVCFC manifest must be an object');
  const schemaVersion = requireString(input, 'schemaVersion', 'manifest');
  if (schemaVersion !== MANIFEST_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported PVCFC manifest schemaVersion ${schemaVersion}`,
    );
  }
  const businessId = requireString(input, 'businessId', 'manifest');
  const capturedAt = requireString(input, 'capturedAt', 'manifest');
  if (Number.isNaN(Date.parse(capturedAt))) {
    throw new Error('manifest.capturedAt must be an ISO date or date-time');
  }
  if (!isRecord(input.organization)) {
    throw new Error('manifest.organization must be an object');
  }
  const organization = {
    collection: requireString(
      input.organization,
      'collection',
      'manifest.organization',
    ),
    recordId: requireString(
      input.organization,
      'recordId',
      'manifest.organization',
    ),
  };
  if (!Array.isArray(input.collections) || input.collections.length === 0) {
    throw new Error('manifest.collections must be a non-empty array');
  }
  const collections = input.collections.map(
    (value, index): CollectionDeclaration => {
      if (!isRecord(value))
        throw new Error(`manifest.collections.${index} must be an object`);
      const name = requireString(
        value,
        'name',
        `manifest.collections.${index}`,
      );
      const access = value.access;
      if (access !== 'searchable' && access !== 'discovery_only') {
        throw new Error(`manifest.collections.${index}.access is invalid`);
      }
      return {
        name,
        access,
        recordCount:
          typeof value.recordCount === 'number' &&
          Number.isSafeInteger(value.recordCount)
            ? value.recordCount
            : 0,
      };
    },
  );
  const names = collections.map((collection) => collection.name);
  if (new Set(names).size !== names.length) {
    throw new Error('manifest.collections contains duplicate names');
  }
  if (!names.includes(organization.collection)) {
    throw new Error(
      'manifest.organization references an undeclared collection',
    );
  }
  return { schemaVersion, businessId, capturedAt, organization, collections };
}

function normalizeRecord(
  record: JsonRecord,
  manifestEntry: FragmentManifestEntry,
  access: CollectionDeclaration['access'],
  collidingIds: ReadonlySet<string>,
): JsonRecord {
  const originalId = requireString(
    record,
    'id',
    `${manifestEntry.path} record`,
  );
  requireString(record, 'name', `${manifestEntry.path}#${originalId}`);
  const sourceUrl = requireString(
    record,
    'sourceUrl',
    `${manifestEntry.path}#${originalId}`,
  );
  const allowLinkedSources = access === 'discovery_only';
  const classification = sourceClassification(sourceUrl, allowLinkedSources);
  const rawProvenance = isRecord(record.provenance) ? record.provenance : {};
  const retrievedAt = requireString(
    rawProvenance,
    'retrievedAt',
    `${manifestEntry.path}#${originalId}.provenance`,
  );
  const sanitized = sanitizeApprovedData(
    { ...record, provenance: undefined, originRefs: undefined },
    allowLinkedSources,
  );
  if (!isRecord(sanitized))
    throw new Error(`Unable to normalize ${originalId}`);
  const id = collidingIds.has(`${manifestEntry.kind}\0${originalId}`)
    ? `${originalId}--${sha256(sourceUrl).slice(0, 12)}`
    : originalId;
  const suppliedOriginRefs = Array.isArray(record.originRefs)
    ? record.originRefs.filter(
        (value): value is string => typeof value === 'string',
      )
    : [];
  const normalized: JsonRecord = {
    ...sanitized,
    id,
    ...(id === originalId ? {} : { originalId }),
    originRefs: [
      ...new Set([
        ...suppliedOriginRefs,
        `${manifestEntry.rawSha256}#${originalId}`,
      ]),
    ],
  };
  normalized.provenance = {
    ...rawProvenance,
    sourceUrl,
    sourceClassification: classification,
    retrievedAt,
    contentSha256: sha256(canonicalJson(normalized)),
  };
  return normalized;
}

async function assertMatches(path: string, expected: string): Promise<void> {
  let actual: string;
  try {
    actual = await readFile(path, 'utf8');
  } catch {
    throw new Error(
      `${relative(process.cwd(), path)} is missing; run fixtures:pvcfc:build`,
    );
  }
  if (actual !== expected) {
    throw new Error(
      `${relative(process.cwd(), path)} is stale; run fixtures:pvcfc:build`,
    );
  }
}

export async function buildPvcfcPublicData(
  options: BuildPvcfcPublicDataOptions = {},
): Promise<void> {
  const defaultBackendRoot = join(
    dirname(fileURLToPath(import.meta.url)),
    '..',
  );
  const backendRoot = options.backendRoot ?? defaultBackendRoot;
  const manifestPath = join(backendRoot, 'fixtures/pvcfc/manifest.json');
  const declaration = parseManifestDeclaration(
    JSON.parse(await readFile(manifestPath, 'utf8')) as unknown,
  );
  const declaredCollections = new Map(
    declaration.collections.map((collection) => [collection.name, collection]),
  );
  const fragmentDirectory = join(backendRoot, 'fixtures/pvcfc/fragments');
  const fragmentNames = (await readdir(fragmentDirectory))
    .filter((name) => name.endsWith('.json'))
    .sort();
  if (fragmentNames.length === 0) throw new Error('No PVCFC fragments found');

  const fragmentEntries: FragmentManifestEntry[] = [];
  const fragments: Array<{
    fragment: Fragment;
    manifest: FragmentManifestEntry;
  }> = [];
  for (const name of fragmentNames) {
    const path = join(fragmentDirectory, name);
    const raw = await readFile(path, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (
      !isRecord(parsed) ||
      !Array.isArray(parsed.records) ||
      !parsed.records.every(isRecord)
    ) {
      throw new Error(`${name} must be a fragment object with records`);
    }
    const fragment: Fragment = {
      ...parsed,
      schemaVersion: requireString(parsed, 'schemaVersion', name),
      kind: requireString(parsed, 'kind', name),
      records: parsed.records,
    };
    if (fragment.schemaVersion !== FRAGMENT_SCHEMA_VERSION) {
      throw new Error(
        `${name} has unsupported schemaVersion ${fragment.schemaVersion}`,
      );
    }
    if (!declaredCollections.has(fragment.kind)) {
      throw new Error(
        `Fragment ${name} uses undeclared collection ${fragment.kind}`,
      );
    }
    const recordIds = fragment.records.map((record) =>
      requireString(record, 'id', `${name} record`),
    );
    if (new Set(recordIds).size !== recordIds.length) {
      throw new Error(`${name} contains duplicate record ids`);
    }
    const manifest: FragmentManifestEntry = {
      path: `fixtures/pvcfc/fragments/${name}`,
      kind: fragment.kind,
      schemaVersion: fragment.schemaVersion,
      rawSha256: sha256(raw),
      recordCount: fragment.records.length,
      recordKeysSha256: sha256(canonicalJson([...recordIds].sort())),
    };
    fragmentEntries.push(manifest);
    fragments.push({ fragment, manifest });
  }

  const collidingIds = new Set<string>();
  const idCounts = new Map<string, number>();
  for (const { fragment } of fragments) {
    for (const record of fragment.records) {
      const key = `${fragment.kind}\0${requireString(record, 'id', 'record')}`;
      idCounts.set(key, (idCounts.get(key) ?? 0) + 1);
    }
  }
  for (const [key, count] of idCounts) if (count > 1) collidingIds.add(key);

  const collections = declaration.collections.map((collection) => {
    const matchingFragments = fragments.filter(
      ({ fragment }) => fragment.kind === collection.name,
    );
    if (matchingFragments.length === 0) {
      throw new Error(`Declared collection ${collection.name} has no fragment`);
    }
    const records = matchingFragments.flatMap(({ fragment, manifest }) =>
      fragment.records.map((record) =>
        normalizeRecord(record, manifest, collection.access, collidingIds),
      ),
    );
    records.sort((left, right) => {
      const leftId = requireString(left, 'id', collection.name);
      const rightId = requireString(right, 'id', collection.name);
      return leftId.localeCompare(rightId);
    });
    const ids = records.map((record) =>
      requireString(record, 'id', collection.name),
    );
    if (new Set(ids).size !== ids.length) {
      throw new Error(
        `Collection ${collection.name} contains duplicate normalized ids`,
      );
    }
    return {
      name: collection.name,
      access: collection.access,
      count: records.length,
      records,
    };
  });

  const organizationCollection = collections.find(
    (collection) => collection.name === declaration.organization.collection,
  );
  const organizationRecord = organizationCollection?.records.find(
    (record) => record.id === declaration.organization.recordId,
  );
  if (organizationRecord === undefined) {
    throw new Error('Manifest organization record was not found');
  }
  const organization = {
    name: requireString(organizationRecord, 'name', 'organization record'),
    sourceRecordId: requireString(
      organizationRecord,
      'id',
      'organization record',
    ),
    provenance: organizationRecord.provenance,
    originRefs: organizationRecord.originRefs,
  };
  const bundle = {
    schemaVersion: BUNDLE_SCHEMA_VERSION,
    businessId: declaration.businessId,
    capturedAt: declaration.capturedAt,
    revision: '',
    organization,
    collections,
  };
  bundle.revision = sha256(canonicalJson(bundle));

  const manifest = {
    schemaVersion: declaration.schemaVersion,
    businessId: declaration.businessId,
    capturedAt: declaration.capturedAt,
    organization: declaration.organization,
    collections: collections.map((collection) => ({
      name: collection.name,
      access: collection.access,
      recordCount: collection.count,
    })),
    fragments: fragmentEntries,
  };
  const manifestOutput = `${JSON.stringify(manifest, null, 2)}\n`;
  const bundleOutput = `${JSON.stringify(bundle, null, 2)}\n`;
  const bundlePath = join(
    backendRoot,
    'fixtures/generated/pvcfc-public-data.json',
  );
  if (options.check) {
    await assertMatches(manifestPath, manifestOutput);
    await assertMatches(bundlePath, bundleOutput);
    return;
  }
  await writeFile(manifestPath, manifestOutput, 'utf8');
  await writeFile(bundlePath, bundleOutput, 'utf8');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await buildPvcfcPublicData({ check: process.argv.includes('--check') });
}
