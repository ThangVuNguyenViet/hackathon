import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join, relative } from 'node:path';
import matter from 'gray-matter';

const APPROVED_SOURCES = new Set([
  'https://kfcvietnam.com.vn/privacy-policy',
  'https://kfcvietnam.com.vn/terms-condition',
  'https://kfcvietnam.com.vn/policy-information-confidentiality',
  'https://www.kfcvietnam.com.vn/order-tracker',
  'https://www.kfcvietnam.com.vn/contacta-con-kfc',
  'https://www.kfcvietnam.com.vn/allergen-chart',
]);

type PolicyKind = 'policy' | 'allergen';

interface PolicyFrontmatter {
  type: 'Policy';
  id: string;
  title: string;
  resource: string;
  kind: PolicyKind;
  tags: string[];
  retrieved_at: string;
  approved_at: string;
  approval_status: 'approved';
  audience: 'customer_public';
}

export interface GeneratedPolicySection {
  id: string;
  kind: PolicyKind;
  title: string;
  sourceUrl: string;
  statusCode: number;
  markdown: string;
  links: string[];
  tags: string[];
  retrievedAt: string;
  approvedAt: string;
  approvalStatus: 'approved';
  audience: 'customer_public';
  contentHash: string;
  provenance: {
    sourceFile: string;
    fixtureMode: 'public_crawl_seed';
  };
}

function requiredString(value: unknown, field: string, file: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${file}: missing ${field}`);
  }
  return value.trim();
}

function parseFrontmatter(value: Record<string, unknown>, file: string): PolicyFrontmatter {
  const type = requiredString(value.type, 'type', file);
  const id = requiredString(value.id, 'id', file);
  const title = requiredString(value.title, 'title', file);
  const resource = requiredString(value.resource, 'resource', file);
  const kind = requiredString(value.kind, 'kind', file);
  const retrievedAt = requiredString(value.retrieved_at, 'retrieved_at', file);
  const approvedAt = requiredString(value.approved_at, 'approved_at', file);
  const approvalStatus = requiredString(value.approval_status, 'approval_status', file);
  const audience = requiredString(value.audience, 'audience', file);
  const tags = value.tags;

  if (type !== 'Policy') throw new Error(`${file}: type must be Policy`);
  if (kind !== 'policy' && kind !== 'allergen') throw new Error(`${file}: unsupported kind ${kind}`);
  if (!APPROVED_SOURCES.has(resource)) throw new Error(`${file}: source is not approved: ${resource}`);
  if (approvalStatus !== 'approved') throw new Error(`${file}: only approved content can be bundled`);
  if (audience !== 'customer_public') throw new Error(`${file}: only customer_public content can be bundled`);
  if (!Array.isArray(tags) || tags.length === 0 || !tags.every((tag) => typeof tag === 'string' && tag.trim())) {
    throw new Error(`${file}: tags must be a non-empty string array`);
  }

  return {
    type,
    id,
    title,
    resource,
    kind,
    tags: tags.map((tag) => tag.trim()),
    retrieved_at: retrievedAt,
    approved_at: approvedAt,
    approval_status: approvalStatus,
    audience,
  };
}

function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function parsePolicyDocument(
  raw: string,
  sourceFile: string,
): GeneratedPolicySection[] {
  const parsed = matter(raw);
  const metadata = parseFrontmatter(parsed.data, sourceFile);
  const body = parsed.content.trim();
  if (!body) throw new Error(`${sourceFile}: policy body is empty`);

  const sections = body.split(/^## /m).slice(1);
  if (!sections.length) throw new Error(`${sourceFile}: expected at least one level-two heading`);
  const contentHash = createHash('sha256').update(body).digest('hex');

  return sections.map((section) => {
    const firstNewline = section.indexOf('\n');
    if (firstNewline <= 0) throw new Error(`${sourceFile}: malformed level-two heading`);
    const heading = section.slice(0, firstNewline).trim();
    const sectionBody = section.slice(firstNewline + 1).trim();
    if (!sectionBody) throw new Error(`${sourceFile}: empty section ${heading}`);
    return {
      id: `${metadata.id}/${slugify(heading)}`,
      kind: metadata.kind,
      title: `${metadata.title} — ${heading}`,
      sourceUrl: metadata.resource,
      statusCode: 200,
      markdown: `## ${heading}\n\n${sectionBody}`,
      links: [metadata.resource],
      tags: metadata.tags,
      retrievedAt: metadata.retrieved_at,
      approvedAt: metadata.approved_at,
      approvalStatus: metadata.approval_status,
      audience: metadata.audience,
      contentHash,
      provenance: {
        sourceFile,
        fixtureMode: 'public_crawl_seed',
      },
    };
  });
}

export async function buildPolicyFixtures(backendRoot: string, check = false): Promise<void> {
  const policyRoot = join(backendRoot, 'knowledge/kfc-okf/policies');
  const fixturePath = join(backendRoot, 'fixtures/generated/content-pages.json');
  const policyFiles = (await readdir(policyRoot))
    .filter((file) => file.endsWith('.md'))
    .sort();
  const generated = (
    await Promise.all(policyFiles.map(async (file) => {
      const absolutePath = join(policyRoot, file);
      const sourceFile = relative(backendRoot, absolutePath);
      return parsePolicyDocument(await readFile(absolutePath, 'utf8'), sourceFile);
    }))
  ).flat();
  const ids = generated.map((record) => record.id);
  if (new Set(ids).size !== ids.length) throw new Error('duplicate generated policy section id');

  const existing = JSON.parse(await readFile(fixturePath, 'utf8')) as Array<{ kind?: string }>;
  const preserved = existing.filter((record) => record.kind !== 'policy' && record.kind !== 'allergen');
  const output = `${JSON.stringify([...preserved, ...generated], null, 2)}\n`;
  if (check) {
    const current = await readFile(fixturePath, 'utf8');
    if (current !== output) throw new Error('policy fixtures are stale; run npm run policies:build');
    return;
  }
  await writeFile(fixturePath, output);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const backendRoot = process.cwd();
  const check = process.argv.includes('--check');
  await buildPolicyFixtures(backendRoot, check);
  console.log(`${check ? 'Checked' : 'Built'} policy fixtures from ${basename(join(backendRoot, 'knowledge/kfc-okf'))}`);
}
