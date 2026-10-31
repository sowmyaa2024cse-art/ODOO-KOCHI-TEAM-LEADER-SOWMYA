import type { RequestHandler } from "express";
import type { z } from "zod";
import { AppError } from "../errors/app-error.js";

export function validateHeader<T>(
  name: string,
  schema: z.ZodType<T>,
  localName: string,
): RequestHandler {
  return (request, response, next) => {
    const result = schema.safeParse(request.get(name));
    if (!result.success) {
      next(
        new AppError(
          422,
          "VALIDATION_ERROR",
          "Request validation failed.",
          result.error.issues.map((issue) => `${name}: ${issue.message}`),
        ),
      );
      return;
    }

    response.locals.validated ??= {};
    response.locals.validated[localName] = result.data;
    next();
  };
}
