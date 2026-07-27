# PVCFC Public Knowledge And Crawl Fixture Inventory

Captured: 2026-07-21  
Authority: public first-party PVCFC web properties only  
Raw corpus: [`pvcfc-crawl/raw/`](./pvcfc-crawl/raw/)  
Machine manifest: [`pvcfc-crawl/manifest.json`](./pvcfc-crawl/manifest.json)

## Answer

A full-service PVCFC assistant needs a public-knowledge Provider that covers corporate identity, products and specifications, agronomy, prices and distribution guidance, contact and escalation channels, customer-facing forms, digital services, investor relations, sustainability, news, procurement, careers, legal policies, and Vietnamese/English variants. The 2026-07-21 TinyFish corpus captures 24 immutable raw artifacts representing 71 successful page or dynamic-page captures across four first-party hosts. Every artifact is byte-counted and SHA-256 hashed in the manifest.

The public site also exposes interfaces that imply private capabilities: inquiry submission, consultation requests, shop search/cart/login/order lookup, factory-visit reservations, surveys, DMS, CRM, and RFID. Their visible fields and public descriptions are useful interface evidence, but they are **not** authoritative API contracts, authenticated records, order status, customer state, appointment availability, or proof that an assistant can execute those workflows. Until PVCFC supplies authoritative contracts and access, later Business Packs must model such workflows with explicitly synthetic Providers and must never present synthetic results as PVCFC records.

## Corpus And Provenance

- Retrieval tool: TinyFish CLI 0.2.0.
- Capture date: 2026-07-21.
- First-party hosts observed:
  - `www.pvcfc.com.vn`
  - `bikipvang.pvcfc.com.vn`
  - `shop.pvcfc.com.vn`
  - `thamquannhamay.pvcfc.com.vn`
- Raw artifacts are preserved without normalization under [`pvcfc-crawl/raw/`](./pvcfc-crawl/raw/).
- [`manifest.json`](./pvcfc-crawl/manifest.json) records the artifact path, capture type, byte length, full SHA-256, filesystem modification time, source URLs, canonical redirects, titles, languages, publication metadata, extracted-content hashes, link/media counts, errors, and TinyFish agent run metadata.
- Search captures are discovery evidence, not authority for a fact. A fact becomes fixture material only when it is supported by captured first-party page or document content.
- Filesystem modification time is preservation metadata, not the page publication date. Use `published_at` only where TinyFish extracted it or where a dynamic document listing supplied an explicit date.
- A refresh must create a new dated corpus/version, preserve the prior corpus, rerun discovery plus authoritative fetches, and compare source/content hashes. Do not silently mutate an existing fixture version.

### Dynamic run provenance

| Surface | Authoritative URL | TinyFish run | Result |
|---|---|---|---|
| Contact | `https://www.pvcfc.com.vn/lien-he` | `ce829e47-29ae-43c1-b49e-4107b52ee794` | Completed; contacts, inquiry fields, CAPTCHA, tab behavior |
| Investor relations | `https://www.pvcfc.com.vn/quan-he-dau-tu` | `53546675-e1df-49e2-93e7-c70c66aa1ced` | Completed; categories, year/search filters, 20 recent documents |
| Sustainability reports | `https://www.pvcfc.com.vn/bao-cao-phat-trien-ben-vung` | `e3cea56f-9a9d-4be1-a36c-b8e1b6b072ab` | Completed; 2023–2025 PDF and online reports |
| Public shop | `https://shop.pvcfc.com.vn/` | `21c2201b-7253-40fb-9400-8d2841bc3399` | Completed; 11 categories, 20 visible products, public UI only |
| Factory visit | `https://thamquannhamay.pvcfc.com.vn/` | `0da2fdf6-793f-4a9b-9834-2827d7a63c2c` | Completed; visit details, survey and reservation fields |

The two subdomain agent goals explicitly prohibited adding to cart, purchasing, entering data, or submitting forms. Both completed with `error: null`.

## Content Taxonomy

Later knowledge fixtures should classify each item by one primary `content_type` and optional tags:

