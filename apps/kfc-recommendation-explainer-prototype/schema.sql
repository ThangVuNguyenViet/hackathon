-- THROWAWAY PROTOTYPE — local D1 only.
CREATE TABLE IF NOT EXISTS prototype_recommendation_profiles (
  profile_key TEXT PRIMARY KEY CHECK (profile_key IN ('authenticated', 'guest')),
  customer_ref TEXT,
  linked INTEGER NOT NULL CHECK (linked IN (0, 1)),
  cart_json TEXT NOT NULL CHECK (json_valid(cart_json)),
  cart_revision INTEGER NOT NULL CHECK (cart_revision >= 0),
  completed_orders_json TEXT NOT NULL CHECK (json_valid(completed_orders_json)),
  checkout_outcomes_json TEXT NOT NULL CHECK (json_valid(checkout_outcomes_json)),
  last_decision_json TEXT CHECK (
    last_decision_json IS NULL OR json_valid(last_decision_json)
  ),
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO prototype_recommendation_profiles (
  profile_key,
  customer_ref,
  linked,
  cart_json,
  cart_revision,
  completed_orders_json,
  checkout_outcomes_json,
  last_decision_json,
  updated_at
) VALUES
  (
    'authenticated',
    'demo-customer-001',
    1,
    '[]',
    0,
    '[]',
    '[]',
    NULL,
    '2026-07-29T00:00:00.000Z'
  ),
  (
    'guest',
    NULL,
    0,
    '[]',
    0,
    '[]',
    '[]',
    NULL,
    '2026-07-29T00:00:00.000Z'
  );
