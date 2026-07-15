CREATE TRIGGER IF NOT EXISTS commerce_lifecycle_faults_validate_insert
BEFORE INSERT ON commerce_lifecycle_faults
WHEN NEW.operation NOT IN ('payment_pending', 'payment_paid', 'payment_failed', 'payment_expired', 'payment_cancelled', 'order_accepted', 'order_rejected', 'order_preparing', 'order_ready', 'order_completed', 'order_cancelled', 'delivery_pending', 'delivery_assigned', 'delivery_started', 'delivery_delivered', 'delivery_cancelled', 'delivery_failed')
  OR NEW.occurrence <= 0
  OR NEW.fault_type NOT IN ('timeout', 'connection', 'rejection', 'malformed', 'partial')
  OR NEW.phase NOT IN ('before_commit', 'after_commit')
  OR NEW.one_shot NOT IN (0, 1)
  OR NEW.configured_revision < 0
  OR NEW.base_occurrence < 0
BEGIN
  SELECT RAISE(ABORT, 'invalid commerce lifecycle fault');
END;

CREATE TRIGGER IF NOT EXISTS commerce_lifecycle_faults_validate_update
BEFORE UPDATE ON commerce_lifecycle_faults
WHEN NEW.operation NOT IN ('payment_pending', 'payment_paid', 'payment_failed', 'payment_expired', 'payment_cancelled', 'order_accepted', 'order_rejected', 'order_preparing', 'order_ready', 'order_completed', 'order_cancelled', 'delivery_pending', 'delivery_assigned', 'delivery_started', 'delivery_delivered', 'delivery_cancelled', 'delivery_failed')
  OR NEW.occurrence <= 0
  OR NEW.fault_type NOT IN ('timeout', 'connection', 'rejection', 'malformed', 'partial')
  OR NEW.phase NOT IN ('before_commit', 'after_commit')
  OR NEW.one_shot NOT IN (0, 1)
  OR NEW.configured_revision < 0
  OR NEW.base_occurrence < 0
BEGIN
  SELECT RAISE(ABORT, 'invalid commerce lifecycle fault');
END;
