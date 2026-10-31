import { createHash } from "node:crypto";
import type { Knex } from "knex";
import { AppError } from "../errors/app-error.js";
import type { AuthActor } from "../auth/auth.types.js";
import type {
  BillingDiscount,
  BillingLine,
  BillingSkip,
  BillingSubscription,
  CalculatedInvoice,
  MarginGuardMode,
} from "./billing.calculator.js";
import { decimalToMinorUnits, formatMoney } from "./money.js";
import {
  calculateInvoice,
  calculateProration,
  daysBetween,
  subtractBillingPeriod,
} from "./billing.calculator.js";
import type { Clock } from "../services/clock.js";
import type {
  InvoiceAction,
  InvoiceStatus,
} from "../invoices/invoice-state-machine.js";
import { transitionInvoice } from "../invoices/invoice-state-machine.js";
import type { z } from "zod";
import type { createPaymentSchema } from "./report.schemas.js";
import { invoiceStatusAfterPayment } from "./payment-status.js";

export interface BillingRunResult {
  data: {
    created: Array<Record<string, unknown>>;
    skipped: BillingSkip[];
    totals: { subtotal: string; discount: string; tax: string; total: string };
    warnings: Array<{
      subscriptionNumber: string;
      productId: string;
      description: string;
      costAmount: string;
      netAfterDiscount: string;
    }>;
  };
  meta: { replayed: boolean };
}

export interface BillingPreviewResult {
  data: {
    asOf: string;
    candidates: Array<{
      subscriptionId: string;
      subscriptionNumber: string;
      invoice: CalculatedInvoice | null;
      skipped: BillingSkip | null;
    }>;
    totals: { subtotal: string; discount: string; tax: string; total: string };
    skipped: BillingSkip[];
    warnings: Array<{
      subscriptionNumber: string;
      productId: string;
      description: string;
      costAmount: string;
      netAfterDiscount: string;
    }>;
  };
}

export interface BillingRepository {
  preview(
    now: Date,
    marginMode: MarginGuardMode,
  ): Promise<BillingPreviewResult>;
  run(
    actor: AuthActor,
    idempotencyKey: string,
    now: Date,
    marginMode: MarginGuardMode,
  ): Promise<BillingRunResult>;
  createProration(
    subscriptionId: string,
    lineId: string,
    quantity: string,
    idempotencyKey: string,
    actor: AuthActor,
    now: Date,
  ): Promise<Record<string, unknown>>;
  transitionInvoice(
    id: string,
    action: InvoiceAction,
    actor: AuthActor,
    now: Date,
  ): Promise<Record<string, unknown>>;
  sendInvoice(
    id: string,
    actor: AuthActor,
    now: Date,
  ): Promise<Record<string, unknown>>;
  invoiceForPrint(
    id: string,
    actor: AuthActor,
  ): Promise<Record<string, unknown>>;
  recordPayment(
    invoiceId: string,
    input: z.infer<typeof createPaymentSchema>,
    actor: AuthActor,
    now: Date,
  ): Promise<Record<string, unknown>>;
}

interface InvoiceLineRow {
  id: string | number;
  product_id: string | number;
  variant_id: string | number | null;
  description: string;
  quantity: string;
  unit_price: string;
  tax_rate: string;
  tax_name: string | null;
  tax_inclusive: boolean;
  cost_price: string | null;
}

export class KnexBillingRepository implements BillingRepository {
  constructor(
    private readonly database: Knex,
    private readonly clock: Clock,
  ) {}

