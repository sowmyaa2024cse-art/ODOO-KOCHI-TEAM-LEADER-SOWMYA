import { Router } from "express";
import { validate } from "../middleware/validate.js";
import { createAuthController } from "../auth/auth.controller.js";
import { createStaffSchema } from "../auth/auth.schemas.js";
import type { AuthService } from "../auth/auth.service.js";
import { requireAuth, requireRoles } from "../auth/auth.middleware.js";

export { scopeCustomerQuery } from "../auth/customer-scope.js";

export function createUsersRouter(
  service: AuthService,
  secureCookies: boolean,
) {
  const router = Router();
  const controller = createAuthController(service, secureCookies);

  router.post(
    "/",
    requireAuth(service),
    requireRoles("admin"),
    validate(createStaffSchema, "body"),
    controller.createStaff,
  );

  return router;
}
