# AWS sandbox deployment blocker — 2026-08-06

Status: **implementation and offline qualification only; deployment prohibited**.

Read-only preflight execution (`npm run deploy:preflight` in `infra/kfc-recommendation-aws`) returned `deployable: false` and identified 13 blocking conditions for AWS deployment:

```json
{
  "deployable": false,
  "verifiedCaller": null,
  "configuredRegion": "us-east-1",
  "verifiedEndpointCount": 0,
  "blockers": [
    "AWS caller identity is unavailable",
    "configured AWS region must be ap-southeast-1",
    "required VPC endpoint services are not verified in ap-southeast-1",
    "all eight deployed endpoints must match exact VPC, service, state, and policy bindings",
    "Qualified Model Bundle is absent or does not match its digest",
    "release manifest is absent or does not match its file hash and semantic bindings",
    "Main image digest is absent from ECR or is not linux/arm64",
    "scorer image digest is absent from ECR or is not linux/arm64",
    "ADOT image digest is absent from ECR or is not linux/arm64",
    "internal ALB certificate is not ISSUED or does not cover its TLS server name",
    "previous release is absent, incomplete, or contract-incompatible; first release must explicitly rollback to paused",
    "release-specific candidate activation alarm is not current and OK",
    "executable runtime probe did not prove deep readiness plus release-bound structured logs and X-Ray telemetry"
  ]
}
```

## Diagnostics

1. **Qualification / Bundle Gate (Phase 2):** Model qualification for regularized challenger `kfc-model-qualification-v3-regularized-challenger-20260806` ended at `failed_selection` (exit code `2`). No four-type Qualified Model Bundle was emitted.
2. **AWS Prerequisites (Phase 4):** `aws sts get-caller-identity` returned `InvalidClientTokenId`. No AWS caller ARN, ECR access, or ap-southeast-1 resources are available.
3. **Downstream Execution Boundary:** In accordance with the approved plan (`local://resolve-automatic-recommendation-remaining-work-plan.md`), absent QMB and missing AWS deployment prerequisites halt all dependent phases (Runtime images, AWS deployment, Flutter kiosk client, Chat cutover, and Peak Serving Envelope capacity release). No infrastructure mutation, image publication, or fake release claims were performed.
