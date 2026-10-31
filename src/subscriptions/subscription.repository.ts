import type { Knex } from "knex";
import { AppError } from "../errors/app-error.js";
import type { AuthActor } from "../auth/auth.types.js";
import {
  assertActiveTax,
  resolveProductUnitPrice,
} from "../catalog/catalog.repository.js";
import type {
  CreateSubscriptionInput,
  TemplateSubscriptionInput,
  UpdateSubscriptionInput,
} from "../catalog/catalog.schemas.js";
import {
  transitionSubscription,
  type SubscriptionAction,
  type SubscriptionStatus,
} from "./subscription-state-machine.js";

export interface SubscriptionListInput {
  page: number;
  limit: number;
  status?: SubscriptionStatus;
  customerId?: string;
}

export interface SubscriptionRepository {
  create(
    input: CreateSubscriptionInput,
    actor: AuthActor,
    now: Date,
  ): Promise<Record<string, unknown>>;
  createFromTemplate(
    templateId: string,
    input: TemplateSubscriptionInput,
    actor: AuthActor,
    now: Date,
  ): Promise<Record<string, unknown>>;
  update(
    id: string,
    input: UpdateSubscriptionInput,
    actor: AuthActor,
    now: Date,
  ): Promise<Record<string, unknown>>;
  deleteDraft(id: string, actor: AuthActor, now: Date): Promise<void>;
  find(id: string, actor: AuthActor): Promise<Record<string, unknown>>;
  list(
    input: SubscriptionListInput,
    actor: AuthActor,
  ): Promise<{
    data: Record<string, unknown>[];
    meta: { page: number; limit: number; total: number };
  }>;
  transition(
    id: string,
    action: SubscriptionAction,
    actor: AuthActor,
    now: Date,
  ): Promise<Record<string, unknown>>;
}

interface LineInput {
  productId: string;
  variantId?: string;
  taxId?: string;
  description: string;
  quantity: string;
  unitPrice?: string;
}

interface PlanRow {
  id: string | number;
  billing_period: "daily" | "weekly" | "monthly" | "yearly";
  billing_interval: number;
  min_qty: number;
  available_from: string | null;
  available_to: string | null;
  closable: boolean;
  pausable: boolean;
  renewable: boolean;
}

export class KnexSubscriptionRepository implements SubscriptionRepository {
  constructor(private readonly database: Knex) {}

  async create(
    input: CreateSubscriptionInput,
    actor: AuthActor,
    now: Date,
  ): Promise<Record<string, unknown>> {
    const customerId = this.customerIdFor(input.customerId, actor);
    this.assertNoCustomerPriceOverrides(input.lines, actor);

    return this.database.transaction(async (transaction) => {
      const plan = await this.findAvailablePlan(transaction, input.planId, now);
      this.assertMinimumQuantity(input.lines, plan.min_qty);
      await this.assertCustomer(transaction, customerId);
      const [subscription] = await transaction("subscriptions")
        .insert({
          customer_id: customerId,
          plan_id: input.planId,
          created_by: actor.id,
          status: "draft",
          currency_code: input.currencyCode,
        })
        .returning("*");

      await this.insertLines(transaction, String(subscription.id), input.lines);
      return this.getWithLines(transaction, subscription);
    });
  }

