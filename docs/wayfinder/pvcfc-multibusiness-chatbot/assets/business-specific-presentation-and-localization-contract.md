# Business-Specific Presentation And Localization Contract

## Decision

The presentation flow has one direction and three distinct responsibilities. First, the active Business Pack projects verified Business state and evidence into one canonical, versioned, Business-neutral presentation envelope. Second, the shared surface/channel projector validates that envelope and projects it into a channel-safe accessible shell. Third, only for a supported structured component, the active Pack renderer renders the component's schema-validated opaque data inside that shell. The Shared Assistant Runtime owns envelope validation, channel safety, accessible delivery mechanics, secure transport, and action replay; the Pack owns customer language, brand, component vocabulary and renderer, action meaning, citation style, media/navigation authority policies, and the state-to-envelope projection.

`business-presentation/v1` is the contract major family, not the full envelope schema revision and not a Pack version. Every envelope separately carries an `envelopeSchemaRevision` within that family. Compatible additive envelope fields increment the schema minor revision; changing the meaning of canonical text, citations, actions, URL/media trust, component identity, or lifecycle state requires a new contract major family and an explicit Pack migration.

The boundary extends the [Shared Assistant Runtime and Business Pack contract](./shared-assistant-runtime-and-business-pack-contract.md), preserves the [KFC compatibility baseline](./kfc-compatibility-baseline-and-reusable-seams.md), and applies the authority and provenance rules in the [Provider, Adapter, and fixture contracts](./provider-adapter-and-fixture-provenance-contracts.md). It must not introduce a shared union of KFC and PVCFC customer components or any runtime branch such as `if (businessId === "kfc")`.

Normative terms **MUST**, **MUST NOT**, **SHOULD**, and **MAY** describe requirements for implementation and the executable contract owned by [issue 08](../issues/08-design-multibusiness-quality-contract-and-kfc-migration.md).

## Ownership Boundary

### Shared customer surface and runtime

The shared surface and runtime own only Business-neutral mechanics:

1. receive the canonical envelope already projected by the active Pack, then validate its contract family, schema revision, Pack reference, Business/run binding, lifecycle revision, evidence references, expiry, and channel profile;
2. project the validated canonical envelope into a channel-safe delivery shape without recomposing Business claims or copy;
3. enforce whether the channel supports structured companions, media, navigation links, copy actions, or interactive actions;
4. render the accessible shell and chrome—focus order, semantics, contrast hooks, reduced-motion behavior, loading/error states, and text-only degradation—while delegating supported opaque component data to the renderer registered by the active Pack;
5. accept an action interaction and route it to a server-side dispatcher under the original Business, Pack, session, channel, component, evidence, and revision bindings; neutral action metadata is neither a global action union nor a direct client execution path;
6. deduplicate and replay action/delivery results without changing their Business meaning;
7. enforce the active Pack's separate navigation/citation scheme-host rules and media scheme-host-key-prefix/transport rules, rejecting unsupported, expired, cross-Pack, or off-policy references;
8. enforce structural parity invariants without interpreting opaque component data: require canonical text; preserve or intentionally suppress only according to channel policy the envelope's evidence, citation, limitation, status, and action references; reject orphaned or cross-boundary references; and invoke the Pack-supplied semantic parity validator/proof when the Pack declares one, treating its result only as typed pass/fail evidence;
9. preserve canonical text when components or media cannot be delivered.

The shared surface MUST NOT choose Business terminology, format KFC currency, invent fallback copy, reinterpret an action, select a substitute image, expose another Pack's component renderer, or infer a source citation from display text.

### Business Pack

Each versioned Business Pack owns:

- brand tokens and semantic asset roles, without granting arbitrary code or URL trust;
- the copy catalog, locale negotiation, source-language disclosure, and locale fallback order;
- component identities, schemas, renderers, lifecycle labels, status labels, and accessibility copy;
- action meanings, localized labels, normalized customer intent, capability binding, confirmation requirements, and consequence class;
- citation ordering, customer-visible source fields, freshness language, historical/stale styling, and a navigation/citation URL authority policy for official pages, forms, contacts, and documents;
- media roles, stable media keys, a separate approved media authority policy with exact scheme/host/key-prefix requirements, required evidence, alt text policy, and safe fallback copy;
- language for unsupported capabilities, uncertainty, reconciliation, escalation, and synthetic-demo limitations;
- the pure projection from verified Pack state and evidence to canonical text, components, citations, badges, actions, and media;
- the semantic truth-equivalence contract for canonical text versus structured presentation, plus any deterministic Pack-supplied parity validator and typed proof schema.

