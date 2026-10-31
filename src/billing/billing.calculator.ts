import {
  decimalRateToBasisPoints,
  decimalToMinorUnits,
  formatMoney,
  inclusiveTaxComponent,
  minorUnitsToDecimal,
  multiplyByRate,
  multiplyQuantityAndMoney,
  roundDivide,
} from "./money.js";

export type MarginGuardMode = "warn" | "block";

export interface BillingLine {
  productId: string;
  variantId: string | null;
  description: string;
  quantity: string;
  unitPrice: string;
  taxName: string | null;
  taxRate: string;
  taxInclusive: boolean;
  costPrice: string | null;
}

export interface BillingDiscount {
  id: string;
  code: string;
  name: string;
  type: "fixed" | "percent";
  value: string;
  minPurchase: string;
  minQty: number;
  startsAt: string | null;
  endsAt: string | null;
  usageLimit: number | null;
  usedCount: number;
  scope: "all" | "products" | "plans" | "products_and_plans";
  productIds: string[];
  planIds: string[];
}

export interface BillingSubscription {
  id: string;
  number: string;
  customerId: string;
  customerEmail: string;
  planId: string;
  currencyCode: string;
  billingPeriod: "daily" | "weekly" | "monthly" | "yearly";
  billingInterval: number;
  nextBillingDate: string;
  autoClose: boolean;
  planAvailableTo: string | null;
  planAvailable: boolean;
  lines: BillingLine[];
}

export interface InvoiceLineCalculation extends BillingLine {
  kind: "charge";
  discountAmount: string;
  taxAmount: string;
  lineTotal: string;
  netAfterDiscount: string;
}

export interface MarginWarning {
  productId: string;
  description: string;
  costAmount: string;
  netAfterDiscount: string;
}

export interface CalculatedInvoice {
  subscriptionId: string;
  subscriptionNumber: string;
  customerId: string;
  customerEmail: string;
  currencyCode: string;
  periodStart: string;
  periodEnd: string;
  dueDate: string;
  subtotal: string;
  discountTotal: string;
  taxTotal: string;
  total: string;
  lines: InvoiceLineCalculation[];
  discounts: Array<{ id: string; code: string; amount: string }>;
  marginWarnings: MarginWarning[];
  nextBillingDate: string;
  autoClose: boolean;
  autoCloseDate: string | null;
}

export interface BillingSkip {
  subscriptionId: string;
  subscriptionNumber: string;
  reason:
    | "already_invoiced"
    | "no_lines"
    | "plan_unavailable"
    | "auto_closed"
    | "margin_below_cost";
  details: string;
}

export type BillingEvaluation =
  | { kind: "invoice"; invoice: CalculatedInvoice }
  | { kind: "skip"; skip: BillingSkip };

