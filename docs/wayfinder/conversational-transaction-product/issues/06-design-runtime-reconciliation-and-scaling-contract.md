Status: open
Type: grilling
Labels: wayfinder:grilling
Parent: ../map.md
Blocked by: 03-define-conversational-transaction-domain-contract.md, 04-design-tenant-identity-and-policy-boundaries.md, 05-design-business-action-and-connector-contract.md
Assignee:

## Question

What runtime architecture preserves the Conversational Transaction guarantee across horizontally scaled instances, retries, crashes, delayed events, connector outages, and human takeover?

Decide durable ownership for session and operation state, atomic run and operation claiming, queue delivery semantics, mutation fencing, reconciliation scheduling and exhaustion, webhook ordering, authoritative reads, no-bypass behavior, cache keys and invalidation, prompt-cache boundaries, observability, exception ownership, recovery objectives, and deployment topology. Reuse current platform and codebase capabilities where they hold; introduce no dedicated tenant cell, custom cache tier, or connector runner without measured need.
