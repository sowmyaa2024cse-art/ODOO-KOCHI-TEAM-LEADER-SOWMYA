ALTER TABLE payments
  ADD COLUMN note TEXT;

CREATE INDEX subscriptions_created_status_idx
  ON subscriptions (created_at DESC, status);
CREATE INDEX subscriptions_closed_at_idx
  ON subscriptions (closed_at)
  WHERE closed_at IS NOT NULL;
CREATE INDEX invoices_period_status_idx
  ON invoices (period_start, status, subscription_id);
CREATE INDEX invoices_subscription_period_idx
  ON invoices (subscription_id, period_start DESC)
  WHERE kind = 'billing';
CREATE INDEX payments_received_invoice_idx
  ON payments (received_at DESC, invoice_id);
