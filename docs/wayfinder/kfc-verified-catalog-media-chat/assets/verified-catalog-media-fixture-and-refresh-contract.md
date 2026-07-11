# Verified Catalog Media Fixture And Refresh Contract

## Decision

Introduce a central generated runtime media registry referenced by stable keys from catalog entities. Keep crawl captures, failed candidates, expired promotions, capture timestamps, and validation attempts in a separate dated evidence archive. Generate all runtime fixtures from a complete staged refresh and publish them atomically only after deterministic validation and diff gates pass.

This design replaces the current implicit split where crawl scripts create intermediate artifacts but `services/kfc-agent-backend/scripts/build-fixtures.ts` only copies manually prepared generated JSON.

## Why a central registry

The same official image is reused by multiple products and hundreds of nested modifier occurrences. Inline media objects would duplicate URL, provenance, validation, and eligibility decisions and allow them to drift.

The runtime representation therefore has two layers:

1. `catalog-media.json` owns each verified URL and its stable evidence once.
2. Entity fixtures contain only a nullable `mediaKey` association.

No runtime entity contains an alternative or fallback URL.

## Runtime media registry

Add `services/kfc-agent-backend/fixtures/generated/catalog-media.json` and include it in `GeneratedFixtures`, bundled fixtures, filesystem loading, and build copying.

Conceptual schema:

```ts
type CatalogMediaEntityType =
  | 'menu_item'
  | 'modifier'
  | 'promotion_campaign'
  | 'allergen_chart';

interface GeneratedCatalogMedia {
  mediaKey: string;
  sourceImageIdentity: string;
  url: string;
  host: string;
  mimeType: 'image/jpeg' | 'image/png' | 'image/gif';
  sizeBytes: number;
  width: number | null;
  height: number | null;
  sourceUrl: string;
  sourceKind: 'public_catalog_api' | 'official_page';
  firstVerifiedAt: string;
  contentVerifiedAt: string;
  fixtureMode: 'public_crawl_seed';
}
```

Rules:

- `mediaKey` is stable across cache-busting query changes.
- `sourceImageIdentity` is the official API/page identity, such as `FS-BUCKET5COB`, not a display name.
- `url` preserves the exact verified official URL, including its query string.
- `host` is normalized lowercase and must equal an explicitly reviewed allowed host.
- `firstVerifiedAt` is set only when a media identity first enters the runtime registry.
- `contentVerifiedAt` changes only when URL or binary metadata changes, not on every successful recheck.
- routine run time and last-check time do not belong in this file.
- dimensions are captured when the binary parser can read them; `null` dimensions do not invalidate an otherwise valid image because platform aspect ratios are guidance rather than hard acceptance gates.
- registry rows are sorted by `mediaKey`.

Current reviewed media host allowlist:

```text
static.kfcvietnam.com.vn
```

Do not use a wildcard such as `*.kfcvietnam.com.vn`. A new official subdomain requires an explicit reviewed allowlist change plus a successful refresh.

## Entity associations

### Menu items

Replace the generated menu fixture's authoritative raw `imageUrl` with:

```ts
mediaKey: string | null;
```

Stable entity key: public catalog item `id` / generated `itemId`.

The runtime `OrderingDataService` resolves the key and returns typed `VerifiedCatalogMedia` alongside the menu item. A temporary compatibility getter may expose `imageUrl` while downstream code migrates, but it must derive from the registry and must not become a second stored source of truth.

### Modifier options

Add `mediaKey: string | null` to every nested generated modifier option.

Stable entity key:

```text
parent itemId + modifierId
```

`imageName` may remain as source evidence/diagnostic identity, but runtime presentation must resolve through `mediaKey`. Repeated occurrences may share one registry key.

### Promotion campaigns and offers

Add a deterministic `campaignId` to every promotion offer and a nullable campaign `mediaKey`. All offer rows belonging to the same campaign use the same pair.

Stable campaign identity:

```text
normalized campaign title + startDate + endDate + official source URL
```

Generate a readable slug plus a short deterministic hash when normalized titles collide. Offer IDs remain offer identities; they are not image identities.

The generated runtime promotion fixture contains only campaigns that are active or scheduled as of the refresh `asOfDate`. `OrderingDataService` still evaluates `startDate` and `endDate` at request time:

- scheduled offers remain undiscoverable before `startDate`;
- expired offers remain undiscoverable after `endDate`, even when refresh has not run again;
- a subsequent successful refresh moves expired campaigns to archive-only evidence.

### Membership

Membership reward and wallet entries use nullable `mediaKey` and remove ineligible raw `imageUrl` values. The current generated values are all `null` because no current official-hosted image passed validation.

