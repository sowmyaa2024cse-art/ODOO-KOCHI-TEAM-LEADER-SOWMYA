import type {
  CatalogRepository,
  PageInput,
  ProductListInput,
} from "./catalog.repository.js";
import type {
  CreatePlanInput,
  CreateProductInput,
  CreateQuotationTemplateInput,
  CreateTaxInput,
  ProductVariantInput,
  UpdateProductInput,
} from "./catalog.schemas.js";

export class CatalogService {
  constructor(private readonly repository: CatalogRepository) {}

  createProduct(input: CreateProductInput) {
    return this.repository.createProduct(input);
  }

  updateProduct(id: string, input: UpdateProductInput) {
    return this.repository.updateProduct(id, input);
  }

  createProductVariant(id: string, input: ProductVariantInput) {
    return this.repository.createProductVariant(id, input);
  }

  listProducts(input: ProductListInput) {
    return this.repository.listProducts(input);
  }

  createPlan(input: CreatePlanInput) {
    return this.repository.createPlan(input);
  }

  listPlans(input: PageInput) {
    return this.repository.listPlans(input);
  }

  createTax(input: CreateTaxInput) {
    return this.repository.createTax(input);
  }

  listTaxes(input: PageInput) {
    return this.repository.listTaxes(input);
  }

  createQuotationTemplate(input: CreateQuotationTemplateInput) {
    return this.repository.createQuotationTemplate(input);
  }

  listQuotationTemplates(input: PageInput) {
    return this.repository.listQuotationTemplates(input);
  }
}
