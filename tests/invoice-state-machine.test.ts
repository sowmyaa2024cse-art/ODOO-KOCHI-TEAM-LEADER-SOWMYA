import { describe, expect, it } from "vitest";
import {
  transitionInvoice,
  type InvoiceAction,
  type InvoiceStatus,
} from "../src/invoices/invoice-state-machine.js";

describe("invoice state machine", () => {
  it.each([
    ["draft", "confirm", "confirmed"],
    ["confirmed", "mark_paid", "paid"],
    ["draft", "cancel", "cancelled"],
    ["confirmed", "cancel", "cancelled"],
  ] as const)("transitions %s with %s to %s", (status, action, next) => {
    expect(
      transitionInvoice(status as InvoiceStatus, action as InvoiceAction),
    ).toBe(next);
  });

  it.each([
    ["paid", "cancel"],
    ["cancelled", "confirm"],
    ["draft", "mark_paid"],
  ] as const)("rejects %s with %s", (status, action) => {
    expect(() =>
      transitionInvoice(status as InvoiceStatus, action as InvoiceAction),
    ).toThrowError(
      expect.objectContaining({
        status: 409,
        code: "INVALID_INVOICE_TRANSITION",
      }),
    );
  });
});
