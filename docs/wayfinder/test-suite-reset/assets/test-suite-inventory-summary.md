# Test-suite reset inventory

This resolution artifact inventories the dirty shared source worktree at commit `d4f20dc3189f944fbd5c80fc362217e96caa0172` without modifying source files or executing test bodies/provider calls. Vitest imports test modules during collection. IDs and output ordering are deterministic for the same source bytes, Git status, installed collector, and generator version.

## Counts

| Category | Count |
|---|---:|
| All inventory records | 2979 |
| Logical executable test cases | 2607 |
| Backend Vitest logical cases | 2382 |
| Flutter expanded cases | 225 |
| Deployment shell assertion records/groups | 274 |
| Verification command surfaces | 98 |

Command surfaces, aliases, producers, and orchestration steps are deliberately excluded from executable test-case counts.

Represented source snapshot: **292 files**, SHA-256 **`82a457a8f03d85d2d0c740b1faa220f7a5b6ae341a479a0cadccba8e3624e8eb`**.

Derivation-input snapshot: **15 files**, SHA-256 **`918cfd1712da96ad28202edb87b3afe93707c6ba2f6b342b7dac8ad094b63239`**. This includes shared enum/generated-plan/qualification/scenario inputs and both generator source files.

## Independent count anchors

- Vitest runtime collection raw cases by profile: `{"default":2370,"live-interruption":1,"live-scenarios":11,"live-scenarios-high-risk":24,"live-text-qualification":9}`.
- Vitest cases after concrete collector-case materialization and repetition/profile separation: **2382**.
- Runtime collection failures: `{}`.
- Runtime-uncollected profiles: `{}`.
- Canonical qualification contract derived from the qualification validator and source-bound scenario inputs: `{"approved_profiles":[{"provider":"openai","model":"gpt-5-mini-2025-08-07","profile":"openai-gpt-5-mini-2025-08-07-reasoning-low-verbosity-low"},{"provider":"google","model":"gemini-3.1-flash-lite","profile":"google-gemini-3.1-flash-lite-thinking-high-qualification"}],"providers":["openai","google"],"repetitions":[1,2,3],"mode":"text","agent_judge_pairings":[{"agent":{"provider":"openai","model":"gpt-5-mini-2025-08-07","profile":"openai-gpt-5-mini-2025-08-07-reasoning-low-verbosity-low"},"judge":{"provider":"google","model":"gemini-3.1-flash-lite","profile":"google-gemini-3.1-flash-lite-thinking-high-qualification"}},{"agent":{"provider":"google","model":"gemini-3.1-flash-lite","profile":"google-gemini-3.1-flash-lite-thinking-high-qualification"},"judge":{"provider":"openai","model":"gpt-5-mini-2025-08-07","profile":"openai-gpt-5-mini-2025-08-07-reasoning-low-verbosity-low"}}],"canonical_scenario_files":["01-dat-mon-ro-rang-giao-hang.json","02-tu-van-combo-va-upsell.json","03-ton-kho-dia-chi-va-cua-hang.json","04-sau-khi-dat-don.json","05-khieu-nai-va-human-handoff.json","06-ngon-ngu-tu-nhien-va-an-toan.json","07-ca-nhan-hoa-va-loyalty.json","08-thanh-toan-loi-va-don-bat-thuong.json","09-phuong-thuc-thanh-toan.json"],"turns_by_scenario":{"01-dat-mon-ro-rang-giao-hang.json":6,"02-tu-van-combo-va-upsell.json":5,"03-ton-kho-dia-chi-va-cua-hang.json":5,"04-sau-khi-dat-don.json":8,"05-khieu-nai-va-human-handoff.json":5,"06-ngon-ngu-tu-nhien-va-an-toan.json":6,"07-ca-nhan-hoa-va-loyalty.json":5,"08-thanh-toan-loi-va-don-bat-thuong.json":4,"09-phuong-thuc-thanh-toan.json":2},"scenario_count_per_execution":9,"turns_per_execution":46,"matrix_executions":6,"scenario_runs":54,"total_turn_evaluations":276,"derived_from":"services/kfc-agent-backend/scripts/lib/kfc-live-text-qualification.mjs"}`.
- Flutter test source files: **32**; authored declarations: **192**; exact expanded cases: **225**.
- Flutter repository-specific expansion covers two literal two-value loops, two `KfcGenUiWidgetKind.values` declarations, the three-state support-handoff map, and generated persisted GenUI capture-plan scenarios.
- Shell assertion/verification-action records: **274**, including **5** embedded Node heredoc groups, **7** expected-failure actions, and **2** set-e zero-exit actions.
- Command surfaces: 19 package scripts, 22 workflow commands, 31 deployed-acceptance invocations, and 26 credible direct executable verification scripts.

