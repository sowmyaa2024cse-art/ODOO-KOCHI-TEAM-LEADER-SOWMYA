# API

## Health

- `GET /api/health` — returns `{ "data": { "status": "ok" } }` when the API process is running.
- Unknown routes return the standard error envelope with HTTP 404.

## Authentication

All request bodies are Zod-validated; invalid requests return HTTP 422 using
`{ "error": { "code", "message", "details" } }`. Authenticated requests use the
`brightloop_session` HTTP-only, SameSite=Lax cookie. The cookie contains a
short-lived signed session token; the corresponding database session is checked
on each request so logout and password reset revoke existing sessions.

- `POST /api/auth/register` — create a customer account and customer profile.
  Body: `{ "email", "password", "fullName", "companyName?" }`. Passwords must
  have 9–128 characters, uppercase, lowercase, and a special character.
  Duplicate email returns 409. Registration does not auto-login.
- `POST /api/auth/login` — body `{ "email", "password" }`; sets the session
  cookie. Invalid credentials return 401 without identifying the failed field.
- `POST /api/auth/logout` — authenticated; revokes the current session, clears
  the cookie, and returns 204.
- `GET /api/auth/me` — authenticated; returns the current user's role and
  customer ID (null for staff/admin).
- `POST /api/auth/forgot-password` — body `{ "email" }`; always returns the
  same 202 response to avoid account enumeration. For known accounts, queues an
  encrypted reset token in `email_outbox`; the SHA-256 token hash and one-hour
  expiry are stored on the user.
- `POST /api/auth/reset-password` — body `{ "token", "password" }`; consumes a
  valid unexpired token exactly once, changes the password, and revokes all
  active sessions. Invalid or expired tokens return 400.
- `POST /api/users` — admin only; body `{ "email", "password" }`; creates a
  staff account. Customer and staff callers receive 403.

Login is limited to 10 attempts per IP per 15 minutes. Forgot/reset requests
share a limit of 5 per IP per hour. The default limiter store is in-memory and
appropriate for the single-process local deployment.

Set `AUTH_TOKEN_SECRET` to a unique random value of at least 32 characters and
`RESET_TOKEN_ENCRYPTION_KEY` to a 32-byte hexadecimal key before exposing the
service beyond local development. Outbox reset tokens are authenticated
AES-256-GCM ciphertext so an eventual SMTP worker can decrypt them without
persisting the raw bearer token.

## Authorization and customer ownership

`src/auth/customer-scope.ts` provides `scopeCustomerQuery`, which adds
`customer_id = authenticatedCustomerId` to a Knex query before execution.
Customer-owned repository methods must apply this helper rather than filtering
results after retrieval or trusting a customer ID from request input.

## Catalog and subscriptions

The following endpoints require an authenticated cookie. Lists are paginated
with `page` (default 1) and `limit` (default 25, max 100), and return
`{ "data": [], "meta": { "page", "limit", "total" } }`.

- `GET /api/products` — active products and variants. Supports `search`.
- `POST /api/products` — admin/staff. Body includes `sku`, `name`, decimal
  string `unitPrice`, optional description and variants
  (`{ "attribute", "value", "extraPrice" }`).
- `PATCH /api/products/:id` — admin/staff; updates product fields.
- `POST /api/products/:id/variants` — admin/staff; adds a variant.
- `GET /api/plans` — active plans and billing/availability/behavior flags.
- `POST /api/plans` — admin only.
- `GET /api/taxes` — active taxes.
- `POST /api/taxes` — admin only.
- `GET /api/quotation-templates` — active templates and lines.
- `POST /api/quotation-templates` — admin/staff. Lines reference product,
  optional variant/plan/tax, quantity and description; price defaults to the
  product plus variant price. Template validity is in days.
- `GET /api/subscriptions` — paginated list with optional `status` and
  `customerId` filters. Customers are always constrained to their own
  `customer_id` in SQL, regardless of supplied filters.
- `POST /api/subscriptions` — creates a draft. Customers are assigned their own
  customer ID and cannot override catalog prices; staff/admin must provide
  `customerId`. Lines include product, optional variant/tax, description and
  decimal-string quantity. Server-side product/variant pricing is used unless
  an admin/staff line supplies a decimal-string `unitPrice`.
- `GET /api/subscriptions/:id` — subscription plus lines; customer access is
  ownership-scoped.
- `PUT /api/subscriptions/:id` — replaces plan, currency, and lines while in
  draft or quotation status.
- `DELETE /api/subscriptions/:id` — soft-deletes drafts and quotations only.
- `POST /api/subscriptions/from-template/:templateId` — creates a quotation
  snapshot for the current customer, or a provided `customerId` for staff/admin.
  Supply a `planId` if the template lines do not select one.
