# PVCFC Business Pack Capabilities And Workflows

## Decision

The first PVCFC Business Pack is a full customer-service **demonstration platform** with two deliberately separate capability classes:

1. **Public, source-backed capabilities** answer from PVCFC's captured first-party website corpus and expose public contact/form/document entry points with citations, dates, freshness, and limitations.
2. **Synthetic private capabilities** demonstrate authenticated customer, sales, order, complaint, and factory-visit workflows through versioned scenario Providers. They never claim to be PVCFC production records or integrations.

The Pack does not inherit KFC's cart, menu, voucher, payment, fulfillment, or retail-order model. The public shop proves that customer-facing commerce UI exists, but the crawl does not define authoritative private APIs or transaction semantics. The first Pack therefore supports product discovery and sales-service workflows, not a fabricated KFC-style fertilizer checkout.

If a customer asks for a real private action and no authoritative PVCFC Provider is configured, the assistant fails closed, states the limitation, and offers the correct public PVCFC channel or form. It does not silently run a synthetic workflow. Synthetic capabilities are available only in a trusted, visibly labelled demo scenario.

## Pack identity and defaults

```text
businessId: pvcfc
packId: pvcfc-customer-service
initial major version: 1
primary locale: vi-VN
supported public content locales: vi, partial en
reference timezone: Asia/Ho_Chi_Minh
public knowledge authority: captured_official_public_fixture
private demo authority: synthetic_scenario_runtime
```

Vietnamese is the primary customer language because the verified English corpus is partial. English requests may use verified English records; when a Vietnamese source is required, the response must disclose that it is translated/summarized from the Vietnamese source rather than inventing an English-equivalent page.

The Pack requires the trusted routing, kernel-and-pack, and evidence contracts already decided in issues 03-05. Business identity, customer authorization, environment, corpus, and scenario are supplied by trusted runtime context, never by prompt text.

## Knowledge domains and customer intents

| Domain | Customer intents | Truthful outcome |
|---|---|---|
| Company | identity, history, facilities, capacity, business activities | cited public profile answer |
| Products | browse categories, compare products, composition, benefits, packaging, crop fit, usage | exact product/category evidence; no unsupported equivalence |
| Agronomy | nutrient roles, deficiency guidance, crop/stage/soil application, rice guidance | context-bound cited guidance with safety caveats |
| Price | reference price, where to ask for a quote, promotion | dated guidance and current-contact route; never a live quote from crawl |
| Distribution | office, hotline, email, dealer/store listing | public contact/directory evidence with freshness limitation |
| Support/forms | inquiry fields, survey, factory-visit form, public entry points | explain/prepare handoff; no claim of form submission unless Provider exists |
| Digital services | Anh Hai Cà Mau, 2 Nông, urban agriculture, DMS, CRM, RFID | public description and source; no private access |
| Investor relations | annual/financial/shareholder/governance/analyst documents | list and cite document metadata/body evidence |
| Sustainability | ESG, environment, Net Zero direction, reports, social welfare | source-backed dated answer/document retrieval |
| Corporate updates | news, press, promotions, procurement, careers | dated listing/item answer; expiry/open-state caveat |
| Legal/privacy | terms, privacy collection/use/rights | cite captured policy; no legal conclusion or private-data action |
| Misconduct reporting | reporting phone/email and safe routing | direct official channel; avoid collecting allegation in ordinary chat |
| Customer identity | view a demo customer profile and authorized capabilities | synthetic only, subject/scenario scoped |
| Sales service | create and track a consultation/quote inquiry | synthetic only; consent and confirmation before submission |
| Order service | look up/status and request cancellation for a demo order | synthetic only; authentication and confirmation for mutation |
| Complaints | create, track, supplement, or escalate a demo complaint | synthetic only; consent, evidence, bounded escalation |
| Factory visit | check demo availability, reserve, view, or cancel | synthetic only; public hours/locations are not private availability |
| Human support | ask for real assistance or reach official channel | public channel handoff; no fabricated case/ticket |

The public inventory and its 24-artifact, 71-source manifest are the knowledge authority (`docs/wayfinder/pvcfc-multibusiness-chatbot/assets/pvcfc-public-knowledge-and-crawl-fixture-inventory.md`, `docs/wayfinder/pvcfc-multibusiness-chatbot/assets/pvcfc-crawl/manifest.json:1-32`).

## Capability registry

### Public knowledge capabilities