  async preview(
    now: Date,
    marginMode: MarginGuardMode,
  ): Promise<BillingPreviewResult> {
    return this.database.transaction(async (transaction) => {
      const due = await this.loadDueSubscriptions(transaction, now, false);
      const dueWithLines = await this.loadLines(transaction, due);
      const discounts = await this.loadDiscounts(transaction, now, false);
      const candidates: BillingPreviewResult["data"]["candidates"] = [];
      const skipped: BillingSkip[] = [];
      const totals = zeroTotals();
      const warnings: BillingPreviewResult["data"]["warnings"] = [];

      for (const subscription of dueWithLines) {
        if (
          await this.invoiceExists(
            transaction,
            subscription.id,
            subscription.nextBillingDate,
          )
        ) {
          const skip = toSkip(
            subscription,
            "already_invoiced",
            "An invoice already exists for this billing period.",
          );
          candidates.push({
            subscriptionId: subscription.id,
            subscriptionNumber: subscription.number,
            invoice: null,
            skipped: skip,
          });
          skipped.push(skip);
          continue;
        }

        const evaluation = calculateInvoice(
          subscription,
          discounts,
          now,
          marginMode,
        );
        if (evaluation.kind === "skip") {
          candidates.push({
            subscriptionId: subscription.id,
            subscriptionNumber: subscription.number,
            invoice: null,
            skipped: evaluation.skip,
          });
          skipped.push(evaluation.skip);
          continue;
        }
        candidates.push({
          subscriptionId: subscription.id,
          subscriptionNumber: subscription.number,
          invoice: evaluation.invoice,
          skipped: null,
        });
        addTotals(totals, evaluation.invoice);
        warnings.push(...warningsFor(evaluation.invoice));
      }

      return {
        data: {
          asOf: dateOnly(now),
          candidates,
          totals: formatTotals(totals),
          skipped,
          warnings,
        },
      };
    });
  }

  async run(
    actor: AuthActor,
    idempotencyKey: string,
    now: Date,
    marginMode: MarginGuardMode,
  ): Promise<BillingRunResult> {
    return this.database.transaction(async (transaction) => {
      const scope = "billing-run";
      const requestHash = createHash("sha256")
        .update(`${scope}:${dateOnly(now)}:${marginMode}`)
        .digest("hex");
      await transaction("idempotency_keys")
        .where({ user_id: actor.id, scope, key: idempotencyKey })
        .where("expires_at", "<=", now)
        .delete();
      await transaction("idempotency_keys")
        .insert({
          user_id: actor.id,
          scope,
          key: idempotencyKey,
          request_hash: requestHash,
          expires_at: this.clock.after(24 * 60 * 60 * 1000),
        })
        .onConflict(["user_id", "scope", "key"])
        .ignore();

      const idempotency = await transaction("idempotency_keys")
        .select("*")
        .where({ user_id: actor.id, scope, key: idempotencyKey })
        .forUpdate()
        .first();
      if (!idempotency) {
        throw new AppError(
          409,
          "IDEMPOTENCY_CONFLICT",
          "Idempotency key is unavailable.",
        );
      }
      if (idempotency.request_hash !== requestHash) {
        throw new AppError(
          409,
          "IDEMPOTENCY_KEY_REUSED",
          "This idempotency key was already used for a different request.",
        );
      }
      if (idempotency.response_body !== null) {
        return {
          data: idempotency.response_body as BillingRunResult["data"],
          meta: { replayed: true },
        };
      }

      const due = await this.loadDueSubscriptions(transaction, now, true);
      const subscriptions = await this.loadLines(transaction, due);
      const discounts = await this.loadDiscounts(transaction, now, true);
      const created: Array<Record<string, unknown>> = [];
      const skipped: BillingSkip[] = [];
      const totals = zeroTotals();
      const warnings: BillingRunResult["data"]["warnings"] = [];

      for (const subscription of subscriptions) {
        if (
          await this.invoiceExists(
            transaction,
            subscription.id,
            subscription.nextBillingDate,
          )
        ) {
          const skip = toSkip(
            subscription,
            "already_invoiced",
            "An invoice already exists for this billing period.",
          );
          skipped.push(skip);
          continue;
        }

        const evaluation = calculateInvoice(
          subscription,
          discounts,
          now,
          marginMode,
        );
        if (evaluation.kind === "skip") {
          skipped.push(evaluation.skip);
          if (evaluation.skip.reason === "auto_closed") {
            await this.closeAfterPlanExpiry(
              transaction,
              subscription.id,
              subscription.planAvailableTo,
              now,
            );
          }
          continue;
        }

        const invoice = evaluation.invoice;
        const [invoiceRow] = await transaction("invoices")
          .insert({
            subscription_id: invoice.subscriptionId,
            period_start: invoice.periodStart,
            period_end: invoice.periodEnd,
            due_date: invoice.dueDate,
            status: "draft",
            kind: "billing",
            currency_code: invoice.currencyCode,
            subtotal: invoice.subtotal,
            discount_total: invoice.discountTotal,
            tax_total: invoice.taxTotal,
            total: invoice.total,
          })
          .returning("*");

        const discountById = new Map(
          discounts.map((discount) => [discount.id, discount]),
        );
        const invoiceLines = invoice.lines.map((line, index) => {
          return {
            invoice_id: invoiceRow.id,
            position: index + 1,
            product_id: line.productId,
            variant_id: line.variantId,
            description: line.description,
            quantity: line.quantity,
            unit_price: line.unitPrice,
            tax_name: line.taxName,
            tax_rate: line.taxRate,
            tax_inclusive: line.taxInclusive,
            cost_price: line.costPrice,
            tax_amount: line.taxAmount,
            discount_amount: line.discountAmount,
            line_total: line.lineTotal,
            created_at: now,
          };
        });
        await transaction("invoice_lines").insert(invoiceLines);

        for (const applied of invoice.discounts) {
          const discount = discountById.get(applied.id);
          if (!discount) {
            throw new AppError(
              409,
              "DISCOUNT_CHANGED",
              "Discount is no longer available.",
            );
          }
          let discountUpdate = transaction("discounts").where({
            id: applied.id,
          });
          if (discount.usageLimit !== null) {
            discountUpdate = discountUpdate.where(
              "used_count",
              "<",
              discount.usageLimit,
            );
          }
          const changed = await discountUpdate.increment("used_count", 1);
          if (changed !== 1) {
            throw new AppError(
              409,
              "DISCOUNT_EXHAUSTED",
              "Discount usage limit was reached.",
            );
          }
          await transaction("discounts")
            .where({ id: applied.id })
            .update({ updated_at: now });
          discount.usedCount += 1;
          await transaction("invoice_discounts").insert({
            invoice_id: invoiceRow.id,
            discount_id: applied.id,
            applied_amount: applied.amount,
          });
        }

        const nextBillingDate = invoice.nextBillingDate;
        if (invoice.autoClose && invoice.autoCloseDate) {
          await this.closeAfterPlanExpiry(
            transaction,
            subscription.id,
            invoice.autoCloseDate,
            now,
          );
        } else {
          await transaction("subscriptions")
            .where({ id: subscription.id })
            .update({
              next_billing_date: nextBillingDate,
              updated_at: now,
            });
        }

        created.push({
          id: String(invoiceRow.id),
          number: invoiceRow.number,
          subscriptionId: subscription.id,
          customerId: subscription.customerId,
          subscriptionNumber: subscription.number,
          periodStart: invoice.periodStart,
          periodEnd: invoice.periodEnd,
          status: invoiceRow.status,
          currencyCode: invoice.currencyCode,
          subtotal: invoice.subtotal,
          discountTotal: invoice.discountTotal,
          taxTotal: invoice.taxTotal,
          total: invoice.total,
        });
        addTotals(totals, invoice);
        warnings.push(...warningsFor(invoice));
      }

      const result: BillingRunResult["data"] = {
        created,
        skipped,
        totals: formatTotals(totals),
        warnings,
      };
      await transaction("idempotency_keys")
        .where({ id: idempotency.id })
        .update({
          response_status: 200,
          response_body: result,
        });

      return { data: result, meta: { replayed: false } };
    });
  }

