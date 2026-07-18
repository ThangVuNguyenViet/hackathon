import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildPolicyFixtures, parsePolicyDocument } from '../../scripts/build-policy-fixtures.js';

describe('policy corpus', () => {
  it('keeps the reviewed Markdown corpus and bundled fixtures in sync', async () => {
    await expect(buildPolicyFixtures(process.cwd(), true)).resolves.toBeUndefined();
    const pages = JSON.parse(
      await readFile(join(process.cwd(), 'fixtures/generated/content-pages.json'), 'utf8'),
    ) as Array<Record<string, unknown>>;
    const policies = pages.filter((page) => page.kind === 'policy' || page.kind === 'allergen');

    expect(policies).toHaveLength(13);
    expect(new Set(policies.map((page) => page.id)).size).toBe(13);
    expect(policies.every((page) =>
      page.approvalStatus === 'approved'
      && page.audience === 'customer_public'
      && /^[a-f0-9]{64}$/.test(String(page.contentHash)),
    )).toBe(true);

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
});
