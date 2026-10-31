import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { AppError } from "../errors/app-error.js";
import { validate } from "../middleware/validate.js";
import { createAuthController } from "./auth.controller.js";
import {
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
} from "./auth.schemas.js";
import type { AuthService } from "./auth.service.js";
import { requireAuth } from "./auth.middleware.js";

export interface AuthRateLimitOptions {
  login?: { windowMs: number; limit: number };
  reset?: { windowMs: number; limit: number };
}

function createRateLimiter(windowMs: number, limit: number) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_request, _response, next) => {
      next(
        new AppError(
          429,
          "RATE_LIMITED",
          "Too many attempts. Please try again later.",
        ),
      );
    },
  });
}

export function createAuthRouter(
  service: AuthService,
  secureCookies: boolean,
  rateLimits: AuthRateLimitOptions = {},
) {
  const router = Router();
  const controller = createAuthController(service, secureCookies);
  const loginLimiter = createRateLimiter(
    rateLimits.login?.windowMs ?? 15 * 60 * 1000,
    rateLimits.login?.limit ?? 10,
  );
  const resetLimiter = createRateLimiter(
    rateLimits.reset?.windowMs ?? 60 * 60 * 1000,
    rateLimits.reset?.limit ?? 5,
  );
  const authenticated = requireAuth(service);

  router.post(
    "/register",
    validate(registerSchema, "body"),
    controller.register,
  );
  router.post(
    "/login",
    loginLimiter,
    validate(loginSchema, "body"),
    controller.login,
  );
  router.post("/logout", authenticated, controller.logout);
  router.get("/me", authenticated, controller.me);
  router.post(
    "/forgot-password",
    resetLimiter,
    validate(forgotPasswordSchema, "body"),
    controller.forgotPassword,
  );
  router.post(
    "/reset-password",
    resetLimiter,
    validate(resetPasswordSchema, "body"),
    controller.resetPassword,
  );

  return router;
}