  async createProration(
    subscriptionId: string,
    lineId: string,
    quantity: string,
    idempotencyKey: string,
    actor: AuthActor,
    now: Date,
  ): Promise<Record<string, unknown>> {
    return this.database.transaction(async (transaction) => {
      const subscriptionQuery = transaction("subscriptions")
        .select(
          "id",
          "number",
          "customer_id",
          "status",
          "currency_code",
          "next_billing_date",
          "plan_id",
          "start_date",
        )
        .where({ id: subscriptionId })
        .forUpdate();
      if (actor.role === "customer") {
        subscriptionQuery.where({ customer_id: actor.customerId });
      }
      const subscription = await subscriptionQuery.first();
      if (!subscription) {
        throw new AppError(
          404,
          "SUBSCRIPTION_NOT_FOUND",
          "Subscription was not found.",
        );
      }
      if (subscription.status !== "active" || !subscription.next_billing_date) {
        throw new AppError(
          409,
          "PRORATION_REQUIRES_ACTIVE_SUBSCRIPTION",
          "Proration requires an active subscription with a next billing date.",
        );
      }

      const today = dateOnly(now);
      const nextBillingDate = toDateOnly(subscription.next_billing_date);
      if (today >= nextBillingDate) {
        throw new AppError(
          409,
          "PRORATION_OUTSIDE_BILLING_PERIOD",
          "Seat changes can be prorated only before the next billing date.",
        );
      }

      const reference = createHash("sha256")
        .update(idempotencyKey)
        .digest("hex");
      const requestHash = createHash("sha256")
        .update(`${subscriptionId}:${lineId}:${quantity}:${today}`)
        .digest("hex");
      const existing = await transaction("invoices")
        .select("*")
        .where({
          subscription_id: subscriptionId,
          kind: "proration",
          proration_reference: reference,
        })
        .first();
      if (existing) {
        if (existing.proration_request_hash !== requestHash) {
          throw new AppError(
            409,
            "IDEMPOTENCY_KEY_REUSED",
            "This idempotency key was already used for a different proration.",
          );
        }
        return {
          ...this.invoiceDto(existing),
          customerId: String(subscription.customer_id),
          replayed: true,
        };
      }

      const line = await transaction("subscription_lines")
        .select(
          "subscription_lines.*",
          "taxes.name as tax_name",
          "products.cost_price",
        )
        .join("products", "products.id", "subscription_lines.product_id")
        .leftJoin("taxes", "taxes.id", "subscription_lines.tax_id")
        .where({
          "subscription_lines.id": lineId,
          "subscription_lines.subscription_id": subscriptionId,
        })
        .forUpdate("subscription_lines")
        .first();
      if (!line) {
        throw new AppError(
          404,
          "SUBSCRIPTION_LINE_NOT_FOUND",
          "Subscription line was not found.",
        );
      }

      const currentQuantity = String(line.quantity);
      if (
        decimalToMinorUnits(quantity, 3) ===
        decimalToMinorUnits(currentQuantity, 3)
      ) {
        throw new AppError(
          422,
          "QUANTITY_UNCHANGED",
          "The requested quantity is unchanged.",
        );
      }
      const lastInvoice = await transaction("invoices")
        .select("period_end")
        .where({ subscription_id: subscriptionId, kind: "billing" })
        .where("period_end", "<=", today)
        .orderBy("period_end", "desc")
        .first();
      const plan = await transaction("plans")
        .select("billing_period", "billing_interval")
        .where({ id: subscription.plan_id })
        .first();
      if (!plan) {
        throw new AppError(
          409,
          "PLAN_NOT_FOUND",
          "Subscription plan was not found.",
        );
      }
      const periodStart = lastInvoice
        ? toDateOnly(lastInvoice.period_end)
        : subscription.start_date
          ? toDateOnly(subscription.start_date)
          : subtractBillingPeriod(
              nextBillingDate,
              plan.billing_period,
              plan.billing_interval,
            );
      const durationDays = daysBetween(periodStart, nextBillingDate);
      const remainingDays = daysBetween(today, nextBillingDate);
      if (durationDays <= 0 || remainingDays <= 0 || today <= periodStart) {
        throw new AppError(
          409,
          "PRORATION_OUTSIDE_BILLING_PERIOD",
          "The current billing period cannot be determined for proration.",
        );
      }

      const proration = calculateProration({
        currentQuantity,
        targetQuantity: quantity,
        unitPrice: String(line.unit_price),
        taxRate: String(line.tax_rate),
        taxInclusive: line.tax_inclusive,
        periodStart,
        periodEnd: nextBillingDate,
        asOf: today,
      });
      const invoiceDescription = `${line.description} - ${proration.kind === "credit" ? "decrease" : "increase"} by ${proration.quantityDelta} units; prorated ${proration.daysRemaining}/${proration.periodDays} days`;
      const [invoice] = await transaction("invoices")
        .insert({
          subscription_id: subscriptionId,
          period_start: today,
          period_end: nextBillingDate,
          due_date: today,
          status: "draft",
          kind: "proration",
          currency_code: subscription.currency_code,
          subtotal: proration.subtotal,
          discount_total: "0.00",
          tax_total: proration.taxAmount,
          total: proration.total,
          proration_reference: reference,
          proration_request_hash: requestHash,
        })
        .returning("*");

      await transaction("invoice_lines").insert({
        invoice_id: invoice.id,
        position: 1,
        product_id: line.product_id,
        variant_id: line.variant_id,
        description: invoiceDescription,
        quantity: proration.quantity,
        unit_price: proration.unitPrice,
        tax_name: line.tax_name,
        tax_rate: line.tax_rate,
        tax_inclusive: line.tax_inclusive,
        cost_price: line.cost_price,
        tax_amount: proration.taxAmount,
        discount_amount: "0.00",
        line_total: proration.lineTotal,
        kind: proration.kind,
        created_at: now,
      });
      await transaction("subscription_lines")
        .where({ id: lineId, subscription_id: subscriptionId })
        .update({ quantity });
      return {
        ...this.invoiceDto(invoice),
        customerId: String(subscription.customer_id),
        replayed: false,
      };
    });
  }