export function calculateInvoice(
  subscription: BillingSubscription,
  discounts: BillingDiscount[],
  now: Date,
  marginMode: MarginGuardMode,
): BillingEvaluation {
  const today = now.toISOString().slice(0, 10);
  if (subscription.lines.length === 0) {
    return skip(
      subscription,
      "no_lines",
      "Subscription has no billable lines.",
    );
  }
  if (
    subscription.autoClose &&
    subscription.planAvailableTo &&
    today >= subscription.planAvailableTo
  ) {
    return skip(
      subscription,
      "auto_closed",
      `Plan availability ended ${subscription.planAvailableTo}; subscription will close without another invoice.`,
    );
  }
  if (!subscription.planAvailable) {
    return skip(
      subscription,
      "plan_unavailable",
      "The subscription plan is inactive.",
    );
  }

  const periodEnd = addBillingPeriod(
    subscription.nextBillingDate,
    subscription.billingPeriod,
    subscription.billingInterval,
  );
  if (
    subscription.autoClose &&
    subscription.planAvailableTo &&
    periodEnd > subscription.planAvailableTo
  ) {
    return skip(
      subscription,
      "auto_closed",
      `Plan availability ends ${subscription.planAvailableTo}; subscription will close instead of renewing.`,
    );
  }

  const grossCents = subscription.lines.map((line) =>
    multiplyQuantityAndMoney(line.quantity, line.unitPrice),
  );
  const discountCents = grossCents.map(() => 0n);
  const applicableDiscounts = discounts
    .filter((discount) => isDiscountWithinWindow(discount, now.toISOString()))
    .filter((discount) => {
      if (
        discount.usageLimit !== null &&
        discount.usedCount >= discount.usageLimit
      ) {
        return false;
      }
      const indexes = eligibleLineIndexes(subscription, discount);
      if (indexes.length === 0) return false;
      const purchase = indexes.reduce(
        (sum, index) => sum + grossCents[index],
        0n,
      );
      const quantity = indexes.reduce(
        (sum, index) =>
          sum + decimalToMinorUnits(subscription.lines[index].quantity, 3),
        0n,
      );
      return (
        purchase >= decimalToMinorUnits(discount.minPurchase, 2) &&
        quantity >= BigInt(discount.minQty) * 1000n
      );
    });

  const appliedDiscounts: CalculatedInvoice["discounts"] = [];
  for (const discount of applicableDiscounts) {
    const indexes = eligibleLineIndexes(subscription, discount);
    let remainingDiscount =
      discount.type === "fixed"
        ? decimalToMinorUnits(discount.value, 2)
        : indexes.reduce(
            (sum, index) => sum + grossCents[index] - discountCents[index],
            0n,
          );
    let applied = 0n;

    for (const index of indexes) {
      const remainingLine = grossCents[index] - discountCents[index];
      if (remainingLine <= 0n || remainingDiscount <= 0n) continue;
      const requested =
        discount.type === "fixed"
          ? remainingDiscount
          : multiplyByRate(
              remainingLine,
              decimalRateToBasisPoints(discount.value),
            );
      const amount = requested > remainingLine ? remainingLine : requested;
      discountCents[index] += amount;
      applied += amount;
      if (discount.type === "fixed") remainingDiscount -= amount;
    }

    if (applied > 0n) {
      appliedDiscounts.push({
        id: discount.id,
        code: discount.code,
        amount: formatMoney(applied),
      });
    }
  }

  const calculatedLines: InvoiceLineCalculation[] = [];
  let subtotalCents = 0n;
  let discountTotalCents = 0n;
  let taxTotalCents = 0n;
  let totalCents = 0n;
  const marginWarnings: MarginWarning[] = [];

  for (let index = 0; index < subscription.lines.length; index += 1) {
    const line = subscription.lines[index];
    const gross = grossCents[index];
    const discount = discountCents[index];
    const discountedGross = gross - discount;
    const rate = decimalRateToBasisPoints(line.taxRate);
    const originalInclusiveTax = line.taxInclusive
      ? inclusiveTaxComponent(gross, rate)
      : 0n;
    const tax = line.taxInclusive
      ? inclusiveTaxComponent(discountedGross, rate)
      : multiplyByRate(discountedGross, rate);
    const net = line.taxInclusive ? discountedGross - tax : discountedGross;
    const displayDiscount = line.taxInclusive
      ? discount - originalInclusiveTax + tax
      : discount;
    const lineTotal = line.taxInclusive
      ? discountedGross
      : discountedGross + tax;

    subtotalCents += line.taxInclusive ? gross - originalInclusiveTax : gross;
    discountTotalCents += displayDiscount;
    taxTotalCents += tax;
    totalCents += lineTotal;

    if (line.costPrice !== null) {
      const cost = multiplyQuantityAndMoney(line.quantity, line.costPrice);
      if (net < cost) {
        marginWarnings.push({
          productId: line.productId,
          description: line.description,
          costAmount: formatMoney(cost),
          netAfterDiscount: formatMoney(net),
        });
      }
    }

    calculatedLines.push({
      ...line,
      kind: "charge",
      discountAmount: formatMoney(discount),
      taxAmount: formatMoney(tax),
      lineTotal: formatMoney(lineTotal),
      netAfterDiscount: formatMoney(net),
    });
  }

  if (marginMode === "block" && marginWarnings.length > 0) {
    return skip(
      subscription,
      "margin_below_cost",
      `Discounted price is below cost for ${marginWarnings.length} line(s).`,
    );
  }

  const nextBillingDate = periodEnd;
  const closeAt =
    subscription.autoClose &&
    subscription.planAvailableTo &&
    nextBillingDate >= subscription.planAvailableTo
      ? subscription.planAvailableTo
      : null;

  return {
    kind: "invoice",
    invoice: {
      subscriptionId: subscription.id,
      subscriptionNumber: subscription.number,
      customerId: subscription.customerId,
      customerEmail: subscription.customerEmail,
      currencyCode: subscription.currencyCode,
      periodStart: subscription.nextBillingDate,
      periodEnd,
      dueDate: addDays(today, 14),
      subtotal: formatMoney(subtotalCents),
      discountTotal: formatMoney(discountTotalCents),
      taxTotal: formatMoney(taxTotalCents),
      total: formatMoney(totalCents),
      lines: calculatedLines,
      discounts: appliedDiscounts,
      marginWarnings,
      nextBillingDate,
      autoClose: closeAt !== null,
      autoCloseDate: closeAt,
    },
  };
}

