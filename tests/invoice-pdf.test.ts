import { describe, expect, it } from "vitest";
import { renderInvoicePdf } from "../src/invoices/invoice.pdf.js";

describe("invoice PDF", () => {
  it("returns a valid PDF document containing invoice totals", () => {
    const pdf = renderInvoicePdf({
      number: "INV-1",
      status: "confirmed",
      customerEmail: "customer@example.test",
      periodStart: "2026-01-01",
      periodEnd: "2026-02-01",
      subtotal: "100.00",
      discountTotal: "10.00",
      taxTotal: "9.00",
      total: "99.00",
      currencyCode: "USD",
      lines: [
        {
          description: "Seats",
          quantity: "2.000",
          unitPrice: "50.00",
          taxAmount: "9.00",
          lineTotal: "99.00",
        },
      ],
    });
    expect(pdf.subarray(0, 8).toString("ascii")).toBe("%PDF-1.4");
    expect(pdf.toString("ascii")).toContain("Total: 99.00 USD");
    expect(pdf.toString("ascii")).toContain("%%EOF");
  });

  it("keeps every line by creating additional pages", () => {
    const pdf = renderInvoicePdf({
      number: "INV-LONG",
      status: "confirmed",
      customerEmail: "customer@example.test",
      periodStart: "2026-01-01",
      periodEnd: "2026-02-01",
      subtotal: "100.00",
      discountTotal: "0.00",
      taxTotal: "0.00",
      total: "100.00",
      currencyCode: "USD",
      lines: Array.from({ length: 60 }, (_value, index) => ({
        description: `Line ${index + 1}`,
        quantity: "1.000",
        unitPrice: "1.00",
        taxAmount: "0.00",
        lineTotal: "1.00",
      })),
    });
    expect(pdf.toString("ascii")).toContain("/Count 2");
    expect(pdf.toString("ascii")).toContain("Line 60");
  });
});
