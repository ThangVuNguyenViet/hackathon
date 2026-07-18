Status: resolved
Type: research
Labels: wayfinder:research
Parent: ../map.md
Blocked by:
Assignee: Codex

## Question

What exact Vertex AI `global` request, authentication, strict structured-output, minimal-thinking, response, usage, error, and timeout contract does `gemini-3.1-flash-lite` expose through the OpenAI-compatible endpoint from local Node and Cloudflare Worker runtimes? Verify the live endpoint in the existing billed project, determine the minimum `roles/aiplatform.user` credential flow and Worker secret shape, and retain redacted request/response evidence. Do not add production credentials to source control.

## Answer

The verified contract is documented in [Vertex Gemini 3.1 Flash-Lite Runtime Contract](../assets/vertex-gemini-3-1-runtime-contract.md), with [redacted evidence](../assets/vertex-runtime-contract-evidence.json) and a [reproducible native Web Crypto probe](../assets/vertex-runtime-contract-probe.mjs).

Live strict-output calls succeeded from Node.js and a real remote Cloudflare Worker using `google/gemini-3.1-flash-lite`, Vertex `global`, `thinking_level: minimal`, no `temperature`, and no output-token limit. The response is an OpenAI Chat Completions envelope with JSON-string content, a Google thought signature, standard prompt/completion/total token fields, and `ON_DEMAND` traffic metadata.

The retained `kfc-planner-worker@kfc-model-arena-gemini.iam.gserviceaccount.com` principal has only `roles/aiplatform.user`, which was sufficient. Production needs one `VERTEX_SERVICE_ACCOUNT_JSON` Worker secret containing `client_email` and `private_key`; native Web Crypto can mint scoped OAuth tokens without a new dependency.

Google HTTP errors arrived as a top-level array containing an `error` object. Client deadlines in Node and the remote Worker both produced `TimeoutError` with no HTTP status. The temporary Worker and all temporary user-managed keys were deleted; the service account remains with zero user-managed keys.
