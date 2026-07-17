# KFC Customer-Service Agent

## Twelve-week paid pilot and production option

### Executive summary

We propose a twelve-week paid pilot of a KFC customer-service transaction and reliability platform across KFC web chat, Facebook Messenger, and Zalo.

The platform is designed to do more than answer questions. It verifies customer identity and commerce state, executes approved actions safely, prevents duplicate or stale operations, hands conversations to human operators with context, and measures whether the customer's issue was actually resolved.

The pilot ends with a jointly reviewed production-readiness report and a pre-agreed annual production option.

## Pilot outcomes

The pilot will demonstrate:

- authenticated, customer-scoped support across web, Messenger, and Zalo;
- verified catalog, order, payment, membership, promotion, invoice, loyalty, and profile interactions through KFC-approved systems;
- confirmation and state revalidation before consequential actions;
- protection against duplicate delivery, retries, rapid customer corrections, stale agent runs, and concurrent mutations;
- human assignment, pause, response, resume, SLA status, and transcript synchronization;
- customer-visible receipts for completed, failed, or escalated actions;
- operational reporting for containment, verified resolution, escalation quality, latency, CSAT, recontact, and system failures;
- deterministic regression tests and controlled end-to-end production proofs.

Production traffic will expand only after KFC and the delivery team approve the relevant identity, security, integration, reliability, and operating gates.

## Delivery plan

| Phase | Weeks | Deliverables |
|---|---:|---|
| Foundation | 1–3 | KFC API discovery, channel verification, account linking, workforce identity, data handling, baseline measurements |
| Integration | 4–7 | Commerce integrations, CRM/case handoff, action receipts, three-channel journeys, failure recovery |
| Controlled rollout | 8–10 | Limited traffic, scheduled canaries, operator workflow, regression and concurrency proofs, metric validation |
| Production decision | 11–12 | Measured outcome report, security and reliability review, operating model, production recommendation |

KFC will provide approved API specifications, credentials, test accounts, business policies, support content, CRM access, channel approvals, and named technical and operational owners according to the agreed delivery schedule.

## Commercial terms

### Paid pilot

| Item | Price |
|---|---:|
| Production hardening and integration | **240,000,000 VND** |
| Platform and operations | **35,000,000 VND/month** |
| Verified outcome | **4,000 VND/outcome** |
| Monthly outcome-fee cap | **25,000,000 VND** |
| Maximum twelve-week pilot | **420,000,000 VND** |

At 10,000 monthly conversations and an illustrative 60% verified-outcome rate, the expected twelve-week pilot price is **417,000,000 VND**. The 60% rate is a planning illustration, not a performance guarantee.

Prices exclude VAT and third-party charges including Meta, Zalo, SMS/OTP, CRM licenses, unusual upstream integration costs, and other services purchased for KFC. Such charges will be approved and passed through separately.

Business-hours pilot support and weekly operational reporting are included. No additional conversion fee applies if KFC signs the production option within 30 days after pilot acceptance.

### Production option

| Item | Price |
|---|---:|
| Annual commitment | **12 months** |
| Platform and operations | **60,000,000 VND/month** |
| Verified outcome | **4,000 VND/outcome** |
| Illustrative monthly price at 6,000 outcomes | **84,000,000 VND** |
| Illustrative annual price at 6,000 outcomes/month | **1,008,000,000 VND** |

Final production volume tiers and any outcome allowance will be agreed from measured pilot traffic without reducing the platform base. A 99.9% platform-availability commitment applies only after KFC-controlled dependencies, support responsibilities, maintenance windows, and incident processes are agreed.

## Verified-outcome contract

At most one outcome is billable per conversation. A billable outcome must:

1. resolve the verified customer goal or complete an approved support procedure;
2. contain authoritative system evidence for any transactional action;
3. pass the agreed independent evaluation policy; and
4. have no same-intent customer recontact within 72 hours.

Greetings, duplicates, abandoned clarification, failed actions, default escalation, unsupported evaluator claims, and conversations resolved only by a human are not billable outcomes.

KFC will receive an auditable outcome report containing the conversation identity, outcome category, evaluator version, supporting action evidence, recontact status, and exclusion reason where applicable. Customer content will be minimized and protected under the agreed data-handling policy.

## Pilot acceptance

Pilot acceptance requires joint evidence that:

- no duplicate consequential action occurs under concurrent or retried delivery;
- identity and authorization are enforced across all three channels;
- controlled proofs pass for order, payment, membership, cancellation or recovery, and human handoff;
- every billable outcome has complete audit evidence;
- agreed containment, resolution, escalation, latency, CSAT, and recontact measurements are available;
- security, rollback, incident, and traffic-expansion procedures are approved by both parties.

Changes outside the approved pilot journeys or unavailable KFC dependencies will be handled through written change control and will not silently weaken an acceptance gate.