export interface ProrationCalculation {
  kind: "charge" | "credit";
  quantityDelta: string;
  quantity: "1.000";
  unitPrice: string;
  taxAmount: string;
  subtotal: string;
  lineTotal: string;
  total: string;
  daysRemaining: number;
  periodDays: number;
}

export function calculateProration(input: {
  currentQuantity: string;
  targetQuantity: string;
  unitPrice: string;
  taxRate: string;
  taxInclusive: boolean;
  periodStart: string;
  periodEnd: string;
  asOf: string;
}): ProrationCalculation {
  const difference =
    decimalToMinorUnits(input.targetQuantity, 3) -
    decimalToMinorUnits(input.currentQuantity, 3);
  if (difference === 0n) {
    throw new Error("Proration requires a quantity change.");
  }
  const periodDays = daysBetween(input.periodStart, input.periodEnd);
  const daysRemaining = daysBetween(input.asOf, input.periodEnd);
  if (
    periodDays <= 0 ||
    daysRemaining <= 0 ||
    input.asOf <= input.periodStart
  ) {
    throw new Error(
      "Proration requires a date inside the current billing period.",
    );
  }

  const quantityMilli = difference < 0n ? -difference : difference;
  const fullAmount = multiplyQuantityAndMoney(
    minorUnitsToDecimal(quantityMilli, 3),
    input.unitPrice,
  );
  const grossAmount = roundDivide(
    fullAmount * BigInt(daysRemaining),
    BigInt(periodDays),
  );
  const rate = decimalRateToBasisPoints(input.taxRate);
  const taxAmount = input.taxInclusive
    ? inclusiveTaxComponent(grossAmount, rate)
    : multiplyByRate(grossAmount, rate);
  const netAmount = input.taxInclusive ? grossAmount - taxAmount : grossAmount;
  const sign = difference < 0n ? -1n : 1n;
  const signedTax = taxAmount * sign;
  const signedNet = netAmount * sign;
  const signedTotal =
    (input.taxInclusive ? grossAmount : netAmount + taxAmount) * sign;

  return {
    kind: difference < 0n ? "credit" : "charge",
    quantityDelta: minorUnitsToDecimal(quantityMilli, 3),
    quantity: "1.000",
    unitPrice: formatMoney(input.taxInclusive ? grossAmount : netAmount),
    taxAmount: formatMoney(signedTax),
    subtotal: formatMoney(signedNet),
    lineTotal: formatMoney(signedTotal),
    total: formatMoney(signedTotal),
    daysRemaining,
    periodDays,
  };
}