  async createFromTemplate(
    templateId: string,
    input: TemplateSubscriptionInput,
    actor: AuthActor,
    now: Date,
  ): Promise<Record<string, unknown>> {
    const customerId = this.customerIdFor(input.customerId, actor);

    return this.database.transaction(async (transaction) => {
      const customer = await this.assertCustomer(transaction, customerId);
      const template = await transaction("quotation_templates")
        .select("*")
        .where({ id: templateId, is_active: true })
        .first();
      if (!template) {
        throw new AppError(
          404,
          "TEMPLATE_NOT_FOUND",
          "Quotation template was not found.",
        );
      }

      const templateLines = await transaction("quotation_template_lines")
        .select("*")
        .where({ template_id: templateId })
        .orderBy("position");
      if (templateLines.length === 0) {
        throw new AppError(
          409,
          "EMPTY_TEMPLATE",
          "Quotation template has no lines.",
        );
      }
      const planId =
        input.planId ??
        templateLines
          .find((line) => line.plan_id !== null)
          ?.plan_id?.toString();
      if (!planId) {
        throw new AppError(
          422,
          "PLAN_REQUIRED",
          "Choose a plan or include one in the quotation template.",
        );
      }
      if (
        templateLines.some(
          (line) => line.plan_id !== null && String(line.plan_id) !== planId,
        )
      ) {
        throw new AppError(
          409,
          "TEMPLATE_PLAN_MISMATCH",
          "The selected plan conflicts with a plan on the quotation template.",
        );
      }
      const plan = await this.findAvailablePlan(transaction, planId, now);
      this.assertMinimumQuantity(
        templateLines.map((line) => ({ quantity: String(line.quantity) })),
        plan.min_qty,
      );

      const [subscription] = await transaction("subscriptions")
        .insert({
          customer_id: customer.id,
          plan_id: plan.id,
          created_by: actor.id,
          status: "quotation",
          currency_code: template.currency_code,
          quote_valid_until: addDays(
            dateOnly(now),
            Number(template.validity_days),
          ),
        })
        .returning("*");

      const lines: LineInput[] = templateLines.map((line) => ({
        productId: String(line.product_id),
        variantId:
          line.variant_id === null ? undefined : String(line.variant_id),
        taxId: line.tax_id === null ? undefined : String(line.tax_id),
        description: line.description,
        quantity: String(line.quantity),
        unitPrice: String(line.unit_price),
      }));
      await this.insertLines(transaction, String(subscription.id), lines);
      return this.getWithLines(transaction, subscription);
    });
  }

  async update(
    id: string,
    input: UpdateSubscriptionInput,
    actor: AuthActor,
    now: Date,
  ): Promise<Record<string, unknown>> {
    this.assertNoCustomerPriceOverrides(input.lines, actor);
    return this.database.transaction(async (transaction) => {
      const query = transaction("subscriptions")
        .where({ id })
        .whereNull("deleted_at")
        .forUpdate();
      if (actor.role === "customer") {
        query.where("customer_id", actor.customerId);
      }
      const subscription = await query.first();
      if (!subscription) {
        throw new AppError(
          404,
          "SUBSCRIPTION_NOT_FOUND",
          "Subscription was not found.",
        );
      }
      if (!["draft", "quotation"].includes(subscription.status)) {
        throw new AppError(
          409,
          "SUBSCRIPTION_NOT_EDITABLE",
          "Only draft or quotation subscriptions can be edited.",
        );
      }

      const plan = await this.findAvailablePlan(transaction, input.planId, now);
      this.assertMinimumQuantity(input.lines, plan.min_qty);
      const [updated] = await transaction("subscriptions")
        .where({ id: subscription.id })
        .update({
          plan_id: input.planId,
          currency_code: input.currencyCode,
          updated_at: now,
        })
        .returning("*");
      await transaction("subscription_lines")
        .where({ subscription_id: subscription.id })
        .delete();
      await this.insertLines(transaction, String(subscription.id), input.lines);
      return this.getWithLines(transaction, updated);
    });
  }

  async deleteDraft(id: string, actor: AuthActor, now: Date): Promise<void> {
    await this.database.transaction(async (transaction) => {
      const query = transaction("subscriptions")
        .where({ id })
        .whereNull("deleted_at")
        .whereIn("status", ["draft", "quotation"])
        .forUpdate();
      if (actor.role === "customer") {
        query.where("customer_id", actor.customerId);
      }
      const subscription = await query.first();
      if (!subscription) {
        throw new AppError(
          404,
          "SUBSCRIPTION_NOT_FOUND",
          "Draft or quotation subscription was not found.",
        );
      }
      await transaction("subscriptions")
        .where({ id: subscription.id })
        .update({ deleted_at: now, updated_at: now });
    });
  }

