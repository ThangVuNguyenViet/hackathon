# KFC Outcome-Level LLM Judge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a strict, evidence-bound LLM outcome judge to the KFC proof artifacts and acceptance runner.

**Architecture:** Create a focused evaluator module that builds a redacted scenario evidence bundle, calls an injectable judge-model client, validates strict JSON, and returns typed judgments. Wire it after deployed browser/monitor evidence and before checksums/publication; hard transport and durability gates remain independent and judge failure is fail-closed.

**Tech Stack:** TypeScript, Vitest, existing OpenAI client/tooling, deployed acceptance Bash runner, JSON proof artifacts.

---

### Task 1: Define the typed judge contract and evidence bundle

**Files:**
- Create: `services/kfc-agent-backend/src/evaluation/outcomeJudge.ts`
- Test: `services/kfc-agent-backend/test/evaluation/outcome-judge.test.ts`

- [ ] **Step 1: Write failing schema tests**

Add tests for parsing a valid judgment, rejecting a non-boolean `passed`, rejecting scores below 0 and above 100, rejecting missing rationale, and rejecting malformed JSON. Use a fake JSON response; do not call OpenAI.

```ts
it('parses a valid judgment and preserves structured fields', () => {
  expect(parseOutcomeJudgment(JSON.stringify({
    passed: true,
    score: 87,
    achievedOutcome: 'Cart is ready for customer confirmation',
    missedExpectations: [],
    safetyIssues: [],
    rationale: 'The transcript shows menu selection and cart updates.',
  }))).toEqual({
    passed: true,
    score: 87,
    achievedOutcome: 'Cart is ready for customer confirmation',
    missedExpectations: [],
    safetyIssues: [],
    rationale: 'The transcript shows menu selection and cart updates.',
  });
});

it.each([
  { passed: 'true', score: 87 },
  { passed: true, score: -1 },
  { passed: true, score: 101 },
  { passed: true, score: 87, rationale: '' },
])('rejects invalid judgment payloads', (overrides) => {
  expect(() => parseOutcomeJudgment(JSON.stringify({
    passed: true,
    score: 87,
    achievedOutcome: 'Outcome',
    missedExpectations: [],
    safetyIssues: [],
    rationale: 'Evidence-based rationale',
    ...overrides,
  }))).toThrow();
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
npm test -- --maxWorkers=1 --no-file-parallelism test/evaluation/outcome-judge.test.ts
```

Expected: FAIL because `parseOutcomeJudgment` and its types do not exist.

- [ ] **Step 3: Implement the minimal typed boundary**

Define and export `OutcomeJudgment`, `OutcomeEvidenceBundle`, `OutcomeJudgeClient`, and `parseOutcomeJudgment`. Require finite integer scores in `[0, 100]`, non-empty strings, string arrays, and JSON objects only. Do not coerce invalid values.

- [ ] **Step 4: Run the focused tests**

Run the same Vitest command. Expected: all schema tests pass.

- [ ] **Step 5: Commit the contract**

```bash
git add services/kfc-agent-backend/src/evaluation/outcomeJudge.ts services/kfc-agent-backend/test/evaluation/outcome-judge.test.ts
git commit -m "feat: add outcome judge contract"
```

### Task 2: Build evidence-bound prompt construction and judge invocation

**Files:**
- Modify: `services/kfc-agent-backend/src/evaluation/outcomeJudge.ts`
- Test: `services/kfc-agent-backend/test/evaluation/outcome-judge.test.ts`

- [ ] **Step 1: Add prompt and invocation tests**

Test that `buildOutcomeJudgePrompt` includes scenario ID, final state, expectations, ordered turns, tool evidence, GenUI metadata, and monitor event summaries. Test that customer IDs and authorization-like values are omitted. Test that `judgeOutcome` calls the injected client once with the requested model and parses its JSON response.

