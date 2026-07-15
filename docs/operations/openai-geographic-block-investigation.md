# OpenAI geographic-block investigation

## Incident window

- Investigated UTC window: `2026-07-12 03:25–03:44Z`.
- LangSmith first confirmed failure: `2026-07-12T03:25:38.899002Z`.
- First confirmed run ID: `019f545b-eed3-7000-8000-05307b19db62` (`small_talk_router`).
- First confirmed trace ID: `019f545b-eed3-7000-8000-0719948f881e`.
- Exact API failure: HTTP 403, `Country, region, or territory not supported`.
- The same 403 recurred in `small_talk_router` and `planner_iteration` through at least
  `2026-07-12T03:43:07.946Z`.

## Placement correlation

- Commit `118c8a22` changed placement from `aws:us-east-1` to Smart Placement before the
  incident.
- Commit `12cec176` disabled Smart Placement after the incident; commit `6f1b1e5a` pinned
  `aws:us-east-1`.
- The retained LangSmith runs do not contain Worker version ID, execution colo,
  `cf-placement`, OpenAI `x-request-id`, or API error `type`/`code`.
- Wrangler's available version/deployment list no longer includes the July 12 versions.
- The authenticated Wrangler session cannot access the Workers Observability query API,
  and the Cloudflare dashboard session available to this investigation is not authenticated.
  Workers Logs retention is plan-dependent (currently documented as 3 days on Free and 7
  days on Paid), so the incident records may also have expired.

## Defensible conclusion

The current conclusion is **Cloudflare-placement-dependent OpenAI geographic enforcement**.
Hong Kong is **unproven**: no retained Cloudflare metadata identifies an `HKG` execution
colo. Do not describe this incident as a confirmed Hong Kong IP block unless either:

1. a future controlled reproduction shows success/failure changing consistently by
   Cloudflare execution colo; or
2. OpenAI support confirms the classified source location for a failing `x-request-id`.

## Support packet for a reproduced failure

Send only:

- OpenAI `x-request-id`
- UTC timestamp
- endpoint (`POST /v1/responses`)
- model
- OpenAI project ID
- HTTP status and API error `type`/`code`
- Cloudflare Worker version, execution colo, and placement header

Do not attach the API key, prompt, customer text, or complete response body.

## Controlled canary

Cloudflare placement is service-scoped in this deployment path, so a 0% version in the
production service did not retain independent Singapore placement. The controlled target is
therefore the isolated `kfc-openai-geo-canary` Worker: it has no production routes, queues,
or scheduled triggers and uses the explicit `aws:ap-southeast-1` placement hint.
`.github/workflows/openai-geo-canary.yml` sends a version-override request every 15 minutes
until `OPENAI_GEO_CANARY_END_AT`. Each probe first verifies the version through `/health`,
then sends one real greeting request that succeeds only when the OpenAI small-talk router
marks the turn as `smallTalk`.

Required GitHub repository variables:

- `OPENAI_GEO_CANARY_WORKER_URL`
- `OPENAI_GEO_CANARY_VERSION_ID`
- `OPENAI_GEO_CANARY_END_AT`

Cloudflare's structured `openai_api_response` events are the authoritative per-OpenAI-call
record; the workflow result is the independent end-to-end canary record.
