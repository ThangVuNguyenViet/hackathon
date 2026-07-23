# Task 2B Report: Trusted Provider and Model Profiles

## Implementation commit

- `684ffdf2` (`feat(kfc): add trusted model candidate profiles`)

## Implemented boundary

- Added immutable named profiles for:
  - `openai-gpt-4.1-mini` through LangChain `ChatOpenAI` Responses
  - `deepseek-v4-flash` through LangChain `ChatOpenAI` compatible chat
    completions at the fixed OpenCode Go endpoint, with Responses and thinking
    disabled
  - `qwen3.7-max` through LangChain `ChatAnthropic` Messages at the fixed
    OpenCode Go endpoint, thinking disabled, and the 65,536-token protocol
    ceiling
  - `minimax-m3` through LangChain `ChatAnthropic` Messages at the fixed
    OpenCode Go endpoint and the 32,768-token protocol ceiling
  - `google-gemini-3.1-flash-lite` through the retained LangChain `ChatGoogle`
    path with low thinking
- Added a four-candidate live matrix that deliberately excludes Google while
  preserving the Google runtime profile.
- Replaced arbitrary provider/model environment selection with
  `KFC_AGENT_CANDIDATE` and optional `KFC_MONITOR_CANDIDATE`.
- Added `OPENCODE_API_KEY` config/server/Worker wiring. No credential file was
  edited, and no credential value is stored, returned, or logged.
- Added a sanitized provider-neutral `BaseChatModel` capability preflight for
  ordinary invocation and typed tool-call behavior.
- Added maintained `@langchain/anthropic@1.5.1`; no direct provider SDK
  orchestration was introduced.

## Fail-closed contracts

- Unknown candidate IDs and asserted model drift are rejected.
- A forged candidate/model profile is rejected before adapter construction.
- Each candidate requires its own credential and never falls back to another
  provider credential.
- OpenCode profiles always use `https://opencode.ai/zen/go/v1`; no OpenCode
  base URL is accepted from runtime configuration.
- Candidate identities include candidate ID, provider, model, profile, and
  transport for later per-session/per-run pinning. No model switching or
  fallback is implemented.
- Preflight results contain only identity, boolean outcomes, and bounded
  failure codes. Prompts, response content, provider errors, and keys are not
  returned or logged.

## TDD evidence

The first focused RED covered the candidate registry, exact transport/profile
construction, credentials, and the absent preflight:

```text
npm test -- test/config/agent-model-profile.test.ts \
  test/config/model-capability-preflight.test.ts
```

Result: seven profile/factory failures plus the expected missing preflight
module.

The second RED covered env/server wiring:

```text
npm test -- test/config/model-env-wiring.test.ts
```

Result: three failures because candidate environment fields and server wiring
did not exist.

Two later focused RED cycles proved that forged model profiles were still
accepted and that Google had not yet been explicitly excluded from the live
matrix. Each was implemented only after its focused failure.

No test or implementation in this task made a live network call.

## Final verification

Run from `services/kfc-agent-backend`:

```text
npm run format
npm test -- test/config/agent-model-profile.test.ts \
  test/config/model-capability-preflight.test.ts \
  test/config/model-env-wiring.test.ts
npm test
npm run lint
npm run typecheck
npm run build
npm run format:check
git diff --check
```

All passed:

- focused Vitest: 3 files, 14 tests
- full Vitest: 12 files, 45 tests
- ESLint: pass with zero warnings
- TypeScript typecheck: pass
- clean TypeScript build: pass
- formatting and diff checks: pass

## Deferred boundary

- Task 5 owns live capability preflights and the live scenario matrix. This
  task deliberately made no live provider requests.
