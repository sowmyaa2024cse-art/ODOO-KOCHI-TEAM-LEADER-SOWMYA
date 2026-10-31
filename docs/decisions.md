# Decisions

## Backend foundation

- What: Start with Express, TypeScript, Zod, Knex/PostgreSQL, and a shared middleware layer.
- Why: These conventional pieces support the required layering and keep persistence parameterized.
- Alternative: Prisma was considered; Knex was selected to make future migrations and repository queries explicit.

## Local application scaffold

- What: Add a React/Vite web workspace and Docker Compose services for PostgreSQL, API, and web.
- Why: One local Compose command starts the complete offline-capable development stack without third-party runtime services.
- Alternative: Keep separate repositories or require a hosted frontend/database; rejected to keep hackathon setup local and reproducible.
- Logging uses structured JSON on stdout/stderr so Compose captures diagnostics without an external logging dependency.

## Phase 1: Database

- What: Use ordered PostgreSQL SQL migrations for enums, identity/catalog, commercial setup, subscriptions, finance/operations, and dashboard/idempotency.
- Why: PostgreSQL enums and declarative constraints reject invalid role, lifecycle, billing, amount, quantity, range, and reference data at the storage boundary.
- Alternative: Store lifecycle and billing values as unchecked strings; rejected because typos and illegal states would persist despite API validation.
- What: Store all prices, rates, quantities, and totals as fixed-precision `NUMERIC`; invoice lines retain descriptions, rates, tax amounts, and discounts from issue time.
- Why: Decimal database arithmetic avoids floating-point money drift, and invoice snapshots remain interpretable after catalog changes.
- Alternative: Recompute historical invoices from current product/tax records; rejected because catalog edits would rewrite financial history.
- What: Catalog and customer references use restrictive foreign keys; invoice snapshot references can be nulled while preserving the copied display and amount fields.
- Why: Referenced commercial records cannot disappear accidentally, while snapshots do not depend on catalog retention.
- Alternative: Cascade-delete through invoices and subscriptions; rejected because it destroys financial and customer history.
- What: Payments and audit entries are append-only; audit inserts are serialized through the singleton system clock and must extend its SHA-256 chain head.
- Why: Corrections are represented as compensating records, and chain order is unambiguous under concurrent inserts.
- Alternative: Update/delete financial activity or maintain an uncoordinated hash chain; rejected because either permits silent rewriting or creates forks.
- What: Discounts use explicit scope plus normalized product/plan join tables; idempotency is unique by actor, operation scope, and key; email is stored in an outbox.
- Why: These structures make target selection, request replay control, and reliable offline delivery state explicit and queryable.
- Alternative: Encode all targets and retry state in opaque JSON or call a hosted mail service directly; rejected because relational integrity and offline operation matter.
- What: Add composite status/date indexes and a single-row dashboard summary view; keep the view based on aggregates rather than cross-joining detail rows.
- Why: Common operational filters remain indexable at 5,000+ subscriptions without aggregate overcounting.
- Alternative: Compute dashboard totals through a fan-out of application queries; rejected because it duplicates query logic and adds request round trips.
- What: Seed deterministic identifiers and 5,000 active subscriptions with one invoice, snapshot line, and payment each in bounded batches.
- Why: The dataset provides repeatable list/dashboard performance data while exercising foreign keys and billing snapshots.
- Alternative: Seed only a few hand-written records or generate fixtures on every request; rejected because it does not exercise realistic row counts or stable local workflows.

## Phase 2: Authentication