A Pack MAY use different component catalogs for major versions, but a session remains pinned to a compatible Pack major version. A Pack upgrade MUST declare whether saved presentation/action envelopes can be replayed, migrated, or must expire.

### Adapter and deployment

Adapters provide normalized evidence and media metadata; they do not compose customer prose or choose components. Deployment configuration binds reviewed endpoints, credentials, exact hosts, signed-URL services, and channel limits to the Business-scoped Pack policy. Neither layer may reinterpret Pack action meanings or silently substitute another Business's content.

## Shared Presentation Envelope

```text
BusinessPresentationEnvelopeV1
  contractFamily: "business-presentation/v1"
  envelopeSchemaRevision: "1.0"
  envelopeId
  customerRunAttachmentBindingRef
  businessId
  packRef
    packId
    packVersion
    presentationCatalogVersion
  canonical
    text
    locale
    sourceLanguage
    fallbackDisclosure?       # required when output locale is not directly verified
  channelProfile
    profileId
    deliveryMode              # structured_companion | standalone_text | standalone_text_media
    capabilityRevision
  components[]
    componentId
    componentKind             # scoped to packRef, never a global union
    schemaVersion
    lifecycleStage
    lifecycleRevision
    status
    data
    evidenceRefs[]
    expiresAt?
  citations[]
    citationId
    evidenceRef
    authorityKind
    canonicalUrl?
    sourceTitle
    sourceLanguage
    representationKind          # html | pdf | document | dataset | other Pack-declared value
    representationVersionRef?
    relatedRepresentationRefs[] # verified translation/version/format relationships only
    publicationOrEffectiveDate?
    capturedAt?
    corpusRef?
    limitationKeys[]
  badges[]
    badgeId
    semanticKind              # limitation | historical | stale | synthetic_demo | status
    copyKey
    persistent
    evidenceRefs[]
  limitations[]
    limitationId
    copyKey
    severity
    evidenceRefs[]
    mustRemainInText
  actions[]
    actionId
    actionRevision
    componentId?
    actionMeaning             # Pack-scoped stable identifier
    localizedLabel
    normalizedCustomerIntent
    consequenceClass          # navigation | copy | read | reversible_write | irreversible_write
    navigationRef?            # Pack-scoped URL reference, never raw client authority
    capabilityRef?
    confirmationBindingRef?
    evidenceRefs[]
    expiresAt?
  media[]
    mediaId
    mediaKey                  # Pack-scoped stable key; not a model-supplied URL
    semanticRole
    evidenceRef
    altText
    mimeType?
    byteSize?
    dimensions?
    secureUrlRef?             # resolved by a trusted runtime/deployment hook
    expiresAt?
    limitations[]
  parityValidation?
    validatorRef              # Pack-scoped; runtime invokes but does not interpret component semantics
    proofRef?                 # typed Pack proof or validation result reference
  evidenceRefs[]
  lifecycleRevision
  createdAt
  expiresAt?
```

`customerRunAttachmentBindingRef` points to immutable metadata in the persisted customer-run/attachment record rather than duplicating replay authority in display data:

```text
CustomerRunAttachmentBinding
  bindingRef / persistedAttachmentRevision
  businessId / packRef
  environmentId
  sessionId / runId
  channelBindingRef
  envelopeId / lifecycleRevision
  componentIds[] / actionIds[]
  evidenceRefs[]
  confirmationBindingRefs[]
  createdAt / expiresAt?
```

The envelope reference makes the required authority location representable without defining persistence mechanics in issue 07. The future production path owned by issue 09 reloads this record and validates it before dispatch; a client-presented envelope or fixture is not the record of authority.

### Envelope invariants

