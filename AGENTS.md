# KFC Agent Repository Rules

- Keep semantic routing, tool selection, and customer-language interpretation in the configured `BaseChatModel` agent loop. Do not use keyword, phrase, or regular-expression routing for semantic behavior; exact normalized retrieval matching and schema validation remain allowed.
- The production semantic loop uses LangChain `createAgent`. Do not import or construct `StateGraph` unless a separately reviewed, evidence-backed resumable-workflow requirement requires it. Do not add direct OpenAI SDK orchestration.
- Scenario JSON files are narrative evidence: retain their goals, turns, risks, and outcome state. They must not contain exact-response, exact-tool-sequence, word-match, or deterministic acceptance assertions, and they must not be replayed as deterministic scenario tests.
- Keep live qualification held out from implementation: run retained narratives in fresh sessions, preserve the complete evidence, and have independent reviewers judge the resulting transcripts without changing the scenario corpus to fit a model output.
- Run deterministic checks through the normal package scripts. Keep unit tests small, direct, and limited to deterministic contracts; do not invoke test commands from application code.