- What: Public registration always creates a customer-role user and profile; only an authenticated admin can create staff through `POST /api/users`.
- Why: Public input cannot assign privileged roles, and the staff-creation policy has one explicit enforcement point.
- Alternative: Accept role from a registration payload or allow staff self-registration; rejected because either enables privilege escalation.
- What: Passwords use salted Node.js scrypt hashes; login uses a dummy hash for unknown emails; passwords must be at least nine characters with uppercase, lowercase, and a special character.
- Why: Slow salted password verification reduces offline cracking value and makes the unknown-account path less distinguishable.
- Alternative: Store reversible passwords or use an unsalted fast digest; rejected because credential compromise would be substantially worse.
- What: Sessions use short-lived HS256 JWTs from `jose` in an HttpOnly, SameSite=Lax cookie, backed by a revocable database session row checked on each authenticated request.
- Why: Cookie storage limits script access, and checking the session row makes logout/reset take effect before token expiry.
- Alternative: Purely stateless longer-lived JWTs; rejected because they cannot be reliably revoked after logout or password reset.
- What: Reset tokens are random, SHA-256-hashed in `users`, single-use and one-hour-expiring; outbox payload stores AES-256-GCM-encrypted token material.
- Why: Database disclosure does not reveal a usable reset token, while the future optional mail worker can deliver the reset link.
- Alternative: Store a raw token in the outbox or expose it in the API response; rejected because either creates a bearer-secret leak.
- What: Login and reset endpoints use per-IP in-memory rate limits; forgot-password responses are identical for known and unknown emails.
- Why: This limits online guessing and account enumeration in the current single-process local deployment.
- Alternative: Per-user limits or a remote distributed limiter; rejected for the offline single-instance stack, with the storage choice documented as a scale-out limitation.
- What: Customer-owned Knex queries use `scopeCustomerQuery` to apply the authenticated `customer_id` predicate in SQL.
- Why: Filtering at query time avoids loading other customers' data into application memory and reduces accidental cross-tenant exposure.
- Alternative: Filter returned collections or trust request-supplied customer IDs; rejected because it is easy to omit and inefficient.

## Phase 3: Catalog and subscriptions

- What: Products store variants as relational attribute/value rows with fixed-precision extra prices; subscription line pricing is resolved server-side from product plus variant, with overrides limited to staff/admin.
- Why: Variant attributes remain queryable and customer input cannot lower/alter catalog prices; `NUMERIC` strings and integer minor-unit arithmetic avoid JavaScript floating-point totals.
- Alternative: Store variants as JSON or accept client-computed amounts; rejected because they weaken relational validation and price integrity.
- What: Subscription numbers are generated from a PostgreSQL sequence-backed default, and subscription lines expose a stored generated amount based on fixed-precision quantity, price, tax, and inclusive-tax setting.
- Why: Concurrent creates receive unique numbers without application counters; the amount cannot be forged independently of its line components.
- Alternative: Allocate numbers in application memory or accept a posted amount; rejected due to races and inconsistent money.
- What: The lifecycle is centralized in a pure state-machine module; transitions lock the subscription row and consult plan flags before persisting.
- Why: Every endpoint shares one transition graph and concurrent requests cannot both act on a stale status.
- Alternative: Embed ad hoc status checks in controllers; rejected because allowed transitions would drift between routes.
- What: Customer subscriptions are filtered by `customer_id` in list/detail/update/delete/transition queries; deletion of drafts/quotations is soft, and non-draft edits are rejected.
- Why: Ownership is enforced before row data is returned or mutated, while historical references are preserved.
- Alternative: Trust the body customer ID, filter after retrieval, or hard-delete; rejected due to cross-customer exposure and lost history.
- What: Quotation conversion copies template line descriptions, quantities, resolved prices, variants, and tax rates into subscription-line records, and snapshots quote expiry.
- Why: Later template/catalog edits do not silently change a customer's issued quotation.
- Alternative: Re-read mutable template/catalog values on every view; rejected because displayed commercial terms would drift.
- What: The `paused` enum value is introduced in its own migration before constraints use it; monthly/yearly billing dates clamp to the last calendar day when needed.
- Why: PostgreSQL requires newly added enum values to commit before use in the next DDL transaction, and clamped dates preserve end-of-month billing cadence.
- Alternative: Combine enum addition and its CHECK constraint in one transaction or rely on JavaScript `Date` rollover; rejected because the former fails on PostgreSQL and the latter skips calendar months.

## Phase 4: Billing and invoices

- What: Preview and execution share a fixed-precision calculator; execution stores actor-scoped idempotent results and locks due subscriptions with `SKIP LOCKED`.
- Why: Retries replay the same result, concurrent runs skip locked rows, and a partial unique period index independently blocks duplicate billing invoices.
- What: Invoice snapshots, discount usage, subscription advancement, and billing results commit together; proration references have a separate unique index.
- Why: A rollback cannot consume a discount or leave partial financial state, and seat-change retries cannot create duplicate charges or credits.
- Alternative: Recompute historical totals from catalog records or send email synchronously; rejected because snapshots must be immutable and offline delivery must remain queued.