| `content_type` | Scope | Minimum fixture fields |
|---|---|---|
| `corporate_profile` | identity, history, mission, facilities, capacity | title, canonical URL, language, extracted assertions, source hash |
| `product_category` | single fertilizers, NPK, organic, other families | category name, description, product links, canonical URL |
| `product_specification` | composition, benefits, crops, dosage, packaging | product name, formulation, instructions, packaging, source URL/hash |
| `agronomy_guidance` | crop stages, soil conditions, application practices | crop/topic, guidance, cautions, publication date, source URL/hash |
| `price_guidance` | reference ranges and price caveats | product/type, amount, unit, effective/publication date, caveat |
| `distribution_contact` | offices, hotline, dealer lists, misconduct channel | channel type, value, geography, source URL/hash |
| `public_form` | visible inquiry, survey, reservation, lookup fields | purpose, fields, required flags, CAPTCHA, submit label, observed date |
| `digital_service_description` | Anh Hai Cà Mau, 2 Nông, urban agriculture, DMS/CRM/RFID | service name, public description, audience, source URL/hash |
| `investor_document` | shareholder, financial, annual, governance materials | title, category, publication date, file type, document URL |
| `sustainability_content` | ESG strategy, environment, social programs | topic, reporting period/date, URL, document relationship |
| `news_or_announcement` | company news, promotions, press coverage | title, section, publication date, canonical URL |
| `procurement_or_career` | tenders and recruitment | title, type, date/status where present, canonical URL |
| `legal_policy` | terms and privacy | policy title, publication/update date, canonical URL, content hash |
| `discovery_index` | robots, sitemap, site map, search results | source, discovered URLs, retrieval date; never answer facts directly |

All fixture records also need `business_id`, `authority_kind`, `language`, `retrieved_at`, `corpus_id`, `artifact_path`, `artifact_sha256`, and `content_sha256`. Documents need `media_type`, `document_url`, `reporting_period`, and an explicit relationship such as `online_version_of` or `download_version_of` when both HTML and PDF represent the same report.

## Public Knowledge Inventory

### 1. Corporate identity and company profile

Authoritative starting points:

- `https://www.pvcfc.com.vn/`
- `https://www.pvcfc.com.vn/gioi-thieu`
- `https://www.pvcfc.com.vn/en-US/`

Captured public assertions include:

- PVCFC was established on 9 March 2011.
- Its stated primary activities include production, trading, and import/export of fertilizer and petrochemical products for agriculture.
- The profile identifies three plants: Cà Mau Urea Plant, Cà Mau NPK Plant, and Hàn-Việt NPK Plant, with stated combined capacity approaching 1.5 million tonnes of fertilizer per year.
- These facts should remain tied to the profile capture because company descriptions, facility names, and capacity can change.

### 2. Product catalog and specifications

Category authorities:

- `https://www.pvcfc.com.vn/san-pham`
- `https://www.pvcfc.com.vn/phan-don`
- `https://www.pvcfc.com.vn/npk`
- `https://www.pvcfc.com.vn/phan-huu-co`
- `https://www.pvcfc.com.vn/phan-bon-khac`

The catalog groups products into mineral/biological products such as N.Humate+TE and Urea Bio, single fertilizers such as Urea, N46.Plus, SA and Kali, compound products such as NPK and DAP, and OM Cà Mau organic products.

The corpus includes 15 dedicated product pages:

- Single/basic: Urea granule, N46.Plus Cà Mau, Urea Bio, N.Humate+TE 28-5, Kali Cà Mau 61, and DAP Cà Mau 18-46.
- NPK: 16-16-8+TE, 20-5-5, Gold 20-20-15+TE, and HAOSITE 18-6-6+TE.
- Organic: OM Cà Mau ECO, GREEN, HAPPY, INNOVA, and RICH.

Representative captured specification facts include packaging weights, crop-specific dosage, nutrient/formulation claims, and usage benefits. For example, the Urea granule page states a 50 kg net package; N46.Plus lists 50/40/25 kg packaging and biuret below 0.99% by mass; and Urea Bio describes `Bacillus spp.` at `1.0 × 10^6 CFU/g`. Such values must be answered from the exact product fixture, not generalized across the catalog.

The public shop separately exposed 11 categories and 20 visible products, but all observed prices were `Liên hệ đại lý` and product clicks did not expose stable unique URLs. The website catalog pages are therefore the preferred specification authority; shop observations are current merchandising/UI evidence only.

### 3. Agronomy and crop guidance

Authorities include:

- `https://www.pvcfc.com.vn/ky-thuat-va-hieu-qua`
- `https://www.pvcfc.com.vn/tu-van-ky-thuat`
- `https://www.pvcfc.com.vn/nghien-cuu-va-phat-trien`
- `https://www.pvcfc.com.vn/phan-bon-la-gi`
- `https://www.pvcfc.com.vn/cach-bon-phan-cho-cay-trong`
- `https://www.pvcfc.com.vn/phan-bon-cho-cay-lua`
- `https://bikipvang.pvcfc.com.vn/`
- `https://bikipvang.pvcfc.com.vn/cay-lua/`

The material covers nutrient roles, fertilizer classes, deficiency symptoms, soil/crop matching, application methods, and crop-stage guidance. The rice article distinguishes seedling/soil preparation, tillering, panicle formation, flowering, and grain filling, while the Bí Kíp Vàng subdomain provides a separate crop-tip stream.

Agronomy answers require stronger safeguards than general corporate answers:

- Preserve crop, soil, growth stage, formulation, dosage, unit, and publication date together.
- Quote or summarize the source; do not transform a crop-specific dose into universal advice.
- Treat potentially conflicting or newer product-label instructions as higher priority than an older general article.
- Encourage professional/local agronomic confirmation where field conditions materially affect safe use.

### 4. Prices, distribution, and contact channels

Authorities:

- `https://www.pvcfc.com.vn/lien-he`
- `https://www.pvcfc.com.vn/bang-gia-phan-bon`
- `https://www.pvcfc.com.vn/gia-phan-bon`
- `https://www.pvcfc.com.vn/dai-ly-va-cua-hang-phan-bon-uy-tin`
- `https://www.pvcfc.com.vn/khuyen-mai`

Captured contacts:

- Headquarters: 647–649 Ngô Quyền Street, An Xuyên Ward, Cà Mau Province; `0290.3819000`; `contact@pvcfc.com.vn`; hotline `1800888606`; fax `0290 3590501`.
- Ho Chi Minh City office: 173–179 Trương Văn Bang Street, Cát Lái Ward, Ho Chi Minh City; `028.2208.5555`; the same public email and hotline.
- Misconduct-reporting channel: `0798 041 041` and `tiepnhanthongtin@pvcfc.com.vn`.

The captured price article explicitly says prices vary by region, dealer, and purchase time. Any numerical range in that article is dated reference guidance, not a live quote or contractual selling price. The assistant should direct users to PVCFC/dealers for current prices. Dealer entries are public directory/article data, not proof of current stock, territory, endorsement status, or fulfillment capability.

### 5. Public support and service-entry surfaces

The contact page has office tabs that dynamically update details and map state. Its inquiry form asks for name, company, phone, email, and a message; it has CAPTCHA and a `Gửi` button.

The product catalog pages expose a consultation prompt/form, but the corpus does not establish a supported API or response-time contract.

The factory-visit subdomain exposes:

- Public visit windows: 08:00–11:00 and 13:00–16:00.
- Locations: Cà Mau Fertilizer Plant and Hàn-Việt NPK Plant.
- A survey with name, email, phone, source, feedback, and consent fields.
- A reservation form with name, email, phone, visit window, and location.
- A 3D virtual-tour interface; some style/map resources failed during capture.

The public shop exposes product search, cart, profile/login, phone-based order lookup, and product browsing. It is an SPA and product interactions did not yield stable item URLs in the capture.

### 6. Digital-service descriptions

Captured entry points:

- `https://www.pvcfc.com.vn/dich-vu-giai-phap`
- `https://www.pvcfc.com.vn/anh-hai-ca-mau`
- `https://www.pvcfc.com.vn/2-nong`
- `https://www.pvcfc.com.vn/nong-nghiep-do-thi`
- `https://www.pvcfc.com.vn/dms`
- `https://www.pvcfc.com.vn/crm`
- `https://www.pvcfc.com.vn/rfid`

Several of these pages yielded limited fetch text beyond shared navigation/footer content. They establish discoverable first-party service names and entry points, but not complete functional contracts. Later refreshes should use dynamic extraction where richer customer-facing behavior is needed.

### 7. Investor relations and downloadable media

Authorities:

- `https://www.pvcfc.com.vn/quan-he-dau-tu`
- `https://www.pvcfc.com.vn/bao-cao-thuong-nien`
- `https://www.pvcfc.com.vn/bao-cao-tai-chinh`
- `https://www.pvcfc.com.vn/dai-hoi-dong-co-dong`
- `https://www.pvcfc.com.vn/en-US/investor-relations`

