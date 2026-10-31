import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationDirectory = join(process.cwd(), "database", "migrations");
const migrationFiles = readdirSync(migrationDirectory)
  .filter((name) => /^\d{3}_[a-z0-9_]+\.sql$/.test(name))
  .sort();
const migrationSql = migrationFiles
  .map((name) => readFileSync(join(migrationDirectory, name), "utf8"))
  .join("\n");

describe("PostgreSQL migration set", () => {
  it("uses unique, ordered migration numbers", () => {
    const numbers = migrationFiles.map((name) => name.slice(0, 3));

    expect(migrationFiles).toHaveLength(13);
    expect(new Set(numbers).size).toBe(numbers.length);
    expect(numbers).toEqual([
      "001",
      "002",
      "003",
      "004",
      "005",
      "006",
      "007",
      "008",
      "009",
      "010",
      "011",
      "012",
      "013",
    ]);
  });

  it("defines the requested relational tables and dashboard view", () => {
    const tables = [
      "users",
      "customers",
      "products",
      "product_variants",
      "plans",
      "quotation_templates",
      "quotation_template_lines",
      "taxes",
      "discounts",
      "discount_products",
      "discount_plans",
      "subscriptions",
      "subscription_lines",
      "invoices",
      "invoice_lines",
      "payments",
      "email_outbox",
      "audit_log",
      "idempotency_keys",
      "system_clock",
      "auth_sessions",
    ];

    for (const table of tables) {
      expect(migrationSql).toMatch(new RegExp(`CREATE TABLE ${table} \\(`));
    }
    expect(migrationSql).toContain("CREATE VIEW dashboard_summary AS");
  });

  it("keeps billing integrity, snapshots, query indexes, and append-only records", () => {
    expect(migrationSql).toContain("NUMERIC(12, 2)");
    expect(migrationSql).toMatch(
      /UNIQUE\s*\(\s*subscription_id,\s*period_start\s*\)/,
    );
    expect(migrationSql).toContain(
      "ON subscriptions (status, next_billing_date)",
    );
    expect(migrationSql).toContain(
      "CREATE UNIQUE INDEX invoices_billing_period_unique",
    );
    expect(migrationSql).toContain(
      "CREATE UNIQUE INDEX invoices_proration_reference_unique",
    );
    expect(migrationSql).toContain("ON invoices (status, due_date)");
    expect(migrationSql).toContain("ON payments (invoice_id)");
    expect(migrationSql).toContain("payments are append-only");
    expect(migrationSql).toContain("audit chain head mismatch");
    expect(migrationSql).toContain("invoice_lines_total_matches_components");
    expect(migrationSql).toContain("users_password_hash_scrypt_format");
  });

  it("prevents duplicate billing and proration invoices at the database boundary", () => {
    const billingIndex = readFileSync(
      join(migrationDirectory, "011_billing_proration.sql"),
      "utf8",
    );
    const billingRepository = readFileSync(
      join(process.cwd(), "src", "billing", "billing.repository.ts"),
      "utf8",
    );
    expect(billingIndex).toMatch(
      /CREATE UNIQUE INDEX invoices_billing_period_unique\s+ON invoices \(subscription_id, period_start\)\s+WHERE kind = 'billing'/s,
    );
    expect(billingIndex).toMatch(
      /CREATE UNIQUE INDEX invoices_proration_reference_unique\s+ON invoices \(subscription_id, proration_reference\)\s+WHERE kind = 'proration' AND proration_reference IS NOT NULL/s,
    );
    expect(billingRepository).toContain("this.invoiceExists(");
    expect(billingRepository).toContain(
      'query.forUpdate("subscriptions").skipLocked()',
    );
  });

  it("validates tax-inclusive invoice line totals without adding included tax twice", () => {
    const inclusiveLineMigration = readFileSync(
      join(migrationDirectory, "012_tax_inclusive_invoice_line_totals.sql"),
      "utf8",
    );
    expect(inclusiveLineMigration).toMatch(
      /CASE WHEN tax_inclusive THEN 0 ELSE abs\(tax_amount\) END/,
    );
    expect(inclusiveLineMigration).toMatch(
      /CASE WHEN kind = 'credit' THEN -1 ELSE 1 END/,
    );
  });

  it("adds payment notes and indexes report date and invoice lookups", () => {
    const reportingMigration = readFileSync(
      join(migrationDirectory, "013_payments_reports.sql"),
      "utf8",
    );
    expect(reportingMigration).toContain("ALTER TABLE payments");
    expect(reportingMigration).toContain("ADD COLUMN note TEXT");
    expect(reportingMigration).toContain("invoices_subscription_period_idx");
    expect(reportingMigration).toContain("payments_received_invoice_idx");
  });
});
