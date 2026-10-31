CREATE TABLE idempotency_keys (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope VARCHAR(200) NOT NULL,
  key VARCHAR(255) NOT NULL,
  request_hash CHAR(64) NOT NULL,
  response_status SMALLINT,
  response_body JSONB,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT idempotency_scope_not_blank CHECK (length(trim(scope)) > 0),
  CONSTRAINT idempotency_key_not_blank CHECK (length(trim(key)) > 0),
  CONSTRAINT idempotency_request_hash_format CHECK (
    request_hash ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT idempotency_response_pair CHECK (
    (response_status IS NULL AND response_body IS NULL)
    OR (
      response_status IS NOT NULL
      AND response_status BETWEEN 100 AND 599
      AND response_body IS NOT NULL
    )
  ),
  CONSTRAINT idempotency_user_scope_key_unique UNIQUE (user_id, scope, key)
);

CREATE INDEX idempotency_expiry_idx ON idempotency_keys (expires_at);

CREATE VIEW dashboard_summary AS
SELECT
  (SELECT count(*) FROM subscriptions WHERE status = 'active')
    AS active_subscriptions,
  (SELECT count(*) FROM subscriptions WHERE status = 'draft')
    AS draft_subscriptions,
  (SELECT count(*) FROM invoices WHERE status IN ('issued', 'partially_paid'))
    AS open_invoices,
  (SELECT count(*) FROM invoices WHERE status = 'overdue')
    AS overdue_invoices,
  (SELECT COALESCE(sum(amount), 0)::NUMERIC(14, 2)
   FROM payments
   WHERE received_at >= date_trunc('month', CURRENT_TIMESTAMP))
    AS payments_received_this_month,
  (SELECT COALESCE(
     sum(GREATEST(i.total - COALESCE(p.paid_amount, 0), 0)),
     0
   )::NUMERIC(14, 2)
   FROM invoices i
   LEFT JOIN (
     SELECT invoice_id, sum(amount) AS paid_amount
     FROM payments
     GROUP BY invoice_id
   ) p ON p.invoice_id = i.id
   WHERE i.status = 'overdue')
    AS overdue_amount;