Observed categories are shareholder meetings, annual reports, financial statements, important-event calendar, other disclosures, charter/regulations, and analyst material. The dynamic capture records 20 recent items, including PDF disclosures and reports, an online HTML annual report, and an MP4 shareholder-meeting summary. Year selection and text search dynamically filter the document grid.

Document fixtures must preserve title, displayed date, category, file type, and direct document URL. The landing page is authority for listing metadata; the document itself is authority for its contents. Never answer a financial figure solely from a search snippet or filename.

### 8. Sustainability and environment

Authorities:

- `https://www.pvcfc.com.vn/phat-trien-ben-vung`
- `https://www.pvcfc.com.vn/bao-cao-phat-trien-ben-vung`
- `https://www.pvcfc.com.vn/bao-cao-ket-qua-do-dac-moi-truong`
- `https://www.pvcfc.com.vn/An-sinh-xa-hoi`

The sustainability landing content describes ESG measurement/action and a Net Zero direction involving production efficiency, reduced energy/material input, and greener/circular product development.

The report listing dynamically exposes paired downloadable/online editions:

- 2025: PDF dated 19 March 2026 and online HTML dated 23 June 2026.
- 2024: PDF and online HTML dated 21 August 2024.
- 2023: PDF and online HTML dated 16 September 2023.

PDF and online editions for the same reporting year are versions of one report family, not six unrelated reports. Preserve each representation and link it to a shared reporting-period identity; do not assume byte/content equality.

### 9. News, promotions, procurement, careers, and corporate updates

Authorities:

- `https://www.pvcfc.com.vn/tin-tuc`
- `https://www.pvcfc.com.vn/tin-hoat-dong-cong-ty`
- `https://www.pvcfc.com.vn/bao-chi-noi-ve-pvcfc`
- `https://www.pvcfc.com.vn/khuyen-mai`
- `https://www.pvcfc.com.vn/moi-thau`
- `https://www.pvcfc.com.vn/tuyen-dung`

These are high-churn classes. Store item-level publication dates and canonical URLs and refresh more frequently than corporate-profile or legal fixtures. A listing-page capture is insufficient evidence that a promotion, tender, or vacancy remains open.

### 10. Legal and privacy

Authorities:

- `https://www.pvcfc.com.vn/dieu-khoan-su-dung`
- `https://www.pvcfc.com.vn/chinh-sach-bao-mat`

The privacy capture describes collection and use of names, phone numbers, email, and addresses; contact/support and marketing/analysis purposes; user access/correction/complaint rights; and a complaint-response statement. These pages are legal source material and should be quoted with their captured publication/update metadata. They do not by themselves define the assistant's privacy design or grant access to stored personal data.

### 11. Language variants

Successful English captures:

- `https://www.pvcfc.com.vn/en-US/`
- `https://www.pvcfc.com.vn/en-US/camau-fertilizers-product`
- `https://www.pvcfc.com.vn/en-US/investor-relations`

The guessed paths `/en-US/about-us` and `/en-US/contact-us` returned `page_not_found`. English coverage is therefore partial and must not be inferred by mechanically prefixing Vietnamese routes. Fixtures need independent language records connected by a `translation_of` relationship only when page meaning/identity has been verified.

## Dynamic, Blocked, Duplicate, And Freshness Findings

### Dynamic behavior

- Contact details and maps change through office tabs without full navigation.
- Investor and sustainability grids use client-side year/search filtering.
- The shop is an SPA; visible product clicks did not expose stable per-product URLs.
- Factory visit uses a 3D virtual-tour experience and dynamic forms.
- Forms were inspected but not submitted.

### Failed or fallback routes

- `https://www.pvcfc.com.vn/sitemap.xml` returned `page_not_found`; working alternatives were `sitemap.ashx`, `product/productsitemap.ashx`, and `news/newssitemap.ashx`.
- `https://www.pvcfc.com.vn/cong-bo-thong-tin` returned `page_not_found`; the investor taxonomy and current routes should be discovered from the investor page/site map.
- Static fetch returned `proxy_error` for shop and factory-visit hosts; TinyFish browser-agent captures succeeded.
- The English `about-us` and `contact-us` guesses returned `page_not_found`.

### Duplicate and version rules

