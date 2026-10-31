import type { RequestHandler, Response } from "express";
import type { CatalogService } from "./catalog.service.js";
import type { ProductListInput } from "./catalog.repository.js";
import type {
  CreatePlanInput,
  CreateProductInput,
  CreateQuotationTemplateInput,
  CreateTaxInput,
  ProductVariantInput,
  UpdateProductInput,
} from "./catalog.schemas.js";

function validated<T>(
  response: Response,
  target: "body" | "params" | "query",
): T {
  const data = response.locals.validated as Record<string, unknown> | undefined;
  return data?.[target] as T;
}

function listResponse(result: { data: unknown[]; meta: object }) {
  return { data: result.data, meta: result.meta };
}

export function createCatalogController(service: CatalogService) {
  const createProduct: RequestHandler = async (_request, response, next) => {
    try {
      const data = await service.createProduct(
        validated<CreateProductInput>(response, "body"),
      );
      response.status(201).json({ data });
    } catch (error) {
      next(error);
    }
  };

  const updateProduct: RequestHandler = async (_request, response, next) => {
    try {
      const { id } = validated<{ id: string }>(response, "params");
      const data = await service.updateProduct(
        id,
        validated<UpdateProductInput>(response, "body"),
      );
      response.status(200).json({ data });
    } catch (error) {
      next(error);
    }
  };

  const createProductVariant: RequestHandler = async (
    _request,
    response,
    next,
  ) => {
    try {
      const { id } = validated<{ id: string }>(response, "params");
      const data = await service.createProductVariant(
        id,
        validated<ProductVariantInput>(response, "body"),
      );
      response.status(201).json({ data });
    } catch (error) {
      next(error);
    }
  };

  const listProducts: RequestHandler = async (_request, response, next) => {
    try {
      response.json(
        listResponse(
          await service.listProducts(
            validated<ProductListInput>(response, "query"),
          ),
        ),
      );
    } catch (error) {
      next(error);
    }
  };

  const createPlan: RequestHandler = async (_request, response, next) => {
    try {
      const data = await service.createPlan(
        validated<CreatePlanInput>(response, "body"),
      );
      response.status(201).json({ data });
    } catch (error) {
      next(error);
    }
  };

  const listPlans: RequestHandler = async (_request, response, next) => {
    try {
      response.json(
        listResponse(
          await service.listPlans(
            validated<{ page: number; limit: number }>(response, "query"),
          ),
        ),
      );
    } catch (error) {
      next(error);
    }
  };

  const createTax: RequestHandler = async (_request, response, next) => {
    try {
      const data = await service.createTax(
        validated<CreateTaxInput>(response, "body"),
      );
      response.status(201).json({ data });
    } catch (error) {
      next(error);
    }
  };

  const listTaxes: RequestHandler = async (_request, response, next) => {
    try {
      response.json(
        listResponse(
          await service.listTaxes(
            validated<{ page: number; limit: number }>(response, "query"),
          ),
        ),
      );
    } catch (error) {
      next(error);
    }
  };

  const createQuotationTemplate: RequestHandler = async (
    _request,
    response,
    next,
  ) => {
    try {
      const data = await service.createQuotationTemplate(
        validated<CreateQuotationTemplateInput>(response, "body"),
      );
      response.status(201).json({ data });
    } catch (error) {
      next(error);
    }
  };

  const listQuotationTemplates: RequestHandler = async (
    _request,
    response,
    next,
  ) => {
    try {
      response.json(
        listResponse(
          await service.listQuotationTemplates(
            validated<{ page: number; limit: number }>(response, "query"),
          ),
        ),
      );
    } catch (error) {
      next(error);
    }
  };

  return {
    createProduct,
    updateProduct,
    createProductVariant,
    listProducts,
    createPlan,
    listPlans,
    createTax,
    listTaxes,
    createQuotationTemplate,
    listQuotationTemplates,
  };
}