1. `contractFamily` selects the major contract family; `envelopeSchemaRevision` selects the concrete compatible schema within it. A consumer MUST reject an unsupported family or revision rather than guess at missing fields.
2. `customerRunAttachmentBindingRef` MUST resolve to persisted metadata matching the envelope's Business, Pack, environment, session/run, channel, lifecycle, evidence, and expiry context before any action dispatch. Display data is not replay authority.
3. `businessId`, `packRef`, and every component, action, media, navigation, and evidence reference MUST match the trusted resolved Business context. A mismatch fails closed before rendering or dispatch.
4. `canonical.text` MUST be non-empty, customer-safe, and understandable without a component or image. It is the durable transcript representation.
5. `canonical.locale` is the language of the customer-facing text. `canonical.sourceLanguage` records the material source language when the response is grounded in language-specific evidence.
6. A component instance is resolved only through the active Pack-scoped registry keyed by `(packRef, componentId)`; that registry binds the instance to its `(componentKind, schemaVersion)`, structural schema validator, renderer, and optional semantic parity validator. There is no global cross-Business component enum. The runtime can enforce schema success and reference integrity, but treats `data` and the validator's Business-semantic reasoning as opaque.
7. Status and lifecycle labels are Pack copy. The runtime validates revision and expiry but does not translate their Business meaning.
8. Customer-visible citations reference evidence; restricted evidence details remain operator-only. A citation never grants visibility to a private identifier.
9. A badge or limitation marked `persistent` or `mustRemainInText` cannot be removed by a channel projection.
10. An action is dispatchable only from the immutable persisted binding revision referenced by the envelope that presented it. Labels and free-form client payloads are not authority.
11. Media is optional enhancement. Missing, rejected, expired, or failed media MUST leave the canonical text, citations, limitations, and valid actions usable.
12. The envelope and each consequential component/action MAY expire independently. The earliest relevant expiry governs dispatch; rendering an expired historical record MUST disable stale actions and visibly mark its state.

## Channel Capability Projection

A channel binding selects one of three minimum profiles:

| Profile | Required behavior | Forbidden behavior |
|---|---|---|
| `structured_companion` | Deliver canonical text and supported Pack components; components may supply scannable detail while preserving truth parity | Treat the component as the only carrier of a limitation, citation meaning, confirmation meaning, or synthetic disclosure |
| `standalone_text` | Deliver self-sufficient canonical text with required citations, limitations, status, and permitted next steps expressed in text | Emit components or media payloads |
| `standalone_text_media` | Deliver self-sufficient text plus policy-approved, evidence-linked media | Emit structured components, arbitrary remote URLs, or media whose failure changes the answer's truth |

The ordered flow is:

1. **Pack envelope projection:** the active Pack projects verified state and evidence once into the canonical envelope, including canonical text and opaque component data;
2. **shared channel projection:** the shared surface/channel projector validates that envelope, intersects it with trusted channel capabilities, and produces the channel-safe accessible shell or safely degrades to canonical text;
3. **Pack component rendering:** only when the channel projection retains a supported structured component, the renderer resolved from the active Pack's `(packRef, componentId)` registry renders that opaque data inside the shared shell.

No stage asks the Pack to produce a second envelope after channel selection. The shared channel projector does not interpret opaque component data, and the Pack renderer does not choose channel capabilities or rewrite canonical truth.

The shared projector's parity check is structural: canonical text remains present; retained components/actions/citations/statuses keep valid envelope references; channel suppression follows declared capability rules; required text limitations survive degradation; and no reference crosses the Business/Pack boundary. If the Pack declares `parityValidation`, the shared runtime invokes its Pack-scoped validator and records or verifies the typed `proofRef`, but consumes only the declared pass/fail result and reference integrity. The Pack defines and evaluates the Business-semantic equivalence behind that result.

Unsupported combinations MUST fail closed. The runtime MUST NOT move a component into a social channel, turn a navigation action into a write, or add media because another Business permits it.

## Localization Contract

A Pack copy catalog is keyed by stable semantic identifiers rather than by runtime-authored prose. Each Pack version declares:

```text
LocalePolicy
  primaryLocale
  supportedLocales[]
  verifiedSourceLanguages[]
  fallbackOrderByRequestedLocale
  terminologyCatalogVersion
  number/date/currency formatters
  sourceLanguageDisclosureKeys
  missingTranslationBehavior
```

Rules:

