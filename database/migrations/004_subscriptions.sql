CREATE TABLE subscriptions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  number VARCHAR(40) NOT NULL UNIQUE,
  customer_id BIGINT NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  plan_id BIGINT NOT NULL REFERENCES plans(id) ON DELETE RESTRICT,
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  status subscription_status NOT NULL DEFAULT 'draft',
  currency_code CHAR(3) NOT NULL DEFAULT 'USD',
  quote_valid_until DATE,
  start_date DATE,
  next_billing_date DATE,
  end_date DATE,
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT subscriptions_number_not_blank CHECK (length(trim(number)) > 0),
  CONSTRAINT subscriptions_currency_format CHECK (currency_code ~ '^[A-Z]{3}$'),
  CONSTRAINT subscriptions_date_order CHECK (
    end_date IS NULL OR start_date IS NULL OR end_date >= start_date
  ),
  CONSTRAINT subscriptions_active_has_billing_date CHECK (
    status <> 'active' OR next_billing_date IS NOT NULL
  ),
  CONSTRAINT subscriptions_closed_timestamp_consistent CHECK (
    closed_at IS NULL OR status = 'closed'
  )
);

CREATE TABLE subscription_lines (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  subscription_id BIGINT NOT NULL REFERENCES subscriptions(id) ON DELETE RESTRICT,
  position INTEGER NOT NULL,
  product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  variant_id BIGINT,
  tax_id BIGINT REFERENCES taxes(id) ON DELETE RESTRICT,
  description VARCHAR(500) NOT NULL,
  quantity NUMERIC(12, 3) NOT NULL DEFAULT 1,
  unit_price NUMERIC(12, 2) NOT NULL,
  tax_rate NUMERIC(5, 2) NOT NULL DEFAULT 0,
  discount_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT subscription_lines_quantity_positive CHECK (quantity > 0),
  CONSTRAINT subscription_lines_price_nonnegative CHECK (unit_price >= 0),
  CONSTRAINT subscription_lines_tax_rate_range CHECK (
    tax_rate >= 0 AND tax_rate <= 100
  ),
  CONSTRAINT subscription_lines_discount_nonnegative CHECK (discount_amount >= 0),
  CONSTRAINT subscription_lines_discount_within_amount CHECK (
    discount_amount <= quantity * unit_price
  ),
  CONSTRAINT subscription_lines_description_not_blank CHECK (
    length(trim(description)) > 0
  ),
  CONSTRAINT subscription_lines_position_unique UNIQUE (subscription_id, position),
  CONSTRAINT subscription_lines_variant_product_fk
    FOREIGN KEY (product_id, variant_id)
    REFERENCES product_variants(product_id, id)
    ON DELETE RESTRICT
);

CREATE INDEX subscriptions_customer_created_idx
  ON subscriptions (customer_id, created_at DESC);
CREATE INDEX subscriptions_status_next_billing_idx
  ON subscriptions (status, next_billing_date);
CREATE INDEX subscriptions_plan_idx ON subscriptions (plan_id);
CREATE INDEX subscription_lines_product_idx ON subscription_lines (product_id);
CREATE INDEX subscription_lines_tax_idx
  ON subscription_lines (tax_id)
  WHERE tax_id IS NOT NULL;
