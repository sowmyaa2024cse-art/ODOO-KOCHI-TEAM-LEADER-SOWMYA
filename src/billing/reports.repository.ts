import type { Knex } from "knex";
import type { ReportQuery } from "./report.schemas.js";
import { decimalToMinorUnits, formatMoney } from "./money.js";

type ReportRow = Record<string, unknown>;

export class ReportsRepository {
  constructor(private readonly database: Knex) {}

  async summary(query: ReportQuery) {
    const invoiceQuery = this.filteredInvoices(query);
    const [
      invoiceTotalsResult,
      paymentTotalsResult,
      subscriptionCountsResult,
      overdueResult,
    ] = await Promise.all([
      invoiceQuery
        .select(
          "invoices.currency_code",
          this.database.raw("count(*)::int as invoice_count"),
          this.database.raw(
            "coalesce(sum(invoices.total), 0)::numeric(14,2) as invoiced",
          ),
          this.database.raw(
            "coalesce(sum(invoices.discount_total), 0)::numeric(14,2) as discounts",
          ),
        )
        .groupBy("invoices.currency_code"),
      this.filteredPayments(query)
        .select(
          "invoices.currency_code",
          this.database.raw(
            "coalesce(sum(payments.amount), 0)::numeric(14,2) as received",
          ),
        )
        .groupBy("invoices.currency_code"),
      this.database("subscriptions")
        .whereNull("deleted_at")
        .modify((builder) => {
          if (query.customerId) builder.where("customer_id", query.customerId);
          if (query.currencyCode)
            builder.where("currency_code", query.currencyCode);
        })
        .select("currency_code", "status")
        .count<{ status: string; count: string }[]>("status")
        .groupBy("currency_code", "status"),
      this.overdueQuery(query)
        .select(
          "invoices.currency_code",
          this.database.raw("count(invoices.id)::int as count"),
        )
        .groupBy("invoices.currency_code"),
    ]);

    const invoiceTotals = invoiceTotalsResult as ReportRow[];
    const paymentTotals = paymentTotalsResult as ReportRow[];
    const subscriptionCounts = subscriptionCountsResult as ReportRow[];
    const overdue = overdueResult as ReportRow[];
    const invoiceByCurrency = new Map<string, ReportRow>(
      invoiceTotals.map((row) => [String(row.currency_code), row]),
    );
    const paymentByCurrency = new Map<string, ReportRow>(
      paymentTotals.map((row) => [String(row.currency_code), row]),
    );
    const subscriptionsByCurrency = new Map<string, Record<string, number>>();
    for (const row of subscriptionCounts) {
      const currencyCode = String(row.currency_code);
      const counts = subscriptionsByCurrency.get(currencyCode) ?? {};
      counts[String(row.status)] = Number(row.count);
      subscriptionsByCurrency.set(currencyCode, counts);
    }
    const overdueByCurrency = new Map<string, number>(
      overdue.map((row) => [String(row.currency_code), Number(row.count)]),
    );
    const currencies = new Set([
      ...invoiceByCurrency.keys(),
      ...paymentByCurrency.keys(),
      ...subscriptionsByCurrency.keys(),
      ...overdueByCurrency.keys(),
    ]);
    const rows = [...currencies].sort().map((currencyCode) => {
      const invoice = invoiceByCurrency.get(currencyCode);
      const payment = paymentByCurrency.get(currencyCode);
      return {
        currencyCode,
        invoices: Number(invoice?.invoice_count ?? 0),
        invoiced: String(invoice?.invoiced ?? "0.00"),
        discounts: String(invoice?.discounts ?? "0.00"),
        received: String(payment?.received ?? "0.00"),
        overdueInvoices: overdueByCurrency.get(currencyCode) ?? 0,
        subscriptions: subscriptionsByCurrency.get(currencyCode) ?? {},
      };
    });
    return {
      data: rows.slice(
        (query.page - 1) * query.limit,
        query.page * query.limit,
      ),
      meta: { page: query.page, limit: query.limit, total: rows.length },
    };
  }