#### `pvcfc.knowledge.search`

Input:

```text
query
contentTypes[]
locale
optional asOf/publication range
optional product/crop/topic filters
```

Output: ranked typed knowledge items with title, content type, language, canonical URL, dates, corpus/artifact/content hashes, freshness, authority, and citation payload.

Policy:

- Search/discovery artifacts cannot directly support a fact.
- First-party captured page/document evidence is required for claims.
- The result is retrieval evidence, not final customer prose.
- Cross-language fallback is explicit and preserves the source language.

#### `pvcfc.product.get`

Input: verified product identity or a bounded name/category query.
Output: product/category facts, formulations, packaging, benefits, crop/usage directions, source and capture/publication metadata.

Policy:

- Do not merge similarly named products without a verified alias relationship.
- Composition, dosage, and packaging belong to the exact product/version evidence.
- The website catalog is preferred for specifications; shop observations are merchandising/UI evidence.
- If a requested product is ambiguous, return candidates and require selection.

#### `pvcfc.agronomy.get_guidance`

Input:

```text
crop
question/topic
optional growthStage
optional soil/location/problem context
optional product identity
locale
```

Output: source passages/facts, applicable crop/stage/product context, units, cautions, date, and citation.

Policy:

- Ask for crop and the minimum missing context before giving dosage or stage-specific guidance.
- Never convert a crop-, stage-, soil-, or product-specific value into universal advice.
- Prefer exact product-label/detail guidance over older general articles when scope conflicts, while disclosing sources.
- Do not diagnose poisoning, environmental contamination, animal/human illness, or guarantee yield/safety.
- For high-consequence uncertainty, product damage, suspected misuse, or conflicting evidence, provide conservative public guidance and route to PVCFC/agronomic support.

#### `pvcfc.price.get_guidance`

Input: product/category, geography, quantity/context, desired date.
Output: dated public reference statements/ranges where captured, public caveats, and current contact/dealer channels.

Policy:

- Never label a captured article or `Liên hệ đại lý` shop display as a live transaction quote.
- State publication/capture date and that region, dealer, quantity, and time can change price.
- If freshness policy has expired, omit numeric price or present it only as explicitly historical, then route to a current quote channel.
- Never claim inventory, credit terms, delivery, or dealer authorization from a price/listing fixture.

#### `pvcfc.contact.find`

Input: purpose, optional geography/channel preference.
Output: verified headquarters/branch/hotline/email/dealer or specialized reporting channels, source and freshness.

Policy:

- Match the purpose: general support, sales/dealer, misconduct reporting, investor information, factory visit, careers/procurement.
- A dealer article is directory evidence, not current stock or endorsement proof.
- For misconduct allegations, provide the official reporting phone/email promptly and do not encourage disclosure of sensitive details in ordinary assistant chat.

#### `pvcfc.public_entrypoint.explain`

Input: entry-point type such as contact inquiry, survey, factory visit, shop order lookup, DMS/CRM/RFID, careers, or procurement.
Output: public URL, observed fields/behavior, CAPTCHA/dynamic limitations, and what the assistant can/cannot perform.

Policy:

- Visible UI establishes only an entry point.
- Do not infer a private API, successful submission, account access, availability, order record, SLA, or workflow status.
- Offer to prepare a customer-owned summary they can paste into the official channel, without transmitting it.

#### `pvcfc.document.list` and `pvcfc.document.get`

Input: document domain/category, year/date/query, locale; exact document identity for `get`.
Output: listing metadata and, when captured/extracted, document-body evidence.

Policy:

- Listing metadata does not support an uncaptured figure inside the document.
- Preserve HTML/PDF/MP4 representation and report-year/version relationships.
- Investor document retrieval is informational, not investment advice.
- Financial figures require direct document-body evidence and precise period/consolidated-vs-separate context.

#### `pvcfc.news.list`

Input: section, date range, query, locale.
Output: dated public items and freshness/open-state limitations.

Policy: promotions, tenders, and vacancies cannot be called active from stale listing evidence.

### Public handoff capability

#### `pvcfc.handoff.prepare_public_contact`

This capability does **not** submit data. It returns:

- the appropriate verified public channel/form URL;
- a customer-reviewed summary draft;
- fields the official form is expected to request;
- sensitive-data caution and freshness/source evidence.

No Provider record, ticket, appointment, order, or complaint ID is created. Clicking/opening a URL is a presentation action owned by the customer channel, not proof of delivery.