export function eligibleLineIndexes(
  subscription: BillingSubscription,
  discount: BillingDiscount,
): number[] {
  if (discount.scope === "all") {
    return subscription.lines.map((_line, index) => index);
  }
  return subscription.lines.flatMap((line, index) => {
    const productMatch = discount.productIds.includes(line.productId);
    const planMatch = discount.planIds.includes(subscription.planId);
    const eligible =
      discount.scope === "products"
        ? productMatch
        : discount.scope === "plans"
          ? planMatch
          : productMatch || planMatch;
    return eligible ? [index] : [];
  });
}

function isDiscountWithinWindow(
  discount: BillingDiscount,
  now: string,
): boolean {
  return (
    (discount.startsAt === null || discount.startsAt <= now) &&
    (discount.endsAt === null || discount.endsAt >= now)
  );
}

function skip(
  subscription: BillingSubscription,
  reason: BillingSkip["reason"],
  details: string,
): BillingEvaluation {
  return {
    kind: "skip",
    skip: {
      subscriptionId: subscription.id,
      subscriptionNumber: subscription.number,
      reason,
      details,
    },
  };
}

function addDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const result = civilFromDays(daysFromCivil(year, month, day) + days);
  return `${String(result.year).padStart(4, "0")}-${String(result.month).padStart(2, "0")}-${String(result.day).padStart(2, "0")}`;
}

export function addBillingPeriod(
  date: string,
  period: BillingSubscription["billingPeriod"],
  interval: number,
): string {
  if (period === "daily") return addDays(date, interval);
  if (period === "weekly") return addDays(date, interval * 7);
  const [year, month, day] = date.split("-").map(Number);
  const delta = period === "yearly" ? interval * 12 : interval;
  const absolute = year * 12 + month - 1 + delta;
  const targetYear = Math.floor(absolute / 12);
  const targetMonth = (absolute % 12) + 1;
  const sourceLastDay = monthLength(year, month);
  const lastDay = monthLength(targetYear, targetMonth);
  const targetDay = day === sourceLastDay ? lastDay : Math.min(day, lastDay);
  return `${String(targetYear).padStart(4, "0")}-${String(targetMonth).padStart(2, "0")}-${String(targetDay).padStart(2, "0")}`;
}

function monthLength(year: number, month: number): number {
  if (month === 2) {
    return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

export function daysBetween(start: string, end: string): number {
  const [startYear, startMonth, startDay] = start.split("-").map(Number);
  const [endYear, endMonth, endDay] = end.split("-").map(Number);
  return (
    daysFromCivil(endYear, endMonth, endDay) -
    daysFromCivil(startYear, startMonth, startDay)
  );
}

export function subtractBillingPeriod(
  date: string,
  period: BillingSubscription["billingPeriod"],
  interval: number,
): string {
  if (period === "daily") return addDays(date, -interval);
  if (period === "weekly") return addDays(date, -interval * 7);
  const [year, month, day] = date.split("-").map(Number);
  const delta = period === "yearly" ? interval * 12 : interval;
  const absolute = year * 12 + month - 1 - delta;
  const targetYear = Math.floor(absolute / 12);
  const targetMonth = (((absolute % 12) + 12) % 12) + 1;
  const lastDay =
    targetMonth === 2
      ? targetYear % 4 === 0 &&
        (targetYear % 100 !== 0 || targetYear % 400 === 0)
        ? 29
        : 28
      : [4, 6, 9, 11].includes(targetMonth)
        ? 30
        : 31;
  return `${String(targetYear).padStart(4, "0")}-${String(targetMonth).padStart(2, "0")}-${String(Math.min(day, lastDay)).padStart(2, "0")}`;
}

function daysFromCivil(year: number, month: number, day: number): number {
  const adjustedYear = year - (month <= 2 ? 1 : 0);
  const era = Math.floor(adjustedYear / 400);
  const yearOfEra = adjustedYear - era * 400;
  const shiftedMonth = month + (month > 2 ? -3 : 9);
  const dayOfYear = Math.floor((153 * shiftedMonth + 2) / 5) + day - 1;
  return (
    era * 146097 +
    yearOfEra * 365 +
    Math.floor(yearOfEra / 4) -
    Math.floor(yearOfEra / 100) +
    dayOfYear
  );
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