```ts
it('builds evidence-bound prompts without raw customer identifiers', () => {
  const prompt = buildOutcomeJudgePrompt({
    scenarioId: '02-tu-van-combo-va-upsell',
    finalState: 'cart_ready',
    expectations: ['Cart contains the requested items'],
    turns: [{ role: 'user', text: 'Gợi ý combo' }],
    toolTrace: [{ toolName: 'searchMenu', status: 'completed' }],
    genUiAttachments: [{ widgetKind: 'smartMenuPicker', actionIds: ['add_item'] }],
    monitorEvents: [{ type: 'assistant_reply_sent' }],
    customerId: 'anon_customer_secret',
  });
  expect(prompt).toContain('cart_ready');
  expect(prompt).toContain('searchMenu');
  expect(prompt).not.toContain('anon_customer_secret');
});

it('calls the injected model and returns the parsed judgment', async () => {
  const client = { complete: vi.fn().mockResolvedValue(validJson) };
  await expect(judgeOutcome(evidence, { client, model: 'judge-model' })).resolves.toMatchObject({ score: 87 });
  expect(client.complete).toHaveBeenCalledWith(expect.objectContaining({ model: 'judge-model' }));
});
```

- [ ] **Step 2: Run tests and confirm the new tests fail**

Run the focused outcome-judge test. Expected: failures for missing prompt construction and invocation functions.

- [ ] **Step 3: Implement prompt construction and fail-closed invocation**

Serialize only the typed evidence bundle into a clearly labeled prompt. Instruct the model to return JSON matching the contract, cite observed evidence, distinguish missing evidence from failure, and never invent outcomes. `judgeOutcome` must propagate client errors and parser errors; it must not retry with fixture data or synthesize a fallback judgment.

- [ ] **Step 4: Run focused tests and the backend build**

```bash
npm test -- --maxWorkers=1 --no-file-parallelism test/evaluation/outcome-judge.test.ts
npm run build
```

Expected: focused tests and TypeScript build pass.

- [ ] **Step 5: Commit prompt and invocation**

```bash
git add services/kfc-agent-backend/src/evaluation/outcomeJudge.ts services/kfc-agent-backend/test/evaluation/outcome-judge.test.ts
git commit -m "feat: add evidence-bound outcome judge"
```

### Task 3: Wire an OpenAI-backed client and artifact generation

**Files:**
- Create: `services/kfc-agent-backend/scripts/run-outcome-judgments.ts`
- Modify: `services/kfc-agent-backend/src/evaluation/outcomeJudge.ts`
- Modify: `services/kfc-agent-backend/package.json`
- Test: `services/kfc-agent-backend/test/scripts/run-outcome-judgments.test.ts`

- [ ] **Step 1: Write runner tests with an injected fake client**

Test that nine evidence bundles produce nine judgments, that the output contains release identity and model name, that customer IDs are not present, and that one model error exits non-zero without writing a passing artifact. Keep the default tests entirely offline.

- [ ] **Step 2: Run the runner tests and verify the expected failures**

```bash
npm test -- --maxWorkers=1 --no-file-parallelism test/scripts/run-outcome-judgments.test.ts
```

Expected: FAIL because the runner and artifact writer do not exist.

- [ ] **Step 3: Implement the injectable OpenAI adapter**

Use the existing OpenAI dependency and environment conventions. Require `OPENAI_API_KEY`, accept `OUTCOME_JUDGE_MODEL` with a documented default, request JSON output, and pass the response through `parseOutcomeJudgment`. Keep the adapter behind `OutcomeJudgeClient` so tests can inject deterministic responses.

- [ ] **Step 4: Implement the offline-compatible runner interface**

The script must accept an evidence input path, output path, release metadata path, and optional model environment. It writes only after all scenario judgments pass parsing and includes `{ gitSha, releaseBuiltAt, dirty, model, judgedAt, scenarios }`. Redact customer IDs before prompt construction and artifact writing.

- [ ] **Step 5: Run tests and build**

```bash
npm test -- --maxWorkers=1 --no-file-parallelism test/evaluation/outcome-judge.test.ts test/scripts/run-outcome-judgments.test.ts
npm run build
```

Expected: all focused tests and build pass.

- [ ] **Step 6: Commit the runner**

