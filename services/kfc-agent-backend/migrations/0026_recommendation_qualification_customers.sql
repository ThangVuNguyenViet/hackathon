-- One explicit mock/synthetic customer authority per held-out qualification
-- narrative. Distinct refs guarantee distinct kfc:<customer> D1 sessions.
INSERT OR IGNORE INTO recommendation_demo_customer_history (
  customer_ref,
  fixture_label,
  linked,
  completed_orders_json,
  favorites_json,
  updated_at
) VALUES
  (
    'demo-qualification-01-returning',
    'Mock/synthetic qualification returning customer 01',
    1,
    '[{"orderId":"synthetic-qualification-order-01","completedAt":"2026-07-20T09:00:00Z","lines":[{"sellableItemId":"20751","categoryId":"20000","quantity":1}]}]',
    '["20751"]',
    '2026-07-28T00:00:00Z'
  ),
  (
    'demo-qualification-02-anonymous',
    'Mock/synthetic qualification anonymous customer 02',
    0,
    '[]',
    '[]',
    '2026-07-28T00:00:00Z'
  ),
  (
    'demo-qualification-03-modifier',
    'Mock/synthetic qualification modifier customer 03',
    1,
    '[]',
    '[]',
    '2026-07-28T00:00:00Z'
  ),
  (
    'demo-qualification-04-modifier-empty',
    'Mock/synthetic qualification modifier-empty customer 04',
    1,
    '[]',
    '[]',
    '2026-07-28T00:00:00Z'
  ),
  (
    'demo-qualification-05-sanity-replacement',
    'Mock/synthetic qualification returning customer 05',
    1,
    '[{"orderId":"synthetic-qualification-order-05","completedAt":"2026-07-20T09:00:00Z","lines":[{"sellableItemId":"20751","categoryId":"20000","quantity":1}]}]',
    '["20751"]',
    '2026-07-28T00:00:00Z'
  ),
  (
    'demo-qualification-06-sanity-suppression',
    'Mock/synthetic qualification suppression customer 06',
    1,
    '[]',
    '[]',
    '2026-07-28T00:00:00Z'
  ),
  (
    'demo-qualification-07-explicit-request',
    'Mock/synthetic qualification explicit-request customer 07',
    1,
    '[]',
    '[]',
    '2026-07-28T00:00:00Z'
  ),
  (
    'demo-qualification-08-once-only',
    'Mock/synthetic qualification once-only customer 08',
    1,
    '[]',
    '[]',
    '2026-07-28T00:00:00Z'
  );
