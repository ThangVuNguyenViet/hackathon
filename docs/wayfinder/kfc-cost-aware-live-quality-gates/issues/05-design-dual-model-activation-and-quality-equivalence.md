Status: open
Type: grilling
Labels: wayfinder:grilling
Parent: ../map.md
Blocked by: 01-measure-current-live-verification-cost-and-duplication.md, 02-inventory-current-and-migrating-model-roles.md
Assignee:

## Question

Define what keeping OpenAI and Gemini active means in production after the migration: routing, fallback, shadow evaluation, traffic allocation, or another explicit role. For every active role, specify minimum live coverage, shared versus provider-specific cases, behavior-equivalence and safety oracles, failover evidence, drift detection, rollout and rollback rules, and whether both providers must qualify every behavior-affecting release or only releases that can reach that provider.
