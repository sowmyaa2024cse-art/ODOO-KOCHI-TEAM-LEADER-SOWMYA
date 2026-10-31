import { z } from "zod";

export const billingPreviewSchema = z
  .object({})
  .strict()
  .optional()
  .default({});
export const billingRunSchema = z.object({}).strict().optional().default({});

export const idempotencyKeySchema = z
  .string()
  .trim()
  .min(8)
  .max(255)
  .regex(/^[A-Za-z0-9._:-]+$/);

export const invoiceIdParamsSchema = z.object({
  id: z.string().regex(/^\d+$/),
});

export const prorationParamsSchema = z.object({
  id: z.string().regex(/^\d+$/),
  lineId: z.string().regex(/^\d+$/),
});

export const prorationBodySchema = z.object({
  quantity: z
    .string()
    .regex(
      /^(?:0\.(?:00[1-9]|0[1-9]\d|[1-9]\d{0,2})|[1-9]\d{0,8}(?:\.\d{1,3})?)$/,
    ),
});
