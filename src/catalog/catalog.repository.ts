import type { Knex } from "knex";
import { AppError } from "../errors/app-error.js";
import type {
  CreatePlanInput,
  CreateProductInput,
  CreateQuotationTemplateInput,
  CreateTaxInput,
  UpdateProductInput,
  ProductVariantInput,
} from "./catalog.schemas.js";

export interface PageInput {
  page: number;
  limit: number;
}

export interface PageResult<T> {
  data: T[];
  meta: { page: number; limit: number; total: number };
}

export interface ProductListInput extends PageInput {
  search?: string;
}

export interface CatalogRepository {
  createProduct(input: CreateProductInput): Promise<Record<string, unknown>>;
  updateProduct(
    id: string,
    input: UpdateProductInput,
  ): Promise<Record<string, unknown>>;
  createProductVariant(
    productId: string,
    input: ProductVariantInput,
  ): Promise<Record<string, unknown>>;
  listProducts(input: ProductListInput): Promise<PageResult<unknown>>;
  createPlan(input: CreatePlanInput): Promise<Record<string, unknown>>;
  listPlans(input: PageInput): Promise<PageResult<unknown>>;
  createTax(input: CreateTaxInput): Promise<Record<string, unknown>>;
  listTaxes(input: PageInput): Promise<PageResult<unknown>>;
  createQuotationTemplate(
    input: CreateQuotationTemplateInput,
  ): Promise<Record<string, unknown>>;
  listQuotationTemplates(input: PageInput): Promise<PageResult<unknown>>;
  findTemplate(
    transaction: Knex.Transaction,
    templateId: string,
  ): Promise<Record<string, unknown> | null>;
}

interface ProductRow {
  id: string | number;
  sku: string;
  name: string;
  description: string | null;
  unit_price: string;
  is_active: boolean;
  created_at: Date | string;
  updated_at: Date | string;
}

export class KnexCatalogRepository implements CatalogRepository {
  constructor(private readonly database: Knex) {}

  async createProduct(
    input: CreateProductInput,
  ): Promise<Record<string, unknown>> {
    try {
      return await this.database.transaction(async (transaction) => {
        const [product] = await transaction("products")
          .insert({
            sku: input.sku,
            name: input.name,
            description: input.description ?? null,
            unit_price: input.unitPrice,
            is_active: input.isActive,
          })
          .returning("*");

        if (input.variants.length > 0) {
          await transaction("product_variants").insert(
            input.variants.map((variant) => ({
              product_id: product.id,
              attribute: variant.attribute,
              value: variant.value,
              extra_price: variant.extraPrice,
            })),
          );
        }

        return {
          ...this.productDto(product),
          variants: await this.listVariants(transaction, [String(product.id)]),
        };
      });
    } catch (error) {
      this.throwDatabaseError(error);
    }
  }

  async updateProduct(
    id: string,
    input: UpdateProductInput,
  ): Promise<Record<string, unknown>> {
    const update: Record<string, unknown> = {};
    if (input.sku !== undefined) update.sku = input.sku;
    if (input.name !== undefined) update.name = input.name;
    if (input.description !== undefined) update.description = input.description;
    if (input.unitPrice !== undefined) update.unit_price = input.unitPrice;
    if (input.isActive !== undefined) update.is_active = input.isActive;
    update.updated_at = this.database.fn.now();

    try {
      const [product] = await this.database("products")
        .where({ id })
        .update(update)
        .returning("*");
      if (!product) {
        throw new AppError(404, "PRODUCT_NOT_FOUND", "Product was not found.");
      }
      return {
        ...this.productDto(product),
        variants: await this.listVariants(this.database, [String(product.id)]),
      };
    } catch (error) {
      this.throwDatabaseError(error);
    }
  }

  async createProductVariant(
    productId: string,
    input: ProductVariantInput,
  ): Promise<Record<string, unknown>> {
    try {
      const product = await this.database("products")
        .select("id")
        .where({ id: productId })
        .first();
      if (!product) {
        throw new AppError(404, "PRODUCT_NOT_FOUND", "Product was not found.");
      }
      const [variant] = await this.database("product_variants")
        .insert({
          product_id: productId,
          attribute: input.attribute,
          value: input.value,
          extra_price: input.extraPrice,
        })
        .returning("*");
      return {
        id: String(variant.id),
        productId: String(variant.product_id),
        attribute: variant.attribute,
        value: variant.value,
        extraPrice: String(variant.extra_price),
      };
    } catch (error) {
      this.throwDatabaseError(error);
    }
  }

