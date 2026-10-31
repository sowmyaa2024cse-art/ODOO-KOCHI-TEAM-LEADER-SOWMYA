import "dotenv/config";
import { randomBytes, scryptSync } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { createDatabase } from "../src/infrastructure/database.js";
import { parseEnvironment } from "../src/config/env.js";
import { logger } from "../src/services/logger.js";
import { systemClock } from "../src/services/clock.js";
import { runMigrations } from "./migrate.js";

const subscriptionCount = 5_000;
const customerCount = 200;
const chunkSize = 500;

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value?.trim()) {
    throw new Error(`${name} must be set before seeding.`);
  }
  return value.trim();
}

function requiredEmail(name: string): string {
  const email = requiredEnvironment(name).toLowerCase();
  const result = z.email().safeParse(email);
  if (!result.success) {
    throw new Error(`${name} must be a valid email address.`);
  }
  return email;
}

function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

export async function seedDatabase(): Promise<void> {
  const environment = parseEnvironment();
  const now = systemClock.now();
  const timestamp = now.toISOString();
  const adminEmail = requiredEmail("SEED_ADMIN_EMAIL");
  const staffEmail = requiredEmail("SEED_STAFF_EMAIL");
  const adminPassword = requiredEnvironment("SEED_ADMIN_PASSWORD");
  const staffPassword = requiredEnvironment("SEED_STAFF_PASSWORD");
  const customerPassword = requiredEnvironment("SEED_CUSTOMER_PASSWORD");

  if (environment.NODE_ENV === "production") {
    throw new Error("Refusing to run the development seed in production.");
  }
  if (adminEmail === staffEmail) {
    throw new Error("Seed admin and staff emails must be different.");
  }
  if (
    [adminEmail, staffEmail].some((email) =>
      /^customer\d{4}@brightloop\.local$/.test(email),
    )
  ) {
    throw new Error(
      "Seed admin/staff emails cannot use the generated customer addresses.",
    );
  }
  for (const password of [adminPassword, staffPassword, customerPassword]) {
    if (password.length < 12) {
      throw new Error("Seed passwords must contain at least 12 characters.");
    }
  }

  await runMigrations();
  const database = createDatabase(environment.DATABASE_URL);
  try {
    await database.transaction(async (transaction) => {
      const userRows = [
        {
          email: adminEmail,
          password_hash: hashPassword(adminPassword),
          role: "admin",
          updated_at: timestamp,
        },
        {
          email: staffEmail,
          password_hash: hashPassword(staffPassword),
          role: "staff",
          updated_at: timestamp,
        },
      ];

      for (let index = 1; index <= customerCount; index += 1) {
        userRows.push({
          email: `customer${String(index).padStart(4, "0")}@brightloop.local`,
          password_hash: hashPassword(customerPassword),
          role: "customer",
          updated_at: timestamp,
        });
      }

      for (let offset = 0; offset < userRows.length; offset += chunkSize) {
        await transaction("users")
          .insert(userRows.slice(offset, offset + chunkSize))
          .onConflict("email")
          .merge(["password_hash", "role", "updated_at"]);
      }

      const emails = userRows.map((user) => user.email);
      const users = await transaction("users")
        .select("id", "email")
        .whereIn("email", emails);
      const userIdByEmail = new Map(
        users.map((user) => [user.email, String(user.id)]),
      );
      const adminId = userIdByEmail.get(adminEmail);
      const staffId = userIdByEmail.get(staffEmail);

      if (!adminId || !staffId) {
        throw new Error("Seed admin or staff account could not be loaded.");
      }

      const customerRows = Array.from({ length: customerCount }, (_, index) => {
        const email = `customer${String(index + 1).padStart(4, "0")}@brightloop.local`;
        const userId = userIdByEmail.get(email);
        if (!userId) {
          throw new Error(`Seed customer account was not created: ${email}`);
        }
        return {
          user_id: userId,
          full_name: `Brightloop Customer ${String(index + 1).padStart(4, "0")}`,
          company_name: `Customer Organization ${String(index + 1).padStart(4, "0")}`,
          billing_address: JSON.stringify({ country: "IN" }),
          updated_at: timestamp,
        };
      });

      for (let offset = 0; offset < customerRows.length; offset += chunkSize) {
        await transaction("customers")
          .insert(customerRows.slice(offset, offset + chunkSize))
          .onConflict("user_id")
          .merge([
            "full_name",
            "company_name",
            "billing_address",
            "updated_at",
          ]);
      }

      await transaction("products")
        .insert({
          sku: "SEED-SERVICE",
          name: "Brightloop Starter Service",
          description: "Local development seed product",
          unit_price: "100.00",
          updated_at: timestamp,
        })
        .onConflict("sku")
        .merge(["name", "description", "unit_price", "updated_at"]);

      await transaction("plans")
        .insert({
          code: "SEED-MONTHLY",
          name: "Seed Monthly Plan",
          billing_period: "monthly",
          billing_interval: 1,
          price: "100.00",
          min_qty: 1,
          auto_close: false,
          closable: true,
          pausable: true,
          renewable: true,
          updated_at: timestamp,
        })
        .onConflict("code")
        .merge(["name", "price", "updated_at"]);

      await transaction("taxes")
        .insert({
          code: "SEED-TAX-5",
          name: "Seed Tax",
          rate: "5.00",
          updated_at: timestamp,
        })
        .onConflict("code")
        .merge(["name", "rate", "updated_at"]);

      await transaction("system_clock")
        .insert({ singleton_id: 1, current_time: timestamp })
        .onConflict("singleton_id")
        .ignore();

      const customers = await transaction("customers")
        .select("id", "user_id")
        .orderBy("user_id");
      const product = await transaction("products")
        .select("id")
        .where({ sku: "SEED-SERVICE" })
        .first();
      const plan = await transaction("plans")
        .select("id")
        .where({ code: "SEED-MONTHLY" })
        .first();
      const tax = await transaction("taxes")
        .select("id")
        .where({ code: "SEED-TAX-5" })
        .first();

      if (!product || !plan || !tax || customers.length !== customerCount) {
        throw new Error("Seed catalog or customer records are incomplete.");
      }

      const subscriptionRows = Array.from(
        { length: subscriptionCount },
        (_, index) => {
          const sequence = index + 1;
          const billingDate = addDays(now, (index % 61) - 30);
          return {
            number: `SUB-SEED-${String(sequence).padStart(6, "0")}`,
            customer_id: String(customers[index % customers.length].id),
            plan_id: String(plan.id),
            created_by: staffId,
            status: "active",
            currency_code: "INR",
            start_date: dateOnly(addDays(now, -90)),
            next_billing_date: dateOnly(billingDate),
            created_at: timestamp,
            updated_at: timestamp,
          };
        },
      );

      for (
        let offset = 0;
        offset < subscriptionRows.length;
        offset += chunkSize
      ) {
        await transaction("subscriptions")
          .insert(subscriptionRows.slice(offset, offset + chunkSize))
          .onConflict("number")
          .ignore();
      }

      const subscriptionByNumber = new Map<string, string>();
      for (
        let offset = 0;
        offset < subscriptionRows.length;
        offset += chunkSize
      ) {
        const numbers = subscriptionRows
          .slice(offset, offset + chunkSize)
          .map((subscription) => subscription.number);
        const rows = await transaction("subscriptions")
          .select("id", "number")
          .whereIn("number", numbers);
        for (const row of rows) {
          subscriptionByNumber.set(row.number, String(row.id));
        }
      }

      if (subscriptionByNumber.size !== subscriptionCount) {
        throw new Error("Seed subscription records are incomplete.");
      }

      const subscriptionLineRows: Record<string, unknown>[] = [];
      const invoiceRows: Record<string, unknown>[] = [];
      for (let index = 0; index < subscriptionCount; index += 1) {
        const sequence = index + 1;
        const subscriptionId = subscriptionByNumber.get(
          `SUB-SEED-${String(sequence).padStart(6, "0")}`,
        );
        if (!subscriptionId) {
          throw new Error(`Seed subscription ${sequence} was not loaded.`);
        }

        const periodStart = addDays(now, -60);
        const periodEnd = addDays(periodStart, 30);
        const dueDate = addDays(periodEnd, 7);
        const invoiceNumber = `INV-SEED-${String(sequence).padStart(6, "0")}`;

        subscriptionLineRows.push({
          subscription_id: subscriptionId,
          position: 1,
          product_id: String(product.id),
          tax_id: String(tax.id),
          description: "Brightloop Starter Service",
          quantity: "1.000",
          unit_price: "100.00",
          tax_rate: "5.00",
          discount_amount: "0.00",
          created_at: timestamp,
        });

        invoiceRows.push({
          number: invoiceNumber,
          subscription_id: subscriptionId,
          period_start: dateOnly(periodStart),
          period_end: dateOnly(periodEnd),
          issued_at: timestamp,
          due_date: dateOnly(dueDate),
          status:
            sequence % 5 === 0
              ? "paid"
              : sequence % 5 === 1
                ? "partially_paid"
                : "overdue",
          currency_code: "INR",
          subtotal: "100.00",
          discount_total: "0.00",
          tax_total: "5.00",
          total: "105.00",
          created_at: timestamp,
          updated_at: timestamp,
        });
      }

      for (
        let offset = 0;
        offset < subscriptionLineRows.length;
        offset += chunkSize
      ) {
        await transaction("subscription_lines")
          .insert(subscriptionLineRows.slice(offset, offset + chunkSize))
          .onConflict(["subscription_id", "position"])
          .ignore();
      }
      for (let offset = 0; offset < invoiceRows.length; offset += chunkSize) {
        await transaction("invoices")
          .insert(invoiceRows.slice(offset, offset + chunkSize))
          .onConflict("number")
          .merge([
            "period_start",
            "period_end",
            "issued_at",
            "due_date",
            "status",
            "updated_at",
          ]);
      }

      const invoiceByNumber = new Map<string, string>();
      for (let offset = 0; offset < invoiceRows.length; offset += chunkSize) {
        const numbers = invoiceRows
          .slice(offset, offset + chunkSize)
          .map((invoice) => String(invoice.number));
        const rows = await transaction("invoices")
          .select("id", "number")
          .whereIn("number", numbers);
        for (const row of rows) {
          invoiceByNumber.set(row.number, String(row.id));
        }
      }

      if (invoiceByNumber.size !== subscriptionCount) {
        throw new Error("Seed invoice records are incomplete.");
      }

      const invoiceLineRows: Record<string, unknown>[] = [];
      const paymentRows: Record<string, unknown>[] = [];
      for (let index = 0; index < subscriptionCount; index += 1) {
        const sequence = index + 1;
        const invoiceId = invoiceByNumber.get(
          `INV-SEED-${String(sequence).padStart(6, "0")}`,
        );
        if (!invoiceId) {
          throw new Error(`Seed invoice ${sequence} was not loaded.`);
        }

        const paidInFull = sequence % 5 === 0;
        invoiceLineRows.push({
          invoice_id: invoiceId,
          position: 1,
          product_id: String(product.id),
          description: "Brightloop Starter Service",
          quantity: "1.000",
          unit_price: "100.00",
          tax_name: "Seed Tax",
          tax_rate: "5.00",
          tax_amount: "5.00",
          discount_amount: "0.00",
          line_total: "105.00",
          created_at: timestamp,
        });
        paymentRows.push({
          invoice_id: invoiceId,
          amount: paidInFull ? "105.00" : "20.00",
          method: "bank_transfer",
          reference: `SEED-PAY-${String(sequence).padStart(6, "0")}`,
          received_at: timestamp,
          recorded_by: staffId,
          created_at: timestamp,
        });
      }

      for (
        let offset = 0;
        offset < invoiceLineRows.length;
        offset += chunkSize
      ) {
        await transaction("invoice_lines")
          .insert(invoiceLineRows.slice(offset, offset + chunkSize))
          .onConflict(["invoice_id", "position"])
          .ignore();
      }
      for (let offset = 0; offset < paymentRows.length; offset += chunkSize) {
        await transaction("payments")
          .insert(paymentRows.slice(offset, offset + chunkSize))
          .onConflict("reference")
          .ignore();
      }
    });

    logger.info("Seed data created", {
      customers: customerCount,
      subscriptions: subscriptionCount,
      invoices: subscriptionCount,
      payments: subscriptionCount,
    });
  } finally {
    await database.destroy();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  seedDatabase().catch((error: unknown) => {
    logger.error("Database seed failed", {
      message: error instanceof Error ? error.message : "Unknown seed error",
    });
    process.exitCode = 1;
  });
}
