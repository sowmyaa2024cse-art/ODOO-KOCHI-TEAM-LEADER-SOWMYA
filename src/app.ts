import express from "express";
import { errorHandler, notFoundHandler } from "./middleware/error-handler.js";
import { healthRouter } from "./routes/health.routes.js";
import type { AuthService } from "./auth/auth.service.js";
import { createAuthRouter } from "./auth/auth.routes.js";
import type { AuthRateLimitOptions } from "./auth/auth.routes.js";
import { createUsersRouter } from "./users/users.routes.js";
import type { CatalogService } from "./catalog/catalog.service.js";
import { createCatalogRouter } from "./catalog/catalog.routes.js";
import type { SubscriptionService } from "./subscriptions/subscription.service.js";
import { createSubscriptionRouter } from "./subscriptions/subscription.routes.js";
import type { BillingService } from "./billing/billing.service.js";
import { createBillingRouter } from "./billing/billing.routes.js";
import type { ReportsService } from "./billing/reports.service.js";
import { createReportsRouter } from "./billing/reports.routes.js";

export interface AppOptions {
  authService?: AuthService;
  secureCookies?: boolean;
  authRateLimits?: AuthRateLimitOptions;
  catalogService?: CatalogService;
  subscriptionService?: SubscriptionService;
  billingService?: BillingService;
  reportsService?: ReportsService;
}

export function createApp(options: AppOptions = {}) {
  const app = express();

  app.use(express.json());
  app.use("/api/health", healthRouter);
  if (options.authService) {
    const secureCookies = options.secureCookies ?? false;
    app.use(
      "/api/auth",
      createAuthRouter(
        options.authService,
        secureCookies,
        options.authRateLimits,
      ),
    );
    app.use(
      "/api/users",
      createUsersRouter(options.authService, secureCookies),
    );
    if (options.catalogService) {
      app.use(
        "/api",
        createCatalogRouter(options.catalogService, options.authService),
      );
    }
    if (options.subscriptionService) {
      app.use(
        "/api/subscriptions",
        createSubscriptionRouter(
          options.subscriptionService,
          options.authService,
        ),
      );
    }
    if (options.billingService) {
      app.use(
        "/api",
        createBillingRouter(options.billingService, options.authService),
      );
    }
    if (options.reportsService) {
      app.use(
        "/api",
        createReportsRouter(options.reportsService, options.authService),
      );
    }
  }
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