```bash
git add services/kfc-agent-backend/src/evaluation/outcomeJudge.ts services/kfc-agent-backend/scripts/run-outcome-judgments.ts services/kfc-agent-backend/package.json services/kfc-agent-backend/test/evaluation/outcome-judge.test.ts services/kfc-agent-backend/test/scripts/run-outcome-judgments.test.ts
git commit -m "feat: generate outcome judgment artifacts"
```

### Task 4: Integrate judgment into deployed acceptance and publication hygiene

**Files:**
- Modify: `scripts/run-kfc-deployed-acceptance.sh`
- Modify: `services/kfc-agent-backend/scripts/run-deployed-browser-proof.ts`
- Modify: `services/kfc-agent-backend/test/scripts/run-live-ai-replay.test.ts`
- Modify: `tests/deployment/deploy_scripts.test.sh`
- Modify: `docs/deployment/two-pages-provenance-runbook.md`

- [ ] **Step 1: Add integration contract tests**

Assert that the acceptance runner invokes the outcome-judgment step after browser and durability evidence, passes the release identity, scans `outcome-judgments.json`, includes it in checksums, and fails on `passed=false` or malformed judgment output. Assert that default local tests do not require a live OpenAI key.

- [ ] **Step 2: Implement evidence export and acceptance wiring**

Have the browser proof write a redacted per-scenario evidence input containing durable turns, monitor events, tool/GenUI summaries, and scenario metadata. Invoke the judgment runner after `durability_post` and before `publication_hygiene`. Require all nine judgments to pass, then include the judgment file in the existing checksum archive and GitHub release.

- [ ] **Step 3: Run deployment contract tests**

```bash
bash tests/deployment/deploy_scripts.test.sh
```

Expected: pass, including the new ordering and artifact checks.

- [ ] **Step 4: Update the deployment runbook**

Document `OUTCOME_JUDGE_MODEL`, the evidence boundary, the fail-closed behavior, and the fact that live judgment requires `.env` credentials. State that the LLM score is supplemental to hard deployment and durability gates.

- [ ] **Step 5: Commit the integration**

```bash
git add scripts/run-kfc-deployed-acceptance.sh services/kfc-agent-backend/scripts/run-deployed-browser-proof.ts services/kfc-agent-backend/test/scripts/run-live-ai-replay.test.ts tests/deployment/deploy_scripts.test.sh docs/deployment/two-pages-provenance-runbook.md
git commit -m "feat: gate deployed proof on outcome judgments"
```

### Task 5: Full verification and deployed judgment proof

**Files:**
- Modify: `services/kfc-agent-backend/README.md`

- [ ] **Step 1: Run all deterministic tests and builds**

```bash
cd services/kfc-agent-backend
npm run build
npm test -- --maxWorkers=1 --no-file-parallelism
cd ../../apps/kfc_live_monitor_flutter
flutter test
cd ../..
bash tests/deployment/deploy_scripts.test.sh
```

Expected: no deterministic failures; any explicitly skipped live suites remain documented as opt-in.

- [ ] **Step 2: Run live tool suites with workspace `.env`**

```bash
cd services/kfc-agent-backend
set -a; [ ! -f ../../.env ] || . ../../.env; set +a
npm run test:live:scenarios
npm run test:live:genui
npm run test:live:interruption
```

Expected: each suite reports its explicit pass/fail summary. Live model variability is reported, not converted into a deterministic fixture result.

- [ ] **Step 3: Run the full deployed acceptance runner**

```bash
cd ../..
OUTCOME_JUDGE_MODEL=${OUTCOME_JUDGE_MODEL:-gpt-4.1-mini} ./scripts/run-kfc-deployed-acceptance.sh
```

Expected: clean/pushed release, 9 deployed scenarios, 9 passing outcome judgments, D1 durability after same-release redeploy, clean secret scan, verified checksums, and a published GitHub proof release.

- [ ] **Step 4: Verify the final artifact independently**

Read `proof-manifest.json` and `outcome-judgments.json`, confirm their release identities match `/release.json` on both Pages sites and `/ready?deep=1` on the Worker, and confirm `git status --short` is empty.

- [ ] **Step 5: Update README and commit final verification notes**

Document the outcome-judgment command, artifact path, model configuration, and distinction between hard gates and LLM quality scores. Commit only the documentation change after the deployed proof succeeds.