  async transitionInvoice(
    id: string,
    action: InvoiceAction,
    actor: AuthActor,
    now: Date,
  ): Promise<Record<string, unknown>> {
    return this.database.transaction(async (transaction) => {
      const query = transaction("invoices")
        .join("subscriptions", "subscriptions.id", "invoices.subscription_id")
        .select("invoices.*", "subscriptions.customer_id")
        .where("invoices.id", id)
        .forUpdate("invoices");
      if (actor.role === "customer") {
        query.where("subscriptions.customer_id", actor.customerId);
      }
      const invoice = await query.first();
      if (!invoice) {
        throw new AppError(404, "INVOICE_NOT_FOUND", "Invoice was not found.");
      }
      if (action === "mark_paid" || action === "cancel") {
        const payments = await transaction("payments")
          .where({ invoice_id: invoice.id })
          .sum<{ paid: string }[]>("amount as paid")
          .first();
        const amountPaid = decimalToMinorUnits(
          String(payments?.paid ?? "0.00"),
          2,
        );
        if (action === "cancel" && amountPaid > 0n) {
          throw new AppError(
            409,
            "INVOICE_HAS_PAYMENTS",
            "An invoice with recorded payments cannot be cancelled.",
          );
        }
        if (
          action === "mark_paid" &&
          amountPaid < decimalToMinorUnits(String(invoice.total), 2)
        ) {
          throw new AppError(
            409,
            "INVOICE_BALANCE_REMAINING",
            "Invoice cannot be marked paid while a balance remains.",
          );
        }
      }
      const status = transitionInvoice(invoice.status as InvoiceStatus, action);
      const [updated] = await transaction("invoices")
        .where({ id: invoice.id })
        .update({ status, updated_at: now })
        .returning("*");
      return {
        ...this.invoiceDto(updated),
        customerId: String(invoice.customer_id),
      };
    });
  }

