import { z } from "zod";

const moneySchema = z
  .string()
  .regex(
    /^(0|[1-9]\d{0,9})(\.\d{1,2})?$/,
    "Must be a non-negative decimal amount.",
  );
const quantitySchema = z
  .string()
  .regex(/^[1-9]\d{0,8}(\.\d{1,3})?$/, "Must be a positive quantity.");
const idSchema = z.string().regex(/^\d+$/);
const currencySchema = z.string().regex(/^[A-Z]{3}$/);

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const productVariantSchema = z.object({
  attribute: z.string().trim().min(1).max(100),
  value: z.string().trim().min(1).max(200),
  extraPrice: moneySchema.default("0.00"),
});

export const createProductSchema = z.object({
  sku: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(200),
  description: z.string().max(10_000).optional(),
  unitPrice: moneySchema,
  isActive: z.boolean().default(true),
  variants: z.array(productVariantSchema).max(100).default([]),
});

export const updateProductSchema = createProductSchema
  .omit({ variants: true })
  .partial();

export const createPlanSchema = z
  .object({
    code: z.string().trim().min(1).max(80),
    name: z.string().trim().min(1).max(200),
    description: z.string().max(10_000).optional(),
    billingPeriod: z.enum(["daily", "weekly", "monthly", "yearly"]),
    billingInterval: z.number().int().positive().max(2147483647).default(1),
    price: moneySchema,
    minQty: z.number().int().positive().max(2147483647).default(1),
    availableFrom: z.iso.date().optional(),
    availableTo: z.iso.date().optional(),
    autoClose: z.boolean().default(false),
    closable: z.boolean().default(true),
    pausable: z.boolean().default(false),
    renewable: z.boolean().default(true),
    isActive: z.boolean().default(true),
  })
  .refine(
    (plan) =>
      !plan.availableFrom ||
      !plan.availableTo ||
      plan.availableTo >= plan.availableFrom,
    {
      path: ["availableTo"],
      message: "Must be on or after availableFrom.",
    },
  );

export const createTaxSchema = z.object({
  code: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(200),
  rate: z.string().regex(/^(0|[1-9]\d?)(\.\d{1,2})?$|^100(\.0{1,2})?$/),
  isInclusive: z.boolean().default(false),
  isActive: z.boolean().default(true),
});

const templateLineSchema = z.object({
  productId: idSchema,
  variantId: idSchema.optional(),
  planId: idSchema.optional(),
  taxId: idSchema.optional(),
  description: z.string().trim().min(1).max(500),
  quantity: quantitySchema.default("1"),
  unitPrice: moneySchema.optional(),
});

export const createQuotationTemplateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().max(10_000).optional(),
  validityDays: z.number().int().positive().max(3650),
  currencyCode: currencySchema.default("USD"),
  isActive: z.boolean().default(true),
  lines: z.array(templateLineSchema).min(1).max(100),
});

export const createSubscriptionSchema = z.object({
  customerId: idSchema.optional(),
  planId: idSchema,
  currencyCode: currencySchema.default("USD"),
  lines: z
    .array(
      z.object({
        productId: idSchema,
        variantId: idSchema.optional(),
        taxId: idSchema.optional(),
        description: z.string().trim().min(1).max(500),
        quantity: quantitySchema,
        unitPrice: moneySchema.optional(),
      }),
    )
    .min(1)
    .max(100),
});

export const updateSubscriptionSchema = z.object({
  planId: idSchema,
  currencyCode: currencySchema,
  lines: createSubscriptionSchema.shape.lines,
});

export const templateSubscriptionSchema = z.object({
  customerId: idSchema.optional(),
  planId: idSchema.optional(),
});

export const subscriptionIdParamsSchema = z.object({
  id: idSchema,
});

export const templateIdParamsSchema = z.object({
  templateId: idSchema,
});

export const subscriptionListQuerySchema = paginationSchema.extend({
  status: z
    .enum(["draft", "quotation", "confirmed", "active", "paused", "closed"])
    .optional(),
  customerId: idSchema.optional(),
});

export const productListQuerySchema = paginationSchema.extend({
  search: z.string().trim().max(100).optional(),
});

export const planListQuerySchema = paginationSchema;
export const taxListQuerySchema = paginationSchema;
export const templateListQuerySchema = paginationSchema;

export type CreateProductInput = z.infer<typeof createProductSchema>;
export type ProductVariantInput = z.infer<typeof productVariantSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
export type CreatePlanInput = z.infer<typeof createPlanSchema>;
export type CreateTaxInput = z.infer<typeof createTaxSchema>;
export type CreateQuotationTemplateInput = z.infer<
  typeof createQuotationTemplateSchema
>;
export type CreateSubscriptionInput = z.infer<typeof createSubscriptionSchema>;
export type UpdateSubscriptionInput = z.infer<typeof updateSubscriptionSchema>;
export type TemplateSubscriptionInput = z.infer<
  typeof templateSubscriptionSchema
>;
