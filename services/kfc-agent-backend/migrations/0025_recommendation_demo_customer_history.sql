-- Mock/synthetic POC customer history only. This is not a production identity
-- table and must never be treated as authenticated customer data.
CREATE TABLE recommendation_demo_customer_history (
  customer_ref TEXT PRIMARY KEY,
  fixture_label TEXT NOT NULL,
  linked INTEGER NOT NULL CHECK (linked IN (0, 1)),
  completed_orders_json TEXT NOT NULL CHECK (json_valid(completed_orders_json)),
  favorites_json TEXT NOT NULL CHECK (json_valid(favorites_json)),
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO recommendation_demo_customer_history (
  customer_ref,
  fixture_label,
  linked,
  completed_orders_json,
  favorites_json,
  updated_at
) VALUES
  (
    'demo-returning-linked',
    'Mock/synthetic POC returning customer',
    1,
    '[{"orderId":"synthetic-poc-order-001","completedAt":"2026-07-20T09:00:00Z","lines":[{"sellableItemId":"20751","categoryId":"20000","quantity":1}]}]',
    '["20751"]',
    '2026-07-27T00:00:00Z'
  ),
  (
    'demo-linked-zero-history',
    'Mock/synthetic POC linked customer with zero history',
    1,
    '[]',
    '[]',
    '2026-07-27T00:00:00Z'
  ),
  (
    'demo-anonymous-unlinked',
    'Mock/synthetic POC anonymous unlinked journey',
    0,
    '[]',
    '[]',
    '2026-07-27T00:00:00Z'
  );