  async listProducts(input: ProductListInput): Promise<PageResult<unknown>> {
    const query = this.database("products").where({ is_active: true });
    if (input.search) {
      query.where((builder) => {
        builder
          .whereILike("name", `%${input.search}%`)
          .orWhereILike("sku", `%${input.search}%`);
      });
    }

    const countRow = await query
      .clone()
      .count<{ count: string }[]>("id as count")
      .first();
    const rows = await query
      .clone()
      .select("*")
      .orderBy("name", "asc")
      .limit(input.limit)
      .offset((input.page - 1) * input.limit);
    const variants = await this.listVariants(
      this.database,
      rows.map((row) => String(row.id)),
    );
    const variantMap = new Map<string, unknown[]>();
    for (const variant of variants) {
      const key = String((variant as { productId: string }).productId);
      variantMap.set(key, [...(variantMap.get(key) ?? []), variant]);
    }

    return {
      data: rows.map((row) => ({
        ...this.productDto(row),
        variants: variantMap.get(String(row.id)) ?? [],
      })),
      meta: {
        page: input.page,
        limit: input.limit,
        total: Number(countRow?.count ?? 0),
      },
    };
  }

  async createPlan(input: CreatePlanInput): Promise<Record<string, unknown>> {
    try {
      const [plan] = await this.database("plans")
        .insert({
          code: input.code,
          name: input.name,
          description: input.description ?? null,
          billing_period: input.billingPeriod,
          billing_interval: input.billingInterval,
          price: input.price,
          min_qty: input.minQty,
          available_from: input.availableFrom ?? null,
          available_to: input.availableTo ?? null,
          auto_close: input.autoClose,
          closable: input.closable,
          pausable: input.pausable,
          renewable: input.renewable,
          is_active: input.isActive,
        })
        .returning("*");
      return this.planDto(plan);
    } catch (error) {
      this.throwDatabaseError(error);
    }
  }

  async listPlans(input: PageInput): Promise<PageResult<unknown>> {
    return this.listSimple(
      "plans",
      input,
      (query) => query.where({ is_active: true }),
      (row) => this.planDto(row),
    );
  }

  async createTax(input: CreateTaxInput): Promise<Record<string, unknown>> {
    try {
      const [tax] = await this.database("taxes")
        .insert({
          code: input.code,
          name: input.name,
          rate: input.rate,
          is_inclusive: input.isInclusive,
          is_active: input.isActive,
        })
        .returning("*");
      return this.taxDto(tax);
    } catch (error) {
      this.throwDatabaseError(error);
    }
  }

  async listTaxes(input: PageInput): Promise<PageResult<unknown>> {
    return this.listSimple(
      "taxes",
      input,
      (query) => query.where({ is_active: true }),
      (row) => this.taxDto(row),
    );
  }

  async createQuotationTemplate(
    input: CreateQuotationTemplateInput,
  ): Promise<Record<string, unknown>> {
    try {
      return await this.database.transaction(async (transaction) => {
        const [template] = await transaction("quotation_templates")
          .insert({
            name: input.name,
            description: input.description ?? null,
            validity_days: input.validityDays,
            currency_code: input.currencyCode,
            is_active: input.isActive,
          })
          .returning("*");

        const lines: Record<string, unknown>[] = [];
        for (const [index, line] of input.lines.entries()) {
          const unitPrice = await resolveProductUnitPrice(
            transaction,
            line.productId,
            line.variantId,
            line.unitPrice,
          );
          await assertActiveTax(transaction, line.taxId);
          await assertActivePlan(transaction, line.planId);
          lines.push({
            template_id: template.id,
            position: index + 1,
            product_id: line.productId,
            variant_id: line.variantId ?? null,
            plan_id: line.planId ?? null,
            tax_id: line.taxId ?? null,
            description: line.description,
            quantity: line.quantity,
            unit_price: unitPrice,
          });
        }
        await transaction("quotation_template_lines").insert(lines);

        return {
          ...this.templateDto(template),
          lines: await this.getTemplateLines(transaction, String(template.id)),
        };
      });
    } catch (error) {
      this.throwDatabaseError(error);
    }
  }