Membership is deliberately not part of `CatalogMediaEntityType` until at least one eligible official source exists. This prevents an empty speculative media domain from becoming a runtime contract.

### Allergen and ingredient evidence

The allergen content record references the fixed chart key:

```text
kfcvn:allergen-chart:vi
```

The parent product image is never duplicated into allergen evidence. When an answer is about a known menu item, runtime joins that item by `itemId` and may select its already verified media. When no exact product association exists, only the chart image or text is eligible.

## Media-key rules

Examples:

```text
kfcvn:item-image:fs-bucket5cob
kfcvn:item-image:mod-ga-gion-cay
kfcvn:promotion-image:trua-nay-khoi-nghi-2026
kfcvn:allergen-chart:vi
```

Keys are:

- lowercase ASCII;
- source-identity based;
- independent of URL query versions;
- unique in the registry;
- immutable once published unless the original association was demonstrably wrong.

If an image identity changes for the same entity, create or reference the new media key and report an association change. Do not silently repurpose an existing key for unrelated content.

## Evidence archive

Each refresh produces a dated evidence directory under the existing tracked crawl area:

```text
ai-talent-tracks/fnb/data/kfcvietnam-ordering-crawl/media-refresh/<run-id>/
  manifest.json
  normalized-candidates.json
  validation-results.json
  entity-associations.json
  promotion-archive.json
  diff.json
  summary.md
```

`run-id` is a deterministic date plus a collision-safe suffix, not a runtime media identity.

The manifest records:

```ts
interface MediaRefreshManifest {
  schemaVersion: 1;
  runId: string;
  capturedAt: string;
  asOfDate: string;
  tinyfishVersion: string;
  officialSources: Array<{
    url: string;
    status: 'complete' | 'failed';
    recordCount: number;
    contentSha256: string;
  }>;
  allowedHosts: string[];
  generationStatus: 'staged' | 'applied' | 'failed';
}
```

The archive retains:

- raw and normalized entity/image associations;
- every rejected candidate and exact rejection reasons;
- expired promotions and their media;
- source records removed from current runtime fixtures;
- HTTP/content metadata and capture time;
- the deterministic runtime diff.

The archive is evidence, not a runtime fixture and not a production source of truth.

## Eligibility gates

A candidate becomes runtime Verified Catalog Media only when all gates pass:

1. The association is explicit in the official public API or visible official page. Text similarity and guessed filenames are not sufficient.
2. The source page/API URL is official KFC Vietnam.
3. The media URL uses HTTPS.
4. The final response host after redirects is on the explicit allowlist.
5. The response status is `2xx`.
6. `Content-Type` is `image/jpeg`, `image/png`, or `image/gif` and matches the decoded binary.
7. `Content-Length` or measured bytes is greater than zero and at most 1,000,000 bytes, the strictest selected channel limit.
8. The binary is decodable as the declared image type.
9. `mediaKey`, source identity, and entity reference pass uniqueness/referential checks.
10. For promotion runtime associations, the campaign is active or scheduled at `asOfDate`.

Ineligible reasons are structured enums such as:

```text
ambiguous_association
unapproved_source
non_https_url
unapproved_final_host
http_failure
invalid_content_type
empty_content
oversize_for_zalo
decode_failure
duplicate_media_key
missing_entity
expired_promotion
```

No rejection path selects another image.

## Source completeness and failure semantics

Publication distinguishes source failure from a real entity/media change.

### Source acquisition failure

If TinyFish, the official catalog API, or a required official page cannot produce a complete source snapshot:

- mark the run failed;
- write the evidence/summary when possible;
- do not modify any runtime fixture;
- do not interpret the missing snapshot as mass deletion.

### Complete source with removed entity

If a complete official catalog snapshot no longer contains an item, remove that entity from generated runtime fixtures and record it under removed/archive evidence. This is the rule that removes stale items `20751` and `20752`.

### Complete source with failed media

If the entity is present but its image association or binary fails validation:

- retain the entity;
- set or leave `mediaKey: null`;
- remove an obsolete media association from runtime;
- record the failure and previous association in the diff/archive;
- use Text-Only Degradation.

### Promotion lifecycle

- Active and scheduled campaigns may appear in generated runtime fixtures.
- Expired campaigns never appear in generated runtime promotion fixtures.
- All campaign evidence, including expired media, remains in `promotion-archive.json`.
- Missing/ambiguous dates make a campaign archive-only until dates are verified.

## Deterministic refresh workflow

The implementation provides three explicit commands:

