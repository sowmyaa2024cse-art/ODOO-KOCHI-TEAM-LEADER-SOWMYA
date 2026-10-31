import { z } from "zod";

export const reportQuerySchema = z
  .object({
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    customerId: z.string().regex(/^\d+$/).optional(),
    currencyCode: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  })
  .refine((query) => !query.from || !query.to || query.from <= query.to, {
    path: ["to"],
    message: "Must be on or after from.",
  });

export type ReportQuery = z.infer<typeof reportQuerySchema>;

export const createPaymentSchema = z.object({
  method: z.enum(["cash", "bank_transfer", "card", "cheque", "other"]),
  amount: z.string().regex(/^(?:0\.(?:0[1-9]|[1-9]\d)|[1-9]\d{0,9}\.\d{2})$/),
  receivedAt: z.iso.date(),
  note: z.string().trim().max(1000).optional(),
});