- Normalize redirects to `canonical_url` while retaining `requested_url`.
- Deduplicate identical content only when content hashes and authority context match; shared headers/footers are not page identity.
- Keep list pages, detail pages, and direct documents as separate records with explicit relationships.
- Pair HTML/PDF editions by report type and reporting period, not filename alone.
- Preserve historical articles even when newer articles cover the same topic; rank by publication date and specificity at answer time.
- Treat shop names and catalog product pages as possible aliases until a stable product identifier or verified canonical relationship exists.

### Suggested refresh policy

| Class | Suggested cadence | Reason |
|---|---|---|
| Price, promotion, shop, tender, vacancy, news | daily to weekly for a live deployment | high volatility or expiry |
| Contact, dealer/distribution, public forms | monthly and on failed health checks | operational change risk |
| Product catalog/specifications and agronomy | monthly to quarterly, plus sitemap change | material safety/usage impact |
| Investor disclosures | daily to weekly during reporting/event periods | regulated time-sensitive publications |
| Sustainability/environment reports | monthly listing check; annual-period capture | report/version publication cycle |
| Corporate profile, legal, static service descriptions | quarterly, plus content-hash change | lower but non-zero change rate |

A production refresh should be event-assisted by sitemap/listing diffs rather than cadence alone.

## Public Knowledge Versus Private Capability Boundary

| Observation from public web | Safe assistant capability now | Not established by the crawl |
|---|---|---|
| Contact details and inquiry fields | explain channels and prepare a handoff summary | submit or track a real inquiry |
| Product pages and agronomy articles | answer with cited, dated public fixtures | personalized agronomic prescription without required context |
| Price article and dealer list | provide dated reference guidance and contacts | live price, inventory, dealer status, quote, sale |
| Shop cart/login/order lookup UI | explain that the public shop exposes these entry points | authenticate, inspect an order, change a cart, purchase |
| Visit reservation form | explain fields, locations, and public visit windows | check capacity, book, modify, or cancel a visit |
| DMS/CRM/RFID pages | describe publicly stated services | access distributor/customer/tag records or private APIs |
| Investor/sustainability documents | retrieve and cite public documents | non-public investor data or unpublished reports |
| Privacy/account language | explain the published policy | access, correct, or delete a person's stored PVCFC data |

Synthetic capability Providers used for demos must carry at least:

- `authority_kind: synthetic`
- an unmistakably synthetic dataset ID and scenario ID
- no real customer identifiers or copied private records
- a visible non-authoritative limitation in evidence and operator tooling
- Business-scoped state and credentials
- deterministic reset/version behavior
- no fallback from a failed real Provider into fabricated “success” presented as real

## Requirements For Later Provider, Business Pack, And Evaluation Decisions

1. **Knowledge Provider:** query by Business, content type, language, effective/publication date, authority, and source freshness; return citations and content hashes with every answerable item.
2. **Document Provider:** distinguish listing metadata from extracted document content and preserve media type/version relationships.
3. **Adapter:** normalize retrieval and errors without erasing requested URL, canonical URL, source date, corpus ID, or authority kind.
4. **Business Pack:** own PVCFC terminology, product/agronomy policies, escalation contacts, presentation, language behavior, public-form descriptions, and synthetic capability bindings.
5. **Safety:** prevent stale price/promotion/opening claims, dosage generalization, unsupported private actions, and leakage across Businesses or synthetic scenarios.
6. **Evaluation:** include cited tests for corporate facts, exact product specifications, crop/stage distinctions, contact routing, date-aware price caveats, document retrieval, Vietnamese/English fallback, stale/duplicate handling, dynamic-form explanation, and refusal to claim private execution.
7. **Evidence:** customer-visible claims that can change must carry canonical source URL, captured/publication dates where available, corpus ID, and artifact/content hashes.

## Known Gaps

- The corpus is broad but not a byte-complete mirror of every URL exposed by the large site map and sitemaps.
- Direct PDF bodies and media streams were inventoried but not all were downloaded and text-extracted.
- Several service, recruitment, environmental-measurement, and listing pages yielded mostly shared chrome in static fetches and need targeted dynamic extraction for deeper fixtures.
- Shop products lacked stable detail URLs and live prices.
- No form was submitted, no account was used, and no private record was accessed.
- Partial English coverage means Vietnamese remains the primary authoritative corpus for many topics.
- Public web observations cannot settle private API semantics, authentication, authorization, availability, SLAs, or data-retention behavior.

These gaps do not block architecture planning: they establish why the public fixture Provider must be provenance-bound and refreshable, and why private customer-service execution must remain explicitly synthetic until authoritative PVCFC contracts are supplied.
