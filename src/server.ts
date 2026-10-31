import "dotenv/config";
import { createApp } from "./app.js";
import { parseEnvironment } from "./config/env.js";
import { createDatabase } from "./infrastructure/database.js";
import { KnexAuthRepository } from "./auth/auth.repository.js";
import { AuthService } from "./auth/auth.service.js";
import { SessionToken } from "./auth/session-token.js";
import { logger } from "./services/logger.js";
import { systemClock } from "./services/clock.js";
import { KnexCatalogRepository } from "./catalog/catalog.repository.js";
import { CatalogService } from "./catalog/catalog.service.js";
import { KnexSubscriptionRepository } from "./subscriptions/subscription.repository.js";
import { SubscriptionService } from "./subscriptions/subscription.service.js";
import { KnexBillingRepository } from "./billing/billing.repository.js";
import { BillingService } from "./billing/billing.service.js";
import { ReportsRepository } from "./billing/reports.repository.js";
import { ReportsService } from "./billing/reports.service.js";

const environment = parseEnvironment();
const database = createDatabase(environment.DATABASE_URL);
const authService = new AuthService(
  new KnexAuthRepository(database),
  new SessionToken(environment.AUTH_TOKEN_SECRET),
  systemClock,
  environment.RESET_TOKEN_ENCRYPTION_KEY,
  environment.WEB_BASE_URL,
);
const catalogService = new CatalogService(new KnexCatalogRepository(database));
const subscriptionService = new SubscriptionService(
  new KnexSubscriptionRepository(database),
  systemClock,
);
const billingService = new BillingService(
  new KnexBillingRepository(database, systemClock),
  systemClock,
  environment.MARGIN_GUARD_MODE,
);
const reportsService = new ReportsService(new ReportsRepository(database));
const app = createApp({
  authService,
  secureCookies: environment.NODE_ENV === "production",
  catalogService,
  subscriptionService,
  billingService,
  reportsService,
});

app.listen(environment.API_PORT, () => {
  logger.info("Brightloop API listening", { port: environment.API_PORT });
});