  async recordPayment(
    invoiceId: string,
    input: {
      method: "cash" | "bank_transfer" | "card" | "cheque" | "other";
      amount: string;
      receivedAt: string;
      note?: string;
    },
    actor: AuthActor,
    now: Date,
  ): Promise<Record<string, unknown>> {
    return this.database.transaction(async (transaction) => {
      const invoice = await transaction("invoices")
        .join("subscriptions", "subscriptions.id", "invoices.subscription_id")
        .select("invoices.*", "subscriptions.customer_id")
        .where("invoices.id", invoiceId)
        .forUpdate("invoices")
        .first();
      if (!invoice) {
        throw new AppError(404, "INVOICE_NOT_FOUND", "Invoice was not found.");
      }
      if (
        !["confirmed", "partially_paid", "overdue"].includes(invoice.status)
      ) {
        throw new AppError(
          409,
          "INVOICE_NOT_PAYABLE",
          "Only confirmed or outstanding invoices can receive payments.",
        );
      }

      const paid = await transaction("payments")
        .where({ invoice_id: invoice.id })
        .sum<{ paid: string }[]>("amount as paid")
        .first();
      const currentPaid = decimalToMinorUnits(String(paid?.paid ?? "0.00"), 2);
      const paymentAmount = decimalToMinorUnits(input.amount, 2);
      const total = decimalToMinorUnits(String(invoice.total), 2);
      const nextPaid = currentPaid + paymentAmount;
      const status = invoiceStatusAfterPayment(
        String(invoice.status),
        formatMoney(nextPaid),
        String(invoice.total),
        toDateOnly(invoice.due_date),
        dateOnly(now),
      );

      const [payment] = await transaction("payments")
        .insert({
          invoice_id: invoice.id,
          amount: input.amount,
          method: input.method,
          received_at: `${input.receivedAt}T00:00:00.000Z`,
          note: input.note ?? null,
          recorded_by: actor.id,
        })
        .returning("*");
      const [updatedInvoice] = await transaction("invoices")
        .where({ id: invoice.id })
        .update({ status, updated_at: now })
        .returning("*");

      return {
        payment: {
          id: String(payment.id),
          invoiceId: String(invoice.id),
          method: payment.method,
          amount: String(payment.amount),
          receivedAt: timestampIso(payment.received_at),
          note: payment.note,
        },
        invoice: {
          ...this.invoiceDto(updatedInvoice),
          customerId: String(invoice.customer_id),
          amountPaid: formatMoney(nextPaid),
          balanceDue: formatMoney(total - nextPaid),
        },
      };
    });
  }

