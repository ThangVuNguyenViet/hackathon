# KFC recommendation live qualification

This directory contains the eight held-out, assertion-free narratives and the
operator/evaluator contract for Task 9. It contains no role-player, evaluator,
model API call, dashboard, resource credential, or generated qualification
verdict.

- `narratives/`: held-out goals, preconditions, historical example turns, and
  risks consumed by the Task 8 HTTP/D1 stdin bridge.
- `operator-runbook.md`: publication, deployment, probing, and controller-owned
  Codex role-player/evaluator workflow.
- `evaluation-template.json`: output shape for each fresh independent
  evaluator.

Generated model packages, external IDs/revisions, evidence packets, verdicts,
and qualification manifests belong under the ignored `.artifacts/` tree until
their bytes and public resource identities actually exist.