  async find(id: string, actor: AuthActor): Promise<Record<string, unknown>> {
    const query = this.database("subscriptions")
      .where("subscriptions.id", id)
      .whereNull("subscriptions.deleted_at");
    if (actor.role === "customer") {
      query.where("subscriptions.customer_id", actor.customerId);
    }
    const subscription = await query.first();
    if (!subscription) {
      throw new AppError(
        404,
        "SUBSCRIPTION_NOT_FOUND",
        "Subscription was not found.",
      );
    }
    return this.getWithLines(this.database, subscription);
  }

  async list(
    input: SubscriptionListInput,
    actor: AuthActor,
  ): Promise<{
    data: Record<string, unknown>[];
    meta: { page: number; limit: number; total: number };
  }> {
    const query = this.database("subscriptions");
    query.whereNull("deleted_at");
    if (actor.role === "customer") {
      query.where("customer_id", actor.customerId);
    } else if (input.customerId) {
      query.where("customer_id", input.customerId);
    }
    if (input.status) {
      query.where("status", input.status);
    }

    const countRow = await query
      .clone()
      .count<{ count: string }[]>("id as count")
      .first();
    const rows = await query
      .clone()
      .select("*")
      .orderBy("created_at", "desc")
      .orderBy("id", "desc")
      .limit(input.limit)
      .offset((input.page - 1) * input.limit);
    const data = await this.getManyWithLines(this.database, rows);
    return {
      data,
      meta: {
        page: input.page,
        limit: input.limit,
        total: Number(countRow?.count ?? 0),
      },
    };
  }

  async transition(
    id: string,
    action: SubscriptionAction,
    actor: AuthActor,
    now: Date,
  ): Promise<Record<string, unknown>> {
    return this.database.transaction(async (transaction) => {
      const query = transaction("subscriptions")
        .where("id", id)
        .whereNull("deleted_at")
        .forUpdate();
      if (actor.role === "customer") {
        query.where("customer_id", actor.customerId);
      }
      const subscription = await query.first();
      if (!subscription) {
        throw new AppError(
          404,
          "SUBSCRIPTION_NOT_FOUND",
          "Subscription was not found.",
        );
      }
      const plan = await transaction("plans")
        .select("*")
        .where({ id: subscription.plan_id })
        .first();
      if (!plan) {
        throw new AppError(
          409,
          "SUBSCRIPTION_PLAN_MISSING",
          "Subscription plan is unavailable.",
        );
      }
      const currentStatus = subscription.status as SubscriptionStatus;
      if (currentStatus === "quotation" && action === "confirm") {
        const quoteValidUntil = subscription.quote_valid_until as string | null;
        if (quoteValidUntil && quoteValidUntil < dateOnly(now)) {
          throw new AppError(
            409,
            "QUOTATION_EXPIRED",
            "Quotation has expired.",
          );
        }
      }

      const status = transitionSubscription(currentStatus, action, {
        closable: plan.closable,
        pausable: plan.pausable,
        renewable: plan.renewable,
      });
      const update: Record<string, unknown> = {
        status,
        updated_at: now,
      };

      if (action === "quote") {
        update.quote_valid_until = addDays(dateOnly(now), 30);
      } else if (action === "activate" || action === "renew") {
        const activatedFromPause =
          action === "activate" && currentStatus === "paused";
        const startDate = activatedFromPause
          ? String(subscription.start_date ?? dateOnly(now))
          : dateOnly(now);
        update.start_date = startDate;
        update.next_billing_date = activatedFromPause
          ? subscription.next_billing_date
          : addBillingPeriod(
              startDate,
              plan.billing_period,
              plan.billing_interval,
            );
        update.paused_at = null;
        update.closed_at = null;
        update.end_date = null;
      } else if (action === "pause") {
        update.paused_at = now;
      } else if (action === "close") {
        update.closed_at = now;
        update.end_date = dateOnly(now);
        update.next_billing_date = null;
        update.paused_at = null;
      }

      const [updated] = await transaction("subscriptions")
        .where({ id: subscription.id })
        .update(update)
        .returning("*");
      return this.getWithLines(transaction, updated);
    });
  }

