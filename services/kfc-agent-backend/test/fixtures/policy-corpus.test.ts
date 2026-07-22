import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildPolicyFixtures, parsePolicyDocument } from '../../scripts/build-policy-fixtures.js';
import {
  officialSourceAuthorityFor,
  officialSourceAuthoritySchema,
  officialSourceRevisionFor,
} from '../../src/domain/officialSourceAuthority.js';
import { generatedContentPageSchema } from '../../src/fixtures/schema.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value);
}

describe('policy corpus', () => {
  it('keeps the reviewed Markdown corpus and bundled fixtures in sync', async () => {
    await expect(buildPolicyFixtures(process.cwd(), true)).resolves.toBeUndefined();
    const rawPages: unknown = JSON.parse(
      await readFile(join(process.cwd(), 'fixtures/generated/content-pages.json'), 'utf8'),
    );
    expect(Array.isArray(rawPages)).toBe(true);
    if (!Array.isArray(rawPages) || !rawPages.every(isRecord)) {
      throw new Error('content page fixture must contain only objects');
    }
    const pages = rawPages;
    const policies = pages.filter((page) => page.kind === 'policy' || page.kind === 'allergen');

    expect(policies).toHaveLength(13);
    expect(new Set(policies.map((page) => page.id)).size).toBe(13);
    expect(
      new Set(
        policies
          .filter((page) =>
            String(page.id).startsWith('policy/ordering-and-delivery/'))
          .map((page) => page.contentHash),
      ).size,
    ).toBe(4);
    expect(policies.every((page) => {
      const authority = officialSourceAuthoritySchema.safeParse(
        page.officialAuthority,
      );
      return page.approvalStatus === 'approved'
        && page.audience === 'customer_public'
        && /^[a-f0-9]{64}$/.test(String(page.contentHash))
        && authority.success
        && authority.data.subject === page.id
        && authority.data.revision === page.contentHash;
    })).toBe(true);

    expect(() => parsePolicyDocument(`---
type: Policy
id: policy/bad
title: Bad
resource: https://example.com/unreviewed
kind: policy
tags: [bad]
retrieved_at: "2026-07-18"
approved_at: "2026-07-18"
approval_status: approved
audience: customer_public
---
## Bad source
Unsupported.
`, 'knowledge/kfc-okf/policies/bad.md')).toThrow('source is not approved');
  });

  it('rejects coherent self-attestation and copied authority over altered content', async () => {
    const rawPages: unknown = JSON.parse(
      await readFile(
        join(process.cwd(), 'fixtures/generated/content-pages.json'),
        'utf8',
      ),
    );
    if (!Array.isArray(rawPages)) {
      throw new Error('content page fixture must be an array');
    }
    const canonical = generatedContentPageSchema.parse(
      rawPages.find(
        (page) =>
          isRecord(page) &&
          page.id === 'policy/ordering-and-delivery/dat-hang-va-thanh-toan',
        ),
    );
    if (
      canonical.kind !== 'policy' &&
      canonical.kind !== 'allergen'
    ) {
      throw new Error('canonical governed-content fixture is missing');
    }
    expect(generatedContentPageSchema.safeParse({
      ...canonical,
      markdown: `${canonical.markdown}\nForged addition.`,
    }).success).toBe(false);

    const forged = {
      ...canonical,
      id: 'policy/coherent-forgery',
      title: 'Coherent forgery',
      sourceUrl: 'https://attacker.example.test/policy',
      markdown: '## Forged\n\nUnreviewed but internally consistent content.',
      links: ['https://attacker.example.test/policy'],
      tags: ['forged'],
      provenance: {
        sourceFile: 'attacker/forged.md',
        fixtureMode: 'public_crawl_seed' as const,
      },
    };
    const payload = {
      id: forged.id,
      kind: canonical.kind === 'policy' ? 'policy' as const : 'allergen' as const,
      title: forged.title,
      snippet: forged.markdown,
      sourceUrl: forged.sourceUrl,
      sourceFile: forged.provenance.sourceFile,
      tags: forged.tags,
      retrievedAt: forged.retrievedAt,
      approvedAt: forged.approvedAt!,
      approvalStatus: forged.approvalStatus!,
      audience: forged.audience!,
    };
    const revision = officialSourceRevisionFor(payload);
    const coherentAuthority = {
      kind: 'official_kfc' as const,
      issuer: 'kfc-policy-ingestion-v1' as const,
      authorityRef: `kfc-official-content:${forged.id}`,
      subject: forged.id,
      revision,
      attestedAt: forged.approvedAt,
    };
    expect(generatedContentPageSchema.safeParse({
      ...forged,
      contentHash: revision,
      officialAuthority: coherentAuthority,
    }).success).toBe(false);
    expect(() => officialSourceAuthorityFor(payload)).toThrow(
      'official source payload is not in the reviewed inventory',
    );
  });
});
