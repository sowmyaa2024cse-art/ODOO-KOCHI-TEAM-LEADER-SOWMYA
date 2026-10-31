import type { RequestHandler } from "express";
import type { z } from "zod";
import { AppError } from "../errors/app-error.js";

export type RequestTarget = "body" | "params" | "query";

export function validate<T>(
  schema: z.ZodType<T>,
  target: RequestTarget,
): RequestHandler {
  return (request, response, next) => {
    const result = schema.safeParse(request[target]);

    if (!result.success) {
      const details = result.error.issues.map((issue) => {
        const path = issue.path.length > 0 ? issue.path.join(".") : target;
        return `${path}: ${issue.message}`;
      });

      next(
        new AppError(
          422,
          "VALIDATION_ERROR",
          "Request validation failed.",
          details,
        ),
      );
      return;
    }

    response.locals.validated ??= {};
    response.locals.validated[target] = result.data;
    next();
  };
}
