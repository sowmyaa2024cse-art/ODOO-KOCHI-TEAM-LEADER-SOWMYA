import { describe, expect, it } from "vitest";
import {
  addBillingPeriod,
  calculateProration,
  calculateInvoice,
  type BillingDiscount,
  type BillingSubscription,
} from "../src/billing/billing.calculator.js";

const subscription: BillingSubscription = {
  id: "1",
  number: "SUB-1",
  customerId: "2",
  customerEmail: "customer@example.test",
  planId: "3",
  currencyCode: "USD",
  billingPeriod: "monthly",
  billingInterval: 1,
  nextBillingDate: "2026-01-31",
  autoClose: false,
  planAvailableTo: null,
  planAvailable: true,
  lines: [
    {
      productId: "4",
      variantId: null,
      description: "Seats",
      quantity: "2.000",
      unitPrice: "50.00",
      taxName: "VAT",
      taxRate: "10.00",
      taxInclusive: false,
      costPrice: "20.00",
    },
  ],
};

const percentDiscount: BillingDiscount = {
  id: "8",
  code: "SAVE10",
  name: "Ten percent",
  type: "percent",
  value: "10.00",
  minPurchase: "0.00",
  minQty: 1,
  startsAt: null,
  endsAt: null,
  usageLimit: null,
  usedCount: 0,
  scope: "all",
  productIds: [],
  planIds: [],
};

describe("billing calculator", () => {
  it("calculates decimal-safe tax, discounts, totals, and clamped monthly periods", () => {
    expect(addBillingPeriod("2026-02-28", "monthly", 1)).toBe("2026-03-31");
    const result = calculateInvoice(
      subscription,
      [percentDiscount],
      new Date("2026-01-31T12:00:00.000Z"),
      "warn",
    );

    expect(result.kind).toBe("invoice");
    if (result.kind !== "invoice") return;
    expect(result.invoice).toMatchObject({
      periodStart: "2026-01-31",
      periodEnd: "2026-02-28",
      subtotal: "100.00",
      discountTotal: "10.00",
      taxTotal: "9.00",
      total: "99.00",
    });
    expect(result.invoice.lines[0]).toMatchObject({
      discountAmount: "10.00",
      taxAmount: "9.00",
      lineTotal: "99.00",
    });

    const inclusive = calculateInvoice(
      {
        ...subscription,
        lines: [
          {
            ...subscription.lines[0],
            unitPrice: "55.00",
            taxInclusive: true,
          },
        ],
      },
      [percentDiscount],
      new Date("2026-01-31T12:00:00.000Z"),
      "warn",
    );
    expect(inclusive).toMatchObject({
      kind: "invoice",
      invoice: {
        subtotal: "100.00",
        discountTotal: "10.00",
        taxTotal: "9.00",
        total: "99.00",
      },
    });
    if (inclusive.kind === "invoice") {
      expect(inclusive.invoice.lines[0]).toMatchObject({
        discountAmount: "11.00",
        taxAmount: "9.00",
        lineTotal: "99.00",
      });
    }
  });

  it("warns or blocks when a discount reduces a line below its cost", () => {
    const expensiveDiscount = { ...percentDiscount, value: "90.00" };
    const warning = calculateInvoice(
      subscription,
      [expensiveDiscount],
      new Date("2026-01-31T12:00:00.000Z"),
      "warn",
    );
    expect(warning.kind).toBe("invoice");
    if (warning.kind === "invoice") {
      expect(warning.invoice.marginWarnings).toHaveLength(1);
    }

    const blocked = calculateInvoice(
      subscription,
      [expensiveDiscount],
      new Date("2026-01-31T12:00:00.000Z"),
      "block",
    );
    expect(blocked).toMatchObject({
      kind: "skip",
      skip: { reason: "margin_below_cost" },
    });
  });

  it("reports unavailable plans and exhausted discounts", () => {
    expect(
      calculateInvoice(
        { ...subscription, planAvailable: false },
        [],
        new Date("2026-01-31T12:00:00.000Z"),
        "warn",
      ),
    ).toMatchObject({ kind: "skip", skip: { reason: "plan_unavailable" } });

    const exhausted = { ...percentDiscount, usageLimit: 1, usedCount: 1 };
    const result = calculateInvoice(
      subscription,
      [exhausted],
      new Date("2026-01-31T12:00:00.000Z"),
      "warn",
    );
    expect(result.kind).toBe("invoice");
    if (result.kind === "invoice") {
      expect(result.invoice.discounts).toEqual([]);
    }
  });

  it("calculates prorated seat increases and decreases as charges and credits", () => {
    const increase = calculateProration({
      currentQuantity: "2.000",
      targetQuantity: "3.000",
      unitPrice: "30.00",
      taxRate: "10.00",
      taxInclusive: false,
      periodStart: "2026-01-01",
      periodEnd: "2026-02-01",
      asOf: "2026-01-16",
    });
    expect(increase).toMatchObject({
      kind: "charge",
      quantityDelta: "1.000",
      unitPrice: "15.48",
      taxAmount: "1.55",
      subtotal: "15.48",
      total: "17.03",
    });

    const decrease = calculateProration({
      currentQuantity: "3.000",
      targetQuantity: "2.500",
      unitPrice: "30.00",
      taxRate: "10.00",
      taxInclusive: false,
      periodStart: "2026-01-01",
      periodEnd: "2026-02-01",
      asOf: "2026-01-16",
    });
    expect(decrease).toMatchObject({
      kind: "credit",
      quantityDelta: "0.500",
      unitPrice: "7.74",
      taxAmount: "-0.77",
      subtotal: "-7.74",
      total: "-8.51",
    });

    const inclusiveDecrease = calculateProration({
      currentQuantity: "2.000",
      targetQuantity: "1.000",
      unitPrice: "110.00",
      taxRate: "10.00",
      taxInclusive: true,
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31",
      asOf: "2026-01-16",
    });
    expect(inclusiveDecrease).toMatchObject({
      kind: "credit",
      unitPrice: "55.00",
      taxAmount: "-5.00",
      subtotal: "-50.00",
      total: "-55.00",
    });
  });
});