  async sendInvoice(
    id: string,
    actor: AuthActor,
    now: Date,
  ): Promise<Record<string, unknown>> {
    return this.database.transaction(async (transaction) => {
      const query = transaction("invoices")
        .join("subscriptions", "subscriptions.id", "invoices.subscription_id")
        .join("customers", "customers.id", "subscriptions.customer_id")
        .join("users", "users.id", "customers.user_id")
        .select(
          "invoices.*",
          "subscriptions.customer_id",
          "users.email as customer_email",
        )
        .where("invoices.id", id)
        .forUpdate("invoices");
      if (actor.role === "customer") {
        query.where("subscriptions.customer_id", actor.customerId);
      }
      const invoice = await query.first();
      if (!invoice) {
        throw new AppError(404, "INVOICE_NOT_FOUND", "Invoice was not found.");
      }
      if (invoice.status !== "confirmed") {
        throw new AppError(
          409,
          "INVOICE_NOT_CONFIRMED",
          "Only confirmed invoices can be sent.",
        );
      }
      if (invoice.sent_at) {
        return {
          ...this.invoiceDto(invoice),
          customerId: String(invoice.customer_id),
          alreadySent: true,
        };
      }
      await transaction("email_outbox").insert({
        recipient: invoice.customer_email,
        template_key: "invoice",
        payload: {
          invoice_id: String(invoice.id),
          invoice_number: invoice.number,
          currency_code: invoice.currency_code,
          total: String(invoice.total),
        },
      });
      const [updated] = await transaction("invoices")
        .where({ id: invoice.id })
        .update({ sent_at: now, updated_at: now })
        .returning("*");
      return {
        ...this.invoiceDto(updated),
        customerId: String(invoice.customer_id),
        alreadySent: false,
      };
    });
  }

  async invoiceForPrint(
    id: string,
    actor: AuthActor,
  ): Promise<Record<string, unknown>> {
    const query = this.database("invoices")
      .join("subscriptions", "subscriptions.id", "invoices.subscription_id")
      .join("customers", "customers.id", "subscriptions.customer_id")
      .join("users", "users.id", "customers.user_id")
      .select("invoices.*", "users.email as customer_email")
      .where("invoices.id", id);
    if (actor.role === "customer") {
      query.where("subscriptions.customer_id", actor.customerId);
    }
    const invoice = await query.first();
    if (!invoice) {
      throw new AppError(404, "INVOICE_NOT_FOUND", "Invoice was not found.");
    }
    const lines = await this.database("invoice_lines")
      .select("*")
      .where({ invoice_id: id })
      .orderBy("position");
    return {
      ...this.invoiceDto(invoice),
      customerEmail: invoice.customer_email,
      lines: lines.map((line) => ({
        description: line.description,
        quantity: String(line.quantity),
        unitPrice: String(line.unit_price),
        taxName: line.tax_name,
        taxAmount: String(line.tax_amount),
        discountAmount: String(line.discount_amount),
        lineTotal: String(line.line_total),
        kind: line.kind,
      })),
    };
  }

