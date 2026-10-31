CREATE TABLE invoices (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  number VARCHAR(40) NOT NULL UNIQUE,
  subscription_id BIGINT NOT NULL REFERENCES subscriptions(id) ON DELETE RESTRICT,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  issued_at TIMESTAMPTZ,
  due_date DATE NOT NULL,
  status invoice_status NOT NULL DEFAULT 'draft',
  currency_code CHAR(3) NOT NULL DEFAULT 'USD',
  subtotal NUMERIC(12, 2) NOT NULL DEFAULT 0,
  discount_total NUMERIC(12, 2) NOT NULL DEFAULT 0,
  tax_total NUMERIC(12, 2) NOT NULL DEFAULT 0,
  total NUMERIC(12, 2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT invoices_subscription_period_unique UNIQUE (
    subscription_id,
    period_start
  ),
  CONSTRAINT invoices_period_range CHECK (period_end > period_start),
  CONSTRAINT invoices_currency_format CHECK (currency_code ~ '^[A-Z]{3}$'),
  CONSTRAINT invoices_totals_nonnegative CHECK (
    subtotal >= 0
    AND discount_total >= 0
    AND tax_total >= 0
    AND total >= 0
  ),
  CONSTRAINT invoices_discount_within_subtotal CHECK (discount_total <= subtotal),
  CONSTRAINT invoices_total_matches_components CHECK (
    total = subtotal - discount_total + tax_total
  )
);

CREATE TABLE invoice_lines (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  invoice_id BIGINT NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
  position INTEGER NOT NULL,
  product_id BIGINT REFERENCES products(id) ON DELETE SET NULL,
  variant_id BIGINT REFERENCES product_variants(id) ON DELETE SET NULL,
  description VARCHAR(500) NOT NULL,
  quantity NUMERIC(12, 3) NOT NULL,
  unit_price NUMERIC(12, 2) NOT NULL,
  tax_name VARCHAR(200),
  tax_rate NUMERIC(5, 2) NOT NULL DEFAULT 0,
  tax_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  discount_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  line_total NUMERIC(12, 2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT invoice_lines_quantity_positive CHECK (quantity > 0),
  CONSTRAINT invoice_lines_price_nonnegative CHECK (unit_price >= 0),
  CONSTRAINT invoice_lines_description_not_blank CHECK (
    length(trim(description)) > 0
  ),
  CONSTRAINT invoice_lines_tax_rate_range CHECK (
    tax_rate >= 0 AND tax_rate <= 100
  ),
  CONSTRAINT invoice_lines_amounts_nonnegative CHECK (
    tax_amount >= 0 AND discount_amount >= 0 AND line_total >= 0
  ),
  CONSTRAINT invoice_lines_discount_within_amount CHECK (
    discount_amount <= quantity * unit_price
  ),
  CONSTRAINT invoice_lines_total_matches_components CHECK (
    line_total = round(quantity * unit_price, 2) - discount_amount + tax_amount
  ),
  CONSTRAINT invoice_lines_position_unique UNIQUE (invoice_id, position)
);

CREATE TABLE payments (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  invoice_id BIGINT NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
  amount NUMERIC(12, 2) NOT NULL,
  method payment_method NOT NULL,
  reference VARCHAR(200),
  received_at TIMESTAMPTZ NOT NULL,
  recorded_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT payments_amount_positive CHECK (amount > 0),
  CONSTRAINT payments_reference_unique UNIQUE (reference)
);

CREATE FUNCTION prevent_payment_mutation() RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'payments are append-only';
END;
$$;

CREATE TRIGGER payments_append_only
  BEFORE UPDATE OR DELETE ON payments
  FOR EACH ROW EXECUTE FUNCTION prevent_payment_mutation();

CREATE TABLE email_outbox (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  recipient VARCHAR(320) NOT NULL,
  template_key VARCHAR(120) NOT NULL,
  payload JSONB NOT NULL,
  status email_status NOT NULL DEFAULT 'queued',
  attempts INTEGER NOT NULL DEFAULT 0,
  available_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT email_outbox_recipient_not_blank CHECK (
    length(trim(recipient)) > 0
  ),
  CONSTRAINT email_outbox_attempts_nonnegative CHECK (attempts >= 0),
  CONSTRAINT email_outbox_payload_object CHECK (jsonb_typeof(payload) = 'object'),
  CONSTRAINT email_outbox_sent_timestamp_consistent CHECK (
    (status = 'sent' AND sent_at IS NOT NULL)
    OR (status <> 'sent' AND sent_at IS NULL)
  )
);

CREATE TABLE system_clock (
  singleton_id SMALLINT PRIMARY KEY DEFAULT 1,
  current_time TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  audit_head_hash CHAR(64),
  CONSTRAINT system_clock_singleton CHECK (singleton_id = 1),
  CONSTRAINT system_clock_audit_hash_format CHECK (
    audit_head_hash IS NULL OR audit_head_hash ~ '^[0-9a-f]{64}$'
  )
);

INSERT INTO system_clock (singleton_id, current_time, audit_head_hash)
VALUES (1, CURRENT_TIMESTAMP, NULL);

CREATE TABLE audit_log (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  action VARCHAR(120) NOT NULL,
  entity_type VARCHAR(120) NOT NULL,
  entity_id VARCHAR(120) NOT NULL,
  payload JSONB NOT NULL,
  prev_hash CHAR(64),
  hash CHAR(64) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT audit_log_action_not_blank CHECK (length(trim(action)) > 0),
  CONSTRAINT audit_log_entity_not_blank CHECK (
    length(trim(entity_type)) > 0 AND length(trim(entity_id)) > 0
  ),
  CONSTRAINT audit_log_payload_object CHECK (jsonb_typeof(payload) = 'object'),
  CONSTRAINT audit_log_hash_format CHECK (hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT audit_log_prev_hash_format CHECK (
    prev_hash IS NULL OR prev_hash ~ '^[0-9a-f]{64}$'
  )
);

CREATE FUNCTION enforce_audit_chain() RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  current_head CHAR(64);
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'audit_log is append-only';
  END IF;

  SELECT audit_head_hash
  INTO current_head
  FROM system_clock
  WHERE singleton_id = 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'system_clock singleton row is missing';
  END IF;

  IF NEW.prev_hash IS DISTINCT FROM current_head THEN
    RAISE EXCEPTION 'audit chain head mismatch';
  END IF;

  UPDATE system_clock
  SET audit_head_hash = NEW.hash
  WHERE singleton_id = 1;

  RETURN NEW;
END;
$$;

CREATE TRIGGER audit_log_chain_guard
  BEFORE INSERT OR UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION enforce_audit_chain();

CREATE INDEX invoices_status_due_date_idx ON invoices (status, due_date);
CREATE INDEX invoices_customer_dashboard_idx
  ON invoices (due_date, status, subscription_id);
CREATE INDEX invoices_subscription_idx ON invoices (subscription_id);
CREATE INDEX invoice_lines_product_idx
  ON invoice_lines (product_id)
  WHERE product_id IS NOT NULL;
CREATE INDEX payments_invoice_idx ON payments (invoice_id);
CREATE INDEX payments_received_at_idx ON payments (received_at DESC);
CREATE INDEX email_outbox_delivery_idx
  ON email_outbox (status, available_at, id)
  WHERE status IN ('queued', 'failed');
CREATE INDEX audit_log_entity_idx ON audit_log (entity_type, entity_id, created_at DESC);
