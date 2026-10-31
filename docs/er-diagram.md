# Brightloop database ER diagram

```mermaid
erDiagram
  USERS {
    bigint id PK
    varchar email UK
    text password_hash
    user_role role
    char reset_token_hash
    timestamptz reset_expires
  }
  CUSTOMERS {
    bigint id PK
    bigint user_id FK,UK
    varchar full_name
    jsonb billing_address
  }
  PRODUCTS {
    bigint id PK
    varchar sku UK
    numeric unit_price
    boolean is_active
  }
  PRODUCT_VARIANTS {
    bigint id PK
    bigint product_id FK
    varchar attribute
    varchar value
    numeric extra_price
  }
  PLANS {
    bigint id PK
    varchar code UK
    billing_period billing_period
    integer billing_interval
    numeric price
    integer min_qty
  }
  TAXES {
    bigint id PK
    varchar code UK
    numeric rate
  }
  DISCOUNTS {
    bigint id PK
    varchar code UK
    discount_type discount_type
    numeric value
    discount_scope scope
    integer used_count
  }
  DISCOUNT_PRODUCTS {
    bigint discount_id PK,FK
    bigint product_id PK,FK
  }
  DISCOUNT_PLANS {
    bigint discount_id PK,FK
    bigint plan_id PK,FK
  }
  QUOTATION_TEMPLATES {
    bigint id PK
    varchar name UK
    integer validity_days
  }
  QUOTATION_TEMPLATE_LINES {
    bigint id PK
    bigint template_id FK
    bigint product_id FK
    bigint variant_id FK
    bigint plan_id FK
    bigint tax_id FK
    numeric unit_price
  }
  SUBSCRIPTIONS {
    bigint id PK
    varchar number UK
    bigint customer_id FK
    bigint plan_id FK
    bigint created_by FK
    subscription_status status
    date next_billing_date
    timestamptz paused_at
    timestamptz deleted_at
  }
  SUBSCRIPTION_LINES {
    bigint id PK
    bigint subscription_id FK
    bigint product_id FK
    bigint variant_id FK
    bigint tax_id FK
    numeric unit_price
    numeric tax_rate
    numeric discount_amount
    boolean tax_inclusive
    numeric amount
  }
  INVOICES {
    bigint id PK
    varchar number UK
    bigint subscription_id FK
    date period_start
    date due_date
    invoice_status status
    numeric total
  }
  INVOICE_LINES {
    bigint id PK
    bigint invoice_id FK
    bigint product_id FK
    bigint variant_id FK
    varchar description
    numeric unit_price
    numeric tax_rate
    numeric tax_amount
    numeric discount_amount
    numeric line_total
  }
  PAYMENTS {
    bigint id PK
    bigint invoice_id FK
    numeric amount
    payment_method method
    timestamptz received_at
  }
  EMAIL_OUTBOX {
    bigint id PK
    varchar recipient
    email_status status
    jsonb payload
    integer attempts
  }
  AUDIT_LOG {
    bigint id PK
    bigint actor_id FK
    varchar action
    varchar entity_type
    char prev_hash
    char hash UK
  }
  IDEMPOTENCY_KEYS {
    bigint id PK
    bigint user_id FK
    varchar scope
    varchar key
    char request_hash
    timestamptz expires_at
  }
  AUTH_SESSIONS {
    uuid session_id PK
    bigint user_id FK
    timestamptz expires_at
    timestamptz revoked_at
  }
  SYSTEM_CLOCK {
    smallint singleton_id PK
    timestamptz current_time
    char audit_head_hash
  }
  DASHBOARD_SUMMARY {
    bigint active_subscriptions
    bigint open_invoices
    bigint overdue_invoices
    numeric payments_received_this_month
    numeric overdue_amount
  }

  USERS ||--o| CUSTOMERS : owns
  USERS ||--o{ SUBSCRIPTIONS : creates
  USERS ||--o{ PAYMENTS : records
  USERS ||--o{ AUDIT_LOG : performs
  USERS ||--o{ IDEMPOTENCY_KEYS : owns
  USERS ||--o{ AUTH_SESSIONS : authenticates
  CUSTOMERS ||--o{ SUBSCRIPTIONS : subscribes
  PRODUCTS ||--o{ PRODUCT_VARIANTS : varies
  PRODUCTS ||--o{ QUOTATION_TEMPLATE_LINES : quoted
  PRODUCTS ||--o{ SUBSCRIPTION_LINES : sold
  PRODUCTS ||--o{ INVOICE_LINES : snapshot_reference
  PLANS ||--o{ SUBSCRIPTIONS : selected
  PLANS ||--o{ QUOTATION_TEMPLATE_LINES : offered
  PLANS ||--o{ DISCOUNT_PLANS : eligible
  DISCOUNTS ||--o{ DISCOUNT_PRODUCTS : targets
  PRODUCTS ||--o{ DISCOUNT_PRODUCTS : discounted
  DISCOUNTS ||--o{ DISCOUNT_PLANS : targets
  TAXES ||--o{ QUOTATION_TEMPLATE_LINES : applies
  TAXES ||--o{ SUBSCRIPTION_LINES : applies
  QUOTATION_TEMPLATES ||--|{ QUOTATION_TEMPLATE_LINES : contains
  SUBSCRIPTIONS ||--|{ SUBSCRIPTION_LINES : contains
  SUBSCRIPTIONS ||--o{ INVOICES : billed
  INVOICES ||--|{ INVOICE_LINES : snapshots
  INVOICES ||--o{ PAYMENTS : receives
```

`DASHBOARD_SUMMARY` is a view over subscriptions, invoices, and payments.
`SYSTEM_CLOCK` is a singleton coordination row and has no ordinary entity
relationship. Invoice-line descriptions and monetary/tax values are historical
snapshots; nullable catalog references are informational only.