### Synthetic private capabilities

Every capability below requires:

- trusted `synthetic_scenario_runtime` binding;
- visible demo/synthetic disclosure in state, evidence, and presentation;
- scenario instance, fixture-set/version, release, customer/session binding, expiry, and revision;
- no real PVCFC customer data;
- capability-specific authenticated demo subject and scope;
- no fallback from or to an authoritative real Provider.

#### Customer

- `pvcfc.synthetic.customer.get_profile`
- `pvcfc.synthetic.customer.list_capabilities`

Reads a demo profile and authorized scenario capabilities. It never searches by arbitrary phone/email or exposes another scenario subject.

#### Sales inquiry

- `pvcfc.synthetic.sales.create_inquiry`
- `pvcfc.synthetic.sales.get_inquiry`
- `pvcfc.synthetic.sales.cancel_inquiry`

An inquiry can include selected public product evidence, geography, quantity/timeframe, contact preference, and customer-provided contact details. It is a service request, not a quote, sale, inventory reservation, credit approval, or order.

#### Order service

- `pvcfc.synthetic.order.list`
- `pvcfc.synthetic.order.get_status`
- `pvcfc.synthetic.order.request_cancellation`

Order records are pre-existing synthetic scenario state. The Pack does not implement a retail cart/payment flow. Cancellation is a request with its own status; the assistant does not claim an order is cancelled until the synthetic Provider commits that state.

#### Complaint

- `pvcfc.synthetic.complaint.create`
- `pvcfc.synthetic.complaint.get_status`
- `pvcfc.synthetic.complaint.add_message`
- `pvcfc.synthetic.complaint.request_human_review`

Complaint categories may cover product quality, packaging, dealer/service experience, delivery/order service, agronomy support, or other. Safety/environmental incidents trigger conservative escalation guidance; the synthetic record is not a report to real PVCFC.

#### Factory visit

- `pvcfc.synthetic.visit.check_availability`
- `pvcfc.synthetic.visit.reserve`
- `pvcfc.synthetic.visit.get`
- `pvcfc.synthetic.visit.cancel`

Publicly captured windows and locations seed the demo, but available dates/slots and reservations come only from the synthetic Provider. The Pack never transforms public opening windows into a confirmed booking.

## Pack state

The runtime owns the durable envelope; the Pack owns this schema and reducer:

```text
PvcfcDomainState
  activeLocale
  selectedKnowledgeContext
    productRef
    crop / growthStage / soilOrLocation
    evidenceRefs
  publicContactDraft
    purpose / customerReviewedSummary / fields
  syntheticAccess
    scenarioInstanceRef / subjectRef / scopes / expiry
  salesInquiry
    draft / consent / pendingConfirmation / record / revision
  selectedOrderRef
  orderEvidence / pendingCancellationConfirmation / cancellationRequest
  complaint
    draft / consent / pendingConfirmation / record / revision / escalation
  factoryVisit
    draft / availabilityEvidence / pendingConfirmation / reservation / revision
  handoff
    purpose / channelEvidence / syntheticOrRealLimitation
  capabilityTraceRefs / evidenceRefs
```

State rules:

- Public evidence is stored by immutable evidence reference, not copied as untraceable model prose.
- Search/planner candidates remain turn-local until selected and verified.
- Private contact fields are minimized and persist only after the relevant consent policy permits it.
- Synthetic records are exposed only while trusted scenario/customer/session binding and scope remain valid.
- An expired or mismatched scenario clears private synthetic projections without deleting the audited Provider history.
- Product/crop context never authorizes a sales/complaint/visit write.
- A new mutation invalidates its pending confirmation and any downstream claim bound to the old draft/revision.
- Real/public handoff state and synthetic records remain distinct.

## Workflow state machines

### 1. Public answer

```text
unresolved
  -> clarified when identity/context is ambiguous
  -> evidence_retrieved
  -> evidence_validated for authority, scope, language, freshness
  -> answered_with_citations
  OR unsupported / stale_revalidation_required / public_handoff_offered
```

No source-backed answer may skip evidence validation. Fluent model knowledge does not satisfy the transition.

### 2. Public contact handoff

```text
purpose_identified
  -> official_channel_retrieved
  -> optional_summary_drafted
  -> customer_reviewed
  -> channel_presented
```

