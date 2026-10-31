import { describe, expect, it } from "vitest";
import {
  idempotencyKeySchema,
  prorationBodySchema,
} from "../src/billing/billing.schemas.js";
import {
  createPaymentSchema,
  reportQuerySchema,
} from "../src/billing/report.schemas.js";

describe("billing request schemas", () => {
  it.each(["0.001", "0.5", "1", "25.125", "999999999.999"])(
    "accepts positive NUMERIC quantity %s",
    (quantity) => {
      expect(prorationBodySchema.safeParse({ quantity }).success).toBe(true);
    },
  );

  it.each(["0", "0.000", "-1", "1.0000", "1000000000"])(
    "rejects invalid quantity %s",
    (quantity) => {
      expect(prorationBodySchema.safeParse({ quantity }).success).toBe(false);
    },
  );

  it("accepts bounded, safe idempotency keys", () => {
    expect(idempotencyKeySchema.safeParse("billing-run:retry_01").success).toBe(
      true,
    );
    expect(idempotencyKeySchema.safeParse("short").success).toBe(false);
    expect(idempotencyKeySchema.safeParse("unsafe key value").success).toBe(
      false,
    );
  });

  it("validates positive payments and report filters", () => {
    expect(
      createPaymentSchema.safeParse({
        method: "card",
        amount: "0.01",
        receivedAt: "2026-10-31",
        note: "Paid online",
      }).success,
    ).toBe(true);
    expect(
      createPaymentSchema.safeParse({
        method: "card",
        amount: "0.00",
        receivedAt: "2026-10-31",
      }).success,
    ).toBe(false);
    expect(
      reportQuerySchema.safeParse({
        from: "2026-11-01",
        to: "2026-10-31",
      }).success,
    ).toBe(false);
    expect(
      reportQuerySchema.safeParse({
        from: "2026-10-01",
        to: "2026-10-31",
        customerId: "123",
        currencyCode: "USD",
        page: "2",
        limit: "50",
      }).success,
    ).toBe(true);
  });
});
