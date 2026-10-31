ALTER TABLE products
  ADD COLUMN cost_price NUMERIC(12, 2),
  ADD CONSTRAINT products_cost_price_nonnegative CHECK (
    cost_price IS NULL OR cost_price >= 0
  );

ALTER TABLE invoices
  DROP CONSTRAINT invoices_subscription_period_unique,
  DROP CONSTRAINT invoices_totals_nonnegative,
  DROP CONSTRAINT invoices_discount_within_subtotal;

ALTER TABLE invoices
  ADD COLUMN kind invoice_kind NOT NULL DEFAULT 'billing',
  ADD COLUMN sent_at TIMESTAMPTZ,
  ADD COLUMN proration_reference VARCHAR(120),
  ADD COLUMN proration_request_hash CHAR(64);

ALTER TABLE invoices
  ADD CONSTRAINT invoices_discount_total_nonnegative CHECK (
    discount_total >= 0
  );

CREATE UNIQUE INDEX invoices_billing_period_unique
  ON invoices (subscription_id, period_start)
  WHERE kind = 'billing';

CREATE SEQUENCE invoice_number_seq;
ALTER TABLE invoices
  ALTER COLUMN number SET DEFAULT (
    'INV-' || to_char(CURRENT_TIMESTAMP, 'YYYYMMDD') || '-'
    || lpad(nextval('invoice_number_seq')::text, 8, '0')
  );

ALTER TABLE invoice_lines
  DROP CONSTRAINT invoice_lines_amounts_nonnegative,
  DROP CONSTRAINT invoice_lines_total_matches_components;

ALTER TABLE invoice_lines
  ADD COLUMN kind invoice_line_type NOT NULL DEFAULT 'charge',
  ADD COLUMN tax_inclusive BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN cost_price NUMERIC(12, 2);

ALTER TABLE invoice_lines
  ADD CONSTRAINT invoice_lines_cost_price_nonnegative CHECK (
    cost_price IS NULL OR cost_price >= 0
  ),
  ADD CONSTRAINT invoice_lines_amounts_match_kind CHECK (
    discount_amount >= 0
    AND (
      (kind = 'charge' AND tax_amount >= 0 AND line_total >= 0)
      OR (kind = 'credit' AND tax_amount <= 0 AND line_total <= 0)
    )
  ),
  ADD CONSTRAINT invoice_lines_total_matches_components CHECK (
    line_total =
      CASE WHEN kind = 'credit' THEN -1 ELSE 1 END
      * (round(quantity * unit_price, 2) - discount_amount)
      + tax_amount
  );

CREATE INDEX invoices_kind_status_created_idx
  ON invoices (kind, status, created_at DESC);
CREATE INDEX invoices_sent_at_idx
  ON invoices (sent_at)
  WHERE sent_at IS NOT NULL;
CREATE INDEX discounts_usage_idx
  ON discounts (is_active, starts_at, ends_at, used_count);

CREATE TABLE invoice_discounts (
  invoice_id BIGINT NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
  discount_id BIGINT NOT NULL REFERENCES discounts(id) ON DELETE RESTRICT,
  applied_amount NUMERIC(12, 2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (invoice_id, discount_id),
  CONSTRAINT invoice_discounts_amount_positive CHECK (applied_amount > 0)
);

CREATE INDEX invoice_discounts_discount_idx
  ON invoice_discounts (discount_id, created_at DESC);

CREATE UNIQUE INDEX invoices_proration_reference_unique
  ON invoices (subscription_id, proration_reference)
  WHERE kind = 'proration' AND proration_reference IS NOT NULL;

ALTER TABLE invoices
  ADD CONSTRAINT invoices_proration_hash_format CHECK (
    proration_request_hash IS NULL
    OR proration_request_hash ~ '^[0-9a-f]{64}$'
  );
