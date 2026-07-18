# Vertex Gemini 3.1 Flash-Lite Runtime Contract

## Result

`gemini-3.1-flash-lite` is callable through Vertex AI `global` from both Node.js and a real Cloudflare Worker using the same native Web Crypto service-account flow. Strict JSON Schema output, minimal thinking, omitted output-token limit, usage extraction, deterministic client timeouts, and Google error bodies were all exercised live.

Evidence:

- [Redacted probe evidence](./vertex-runtime-contract-evidence.json)
- [Reproducible Node and Worker probe](./vertex-runtime-contract-probe.mjs)

The project `kfc-model-arena-gemini` has billing and `aiplatform.googleapis.com` enabled. The retained service account is:

`kfc-planner-worker@kfc-model-arena-gemini.iam.gserviceaccount.com`

It has exactly one project role: `roles/aiplatform.user`. A live call succeeded with that role and no additional project role.

## Request contract

```text
POST https://aiplatform.googleapis.com/v1/projects/{project}/locations/global/endpoints/openapi/chat/completions
Authorization: Bearer {OAuth access token}
Content-Type: application/json
```

The immutable model identifier in the OpenAI-compatible body is:

```json
{
  "model": "google/gemini-3.1-flash-lite"
}
```

The planner transport should merge this Gemini-specific field into the body:

```json
{
  "google": {
    "thinking_config": {
      "thinking_level": "minimal"
    }
  }
}
```

Do not also send `thinking_budget`; the live endpoint returned HTTP 400 `INVALID_ARGUMENT` when both were present. Do not send `temperature: 0`; Google's Gemini 3 guidance recommends keeping the model default. The live strict-output calls omitted both `temperature` and an output-token limit and succeeded.

Strict output uses the standard OpenAI-compatible `response_format.type = "json_schema"` shape with `strict: true`. The live response conformed to the required object, enum, and `additionalProperties: false` constraints.

Google's current model card identifies `gemini-3.1-flash-lite`, a 1,048,576-token context window, a default maximum output of 65,535 tokens, structured output, thinking, and Chat Completions support:

- [Gemini 3.1 Flash-Lite model card](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/3-1-flash-lite)
- [OpenAI compatibility](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/start/openai)
- [Gemini 3 thinking levels](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/start/get-started-with-gemini-3)

## Authentication and Worker secret

Use one Cloudflare secret named `VERTEX_SERVICE_ACCOUNT_JSON`. Its minimum runtime shape is:

```json
{
  "client_email": "kfc-planner-worker@kfc-model-arena-gemini.iam.gserviceaccount.com",
  "private_key": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
}
```

The transport mints an OAuth access token by signing an RS256 JWT with native Web Crypto and exchanging it at `https://oauth2.googleapis.com/token` using the `https://www.googleapis.com/auth/cloud-platform` scope. Node 26, local `workerd`, and the remote Cloudflare Worker all accepted this implementation without a Google auth package.

Production should cache the access token in the Worker isolate and refresh it before expiry. The proof intentionally minted a fresh token per request to exercise the full credential path.

Human ADC remains local only. The Worker secret is not an API key, ADC file path, or static OAuth access token. Access tokens expire; the service-account JSON is the credential used to mint replacements.

The proof created temporary user-managed keys only long enough to upload the isolated probe secret. Both keys and the temporary Worker were deleted. The retained service account currently has zero user-managed keys. The production key should be created only when the production Worker secret is installed, and the local key file should be removed immediately afterward.

## Response contract

Successful responses use the OpenAI Chat Completions envelope:

- content: `choices[0].message.content`, as a JSON string;
- finish reason: `choices[0].finish_reason`;
- model: `model`;
- thought signature: `choices[0].message.extra_content.google.thought_signature`;
- tokens: `usage.prompt_tokens`, `usage.completion_tokens`, and `usage.total_tokens`;
- traffic class: `usage.extra_properties.google.traffic_type`.

Both successful probes returned `traffic_type: "ON_DEMAND"`. Neither returned a reasoning-token field or cached-token detail. Missing optional usage components must therefore normalize to zero/unknown without inventing billed tokens.

Minimal thinking still returned a thought signature. The planner's calls are independent requests, and `priorPlanForReview` is supplied as data rather than replaying an assistant completion, so the migration does not need to persist or resend this signature. It should record only whether the signature was present and must not log the signature itself.

## Error and timeout contract

The compatibility endpoint returned Google errors as a top-level JSON array containing an `error` object:

- missing auth: HTTP 401, `UNAUTHENTICATED`, `CREDENTIALS_MISSING`;
- conflicting thinking fields: HTTP 400, `INVALID_ARGUMENT`.

The response extractor must accept this array shape as well as the object-shaped errors already normalized for other providers.

Node and the remote Cloudflare Worker both produced:

```json
{
  "name": "TimeoutError",
  "message": "The operation was aborted due to timeout"
}
```

when `AbortSignal.timeout(1)` expired. This is a client-side failure with no HTTP status. The transport should preserve it as a timed-out attempt rather than convert it into a provider HTTP error.

## Implementation consequences

The next transport ticket needs only:

- native Web Crypto JWT signing and token caching;
- the fixed Vertex `global` OpenAI-compatible URL and model ID;
- strict `json_schema` mapping;
- `google.thinking_config.thinking_level = "minimal"`;
- Chat Completions content, usage, thought-signature-presence, and array-error extraction;
- existing request deadline propagation.

No Google SDK, auth dependency, Gemini-only semantic prompt, output-token cap, or per-request GPT fallback is needed.
