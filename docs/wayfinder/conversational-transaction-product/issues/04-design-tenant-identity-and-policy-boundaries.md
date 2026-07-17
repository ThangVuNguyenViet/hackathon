Status: open
Type: grilling
Labels: wayfinder:grilling
Parent: ../map.md
Blocked by: 02-audit-current-system-against-product-boundary.md, 03-define-conversational-transaction-domain-contract.md
Assignee:

## Question

What tenant, customer-identity, authorization, confirmation, credential, data-retention, and operator-access boundaries are required for the shared SaaS platform and the KFC pilot?

Specify server-derived Tenant context across persistence, queues, caches, operation identities, connector credentials, evidence, and billing; define account-linking or OTP token exchange for channel identities; bind confirmations to exact business state; define RBAC and human-takeover authority; minimize transcript and personal-data ingestion; establish encryption, secret, audit, retention, incident, and payment-data boundaries; and identify the tests that must prove cross-tenant denial and fail-closed write behavior.
