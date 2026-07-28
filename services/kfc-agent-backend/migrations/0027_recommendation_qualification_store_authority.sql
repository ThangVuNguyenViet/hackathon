-- Scenario 06 is evaluated against the synthetic sanity policy for verified
-- store KFCVN0036. Seed that authority in the same durable pack-state model
-- consumed by the recommendation tools; narrative prose is not runtime state.
INSERT INTO pack_state_projections (
  session_id,
  pack_id,
  pack_version,
  envelope_json,
  updated_at
) VALUES (
  'kfc:demo-qualification-06-sanity-suppression',
  'kfc-vietnam',
  '1.0.0',
  '{"envelopeVersion":1,"packRef":{"packId":"kfc-vietnam","version":"1.0.0"},"schemaVersion":"1","state":{"fulfillment":{"method":"pickup","disposition":"pickup","storeId":"KFCVN0036","storeName":"KFC CO.OPMART BIÊN HÒA","feeVnd":0,"etaMinutes":0,"availability":{"ok":true,"checkedItemIds":[],"unavailableItemIds":[],"blockedTimeslotItemIds":[],"source":{"fixtureMode":"public_crawl_seed","sourceFile":"ai-talent-tracks/fnb/data/kfcvietnam-ordering-crawl/exhaustive/kfcvietnam-api-store-availability-by-store-vi.raw.json","sourceApi":"https://api.kfcvietnam.com.vn/stores/{storeId}/{disposition}/{endpoint}"}}}},"integrity":{"algorithm":"sha256","digest":"a8d14716588ef484aab6a5907cf909304243524bf4efc3f65b4f2612d4446bbc"}}',
  '2026-07-28T00:00:00Z'
)
ON CONFLICT (session_id, pack_id, pack_version) DO UPDATE SET
  envelope_json = excluded.envelope_json,
  updated_at = excluded.updated_at;