  private async loadDueSubscriptions(
    transaction: Knex.Transaction,
    now: Date,
    lock: boolean,
  ): Promise<BillingSubscription[]> {
    let query = transaction("subscriptions")
      .join("plans", "plans.id", "subscriptions.plan_id")
      .join("customers", "customers.id", "subscriptions.customer_id")
      .join("users", "users.id", "customers.user_id")
      .select(
        "subscriptions.id",
        "subscriptions.number",
        "subscriptions.customer_id",
        "users.email as customer_email",
        "subscriptions.plan_id",
        "subscriptions.currency_code",
        "subscriptions.next_billing_date",
        "plans.billing_period",
        "plans.billing_interval",
        "plans.auto_close",
        "plans.available_to as plan_available_to",
        "plans.is_active as plan_is_active",
      )
      .where("subscriptions.status", "active")
      .where("subscriptions.next_billing_date", "<=", dateOnly(now))
      .orderBy("subscriptions.next_billing_date", "asc")
      .orderBy("subscriptions.id", "asc");
    if (lock) {
      query = query.forUpdate("subscriptions").skipLocked();
    }
    const rows = await query;
    return rows.map((row) => ({
      id: String(row.id),
      number: row.number,
      customerId: String(row.customer_id),
      customerEmail: row.customer_email,
      planId: String(row.plan_id),
      currencyCode: row.currency_code,
      billingPeriod: row.billing_period,
      billingInterval: row.billing_interval,
      nextBillingDate: toDateOnly(row.next_billing_date),
      autoClose: row.auto_close,
      planAvailable: row.plan_is_active,
      planAvailableTo: row.plan_available_to
        ? toDateOnly(row.plan_available_to)
        : null,
      lines: [],
    }));
  }

  private async loadLines(
    transaction: Knex.Transaction,
    subscriptions: BillingSubscription[],
  ): Promise<BillingSubscription[]> {
    if (subscriptions.length === 0) return [];
    const rows = (await transaction("subscription_lines")
      .join("products", "products.id", "subscription_lines.product_id")
      .leftJoin("taxes", "taxes.id", "subscription_lines.tax_id")
      .select(
        "subscription_lines.id",
        "subscription_lines.subscription_id",
        "subscription_lines.product_id",
        "subscription_lines.variant_id",
        "subscription_lines.description",
        "subscription_lines.quantity",
        "subscription_lines.unit_price",
        "subscription_lines.tax_rate",
        "subscription_lines.tax_inclusive",
        "products.cost_price",
        "taxes.name as tax_name",
      )
      .whereIn(
        "subscription_lines.subscription_id",
        subscriptions.map((subscription) => subscription.id),
      )
      .orderBy([
        "subscription_lines.subscription_id",
        "subscription_lines.position",
      ])) as Array<InvoiceLineRow & { subscription_id: string | number }>;
    const linesBySubscription = new Map<string, BillingLine[]>();
    for (const row of rows) {
      const subscriptionId = String(row.subscription_id);
      linesBySubscription.set(subscriptionId, [
        ...(linesBySubscription.get(subscriptionId) ?? []),
        {
          productId: String(row.product_id),
          variantId: row.variant_id === null ? null : String(row.variant_id),
          description: row.description,
          quantity: String(row.quantity),
          unitPrice: String(row.unit_price),
          taxName: row.tax_name,
          taxRate: String(row.tax_rate),
          taxInclusive: row.tax_inclusive,
          costPrice: row.cost_price === null ? null : String(row.cost_price),
        },
      ]);
    }
    return subscriptions.map((subscription) => ({
      ...subscription,
      lines: linesBySubscription.get(subscription.id) ?? [],
    }));
  }

  private async loadDiscounts(
    executor: Knex | Knex.Transaction,
    now: Date,
    lock: boolean,
  ): Promise<BillingDiscount[]> {
    let query = executor("discounts")
      .select("*")
      .where({ is_active: true })
      .where((builder) =>
        builder.whereNull("starts_at").orWhere("starts_at", "<=", now),
      )
      .where((builder) =>
        builder.whereNull("ends_at").orWhere("ends_at", ">=", now),
      )
      .orderBy("id", "asc");
    if (lock && "forUpdate" in query) {
      query = query.forUpdate();
    }
    const rows = await query;
    if (rows.length === 0) return [];
    const ids = rows.map((row) => String(row.id));
    const productTargets = await executor("discount_products")
      .select("discount_id", "product_id")
      .whereIn("discount_id", ids);
    const planTargets = await executor("discount_plans")
      .select("discount_id", "plan_id")
      .whereIn("discount_id", ids);
    const productsByDiscount = groupIds(
      productTargets,
      "discount_id",
      "product_id",
    );
    const plansByDiscount = groupIds(planTargets, "discount_id", "plan_id");
    return rows
      .filter(
        (row) => row.usage_limit === null || row.used_count < row.usage_limit,
      )
      .map((row) => ({
        id: String(row.id),
        code: row.code,
        name: row.name,
        type: row.discount_type,
        value: String(row.value),
        minPurchase: String(row.min_purchase),
        minQty: row.min_qty,
        startsAt: row.starts_at ? timestampIso(row.starts_at) : null,
        endsAt: row.ends_at ? timestampIso(row.ends_at) : null,
        usageLimit: row.usage_limit,
        usedCount: row.used_count,
        scope: row.scope,
        productIds: productsByDiscount.get(String(row.id)) ?? [],
        planIds: plansByDiscount.get(String(row.id)) ?? [],
      }));
  }

