import { Router } from "express";
import type { AuthService } from "../auth/auth.service.js";
import { requireAuth } from "../auth/auth.middleware.js";
import {
  createSubscriptionSchema,
  subscriptionIdParamsSchema,
  subscriptionListQuerySchema,
  templateIdParamsSchema,
  templateSubscriptionSchema,
  updateSubscriptionSchema,
} from "../catalog/catalog.schemas.js";
import { validate } from "../middleware/validate.js";
import type { SubscriptionService } from "./subscription.service.js";
import { createSubscriptionController } from "./subscription.controller.js";

export function createSubscriptionRouter(
  service: SubscriptionService,
  authService: AuthService,
) {
  const router = Router();
  const controller = createSubscriptionController(service);
  const authenticated = requireAuth(authService);

  router.get(
    "/",
    authenticated,
    validate(subscriptionListQuerySchema, "query"),
    controller.list,
  );
  router.post(
    "/",
    authenticated,
    validate(createSubscriptionSchema, "body"),
    controller.create,
  );
  router.post(
    "/from-template/:templateId",
    authenticated,
    validate(templateIdParamsSchema, "params"),
    validate(templateSubscriptionSchema, "body"),
    controller.createFromTemplate,
  );
  router.get(
    "/:id",
    authenticated,
    validate(subscriptionIdParamsSchema, "params"),
    controller.find,
  );
  router.put(
    "/:id",
    authenticated,
    validate(subscriptionIdParamsSchema, "params"),
    validate(updateSubscriptionSchema, "body"),
    controller.update,
  );
  router.delete(
    "/:id",
    authenticated,
    validate(subscriptionIdParamsSchema, "params"),
    controller.remove,
  );

  for (const action of [
    "quote",
    "confirm",
    "activate",
    "pause",
    "renew",
    "close",
  ] as const) {
    router.post(
      `/:id/${action}`,
      authenticated,
      validate(subscriptionIdParamsSchema, "params"),
      controller[action],
    );
  }

  return router;
}