Terminal outcome is “channel/summary provided,” never “submitted,” “case opened,” or “PVCFC will contact you.” CAPTCHA and third-party form completion remain customer actions unless a future authoritative capability explicitly changes the contract.

### 3. Synthetic sales inquiry

```text
draft
  -> required_fields_complete
  -> privacy_consent_recorded
  -> confirmation_pending [bound to exact draft + scenario/provider revision]
  -> submitted_synthetic
  -> in_review | contact_scheduled | closed | cancelled
```

Changing product, quantity, geography, contact details, purpose, scenario, or Provider revision invalidates confirmation. “Contact scheduled” must come from Provider state; it is not inferred from submission.

### 4. Synthetic order service

```text
scenario_authorized
  -> order_selected from scoped Provider evidence
  -> current_status_retrieved
  -> optional cancellation_requested_by_customer
  -> cancellation_confirmation_pending
  -> cancellation_request_committed
  -> accepted | rejected | pending_review
```

The Pack checks current status immediately before cancellation. Terminal/otherwise ineligible orders reject mutation. A cancellation request is not equivalent to cancellation.

### 5. Synthetic complaint

```text
draft
  -> category_and_minimum_details_complete
  -> privacy_consent_recorded
  -> confirmation_pending
  -> submitted_synthetic
  -> acknowledged | in_review | awaiting_customer | resolved | closed
  -> optional human_review_requested
```

A safety/environment incident can bypass ordinary conversational optimization to show urgent official channels, but the assistant must still say that a synthetic complaint was not sent to real PVCFC.

### 6. Synthetic factory visit

```text
draft_location_and_window
  -> availability_checked at current synthetic revision
  -> visitor/contact details complete
  -> privacy_consent_recorded
  -> confirmation_pending [slot + details + revision]
  -> reserved_synthetic
  -> cancelled | completed
```

Changing slot/location/visitor details invalidates confirmation. Public hours are informative prerequisites, not availability evidence.

## Consent and confirmation policy

### No explicit consent required

- retrieving public knowledge/documents;
- showing official public contact channels;
- asking non-sensitive clarification about product, crop, topic, geography, or document period;
- preparing a draft that remains turn-local and is not transmitted or durably stored.

### Privacy consent required before durable private draft/write

- storing name, phone, email, address, company, visit details, complaint narrative, or other contact/private fields;
- creating or supplementing a synthetic sales inquiry, complaint, or visit request.

The assistant states purpose, synthetic/real destination, minimum fields, and retention/reset behavior appropriate to the scenario. Refusal leaves public assistance available.

### Explicit confirmation required

- create or cancel a sales inquiry;
- submit or supplement a complaint when it changes Provider state;
- request human review/escalation in the synthetic system when it creates a side effect;
- request order cancellation;
- reserve or cancel a factory visit;
- any future external message or private-record mutation.

Confirmation is bound to Business/environment, scenario/customer/session, capability, exact normalized payload hash, relevant public evidence where used, Provider binding/revision, and expiry. A generic earlier “yes” cannot authorize a changed action.

## Escalation and official routing

Offer or prioritize official human/public routing when:

- the customer explicitly requests a person or real PVCFC action;
- a real customer/order/complaint/sales/visit record is requested but only synthetic capability exists;
- agronomy evidence is missing, conflicting, too general, or high consequence;
- suspected poisoning, injury, environmental release, crop damage, counterfeit product, severe quality issue, or urgent safety concern is described;
- a payment, legal, privacy-right, investor-specific, procurement, or employment question exceeds public evidence;
- a synthetic Provider is unavailable, expired, uncertain after commit, or cannot reconcile;
- the customer needs accessible support not supported by the current channel.

Routing choices:

- general/public support: captured headquarters/branch email, hotline, or inquiry form;
- sales/current price/dealer: appropriate public contact/dealer route with freshness caveat;
- misconduct: dedicated captured phone/email, without collecting the allegation in ordinary chat;
- factory visit: official captured visit page;
- investor/sustainability: exact public document/page before generic contact;
- careers/procurement: exact public listing/section;
- emergencies: advise appropriate local emergency/professional services where warranted, then official PVCFC contact.

The Pack does not invent response times, case IDs, guarantees, or successful delivery.

## Fail-closed rules

