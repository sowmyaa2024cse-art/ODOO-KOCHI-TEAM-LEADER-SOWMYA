import { Router } from "express";
import { requireAuth, requireRoles } from "../auth/auth.middleware.js";
import type { AuthService } from "../auth/auth.service.js";
import { validate } from "../middleware/validate.js";
import {
  createPlanSchema,
  createProductSchema,
  createQuotationTemplateSchema,
  createTaxSchema,
  planListQuerySchema,
  productListQuerySchema,
  subscriptionIdParamsSchema,
  taxListQuerySchema,
  templateListQuerySchema,
  productVariantSchema,
  updateProductSchema,
} from "./catalog.schemas.js";
import { createCatalogController } from "./catalog.controller.js";
import type { CatalogService } from "./catalog.service.js";

export function createCatalogRouter(
  service: CatalogService,
  authService: AuthService,
) {
  const router = Router();
  const controller = createCatalogController(service);
  const authenticated = requireAuth(authService);

  router.get(
    "/products",
    authenticated,
    validate(productListQuerySchema, "query"),
    controller.listProducts,
  );
  router.post(
    "/products",
    authenticated,
    requireRoles("admin", "staff"),
    validate(createProductSchema, "body"),
    controller.createProduct,
  );
  router.patch(
    "/products/:id",
    authenticated,
    requireRoles("admin", "staff"),
    validate(subscriptionIdParamsSchema, "params"),
    validate(updateProductSchema, "body"),
    controller.updateProduct,
  );
  router.post(
    "/products/:id/variants",
    authenticated,
    requireRoles("admin", "staff"),
    validate(subscriptionIdParamsSchema, "params"),
    validate(productVariantSchema, "body"),
    controller.createProductVariant,
  );

  router.get(
    "/plans",
    authenticated,
    validate(planListQuerySchema, "query"),
    controller.listPlans,
  );
  router.post(
    "/plans",
    authenticated,
    requireRoles("admin"),
    validate(createPlanSchema, "body"),
    controller.createPlan,
  );

  router.get(
    "/taxes",
    authenticated,
    validate(taxListQuerySchema, "query"),
    controller.listTaxes,
  );
  router.post(
    "/taxes",
    authenticated,
    requireRoles("admin"),
    validate(createTaxSchema, "body"),
    controller.createTax,
  );

  router.get(
    "/quotation-templates",
    authenticated,
    validate(templateListQuerySchema, "query"),
    controller.listQuotationTemplates,
  );
  router.post(
    "/quotation-templates",
    authenticated,
    requireRoles("admin", "staff"),
    validate(createQuotationTemplateSchema, "body"),
    controller.createQuotationTemplate,
  );

  return router;
}
