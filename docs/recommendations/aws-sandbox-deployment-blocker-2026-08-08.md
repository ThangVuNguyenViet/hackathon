# AWS sandbox deployment blocker — 2026-08-08

Status: **offline workbench implementation verified; runtime and deployment remain blocked**.

## Verified prerequisites

- A local four-type qualified model bundle is present at `/private/tmp/kfc-local-qmb-pass54/qualification-final3/qualified-model-bundle`.
- The bundle manifest declares `status: qualified` in the adjacent qualification evidence and binds `bundleDigest` `9b773cf2fcf23f5874c4de4669aa17bb86edd48153901d3e385f2040ca3fef19`.
- The pinned catalog baseline is tracked at `services/kfc-agent-backend/fixtures/catalog-baselines/kfcvn-generic-menu@2026-07-10.raw.json` with digest `a681130fc630f4cc37a0c102337c393e551ee53e2f028a53a3fb79483a886bcd`.
- The local Docker daemon is reachable (`29.0.1`, `aarch64`).
- Local images were built and inspected as `linux/arm64`:
  - Main: `kfc-main:local`, image digest `7a9993ce18ff1ac95f10b5bbe343946357c5336da8adf5b3a6ca66517e3066c2`
  - Scorer: `kfc-scorer:local`, image digest `9af73ec59aee416d02ed34298d07f2905f975fb8c476f3f472852d1f295bc98f`
  - Build-time QMB and catalog digest checks passed.
- The canonical Node feature digest now matches the qualified bundle's `featureContractDigest` (`35b710d0b73e7419038e83bc9c39f93feb38564d793726cd47021fa2dbc8421b`); the aligned scorer passed its internal `/ready` smoke. Main `/ready` remained `503` because the local container lacks the trusted AWS/DynamoDB runtime context.

## Blocking prerequisites

1. The live catalog endpoint has changed since the pinned capture. `npm exec -- tsx scripts/capture-catalog-baseline.ts` failed closed with `Catalog capture hash mismatch`; the current HTTP 200 payload hashes to `112d2f89c26d065783e28db0fe5f909198a4c0f0a11041c35edc13b06f9d89a4` (233,228 bytes), while the reviewed pinned fixture remains `a681130fc630f4cc37a0c102337c393e551ee53e2f028a53a3fb79483a886bcd`. No replacement catalog was written. A future catalog refresh requires review and explicit re-pinning.
2. A fresh read-only `npm run deploy:preflight` in `infra/kfc-recommendation-aws` returned exit code `2` with `deployable: false`, `verifiedCaller: null`, `configuredRegion: "us-east-1"`, `verifiedEndpointCount: 0`, and the 13 blockers listed by the command, including absent AWS release-manifest/ECR/certificate/alarm/runtime evidence. AWS credentials/resources remain unavailable; the prior preflight recorded `InvalidClientTokenId`.

## Boundary

Per the approved remaining-work plan, do not fabricate a catalog, build a release image without its exact digest, publish to ECR, call `cdk deploy`, or claim deployed API evidence. The Flutter kiosk client and browser/widget acceptance tests are complete offline; exact deployed-API acceptance, chat cutover, capacity discovery, and release finalization remain gated on the missing trusted catalog and AWS prerequisites.
