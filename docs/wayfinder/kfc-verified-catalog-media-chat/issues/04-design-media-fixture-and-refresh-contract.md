Status: resolved
Type: research
Labels: wayfinder:research
Parent: ../map.md
Blocked by: 01-audit-catalog-media-flow-and-rendering-gaps.md, 02-inventory-official-kfc-media-with-tinyfish.md
Assignee: Codex

## Question

What typed fixture contract should represent Verified Catalog Media across menu items, nested modifier options, promotions, membership rewards, and parent-product ingredient/allergen evidence? Define provenance, capture time, validation status, entity association, promotion lifecycle, deterministic refresh/diff behavior, retention of archived evidence, runtime filtering, and text-only degradation without duplicating decisions across fixtures.

## Answer

[Verified Catalog Media Fixture And Refresh Contract](../assets/verified-catalog-media-fixture-and-refresh-contract.md) defines the central media registry, entity references, evidence archive, validation gates, promotion lifecycle, deterministic refresh/diff algorithm, failure semantics, and acceptance tests.

The decision-level contract is:

- Add one generated `catalog-media.json` registry containing only currently eligible Verified Catalog Media. Menu items, nested modifiers, promotion campaigns, and content pages reference it by nullable `mediaKey`; they do not duplicate URLs or provenance.
- Keep raw TinyFish/API/page captures, rejected candidates, expired promotions, prior associations, capture time, and validation results in dated crawl evidence outside runtime fixtures.
- Runtime media entries store stable source provenance and the last content-changing verification facts. Per-run `capturedAt`/`lastCheckedAt` stays in the run manifest so an unchanged refresh produces byte-identical generated fixtures.
- Use stable source identities: catalog item ID for products, parent item ID plus modifier ID for options, a deterministic campaign ID from normalized title/date window/source, and a fixed allergen-chart ID. `mediaKey` is based on the source image identity, not a cache-busting URL query.
- A runtime media URL must be HTTPS, explicitly associated by an official source, hosted on the reviewed allowlist, return `2xx image/*`, use JPEG/PNG/GIF, and be at most 1,000,000 bytes. Unknown length, redirect to an unapproved host, failed fetch, or ambiguous association makes it ineligible and text-only.
- A failed source acquisition aborts publication and leaves current fixtures untouched. A successful complete source snapshot may remove absent entities; a per-image validation failure removes only that media association while retaining the entity for text-only use.
- Runtime promotion fixtures contain only active or scheduled campaigns as of the refresh date. Expired campaigns and their images remain in the evidence archive; runtime date filtering still prevents a scheduled campaign appearing before its start or an unrefreshed campaign appearing after expiry.
- Refresh is collect → normalize → associate → validate → generate in staging → schema/reference checks → deterministic diff → explicit atomic apply. No runtime file changes occur before every gate passes.
