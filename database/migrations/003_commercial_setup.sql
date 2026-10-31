CREATE TABLE plans (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code VARCHAR(80) NOT NULL UNIQUE,
  name VARCHAR(200) NOT NULL,
  description TEXT,
  billing_period billing_period NOT NULL,
  billing_interval INTEGER NOT NULL DEFAULT 1,
  price NUMERIC(12, 2) NOT NULL,
  min_qty INTEGER NOT NULL DEFAULT 1,
  available_from DATE,
  available_to DATE,
  auto_close BOOLEAN NOT NULL DEFAULT FALSE,
  closable BOOLEAN NOT NULL DEFAULT TRUE,
  pausable BOOLEAN NOT NULL DEFAULT FALSE,
  renewable BOOLEAN NOT NULL DEFAULT TRUE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT plans_name_not_blank CHECK (length(trim(name)) > 0),
  CONSTRAINT plans_price_nonnegative CHECK (price >= 0),
  CONSTRAINT plans_billing_interval_positive CHECK (billing_interval > 0),
  CONSTRAINT plans_min_qty_positive CHECK (min_qty > 0),
  CONSTRAINT plans_availability_range CHECK (
    available_to IS NULL
    OR available_from IS NULL
    OR available_to >= available_from
  )
);

CREATE TABLE taxes (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code VARCHAR(80) NOT NULL UNIQUE,
  name VARCHAR(200) NOT NULL,
  rate NUMERIC(5, 2) NOT NULL,
  is_inclusive BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT taxes_name_not_blank CHECK (length(trim(name)) > 0),
  CONSTRAINT taxes_rate_range CHECK (rate >= 0 AND rate <= 100)
);

CREATE TABLE discounts (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code VARCHAR(80) NOT NULL UNIQUE,
  name VARCHAR(200) NOT NULL,
  discount_type discount_type NOT NULL,
  value NUMERIC(12, 2) NOT NULL,
  min_purchase NUMERIC(12, 2) NOT NULL DEFAULT 0,
  min_qty INTEGER NOT NULL DEFAULT 1,
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  usage_limit INTEGER,
  used_count INTEGER NOT NULL DEFAULT 0,
  scope discount_scope NOT NULL DEFAULT 'all',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT discounts_name_not_blank CHECK (length(trim(name)) > 0),
  CONSTRAINT discounts_value_positive CHECK (value > 0),
  CONSTRAINT discounts_percent_max CHECK (
    discount_type <> 'percent' OR value <= 100
  ),
  CONSTRAINT discounts_min_purchase_nonnegative CHECK (min_purchase >= 0),
  CONSTRAINT discounts_min_qty_positive CHECK (min_qty > 0),
  CONSTRAINT discounts_usage_counts_valid CHECK (
    used_count >= 0 AND (usage_limit IS NULL OR usage_limit >= used_count)
  ),
  CONSTRAINT discounts_usage_limit_nonnegative CHECK (
    usage_limit IS NULL OR usage_limit >= 0
  ),
  CONSTRAINT discounts_date_range CHECK (
    ends_at IS NULL OR starts_at IS NULL OR ends_at >= starts_at
  )
);

CREATE TABLE discount_products (
  discount_id BIGINT NOT NULL REFERENCES discounts(id) ON DELETE CASCADE,
  product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  PRIMARY KEY (discount_id, product_id)
);

CREATE TABLE discount_plans (
  discount_id BIGINT NOT NULL REFERENCES discounts(id) ON DELETE CASCADE,
  plan_id BIGINT NOT NULL REFERENCES plans(id) ON DELETE RESTRICT,
  PRIMARY KEY (discount_id, plan_id)
);

CREATE FUNCTION validate_discount_target_scope() RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  target_scope discount_scope;
BEGIN
  SELECT scope
  INTO target_scope
  FROM discounts
  WHERE id = NEW.discount_id;

  IF TG_TABLE_NAME = 'discount_products'
    AND target_scope NOT IN ('products', 'products_and_plans') THEN
    RAISE EXCEPTION 'discount scope does not allow product targets';
  END IF;

  IF TG_TABLE_NAME = 'discount_plans'
    AND target_scope NOT IN ('plans', 'products_and_plans') THEN
    RAISE EXCEPTION 'discount scope does not allow plan targets';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER discount_products_scope_guard
  BEFORE INSERT OR UPDATE ON discount_products
  FOR EACH ROW EXECUTE FUNCTION validate_discount_target_scope();
CREATE TRIGGER discount_plans_scope_guard
  BEFORE INSERT OR UPDATE ON discount_plans
  FOR EACH ROW EXECUTE FUNCTION validate_discount_target_scope();

CREATE FUNCTION validate_discount_scope_change() RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.scope NOT IN ('products', 'products_and_plans')
    AND EXISTS (
      SELECT 1 FROM discount_products WHERE discount_id = NEW.id
    ) THEN
    RAISE EXCEPTION 'discount scope conflicts with product targets';
  END IF;

  IF NEW.scope NOT IN ('plans', 'products_and_plans')
    AND EXISTS (
      SELECT 1 FROM discount_plans WHERE discount_id = NEW.id
    ) THEN
    RAISE EXCEPTION 'discount scope conflicts with plan targets';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER discounts_scope_change_guard
  BEFORE UPDATE OF scope ON discounts
  FOR EACH ROW EXECUTE FUNCTION validate_discount_scope_change();

CREATE TABLE quotation_templates (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name VARCHAR(200) NOT NULL UNIQUE,
  description TEXT,
  validity_days INTEGER NOT NULL,
  currency_code CHAR(3) NOT NULL DEFAULT 'USD',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT quotation_templates_name_not_blank CHECK (length(trim(name)) > 0),
  CONSTRAINT quotation_templates_validity_positive CHECK (validity_days > 0),
  CONSTRAINT quotation_templates_currency_format CHECK (
    currency_code ~ '^[A-Z]{3}$'
  )
);

CREATE TABLE quotation_template_lines (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  template_id BIGINT NOT NULL REFERENCES quotation_templates(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  variant_id BIGINT,
  plan_id BIGINT REFERENCES plans(id) ON DELETE RESTRICT,
  tax_id BIGINT REFERENCES taxes(id) ON DELETE RESTRICT,
  description VARCHAR(500) NOT NULL,
  quantity NUMERIC(12, 3) NOT NULL DEFAULT 1,
  unit_price NUMERIC(12, 2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT quotation_template_lines_quantity_positive CHECK (quantity > 0),
  CONSTRAINT quotation_template_lines_price_nonnegative CHECK (unit_price >= 0),
  CONSTRAINT quotation_template_lines_description_not_blank CHECK (
    length(trim(description)) > 0
  ),
  CONSTRAINT quotation_template_lines_position_unique UNIQUE (template_id, position),
  CONSTRAINT quotation_template_lines_variant_product_fk
    FOREIGN KEY (product_id, variant_id)
    REFERENCES product_variants(product_id, id)
    ON DELETE RESTRICT
);

CREATE INDEX plans_available_active_idx
  ON plans (available_from, available_to)
  WHERE is_active;
CREATE INDEX discounts_active_dates_idx
  ON discounts (starts_at, ends_at)
  WHERE is_active;
CREATE INDEX discount_products_product_idx ON discount_products (product_id);
CREATE INDEX discount_plans_plan_idx ON discount_plans (plan_id);
CREATE INDEX quotation_template_lines_product_idx
  ON quotation_template_lines (product_id);
CREATE INDEX quotation_template_lines_plan_idx
  ON quotation_template_lines (plan_id)
  WHERE plan_id IS NOT NULL;