  async mrr(query: ReportQuery) {
    const asOf = query.to ?? new Date().toISOString().slice(0, 10);
    const activeQuery = this.database("subscriptions")
      .join("plans", "plans.id", "subscriptions.plan_id")
      .join(
        "subscription_lines",
        "subscription_lines.subscription_id",
        "subscriptions.id",
      )
      .where("subscriptions.status", "active")
      .whereNull("subscriptions.deleted_at")
      .where("subscriptions.created_at", "<=", `${asOf}T23:59:59.999Z`)
      .modify((builder) => {
        if (query.customerId)
          builder.where("subscriptions.customer_id", query.customerId);
        if (query.currencyCode)
          builder.where("subscriptions.currency_code", query.currencyCode);
      })
      .select(
        "subscriptions.id",
        "subscriptions.created_at",
        "subscriptions.currency_code",
        "plans.billing_period",
        "plans.billing_interval",
        this.database.raw(
          "sum(subscription_lines.amount)::numeric(14,2) as recurring_amount",
        ),
      )
      .groupBy(
        "subscriptions.id",
        "subscriptions.created_at",
        "subscriptions.currency_code",
        "plans.billing_period",
        "plans.billing_interval",
      );
    const activeRows = (await activeQuery) as ReportRow[];
    const currentByCurrency = new Map<string, bigint>();
    const newByCurrency = new Map<string, bigint>();
    const activeMrrBySubscription = new Map<
      string,
      { currencyCode: string; mrr: bigint; createdDate: string }
    >();
    for (const row of activeRows) {
      const currency = String(row.currency_code);
      const createdDate = dateOnly(row.created_at);
      const amount = monthlyize(
        String(row.recurring_amount),
        String(row.billing_period),
        Number(row.billing_interval),
      );
      currentByCurrency.set(
        currency,
        (currentByCurrency.get(currency) ?? 0n) + amount,
      );
      activeMrrBySubscription.set(String(row.id), {
        currencyCode: currency,
        mrr: amount,
        createdDate,
      });
      if (
        createdDate >= (query.from ?? monthStart(asOf)) &&
        createdDate <= asOf
      ) {
        newByCurrency.set(
          currency,
          (newByCurrency.get(currency) ?? 0n) + amount,
        );
      }
    }

    const latestInvoices = await this.database("invoices")
      .join("subscriptions", "subscriptions.id", "invoices.subscription_id")
      .join("plans", "plans.id", "subscriptions.plan_id")
      .distinctOn("invoices.subscription_id")
      .select(
        "invoices.subscription_id",
        "invoices.total",
        "subscriptions.currency_code",
        "plans.billing_period",
        "plans.billing_interval",
      )
      .where("invoices.kind", "billing")
      .where("invoices.period_start", "<=", asOf)
      .modify((builder) => {
        if (query.customerId)
          builder.where("subscriptions.customer_id", query.customerId);
        if (query.currencyCode)
          builder.where("subscriptions.currency_code", query.currencyCode);
      })
      .orderBy("invoices.subscription_id")
      .orderBy("invoices.period_start", "desc");
    const expansionByCurrency = new Map<string, bigint>();
    for (const row of latestInvoices) {
      const current = activeMrrBySubscription.get(String(row.subscription_id));
      if (!current || current.createdDate >= (query.from ?? monthStart(asOf))) {
        continue;
      }
      const previous = monthlyize(
        String(row.total),
        String(row.billing_period),
        Number(row.billing_interval),
      );
      if (current.mrr > previous) {
        expansionByCurrency.set(
          current.currencyCode,
          (expansionByCurrency.get(current.currencyCode) ?? 0n) +
            current.mrr -
            previous,
        );
      }
    }

    const closedQuery = this.database("subscriptions")
      .join("plans", "plans.id", "subscriptions.plan_id")
      .join(
        "subscription_lines",
        "subscription_lines.subscription_id",
        "subscriptions.id",
      )
      .where("subscriptions.status", "closed")
      .whereNull("subscriptions.deleted_at")
      .whereNotNull("subscriptions.closed_at")
      .where("subscriptions.closed_at", "<=", `${asOf}T23:59:59.999Z`)
      .modify((builder) => {
        builder.where(
          "subscriptions.closed_at",
          ">=",
          `${query.from ?? monthStart(asOf)}T00:00:00.000Z`,
        );
        if (query.customerId)
          builder.where("subscriptions.customer_id", query.customerId);
        if (query.currencyCode)
          builder.where("subscriptions.currency_code", query.currencyCode);
      })
      .select(
        "subscriptions.currency_code",
        "plans.billing_period",
        "plans.billing_interval",
        this.database.raw(
          "sum(subscription_lines.amount)::numeric(14,2) as recurring_amount",
        ),
      )
      .groupBy(
        "subscriptions.id",
        "subscriptions.currency_code",
        "plans.billing_period",
        "plans.billing_interval",
      );
    const churnRows = (await closedQuery) as ReportRow[];
    const churnByCurrency = new Map<string, bigint>();
    for (const row of churnRows) {
      const currency = String(row.currency_code);
      const amount = monthlyize(
        String(row.recurring_amount),
        String(row.billing_period),
        Number(row.billing_interval),
      );
      churnByCurrency.set(
        currency,
        (churnByCurrency.get(currency) ?? 0n) + amount,
      );
    }

    const currencies = new Set([
      ...currentByCurrency.keys(),
      ...newByCurrency.keys(),
      ...churnByCurrency.keys(),
    ]);
    const rows = [...currencies].sort().map((currencyCode) => {
      const mrr = currentByCurrency.get(currencyCode) ?? 0n;
      const newMrr = newByCurrency.get(currencyCode) ?? 0n;
      const churn = churnByCurrency.get(currencyCode) ?? 0n;
      return {
        currencyCode,
        mrr: formatMoney(mrr),
        arr: formatMoney(mrr * 12n),
        new: formatMoney(newMrr),
        expansion: formatMoney(expansionByCurrency.get(currencyCode) ?? 0n),
        churn: formatMoney(churn),
      };
    });
    const total = rows.length;
    return {
      data: rows.slice(
        (query.page - 1) * query.limit,
        query.page * query.limit,
      ),
      meta: { page: query.page, limit: query.limit, total, asOf },
    };
  }