  private customerIdFor(
    requestedCustomerId: string | undefined,
    actor: AuthActor,
  ): string {
    if (actor.role === "customer") {
      if (!actor.customerId) {
        throw new AppError(
          403,
          "CUSTOMER_PROFILE_REQUIRED",
          "Customer access is unavailable.",
        );
      }
      if (requestedCustomerId && requestedCustomerId !== actor.customerId) {
        throw new AppError(
          403,
          "FORBIDDEN",
          "Customers can only create their own subscriptions.",
        );
      }
      return actor.customerId;
    }
    if (!requestedCustomerId) {
      throw new AppError(422, "CUSTOMER_REQUIRED", "customerId is required.");
    }
    return requestedCustomerId;
  }

  private assertNoCustomerPriceOverrides(
    lines: LineInput[],
    actor: AuthActor,
  ): void {
    if (
      actor.role === "customer" &&
      lines.some((line) => line.unitPrice !== undefined)
    ) {
      throw new AppError(
        403,
        "FORBIDDEN",
        "Customers cannot override catalog prices.",
      );
    }
  }

  private async assertCustomer(
    transaction: Knex.Transaction,
    customerId: string,
  ): Promise<{ id: string | number }> {
    const customer = await transaction("customers")
      .select("id")
      .where({ id: customerId })
      .first();
    if (!customer) {
      throw new AppError(404, "CUSTOMER_NOT_FOUND", "Customer was not found.");
    }
    return customer;
  }

  private async findAvailablePlan(
    transaction: Knex.Transaction,
    planId: string,
    now: Date,
  ): Promise<PlanRow> {
    const today = dateOnly(now);
    const plan = (await transaction("plans")
      .select("*")
      .where({ id: planId, is_active: true })
      .where((builder) =>
        builder
          .whereNull("available_from")
          .orWhere("available_from", "<=", today),
      )
      .where((builder) =>
        builder.whereNull("available_to").orWhere("available_to", ">=", today),
      )
      .first()) as PlanRow | undefined;
    if (!plan) {
      throw new AppError(
        404,
        "PLAN_NOT_AVAILABLE",
        "An available plan was not found.",
      );
    }
    return plan;
  }

  private assertMinimumQuantity(
    lines: Array<{ quantity: string }>,
    minimum: number,
  ): void {
    const totalMilliunits = lines.reduce(
      (total, line) => total + quantityToMilliunits(line.quantity),
      0n,
    );
    if (totalMilliunits < BigInt(minimum) * 1000n) {
      throw new AppError(
        422,
        "MINIMUM_QUANTITY",
        `This plan requires a minimum quantity of ${minimum}.`,
      );
    }
  }

  private async insertLines(
    transaction: Knex.Transaction,
    subscriptionId: string,
    lines: LineInput[],
  ): Promise<void> {
    const rows: Record<string, unknown>[] = [];
    for (const [index, line] of lines.entries()) {
      const unitPrice = await resolveProductUnitPrice(
        transaction,
        line.productId,
        line.variantId,
        line.unitPrice,
      );
      const tax = await assertActiveTax(transaction, line.taxId);
      rows.push({
        subscription_id: subscriptionId,
        position: index + 1,
        product_id: line.productId,
        variant_id: line.variantId ?? null,
        tax_id: line.taxId ?? null,
        description: line.description,
        quantity: line.quantity,
        unit_price: unitPrice,
        tax_rate: tax?.rate ?? "0.00",
        tax_inclusive: tax?.isInclusive ?? false,
        discount_amount: "0.00",
      });
    }
    await transaction("subscription_lines").insert(rows);
  }

  private async getWithLines(
    executor: Knex | Knex.Transaction,
    row: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const lines = await executor("subscription_lines")
      .select("*")
      .where({ subscription_id: row.id })
      .orderBy("position");
    return this.toSubscriptionDto(row, lines);
  }

  private async getManyWithLines(
    executor: Knex | Knex.Transaction,
    rows: Record<string, unknown>[],
  ): Promise<Record<string, unknown>[]> {
    if (rows.length === 0) return [];
    const subscriptionIds = rows.map((row) => String(row.id));
    const lines = await executor("subscription_lines")
      .select("*")
      .whereIn("subscription_id", subscriptionIds)
      .orderBy(["subscription_id", "position"]);
    const linesBySubscription = new Map<string, Record<string, unknown>[]>();
    for (const line of lines) {
      const key = String(line.subscription_id);
      linesBySubscription.set(key, [
        ...(linesBySubscription.get(key) ?? []),
        line,
      ]);
    }
    return rows.map((row) =>
      this.toSubscriptionDto(
        row,
        linesBySubscription.get(String(row.id)) ?? [],
      ),
    );
  }