  async listQuotationTemplates(input: PageInput): Promise<PageResult<unknown>> {
    const query = this.database("quotation_templates").where({
      is_active: true,
    });
    const countRow = await query
      .clone()
      .count<{ count: string }[]>("id as count")
      .first();
    const rows = await query
      .clone()
      .select("*")
      .orderBy("name", "asc")
      .limit(input.limit)
      .offset((input.page - 1) * input.limit);
    const linesByTemplate = await this.getTemplateLinesForIds(
      this.database,
      rows.map((row) => String(row.id)),
    );
    const data = rows.map((row) => ({
      ...this.templateDto(row),
      lines: linesByTemplate.get(String(row.id)) ?? [],
    }));
    return {
      data,
      meta: {
        page: input.page,
        limit: input.limit,
        total: Number(countRow?.count ?? 0),
      },
    };
  }

  async findTemplate(
    transaction: Knex.Transaction,
    templateId: string,
  ): Promise<Record<string, unknown> | null> {
    const row = await transaction("quotation_templates")
      .select("*")
      .where({ id: templateId, is_active: true })
      .first();
    if (!row) {
      return null;
    }
    return {
      ...this.templateDto(row),
      lines: await this.getTemplateLines(transaction, templateId),
    };
  }

  private async listSimple(
    table: "plans" | "taxes",
    input: PageInput,
    filter: (query: Knex.QueryBuilder) => Knex.QueryBuilder,
    map: (row: Record<string, unknown>) => Record<string, unknown>,
  ): Promise<PageResult<unknown>> {
    const query = filter(this.database(table));
    const countRow = await query
      .clone()
      .count<{ count: string }[]>("id as count")
      .first();
    const rows = await query
      .clone()
      .select("*")
      .orderBy("name", "asc")
      .limit(input.limit)
      .offset((input.page - 1) * input.limit);
    return {
      data: rows.map(map),
      meta: {
        page: input.page,
        limit: input.limit,
        total: Number(countRow?.count ?? 0),
      },
    };
  }

  private async listVariants(
    executor: Knex | Knex.Transaction,
    productIds: string[],
  ): Promise<Record<string, unknown>[]> {
    if (productIds.length === 0) {
      return [];
    }
    const rows = await executor("product_variants")
      .select("*")
      .whereIn("product_id", productIds)
      .orderBy(["product_id", "attribute", "value"]);
    return rows.map((row) => ({
      id: String(row.id),
      productId: String(row.product_id),
      attribute: row.attribute,
      value: row.value,
      extraPrice: String(row.extra_price),
    }));
  }

  private async getTemplateLines(
    executor: Knex | Knex.Transaction,
    templateId: string,
  ): Promise<Record<string, unknown>[]> {
    const rows = await executor("quotation_template_lines")
      .select("*")
      .where({ template_id: templateId })
      .orderBy("position");
    return rows.map((row) => ({
      id: String(row.id),
      position: row.position,
      productId: String(row.product_id),
      variantId: row.variant_id === null ? null : String(row.variant_id),
      planId: row.plan_id === null ? null : String(row.plan_id),
      taxId: row.tax_id === null ? null : String(row.tax_id),
      description: row.description,
      quantity: String(row.quantity),
      unitPrice: String(row.unit_price),
    }));
  }

  private async getTemplateLinesForIds(
    executor: Knex | Knex.Transaction,
    templateIds: string[],
  ): Promise<Map<string, Record<string, unknown>[]>> {
    if (templateIds.length === 0) return new Map();
    const rows = await executor("quotation_template_lines")
      .select("*")
      .whereIn("template_id", templateIds)
      .orderBy(["template_id", "position"]);
    const grouped = new Map<string, Record<string, unknown>[]>();
    for (const row of rows) {
      const key = String(row.template_id);
      grouped.set(key, [
        ...(grouped.get(key) ?? []),
        {
          id: String(row.id),
          position: row.position,
          productId: String(row.product_id),
          variantId: row.variant_id === null ? null : String(row.variant_id),
          planId: row.plan_id === null ? null : String(row.plan_id),
          taxId: row.tax_id === null ? null : String(row.tax_id),
          description: row.description,
          quantity: String(row.quantity),
          unitPrice: String(row.unit_price),
        },
      ]);
    }
    return grouped;
  }

