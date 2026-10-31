import { Router } from "express";
import type { AuthService } from "../auth/auth.service.js";
import { requireAuth, requireRoles } from "../auth/auth.middleware.js";
import { validate } from "../middleware/validate.js";
import { validateHeader } from "../middleware/validate-header.js";
import type { BillingService } from "./billing.service.js";
import {
  billingPreviewSchema,
  billingRunSchema,
  idempotencyKeySchema,
  invoiceIdParamsSchema,
  prorationBodySchema,
  prorationParamsSchema,
} from "./billing.schemas.js";
import { createPaymentSchema } from "./report.schemas.js";
import { createBillingController } from "./billing.controller.js";

export function createBillingRouter(
  service: BillingService,
  authService: AuthService,
) {
  const router = Router();
  const controller = createBillingController(service);
  const authenticated = requireAuth(authService);
  const financeStaff = requireRoles("admin", "staff");
  const idempotencyKey = validateHeader(
    "Idempotency-Key",
    idempotencyKeySchema,
    "idempotency-key",
  );

  router.get("/events", authenticated, controller.events);
  router.post(
    "/invoices/:id/payments",
    authenticated,
    financeStaff,
    validate(invoiceIdParamsSchema, "params"),
    validate(createPaymentSchema, "body"),
    controller.payment,
  );
  router.post(
    "/billing/preview",
    authenticated,
    financeStaff,
    validate(billingPreviewSchema, "body"),
    controller.preview,
  );
  router.post(
    "/billing/run",
    authenticated,
    financeStaff,
    validate(billingRunSchema, "body"),
    idempotencyKey,
    controller.run,
  );
  router.post(
    "/subscriptions/:id/lines/:lineId/proration",
    authenticated,
    validate(prorationParamsSchema, "params"),
    validate(prorationBodySchema, "body"),
    idempotencyKey,
    controller.proration,
  );
  router.post(
    "/invoices/:id/confirm",
    authenticated,
    financeStaff,
    validate(invoiceIdParamsSchema, "params"),
    controller.confirm,
  );
  router.post(
    "/invoices/:id/mark-paid",
    authenticated,
    financeStaff,
    validate(invoiceIdParamsSchema, "params"),
    controller.markPaid,
  );
  router.post(
    "/invoices/:id/cancel",
    authenticated,
    financeStaff,
    validate(invoiceIdParamsSchema, "params"),
    controller.cancel,
  );
  router.post(
    "/invoices/:id/send",
    authenticated,
    financeStaff,
    validate(invoiceIdParamsSchema, "params"),
    controller.send,
  );
  router.get(
    "/invoices/:id/pdf",
    authenticated,
    validate(invoiceIdParamsSchema, "params"),
    controller.pdf,
  );

  return router;
}