  private toSubscriptionDto(
    row: Record<string, unknown>,
    lines: Record<string, unknown>[],
  ): Record<string, unknown> {
    return {
      id: String(row.id),
      number: row.number,
      customerId: String(row.customer_id),
      planId: String(row.plan_id),
      status: row.status,
      currencyCode: row.currency_code,
      quoteValidUntil: row.quote_valid_until,
      startDate: row.start_date,
      nextBillingDate: row.next_billing_date,
      endDate: row.end_date,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lines: lines.map((line) => ({
        id: String(line.id),
        position: line.position,
        productId: String(line.product_id),
        variantId: line.variant_id === null ? null : String(line.variant_id),
        taxId: line.tax_id === null ? null : String(line.tax_id),
        description: line.description,
        quantity: String(line.quantity),
        unitPrice: String(line.unit_price),
        taxRate: String(line.tax_rate),
        taxInclusive: line.tax_inclusive,
        amount: String(line.amount),
      })),
    };
  }
}

function quantityToMilliunits(quantity: string): bigint {
  const [whole, fraction = ""] = quantity.split(".");
  return BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, "0"));
}

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const ordinal = daysFromCivil(year, month, day) + days;
  const result = civilFromDays(ordinal);
  return `${String(result.year).padStart(4, "0")}-${String(result.month).padStart(2, "0")}-${String(result.day).padStart(2, "0")}`;
}

export function addBillingPeriod(
  date: string,
  period: PlanRow["billing_period"],
  interval: number,
): string {
  if (period === "daily") return addDays(date, interval);
  if (period === "weekly") return addDays(date, interval * 7);

  const [year, month, day] = date.split("-").map(Number);
  const monthDelta = period === "yearly" ? interval * 12 : interval;
  const absoluteMonth = year * 12 + month - 1 + monthDelta;
  const nextYear = Math.floor(absoluteMonth / 12);
  const nextMonth = (absoluteMonth % 12) + 1;
  const lastDay = daysInMonth(nextYear, nextMonth);
  return `${String(nextYear).padStart(4, "0")}-${String(nextMonth).padStart(2, "0")}-${String(Math.min(day, lastDay)).padStart(2, "0")}`;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function daysFromCivil(year: number, month: number, day: number): number {
  const adjustedYear = year - (month <= 2 ? 1 : 0);
  const era = Math.floor(adjustedYear / 400);
  const yearOfEra = adjustedYear - era * 400;
  const shiftedMonth = month + (month > 2 ? -3 : 9);
  const dayOfYear = Math.floor((153 * shiftedMonth + 2) / 5) + day - 1;
  const dayOfEra =
    yearOfEra * 365 +
    Math.floor(yearOfEra / 4) -
    Math.floor(yearOfEra / 100) +
    dayOfYear;
  return era * 146097 + dayOfEra;
}

function civilFromDays(days: number): {
  year: number;
  month: number;
  day: number;
} {
  const era = Math.floor(days / 146097);
  const dayOfEra = days - era * 146097;
  const yearOfEra = Math.floor(
    (dayOfEra -
      Math.floor(dayOfEra / 1460) +
      Math.floor(dayOfEra / 36524) -
      Math.floor(dayOfEra / 146096)) /
      365,
  );
  let year = yearOfEra + era * 400;
  const dayOfYear =
    dayOfEra -
    (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
  const shiftedMonth = Math.floor((5 * dayOfYear + 2) / 153);
  const day = dayOfYear - Math.floor((153 * shiftedMonth + 2) / 5) + 1;
  const month = shiftedMonth + (shiftedMonth < 10 ? 3 : -9);
  year += month <= 2 ? 1 : 0;
  return { year, month, day };
}
