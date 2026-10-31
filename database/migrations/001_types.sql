CREATE TYPE user_role AS ENUM ('admin', 'staff', 'customer');
CREATE TYPE billing_period AS ENUM ('daily', 'weekly', 'monthly', 'yearly');
CREATE TYPE subscription_status AS ENUM (
  'draft',
  'quotation',
  'confirmed',
  'active',
  'closed'
);
CREATE TYPE invoice_status AS ENUM (
  'draft',
  'issued',
  'partially_paid',
  'paid',
  'overdue',
  'void'
);
CREATE TYPE discount_type AS ENUM ('fixed', 'percent');
CREATE TYPE discount_scope AS ENUM ('all', 'products', 'plans', 'products_and_plans');
CREATE TYPE payment_method AS ENUM ('cash', 'bank_transfer', 'card', 'cheque', 'other');
CREATE TYPE email_status AS ENUM ('queued', 'sending', 'sent', 'failed');