  private productDto(row: ProductRow): Record<string, unknown> {
    return {
      id: String(row.id),
      sku: row.sku,
      name: row.name,
      description: row.description,
      unitPrice: String(row.unit_price),
      isActive: row.is_active,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private planDto(row: Record<string, unknown>): Record<string, unknown> {
    return {
      id: String(row.id),
      code: row.code,
      name: row.name,
      description: row.description,
      billingPeriod: row.billing_period,
      billingInterval: row.billing_interval,
      price: String(row.price),
      minQty: row.min_qty,
      availableFrom: row.available_from,
      availableTo: row.available_to,
      autoClose: row.auto_close,
      closable: row.closable,
      pausable: row.pausable,
      renewable: row.renewable,
      isActive: row.is_active,
    };
  }

  private taxDto(row: Record<string, unknown>): Record<string, unknown> {
    return {
      id: String(row.id),
      code: row.code,
      name: row.name,
      rate: String(row.rate),
      isInclusive: row.is_inclusive,
      isActive: row.is_active,
    };
  }

  private templateDto(row: Record<string, unknown>): Record<string, unknown> {
    return {
      id: String(row.id),
      name: row.name,
      description: row.description,
      validityDays: row.validity_days,
      currencyCode: row.currency_code,
      isActive: row.is_active,
    };
  }

  private throwDatabaseError(error: unknown): never {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "23505"
    ) {
      throw new AppError(
        409,
        "DUPLICATE_RESOURCE",
        "A resource with this unique value already exists.",
      );
    }
    throw error;
  }
}

export async function resolveProductUnitPrice(
  executor: Knex | Knex.Transaction,
  productId: string,
  variantId: string | undefined,
  override?: string,
): Promise<string> {
  const product = await executor("products")
    .select("unit_price")
    .where({ id: productId, is_active: true })
    .first();
  if (!product) {
    throw new AppError(
      404,
      "PRODUCT_NOT_FOUND",
      "An active product was not found.",
    );
  }
  let extraPrice = "0.00";
  if (variantId) {
    const variant = await executor("product_variants")
      .select("extra_price")
      .where({ id: variantId, product_id: productId })
      .first();
    if (!variant) {
      throw new AppError(
        404,
        "VARIANT_NOT_FOUND",
        "Product variant was not found.",
      );
    }
    extraPrice = String(variant.extra_price);
  }
  return override ?? addMoney(String(product.unit_price), extraPrice);
}

export async function assertActiveTax(
  executor: Knex | Knex.Transaction,
  taxId: string | undefined,
): Promise<{ rate: string; isInclusive: boolean } | null> {
  if (!taxId) return null;
  const tax = await executor("taxes")
    .select("id", "rate", "is_inclusive")
    .where({ id: taxId, is_active: true })
    .first();
  if (!tax) {
    throw new AppError(404, "TAX_NOT_FOUND", "An active tax was not found.");
  }
  return { rate: String(tax.rate), isInclusive: tax.is_inclusive };
}

export async function assertActivePlan(
  executor: Knex | Knex.Transaction,
  planId: string | undefined,
): Promise<void> {
  if (!planId) return;
  const plan = await executor("plans")
    .select("id")
    .where({ id: planId, is_active: true })
    .first();
  if (!plan) {
    throw new AppError(404, "PLAN_NOT_FOUND", "An active plan was not found.");
  }
}

function addMoney(left: string, right: string): string {
  const toCents = (value: string): bigint => {
    const [whole, fraction = ""] = value.split(".");
    return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  };
  const cents = toCents(left) + toCents(right);
  return `${cents / 100n}.${String(cents % 100n).padStart(2, "0")}`;
}
