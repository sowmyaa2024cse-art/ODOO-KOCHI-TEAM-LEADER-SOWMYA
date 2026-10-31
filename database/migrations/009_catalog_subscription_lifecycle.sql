ALTER TABLE subscriptions
  ADD COLUMN paused_at TIMESTAMPTZ,
  ADD COLUMN deleted_at TIMESTAMPTZ,
  ADD CONSTRAINT subscriptions_paused_timestamp_consistent CHECK (
    (status = 'paused' AND paused_at IS NOT NULL)
    OR (status <> 'paused' AND paused_at IS NULL)
  );

CREATE SEQUENCE subscription_number_seq;
ALTER TABLE subscriptions
  ALTER COLUMN number SET DEFAULT (
    'SUB-' || to_char(CURRENT_TIMESTAMP, 'YYYYMMDD') || '-'
    || lpad(nextval('subscription_number_seq')::text, 8, '0')
  );

ALTER TABLE subscription_lines
  ADD COLUMN tax_inclusive BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE subscription_lines
  ADD COLUMN amount NUMERIC(12, 2)
    GENERATED ALWAYS AS (
      round(
        quantity * unit_price - discount_amount
        + CASE
          WHEN tax_inclusive THEN 0
          ELSE round(
            (quantity * unit_price - discount_amount) * tax_rate / 100,
            2
          )
        END,
        2
      )
    ) STORED;

CREATE INDEX subscription_lines_subscription_position_idx
  ON subscription_lines (subscription_id, position);
CREATE INDEX subscriptions_not_deleted_created_idx
  ON subscriptions (created_at DESC, id DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX quotation_templates_active_name_idx
  ON quotation_templates (name)
  WHERE is_active;
CREATE INDEX plans_name_active_idx
  ON plans (name)
  WHERE is_active;
CREATE INDEX taxes_name_active_idx
  ON taxes (name)
  WHERE is_active;
