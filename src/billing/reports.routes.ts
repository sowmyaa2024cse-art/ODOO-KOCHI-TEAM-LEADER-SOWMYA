import { Router } from "express";
import type { AuthService } from "../auth/auth.service.js";
import { requireAuth, requireRoles } from "../auth/auth.middleware.js";
import { validate } from "../middleware/validate.js";
import { createReportsController } from "./reports.controller.js";
import type { ReportsService } from "./reports.service.js";
import { reportQuerySchema } from "./report.schemas.js";

export function createReportsRouter(
  service: ReportsService,
  authService: AuthService,
) {
  const router = Router();
  const controller = createReportsController(service);
  const authenticated = requireAuth(authService);
  const financeStaff = requireRoles("admin", "staff");
  const reportQuery = [
    authenticated,
    financeStaff,
    validate(reportQuerySchema, "query"),
  ];

  router.get("/reports/summary", ...reportQuery, controller.summary);
  router.get("/reports/mrr", ...reportQuery, controller.mrr);
  router.get("/reports/overdue", ...reportQuery, controller.overdue);
  router.get("/reports/revenue", ...reportQuery, controller.revenue);
  return router;
}