  async overdue(query: ReportQuery) {
    const base = this.overdueQuery(query);
    const countRow = await base
      .clone()
      .count<{ count: string }[]>("invoices.id as count")
      .first();
    const rows = (await base
      .select(
        "invoices.id",
        "invoices.number",
        "invoices.due_date",
        "invoices.status",
        "invoices.currency_code",
        "invoices.total",
        "subscriptions.customer_id",
        "users.email as customer_email",
        this.database.raw(
          "coalesce((select sum(payments.amount) from payments where payments.invoice_id = invoices.id), 0)::numeric(14,2) as amount_paid",
        ),
      )
      .orderBy("invoices.due_date", "asc")
      .orderBy("invoices.id", "asc")
      .limit(query.limit)
      .offset((query.page - 1) * query.limit)) as ReportRow[];
    return {
      data: rows.map((row) => ({
        id: String(row.id),
        number: row.number,
        customerId: String(row.customer_id),
        customerEmail: row.customer_email,
        dueDate: dateOnly(row.due_date),
        status: row.status,
        currencyCode: row.currency_code,
        total: String(row.total),
        amountPaid: String(row.amount_paid),
        balanceDue: formatMoney(
          decimalToMinorUnits(String(row.total), 2) -
            decimalToMinorUnits(String(row.amount_paid), 2),
        ),
      })),
      meta: {
        page: query.page,
        limit: query.limit,
        total: Number(countRow?.count ?? 0),
      },
    };
  }

