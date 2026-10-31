import { AppError } from "../errors/app-error.js";
import { decimalToMinorUnits } from "./money.js";

export function invoiceStatusAfterPayment(
  currentStatus: string,
  amountPaid: string,
  total: string,
  dueDate: string,
  asOf: string,
): "paid" | "partially_paid" | "overdue" {
  const paidMinor = decimalToMinorUnits(amountPaid, 2);
  const totalMinor = decimalToMinorUnits(total, 2);
  if (paidMinor > totalMinor) {
    throw new AppError(
      422,
      "PAYMENT_EXCEEDS_BALANCE",
      "Payment amount exceeds the invoice balance.",
    );
  }
  if (paidMinor === totalMinor) return "paid";
  if (currentStatus === "overdue" || asOf > dueDate) return "overdue";
  return "partially_paid";
}
