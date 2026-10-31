import { describe, expect, it } from "vitest";
import { invoiceStatusAfterPayment } from "../src/billing/payment-status.js";

describe("invoice payment status", () => {
  it("marks the invoice paid only after the balance is covered", () => {
    expect(
      invoiceStatusAfterPayment(
        "confirmed",
        "99.99",
        "100.00",
        "2026-11-01",
        "2026-10-31",
      ),
    ).toBe("partially_paid");
    expect(
      invoiceStatusAfterPayment(
        "partially_paid",
        "100.00",
        "100.00",
        "2026-11-01",
        "2026-10-31",
      ),
    ).toBe("paid");
  });

  it("keeps an unpaid overdue invoice overdue and rejects overpayment", () => {
    expect(
      invoiceStatusAfterPayment(
        "overdue",
        "50.00",
        "100.00",
        "2026-10-01",
        "2026-10-31",
      ),
    ).toBe("overdue");
    expect(() =>
      invoiceStatusAfterPayment(
        "confirmed",
        "100.01",
        "100.00",
        "2026-11-01",
        "2026-10-31",
      ),
    ).toThrowError(
      expect.objectContaining({ code: "PAYMENT_EXCEEDS_BALANCE" }),
    );
  });
});