| Situation | Required behavior |
|---|---|
| No first-party evidence for a public fact | Clarify, say evidence is unavailable, or route; do not answer from model memory as PVCFC fact |
| Search snippet only | Use for discovery, not a customer claim |
| Public source stale for a high-churn claim | Revalidate or present only as historical with date; offer current contact |
| Product identity ambiguous | Return candidates and require selection |
| Agronomy context insufficient | Ask minimum clarifying questions; avoid dosage/prescription |
| Public form/UI observed but no Provider | Explain fields/URL; do not claim submission or record access |
| Real private request with synthetic capability available | Do not invoke automatically; explain demo limitation and offer real public route |
| Synthetic scenario not trusted/expired/mismatched | Withhold private state and deny capability |
| Synthetic result missing limitation/provenance | Treat result as invalid |
| Provider write timeout after dispatch | Report uncertainty, reconcile, and do not blindly retry or claim success/failure |
| Authorization or scope missing | Deny without revealing record existence; retain public assistance |
| Private capability absent | Unsupported/public handoff, never KFC commerce fallback |

## Customer-visible limitation language

Every synthetic private result must communicate the equivalent of:

> Đây là dữ liệu và quy trình mô phỏng để minh họa trợ lý; không phải hồ sơ hay giao dịch thật của PVCFC.

The wording can be localized and adapted to the channel, but it must be visible at capability entry and consequential result. Repeating it on every sentence is unnecessary when the presentation maintains a persistent demo marker and the result itself remains unambiguous.

Public crawl answers use a different disclosure: they cite the official page/document and relevant publication/capture date; they are not called synthetic.

## Presentation inputs for issue 07

The Pack will need presentation projections for:

- cited public answer and source list;
- product/specification comparison;
- agronomy context/caution card;
- dated price guidance with current-contact action;
- public contact/form handoff summary;
- investor/sustainability document list;
- persistent synthetic-demo banner/badge;
- consent prompt and exact confirmation summary;
- synthetic sales inquiry, order status/cancellation, complaint, and visit cards;
- uncertainty/reconciliation and human-route states.

Actions are generated only from capability/state policy and carry exact evidence/confirmation bindings. A public URL action never masquerades as an assistant-side submission.

## Minimum scenario inventory for issue 08

The executable PVCFC quality contract must include at least:

### Public knowledge

- company identity/facility/capacity with citations;
- product category and exact product composition/packaging distinction;
- ambiguous product clarification;
- crop/stage-specific agronomy answer and missing-context clarification;
- conflicting/general-vs-product guidance behavior;
- dated/stale price response and current-contact route;
- headquarters/branch/general/misconduct routing;
- public form explanation without submission claim;
- investor document listing and direct-body requirement for a financial figure;
- sustainability HTML/PDF version relationship;
- Vietnamese primary and verified/partial English fallback;
- promotion/tender/vacancy freshness/open-state refusal;
- discovery-only evidence rejection.

### Synthetic private workflows

- denied access without trusted demo scenario/authentication/scope;
- visible synthetic disclosure and evidence on every private result;
- create/track/cancel sales inquiry with consent and confirmation invalidation;
- order lookup/status and cancellation-request state distinction;
- complaint creation, later message, status, and human review without unrelated side effects;
- factory availability/reservation/cancellation with stale-slot revalidation;
- expired scenario and cross-customer/session isolation;
- pre-commit failure versus post-commit uncertainty/reconciliation;
- request for real PVCFC action routes publicly instead of using synthetic state;
- no cart/payment/KFC tools or state in PVCFC cases.

### Shared guarantees

- trusted Business cannot be changed by message/model;
- evidence authority/freshness and Business scope are correct;
- public, synthetic, and unsupported paths never blur;
- transcript/state/checkpoint/evidence persistence is readable and isolated;
- text and structured presentation express the same truth and permitted actions.

## What the first Pack intentionally does not do

- access or modify real PVCFC customer, dealer, employee, order, complaint, sales, visit, DMS, CRM, RFID, or identity records;
- submit public CAPTCHA forms;
- purchase shop products, create a real cart, quote current inventory/price, take payment, or promise delivery;
- give universal or guaranteed agronomic prescriptions;
- provide emergency, medical, legal, or investment-professional advice;
- infer English page equivalents, current tender/vacancy/promotion status, or report contents not directly captured;
- turn synthetic demo data into real-looking PVCFC evidence;
- reuse KFC tools, state, fixtures, subjects, Providers, or customer-facing components by default.

These omissions are deliberate truthfulness boundaries, not gaps to hide with model improvisation.
