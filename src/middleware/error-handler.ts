import type { ErrorRequestHandler, RequestHandler } from "express";
import { AppError } from "../errors/app-error.js";
import { logger } from "../services/logger.js";

export const notFoundHandler: RequestHandler = (_request, _response, next) => {
  next(new AppError(404, "NOT_FOUND", "The requested resource was not found."));
};

export const errorHandler: ErrorRequestHandler = (
  error,
  _request,
  response,
  next,
) => {
  if (response.headersSent) {
    next(error);
    return;
  }

  const normalizedError = isMalformedJsonError(error)
    ? new AppError(400, "INVALID_JSON", "Request body must be valid JSON.")
    : error;

  if (normalizedError instanceof AppError) {
    if (normalizedError.status >= 500) {
      logger.error("Request failed", { code: normalizedError.code });
    }

    response.status(normalizedError.status).json({
      error: {
        code: normalizedError.code,
        message: normalizedError.message,
        details: normalizedError.details,
      },
    });
    return;
  }

  logger.error("Unhandled request error", {
    name: error instanceof Error ? error.name : "UnknownError",
  });

  response.status(500).json({
    error: {
      code: "INTERNAL_SERVER_ERROR",
      message: "An unexpected error occurred.",
      details: [],
    },
  });
};

function isMalformedJsonError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "type" in error &&
    error.type === "entity.parse.failed"
  );
}
