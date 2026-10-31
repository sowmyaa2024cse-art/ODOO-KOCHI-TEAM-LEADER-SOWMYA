CREATE TABLE users (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email VARCHAR(320) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role user_role NOT NULL,
  reset_token_hash CHAR(64),
  reset_expires TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT users_email_normalized CHECK (email = lower(email)),
  CONSTRAINT users_email_not_blank CHECK (length(trim(email)) > 0),
  CONSTRAINT users_password_hash_not_blank CHECK (length(password_hash) > 0),
  CONSTRAINT users_reset_token_pair CHECK (
    (reset_token_hash IS NULL AND reset_expires IS NULL)
    OR (reset_token_hash IS NOT NULL AND reset_expires IS NOT NULL)
  ),
  CONSTRAINT users_reset_token_hash_format CHECK (
    reset_token_hash IS NULL OR reset_token_hash ~ '^[0-9a-f]{64}$'
  )
);

CREATE TABLE customers (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id BIGINT NOT NULL UNIQUE REFERENCES users(id) ON DELETE RESTRICT,
  full_name VARCHAR(200) NOT NULL,
  company_name VARCHAR(200),
  phone VARCHAR(40),
  billing_address JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT customers_name_not_blank CHECK (length(trim(full_name)) > 0),
  CONSTRAINT customers_billing_address_object CHECK (
    jsonb_typeof(billing_address) = 'object'
  )
);

CREATE TABLE products (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sku VARCHAR(80) NOT NULL UNIQUE,
  name VARCHAR(200) NOT NULL,
  description TEXT,
  unit_price NUMERIC(12, 2) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT products_name_not_blank CHECK (length(trim(name)) > 0),
  CONSTRAINT products_unit_price_nonnegative CHECK (unit_price >= 0)
);

CREATE TABLE product_variants (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  attribute VARCHAR(100) NOT NULL,
  value VARCHAR(200) NOT NULL,
  extra_price NUMERIC(12, 2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT product_variants_attribute_not_blank CHECK (
    length(trim(attribute)) > 0
  ),
  CONSTRAINT product_variants_value_not_blank CHECK (length(trim(value)) > 0),
  CONSTRAINT product_variants_extra_price_nonnegative CHECK (extra_price >= 0),
  CONSTRAINT product_variants_product_attribute_value_unique UNIQUE (
    product_id,
    attribute,
    value
  ),
  CONSTRAINT product_variants_product_id_unique UNIQUE (product_id, id)
);

CREATE INDEX customers_created_at_idx ON customers (created_at DESC);
CREATE UNIQUE INDEX users_reset_token_hash_idx
  ON users (reset_token_hash)
  WHERE reset_token_hash IS NOT NULL;
CREATE INDEX products_active_name_idx ON products (name) WHERE is_active;
CREATE INDEX product_variants_product_idx ON product_variants (product_id);