## Extraction and classification

- **Backend Vitest:** collected with installed `vitest list --json --includeTaskLocation` under default, live scenario, controlled high-risk repetition, mandatory live-text qualification, and live interruption environments. Child processes receive a minimal allowlisted environment with inherited provider/live/tracing flags cleared and explicit placeholders only where collection requires them. Test modules are imported, but test bodies and provider calls are not executed. Same-name parameterized collector cases receive deterministic ordinals and remain separate records. Qualification profile enablement is contract-filtered to canonical scenarios 01–09; scenarios 10–11 remain ordinary live-scenario cases. Snapshot validation requires the qualified record set to equal `canonical_scenario_files` exactly and rejects any out-of-contract profile tag. Profile enablement and explicit live diagnostic repetitions remain execution dimensions instead of multiplying logical cases.
- **Flutter:** statically parses every `*_test.dart` declaration under `test/` and `integration_test/`, including `testGoldenScene`. Repository-specific resolvers expand the six current authored parameterization sites from literal lists/maps, enum values, conditional interpolation, or generated JSON.
- **Shell:** materializes top-level assertions and verification actions with source spans. This includes `bash -n`, grep/rg/test/node/cmp/diff/shasum assertions, multiline expected-failure deployment invocations, and set-e-enforced zero-exit script actions. Embedded JavaScript heredocs remain assertion groups.
- **Commands:** inventories nonstandard proof/eval/live/validation package scripts, workflow run commands, deployed acceptance invocations, and only direct scripts with a command-target reference or credible CLI/top-level execution signal. Pure imported support modules are excluded. These are command surfaces only, even when they invoke a test runner.
- **Metadata:** production-path, mock/fixture, model-boundary, assertion, overlap, and tier fields are conservative static summaries. Every field is populated; unavailable case/group boundaries use explicit nulls or `unknown` values.

## Limitations and unresolved gaps

1. Vitest source locations are runtime-authoritative, but assertion summaries use a bounded source window because the collector does not expose callback end locations. Any required profile collection failure aborts generation; the generator does not publish a partial per-file fallback as complete.
2. Live text qualification safely runtime-collects the scenario test module, then applies the parsed canonical contract before profile attribution. The recorded contract includes approved provider/model/profile identities, inverse agent/judge pairings, repetitions, text mode, scenarios 01–09, turns per execution, scenario runs, and total turn evaluations. The qualification runner itself is never executed because that would make provider calls.
3. Flutter expansion is exact for the current six parameterized declarations across literal-list, map-entry, enum, conditional, and generated-JSON resolver forms. A future new dynamic form will appear as a low-confidence unresolved expression and fail the current zero-unresolved anchor expectation during review.
4. Flutter integration tests are inventoried statically and not executed; their required deployed endpoints, files, and devices are outside a safe inventory run.
5. Shell heredoc internals are intentionally grouped. Canonical named test cases do not exist in `deploy_scripts.test.sh`, so `logical_case` remains null for assertion records.
6. Workflow YAML is parsed as command-bearing lines rather than with a YAML dependency; multiline shell structure is preserved only to the command line/group level.
7. Production evidence and overlap signals are search-based summaries, not coverage instrumentation or proof that a production branch executed.
8. Snapshot and derivation digests identify one successful point in time. A later `--check-source` may correctly become stale if the shared worktree continues changing; this does not invalidate the recorded snapshot.

## Validation

Run:

```sh
node scripts/generate-test-suite-inventory.mjs \
  --source-root /path/to/shared/source-worktree
node scripts/generate-test-suite-inventory.mjs \
  --output-dir docs/wayfinder/test-suite-reset/assets \
  --check
node scripts/generate-test-suite-inventory.mjs \
  --output-dir docs/wayfinder/test-suite-reset/assets \
  --check-source --source-root /path/to/shared/source-worktree
```

Default `--check` is snapshot-only: it recomputes all manifest count facets and derivable anchors from JSONL, verifies schema/artifact identity, represented-source and derivation-input snapshot digests/file counts, required fields, JSONL/CSV digests, and exact generated CSV/Markdown content. Explicit `--check-source --source-root` additionally hashes every currently represented shared source, every shared derivation dependency, and both current generator files.