- Locale resolution is deterministic and recorded in the envelope.
- A fallback MUST preserve claim scope and limitations; it cannot make an answer sound more current, authoritative, or complete.
- Dates MUST retain the source's publication/effective meaning and display an unambiguous localized date.
- Number and currency formatting belong to the Pack. The shared runtime must not assume VND or any Business unit.
- A locale fallback disclosure is required whenever customer-facing wording is translated or summarized from a source not verified in the requested language.
- Machine-inferred URL variants are not verified translations.
- Accessibility copy, action labels, media alt text, citation labels, and status text follow the same locale/fallback decision as the main response.

## Citation And Freshness Presentation

Public citations MUST be derived from evidence and display, at minimum, the canonical source URL, source title, source language, and publication/effective date when available. The presentation MAY also display capture date and corpus identity when they help the customer distinguish source time from assistant retrieval time.

A Pack's citation projection MUST preserve evidence authority, limitations, representation, and version, and MUST distinguish:

- official public, synthetic, fixture, and other Pack-approved authority kinds without presenting one as another;
- current evidence from historical evidence;
- source publication/effective date from capture date;
- a listing or discovery page from the directly captured page/document that supports the claim;
- HTML, PDF, extracted document, dataset, translation, revision, and superseding-version relationships only when evidence verifies them;
- original-language evidence from a verified translation or a disclosed translation/summary;
- customer-visible public citations from restricted private/synthetic evidence references.

Historical, superseded, expired, or stale-sensitive content MUST carry a visible label and limitation. Styling alone is insufficient; text projection must preserve the same meaning. Search results, listing metadata, or an uncaptured document title cannot be presented as evidence for facts contained only in the missing body.

## Action Contract

The Pack owns what an action means; action trust remains server-side, and the runtime owns whether the immutable action envelope may be dispatched. A client or fixture catalog may display localized action metadata, but that metadata is not authority and is never a direct execution path. Neutral action fields are an envelope shape, not a global union of Business commands.

Dispatch MUST validate:

1. trusted Business, Pack, environment, session, and channel binding;
2. envelope, component, action, and lifecycle revisions;
3. action and evidence expiry;
4. the declared consequence class and current channel support;
5. authorization, capability, and confirmation bindings where applicable;
6. replay/idempotency state and stale-run protection.

The runtime sends `normalizedCustomerIntent` or invokes the bound capability according to the Pack declaration. It MUST NOT reconstruct intent from the localized label. Re-rendered or localized copy does not change action authority.

Navigation and copy actions remain non-transactional. Their completion may say that a URL was opened or details were copied; it MUST NOT imply that an external form, inquiry, reservation, complaint, order, or payment was submitted.

## Secure Media, Navigation, And Citation URLs

Media authority and navigation/citation authority are separate Pack-owned policies. Approval under one policy never implies approval under the other.

### Navigation and citation URL authority

Each Pack declares a versioned `NavigationCitationUrlPolicy` for evidence-backed citation links, official pages, forms, contacts, and public documents. It assigns each Pack-scoped `navigationRef` or citation URL a semantic role and an exact approved scheme plus, for network URLs, an exact parsed host and optional path constraint. This policy can admit reviewed public citation/form authorities without requiring a media key, image MIME type, or media-host approval.

The shared surface/channel layer resolves the Pack-scoped reference and enforces the declared scheme, exact host where applicable, redirect target, role, Business/Pack scope, channel support, and expiry. Wildcard or suffix-only host matching and model/client-authored arbitrary URLs are forbidden. A navigation result can report only `opened`, `copied`, `prepared`, or a delivery failure; it does not prove that a form or external write completed.

### Media authority

Every media item MUST:

- use HTTPS;
- resolve from a Pack-supplied stable `mediaKey` or reviewed secure URL reference, never a model-authored arbitrary URL;
- match the exact active Pack's approved media scheme, parsed host, and media-key prefix allowlists; wildcard hosts, suffix-only host matching, and unscoped key-prefix matching are forbidden;
- carry non-empty localized alt text;
- reference evidence that establishes source association and permitted semantic role;
- satisfy configured MIME, size, dimensions, freshness, and expiry checks;
- fail safely without hiding canonical text, citations, limitations, or actions.