```text
npm run fixtures:media:refresh -- --as-of YYYY-MM-DD
npm run fixtures:media:check
npm run fixtures:media:apply -- --run-id <run-id>
```

### Refresh

1. Verify TinyFish authentication and versions.
2. Collect each official source independently.
3. Require completeness markers and source record counts.
4. Normalize source values without mutating current fixtures.
5. Associate entities to source image identities.
6. Validate all unique media URLs once.
7. Build runtime entities and registry in a temporary staging directory.
8. Parse staged output with the same production Zod schemas.
9. Validate every non-null `mediaKey` resolves exactly once and no registry row is orphaned unless explicitly shared/future-safe policy allows it.
10. Produce canonical JSON, evidence files, and diff.
11. Stop in `staged`; do not apply implicitly.

### Check

Read-only CI/local validation:

- parse current runtime fixtures;
- validate media-key references and uniqueness;
- enforce canonical ordering/formatting;
- optionally compare current fixtures to a named staged run;
- exit nonzero for schema/reference/eligibility errors;
- use a distinct drift exit code when staged output is valid but differs from current.

### Apply

- require a named successful staged run;
- revalidate its hashes and schemas;
- replace all affected runtime fixtures together via an atomic directory/file swap;
- update the run manifest to `applied` only after replacement succeeds;
- never partially update registry and entity references.

## Canonical output and diff

Canonical runtime JSON uses:

- two-space indentation;
- UTF-8;
- one trailing newline;
- arrays sorted by stable entity/media IDs;
- object property order defined by serializers rather than input crawl order;
- normalized dates as `YYYY-MM-DD`;
- exact verified media URLs without tracking parameters unrelated to asset identity;
- no per-run timestamp changes in runtime files.

Running refresh twice against identical source content and the same `asOfDate` must produce byte-identical staged runtime fixtures.

`diff.json` reports:

```ts
interface MediaFixtureDiff {
  entities: {
    added: string[];
    removed: string[];
    changed: string[];
  };
  media: {
    added: string[];
    removed: string[];
    urlChanged: string[];
    metadataChanged: string[];
  };
  associations: {
    added: string[];
    removed: string[];
    changed: string[];
  };
  promotions: {
    active: string[];
    scheduled: string[];
    expiredToArchive: string[];
  };
  rejected: Array<{ candidateId: string; reasons: string[] }>;
}
```

The human summary calls out count changes, stale removals, newly text-only entities, allowlist changes, and promotion lifecycle movements.

## Runtime resolution

`GeneratedFixtures` builds a `Map<mediaKey, GeneratedCatalogMedia>` once. Construction fails for duplicate keys or broken references.

Ordering/domain boundaries return typed `VerifiedCatalogMedia` rather than raw arbitrary URLs. Catalog Media Intent selection accepts only resolved registry entries, so Flutter and channel code never re-evaluate host or provenance policy.

The runtime never reads dated evidence archives.

## Required tests

### Schema and references

- valid registry and entity references load;
- duplicate `mediaKey` fails;
- missing reference fails;
- invalid host/MIME/size fails staged generation;
- nullable association keeps the entity text-capable;
- one registry entry can be reused by multiple entity references.

### Determinism

- identical source + `asOfDate` produces byte-identical output;
- shuffled crawl order produces identical output;
- routine recheck time changes only the run manifest, not runtime fixtures;
- URL query/content change produces one explicit diff.

### Failure safety

- required source timeout produces no runtime changes;
- one image failure removes only its association;
- atomic apply cannot leave registry/entity files out of sync;
- an unapproved redirect host is rejected;
- unknown/oversize content triggers text-only output.

### Entity and lifecycle

- live 118-item snapshot removes stale items `20751` and `20752`;
- all current 42 modifier image identities resolve through shared keys;
- active and scheduled promotions enter runtime fixtures;
- expired and unknown-date promotions remain archive-only;
- the current third active promotion without verified media remains runtime text-only;
- membership media associations are null;
- allergen chart resolves while parent-product media is joined rather than copied.

### Integration

- `loadGeneratedFixtures` and bundled loading resolve identical media;
- `build-fixtures.ts` copies registry and associated fixtures together;
- menu search/detail/add-ons and modifier/promotion tools expose typed resolved media;
- no runtime serializer emits a second authoritative raw image URL.

## Migration boundary

Implementation may temporarily derive the old `MenuItem.imageUrl` from resolved registry media to keep unrelated code compiling. The migration is complete only when fixtures contain one authoritative URL location, all new media-aware code consumes the typed media object, and compatibility output cannot diverge from the registry.