- `POST /api/subscriptions/:id/quote` — draft to quotation (30-day validity).
- `POST /api/subscriptions/:id/confirm` — quotation to confirmed; expired
  quotations return 409.
- `POST /api/subscriptions/:id/activate` — confirmed to active or paused to
  active; sets the next billing date using the plan period/interval.
- `POST /api/subscriptions/:id/pause` — active to paused if the plan is pausable.
- `POST /api/subscriptions/:id/renew` — closed to active if renewable.
- `POST /api/subscriptions/:id/close` — closes a non-closed subscription if
  closable. Closing clears its next billing date.

All invalid subscription lifecycle transitions return HTTP 409. Supported
transitions are centralized in
`src/subscriptions/subscription-state-machine.ts`. Plan quantity minimums and
date availability are checked when creating/updating subscriptions. Money is
accepted and returned as decimal strings; the database computes subscription
line amounts using `NUMERIC` and tax-inclusive/exclusive settings.

## Billing and invoices

Billing endpoints require an authenticated admin or staff account except PDF
downloads and subscription proration, which are also available to customers
for their own records. Billing uses the server clock's UTC calendar date and
the configured `MARGIN_GUARD_MODE` (`warn` by default, or `block`).

- `POST /api/billing/preview` — accepts an empty JSON object (or no body) and
  returns each due subscription, the proposed invoice or skip reason, totals,
  and margin warnings. It does not write billing data.
- `POST /api/billing/run` — accepts an empty JSON object (or no body) and
  requires an `Idempotency-Key` header (8–255 safe characters). Runs one
  transaction over due subscriptions, returns created invoices and skips, and
  replays the original response for a repeated key. Reusing the key for a
  different billing date or guard mode returns 409. Due rows are locked with
  `FOR UPDATE SKIP LOCKED`; a partial unique index independently prevents a
  second billing invoice for a subscription period.
- `POST /api/subscriptions/:id/lines/:lineId/proration` — body
  `{ "quantity": "3.000" }` and an `Idempotency-Key`; creates a draft charge
  or credit invoice for the remaining days of the active billing period and
  then updates the line quantity. Repeating the same key and request returns
  the original invoice; key reuse for a different request returns 409.
- `POST /api/invoices/:id/confirm` — draft to confirmed.
- `POST /api/invoices/:id/mark-paid` — confirmed to paid.
- `POST /api/invoices/:id/cancel` — draft or confirmed to cancelled.
- `POST /api/invoices/:id/send` — queues a confirmed invoice in
  `email_outbox`; a sent invoice is not queued twice. SMTP delivery remains
  optional and offline-safe.
- `GET /api/invoices/:id/pdf` — returns a self-contained printable PDF, with
  database-level customer ownership scoping.
- `POST /api/invoices/:id/payments` — admin/staff records a payment using
  `{ "method", "amount", "receivedAt", "note?" }`. Payments are append-only;
  amounts are positive decimal strings and cannot exceed the remaining invoice
  balance. An outstanding invoice becomes `partially_paid` (or remains
  `overdue`) until payments cover its total, then becomes `paid`.
- `GET /api/reports/summary` — admin/staff invoice, payment, subscription, and
  overdue totals grouped by currency.
- `GET /api/reports/mrr` — admin/staff monthly recurring revenue and ARR,
  new MRR, expansion, and churn, grouped by currency. MRR normalizes current
  subscription line amounts by plan billing period and interval. New and churn
  use subscription creation and closure dates; expansion compares current
  recurring amounts with each active subscription's latest billing invoice.
- `GET /api/reports/overdue` — admin/staff outstanding invoices whose due date
  has passed, including paid-to-date and balance due.
- `GET /api/reports/revenue` — admin/staff payments grouped by received date
  and currency.

Reports accept `from`, `to`, `customerId`, and `currencyCode`; list reports
also accept `page` (default 1) and `limit` (default 25, max 100). Date ranges
are inclusive. Queries use indexed date/customer/invoice paths and return
paginated `{ "data": [], "meta": { "page", "limit", "total" } }` envelopes
where applicable.

- `GET /api/events` — authenticated Server-Sent Events stream. Emits
  `invoice.created`, `invoice.status`, `invoice.sent`, and `payment.recorded`.
  Staff can observe all events; customers receive events only for their own
  invoices. The stream sends periodic keep-alives.

Invoice state transitions are centralized in
`src/invoices/invoice-state-machine.ts`; invalid transitions return HTTP 409.
Invoice lines snapshot tax, cost, description, discounts, and price. All money
arithmetic uses integer minor units/`BigInt`; no floating-point calculations
are used for totals.