The Pack declares approved media authorities and semantic roles; the shared surface/channel layer enforces media URL scheme, exact parsed host, exact Pack-scoped key prefix, transport, Business/Pack scope, evidence link, redirect target, and expiry before delivery. A scheme, host, or key prefix accepted for one Pack MUST NOT be accepted for another Pack unless it is independently declared and reviewed in that Pack's versioned media policy. Caches, signed URLs, object paths, and upload destinations are Business-scoped.

No renderer may substitute a generic or different product/document image when the intended evidence-linked media is missing. A URL admitted only by `NavigationCitationUrlPolicy` is not eligible media, and a media-authority URL is not automatically a citation, form, contact, or document navigation target.

## KFC Compatibility Contract

Extraction into a KFC Business Pack is behavior-preserving, not a redesign. The Pack and shared surface MUST preserve:

1. every currently implemented KFC widget kind and semantic, including lifecycle/status meaning, typed/open data, actions, selected action, evidence-driven selection, and expiry; none may be removed, merged, renamed, or reassigned during the presentation extraction;
2. the existing Vietnamese customer wording, lifecycle/status labels, safe fallback phrases, and normalized customer commands;
3. KFC's VND behavior, including dot-separated thousands and the `đ` suffix, as KFC Pack formatting rather than shared-runtime formatting;
4. current action normalization for add-item, fulfillment acceptance, order confirmation, payment-method selection, tracking, and human handoff, with immutable attachment/action revision and evidence validation;
5. the current channel split: KFC app structured companion; Messenger/Zalo standalone text with eligible trusted catalog media; text-only channels without GenUI or social-media cross-contamination;
6. the exact trusted KFC CDN policy for `https://static.kfcvietnam.com.vn`: HTTPS, exact host, no wildcard trust, semantic labels, non-cropping presentation, and text/action survival when media fails;
7. the existing component catalog goldens, focused renderer/action/media tests, GenUI proof, 46-turn dual-mode inventory, and 92-case conjunctive gate without reducing or reinterpreting their assertions.

The authoritative current lists are `services/kfc-agent-backend/src/genui/kfcGenUi.ts` and `apps/kfc_live_monitor_flutter/lib/features/customer_chat/domain/kfc_genui_models.dart`. Both enumerate these 12 kinds: `smartMenuPicker`, `productDetailCard`, `modifierPicker`, `promotionGallery`, `allergenEvidence`, `cartBuilder`, `addressFulfillmentCheck`, `orderReviewConfirm`, `paymentOrderStatus`, `orderTrackingStatus`, `supportHandoff`, and `paymentMethodPicker`. The earlier compatibility-baseline prose says 13, but the repository does not currently define a thirteenth kind. [Issue 08](../issues/08-design-multibusiness-quality-contract-and-kfc-migration.md) MUST record and reconcile that documentation discrepancy against the executable inventory; it MUST NOT invent a thirteenth kind, modify KFC behavior, or silently drop any implemented semantic.

KFC media may migrate from raw trusted URLs to evidence-linked stable media keys only if the customer-visible result, exact-host restriction, failure behavior, and existing media tests remain equivalent.

## PVCFC Presentation Contract

The first PVCFC Pack follows the capability and truthfulness boundaries in [PVCFC Business Pack capabilities and workflows](./pvcfc-business-pack-capabilities-and-workflows.md) and the [public knowledge and crawl fixture inventory](./pvcfc-public-knowledge-and-crawl-fixture-inventory.md).

### Language and citations

- Vietnamese is the primary customer locale.
- For an English request, the Pack MUST use independently verified English evidence when available. Otherwise it MUST disclose that the answer is translated or summarized from a Vietnamese source and retain the Vietnamese source language in the citation.
- The Pack MUST NOT invent English counterparts by adding `/en-US/` to Vietnamese paths.
- Each public factual answer MUST expose canonical source, source title, source language, and publication/effective date when available. Capture date/corpus identity MUST remain traceable and be displayed where freshness or version interpretation depends on it.
- Historical or stale-sensitive prices, promotions, tenders, vacancies, news, documents, and guidance MUST carry explicit historical/stale wording and a current-contact route where appropriate.
- Agronomy presentation MUST preserve required context, caveats, and uncertainty; a card cannot visually upgrade general or historical guidance into a personalized guarantee.

### Public contacts and forms

Public contact, document, shop, and form actions are limited to actions such as:

- open the official page;
- open an official contact method;
- copy a phone number, email address, location, or prepared handoff summary;
- prepare a customer-reviewed handoff summary without transmitting it;
- view or download an evidence-linked public document.

They MUST NOT say or imply `submitted`, `sent`, `booked`, `reserved`, `case created`, `order created`, or another completed external write. The Pack does not bypass CAPTCHA or claim access to private PVCFC systems.

### Synthetic private workflows

Every PVCFC private workflow card MUST carry a persistent `synthetic_demo` badge/banner and customer-visible language equivalent to:

> Đây là dữ liệu và quy trình mô phỏng để minh họa trợ lý; không phải hồ sơ hay giao dịch thật của PVCFC.

The disclosure appears at synthetic capability entry and on every consequential result. A structured badge does not remove the standalone-text requirement. Public crawl answers are cited public evidence and MUST NOT be mislabeled synthetic.

Synthetic sales inquiries, order status/cancellation requests, complaints, and factory visits use PVCFC-specific component and action meanings. They MUST distinguish requests from completed external outcomes, preserve consent and fresh confirmation rules, and show `outcome_uncertain` as reconciliation/unknown rather than success or failure.

The PVCFC Pack MUST NOT expose KFC cart, checkout, voucher, payment, combo, fulfillment, or KFC order-placement vocabulary, components, actions, media, tools, or state. A request for a real PVCFC operation routes to an official public channel rather than silently invoking a synthetic demo.

### Minimum Pack-scoped component families

PVCFC's initial registry MUST be able to project, without KFC renderer reuse by default:

- cited public answer and source list;
- product/specification comparison;
- agronomy context and caution;
- dated price guidance with current-contact action;
- public contact/form handoff summary;
- investor/sustainability document list;
- persistent synthetic-demo disclosure;
- consent prompt and exact confirmation summary;
- synthetic sales inquiry, order-status/cancellation-request, complaint, and visit states;
- uncertainty/reconciliation and official human routing.

These are Pack-scoped semantic families, not additions to a global widget enum.

## Text And Structured Truth Parity

The Business Pack's projection and semantic parity contract MUST establish that canonical text and every structured projection agree on:

- factual claims and their evidence;
- citation identity, authority, limitations, representation/version, and source-language meaning;
- caveats and lifecycle/outcome status;
- whether content is current, stale, historical, translated, partial, public, private, or synthetic;
- whether an action opens, copies, prepares, or performs a write;
- required consent and confirmation;
- uncertainty and reconciliation state;
- permitted next actions.

A component MAY make detail easier to scan, but it MUST NOT carry the sole warning that prevents the text from being misleading. Conversely, canonical text MUST NOT promise an action omitted or forbidden by the structured state. The shared runtime checks only the structural invariants defined above and invokes a declared Pack validator/proof; it does not inspect opaque component data to decide whether Business claims are semantically equivalent. The Pack owns that semantic judgment, and issue 08's executable oracle MUST test it against Pack scenarios without requiring identical typography.

## Failure And Degradation Rules

The safe fallback order is:

1. channel-safe shell with every supported Pack component rendered;
2. canonical text plus supported citations/actions;
3. canonical text with required limitations and a safe retry or official handoff;
4. fail closed when even the canonical text cannot be validated against the Pack/evidence binding.

Component schema mismatch, missing renderer, unsupported channel, rejected media, localization gap, expired action, or stale lifecycle revision MUST NOT cause cross-Pack fallback. The runtime may emit neutral delivery failure chrome, but Business-specific recovery wording comes from the active Pack.

## Low-Cost Prototype Proof

The contract can be proven before runtime migration with two Pack-owned fixture projections passed through one envelope validator and channel projector:

```text
project(verifiedKfcState, kfcPack@current)
  -> BusinessPresentationEnvelopeV1
  -> kfcPack component registry / Vietnamese copy / KFC media policy

project(verifiedPvcfcState, pvcfcPack@v1)
  -> BusinessPresentationEnvelopeV1
  -> pvcfcPack component registry / citation copy / synthetic-demo policy
```

The proof is acceptable only when:

- the shared schema and projector contain no KFC/PVCFC component union or Business-ID conditional;
- an existing KFC fixture preserves its Vietnamese text, VND, action, component, channel, and trusted-media semantics;
- a PVCFC public fixture shows canonical citations, language/source disclosure, and stale/historical treatment where applicable;
- a PVCFC synthetic fixture keeps the demo disclosure in structured and standalone-text profiles;
- swapping a KFC component/media/action reference into a PVCFC envelope, or vice versa, fails validation;
- disabling component or media support leaves a truthful, actionable canonical-text response.

This is a decision/prototype contract, not the full executable acceptance suite.

## Versioning And Change Control

Each rendered record pins independently:

- `contractFamily`, the envelope protocol's major family such as `business-presentation/v1`;
- `envelopeSchemaRevision`, the concrete schema revision such as `1.0` or a later compatible `1.x` revision;
- Pack ID and Pack semantic version;
- presentation/copy catalog version;
- component schema versions;
- channel capability revision;
- lifecycle, persisted attachment, and action revisions;
- evidence, navigation/citation URL policy, and media policy revisions through their references.

A consumer declares the `envelopeSchemaRevision` range it implements within the selected `contractFamily`. Adding an optional envelope field increments the schema minor revision; older consumers may ignore only fields explicitly declared optional and semantics-preserving. Adding a required field, changing an existing field's meaning, or changing canonical-text, citation, action, trust, component-identity, or lifecycle semantics requires a new contract major family. These envelope revisions are independent from Pack releases: Pack copy or optional component data may change under a compatible Pack minor/patch release without changing the envelope schema, while a Pack migration may be required even when the envelope family is unchanged. Old actions are never reinterpreted under a newer schema, Pack, or catalog revision.

## Requirements For Issue 08

[Issue 08](../issues/08-design-multibusiness-quality-contract-and-kfc-migration.md) owns the full executable oracle. It must turn this decision into blocking tests for:

- unchanged KFC customer-visible and action/media behavior, including every kind in the authoritative current 12-kind lists, their semantics, and existing goldens/gates, while explicitly resolving the stale documented count of 13 without inventing a kind;
- Business/Pack/component/action/media isolation and no shared Business-specific branches;
- channel capability failure and text-only degradation;
- locale fallback and source-language disclosure;
- PVCFC citation completeness, freshness/historical labels, public-action wording, synthetic-demo persistence, and absence of KFC commerce vocabulary;
- runtime structural parity enforcement plus Pack-owned semantic canonical-text/structured truth equivalence through Pack scenarios and declared validator/proof behavior;
- separate navigation/citation and media authority policies, including exact scheme/host enforcement, media key-prefix enforcement, evidence/alt-text/expiry rules where applicable, safe failure, and cross-Pack rejection.

Issue 08 may add executable schemas and fixtures, but it must not weaken the ownership or truthfulness rules decided here.

## Decisions Deferred To Issue 09

[Issue 09](../issues/09-assemble-implementation-ready-multibusiness-specification.md) owns runtime/backend migration and rollout details, including:

- concrete module names, directories, language-specific interfaces, and generated-schema tooling;
- extraction order for current KFC presentation code and Flutter renderers;
- PVCFC renderer implementation slices and final deployment-specific navigation/citation scheme-host policy plus separate media scheme-host-key-prefix policy;
- persistence migrations for saved envelopes, customer-run/attachment bindings, and actions;
- the production action path that follows `customerRunAttachmentBindingRef`, reloads the persisted attachment server-side, verifies Business/Pack/environment/session/run/channel/component/action/status/evidence/confirmation/expiry bindings, constrains selections to persisted component data, and only then projects a typed Pack command with evidence and confirmation binding; fixture catalogs remain metadata displays, not execution paths;
- generic revision/envelope support for opaque Pack attachments without promoting KFC protocols, VND formatting, trusted hosts, selectors, action/tool names, or state nouns into neutral interfaces;
- feature flags, compatibility adapters, telemetry, staged rollout, rollback, and removal of temporary KFC bridges;
- deployment-specific URL signing, cache, upload, and channel transport choices.

These are migration guardrails, not implementation work for issue 07. Those choices must implement this contract and issue 08's oracle. They may not move Business copy, component meaning, action semantics, citation policy, or media authority into the shared runtime, and they must not claim that today's KFC persistence is already atomic or multi-Business.