  private async invoiceExists(
    transaction: Knex.Transaction,
    subscriptionId: string,
    periodStart: string,
  ): Promise<boolean> {
    const row = await transaction("invoices")
      .select("id")
      .where({
        subscription_id: subscriptionId,
        period_start: periodStart,
        kind: "billing",
      })
      .first();
    return Boolean(row);
  }

  private async closeAfterPlanExpiry(
    transaction: Knex.Transaction,
    subscriptionId: string,
    endDate: string | null,
    now: Date,
  ): Promise<void> {
    await transaction("subscriptions")
      .where({ id: subscriptionId })
      .update({
        status: "closed",
        closed_at: now,
        end_date: endDate ?? dateOnly(now),
        next_billing_date: null,
        updated_at: now,
      });
  }

  private invoiceDto(row: Record<string, unknown>): Record<string, unknown> {
    return {
      id: String(row.id),
      number: row.number,
      subscriptionId: String(row.subscription_id),
      periodStart: toDateOnly(row.period_start),
      periodEnd: toDateOnly(row.period_end),
      dueDate: toDateOnly(row.due_date),
      status: row.status,
      kind: row.kind,
      currencyCode: row.currency_code,
      subtotal: String(row.subtotal),
      discountTotal: String(row.discount_total),
      taxTotal: String(row.tax_total),
      total: String(row.total),
      sentAt: row.sent_at ?? null,
    };
  }
}

function groupIds(
  rows: Array<Record<string, unknown>>,
  groupKey: string,
  idKey: string,
): Map<string, string[]> {
  const grouped = new Map<string, string[]>();
  for (const row of rows) {
    const key = String(row[groupKey]);
    grouped.set(key, [...(grouped.get(key) ?? []), String(row[idKey])]);
  }
  return grouped;
}

function toSkip(
  subscription: BillingSubscription,
  reason: BillingSkip["reason"],
  details: string,
): BillingSkip {
  return {
    subscriptionId: subscription.id,
    subscriptionNumber: subscription.number,
    reason,
    details,
  };
}

function zeroTotals() {
  return { subtotal: 0n, discount: 0n, tax: 0n, total: 0n };
}

function addTotals(
  totals: ReturnType<typeof zeroTotals>,
  invoice: CalculatedInvoice,
): void {
  totals.subtotal += decimalToCents(invoice.subtotal);
  totals.discount += decimalToCents(invoice.discountTotal);
  totals.tax += decimalToCents(invoice.taxTotal);
  totals.total += decimalToCents(invoice.total);
}

function decimalToCents(value: string): bigint {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
}

function formatTotals(totals: ReturnType<typeof zeroTotals>) {
  return {
    subtotal: formatMoney(totals.subtotal),
    discount: formatMoney(totals.discount),
    tax: formatMoney(totals.tax),
    total: formatMoney(totals.total),
  };
}

function warningsFor(invoice: CalculatedInvoice) {
  return invoice.marginWarnings.map((warning) => ({
    subscriptionNumber: invoice.subscriptionNumber,
    ...warning,
  }));
}

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function toDateOnly(date: unknown): string {
  if (!(date instanceof Date) && typeof date !== "string") {
    throw new Error("Database returned an invalid date.");
  }
  return date instanceof Date
    ? date.toISOString().slice(0, 10)
    : date.slice(0, 10);
}

function timestampIso(timestamp: unknown): string {
  if (!(timestamp instanceof Date) && typeof timestamp !== "string") {
    throw new Error("Database returned an invalid timestamp.");
  }
  return timestamp instanceof Date ? timestamp.toISOString() : timestamp;
}