  async revenue(query: ReportQuery) {
    const base = this.filteredPayments(query)
      .select(
        this.database.raw("payments.received_at::date::text as date"),
        "invoices.currency_code",
        this.database.raw("sum(payments.amount)::numeric(14,2) as amount"),
        this.database.raw("count(payments.id)::int as payment_count"),
      )
      .groupByRaw("payments.received_at::date, invoices.currency_code");
    const groups = this.filteredPayments(query)
      .select(
        this.database.raw("payments.received_at::date"),
        "invoices.currency_code",
      )
      .groupByRaw("payments.received_at::date, invoices.currency_code");
    const countRow = await this.database
      .from(groups.as("revenue_groups"))
      .count<{ count: string }[]>("* as count")
      .first();
    const rows = (await base
      .orderBy("date", "desc")
      .orderBy("invoices.currency_code", "asc")
      .limit(query.limit)
      .offset((query.page - 1) * query.limit)) as ReportRow[];
    return {
      data: rows.map((row) => ({
        date: row.date,
        currencyCode: row.currency_code,
        amount: String(row.amount),
        paymentCount: Number(row.payment_count),
      })),
      meta: {
        page: query.page,
        limit: query.limit,
        total: Number(countRow?.count ?? 0),
      },
    };
  }

  private filteredInvoices(query: ReportQuery) {
    return this.database("invoices")
      .join("subscriptions", "subscriptions.id", "invoices.subscription_id")
      .modify((builder) => {
        if (query.from)
          builder.where(
            "invoices.created_at",
            ">=",
            `${query.from}T00:00:00.000Z`,
          );
        if (query.to)
          builder.where("invoices.created_at", "<", nextDay(query.to));
        if (query.customerId)
          builder.where("subscriptions.customer_id", query.customerId);
        if (query.currencyCode)
          builder.where("invoices.currency_code", query.currencyCode);
      });
  }

  private filteredPayments(query: ReportQuery) {
    return this.database("payments")
      .join("invoices", "invoices.id", "payments.invoice_id")
      .join("subscriptions", "subscriptions.id", "invoices.subscription_id")
      .modify((builder) => {
        if (query.from)
          builder.where(
            "payments.received_at",
            ">=",
            `${query.from}T00:00:00.000Z`,
          );
        if (query.to)
          builder.where("payments.received_at", "<", nextDay(query.to));
        if (query.customerId)
          builder.where("subscriptions.customer_id", query.customerId);
        if (query.currencyCode)
          builder.where("invoices.currency_code", query.currencyCode);
      });
  }

  private overdueQuery(query: ReportQuery) {
    return this.database("invoices")
      .join("subscriptions", "subscriptions.id", "invoices.subscription_id")
      .join("customers", "customers.id", "subscriptions.customer_id")
      .join("users", "users.id", "customers.user_id")
      .where(
        "invoices.due_date",
        "<",
        query.to ?? new Date().toISOString().slice(0, 10),
      )
      .whereIn("invoices.status", ["confirmed", "partially_paid", "overdue"])
      .modify((builder) => {
        if (query.from) builder.where("invoices.due_date", ">=", query.from);
        if (query.customerId)
          builder.where("subscriptions.customer_id", query.customerId);
        if (query.currencyCode)
          builder.where("invoices.currency_code", query.currencyCode);
      })
      .whereRaw(
        "invoices.total > coalesce((select sum(payments.amount) from payments where payments.invoice_id = invoices.id), 0)",
      );
  }
}

function monthlyize(value: string, period: string, interval: number): bigint {
  const amount = decimalToMinorUnits(value, 2);
  if (period === "daily")
    return (amount * 30n + BigInt(interval) / 2n) / BigInt(interval);
  if (period === "weekly")
    return (
      (amount * 4345n + BigInt(interval) * 500n) / (1000n * BigInt(interval))
    );
  if (period === "yearly")
    return (amount + BigInt(interval) * 6n) / (12n * BigInt(interval));
  return (amount + BigInt(interval) / 2n) / BigInt(interval);
}

function dateOnly(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "string") return value.slice(0, 10);
  throw new Error("Database returned an invalid date.");
}

function nextDay(date: string): string {
  const tomorrow = new Date(`${date}T00:00:00.000Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  return tomorrow.toISOString();
}

function monthStart(date: string): string {
  return `${date.slice(0, 7)}-01`;
}
