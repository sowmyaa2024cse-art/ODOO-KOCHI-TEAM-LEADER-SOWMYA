import { AppError } from "../errors/app-error.js";

export type InvoiceStatus =
  | "draft"
  | "confirmed"
  | "paid"
  | "cancelled"
  | "issued"
  | "partially_paid"
  | "overdue"
  | "void";

export type InvoiceAction = "confirm" | "mark_paid" | "cancel";

const transitions: Record<
  InvoiceAction,
  (status: InvoiceStatus) => InvoiceStatus | null
> = {
  confirm: (status) => (status === "draft" ? "confirmed" : null),
  mark_paid: (status) => (status === "confirmed" ? "paid" : null),
  cancel: (status) =>
    status === "draft" || status === "confirmed" ? "cancelled" : null,
};

export function transitionInvoice(
  status: InvoiceStatus,
  action: InvoiceAction,
): InvoiceStatus {
  const nextStatus = transitions[action](status);
  if (!nextStatus) {
    throw new AppError(
      409,
      "INVALID_INVOICE_TRANSITION",
      `Cannot ${action} a ${status} invoice.`,
    );
  }
  return nextStatus;
}
