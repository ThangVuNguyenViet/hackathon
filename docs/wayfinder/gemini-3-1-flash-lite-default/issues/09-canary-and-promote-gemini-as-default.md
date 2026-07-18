Status: open
Type: task
Labels: wayfinder:task
Parent: ../map.md
Blocked by: 08-shadow-gemini-for-100-production-turns.md
Assignee:

## Question

Route 10% of production planner traffic to Gemini 3.1 Flash-Lite for 100 turns with GPT-4.1 remaining the deployment default and explicit rollback. Roll back on any critical violation, schema regression, error-rate increase above one percentage point, p95 above 125% of control, or total savings below 25%. If every gate passes, switch the deployed planner default to Gemini, verify the exact release, and retain the GPT-4.1 rollback runbook and final decision evidence.
