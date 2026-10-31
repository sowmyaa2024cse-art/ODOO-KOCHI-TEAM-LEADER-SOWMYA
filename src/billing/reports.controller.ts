import type { RequestHandler, Response } from "express";
import type { ReportsService } from "./reports.service.js";
import type { ReportQuery } from "./report.schemas.js";

function query(response: Response): ReportQuery {
  const validated = response.locals.validated as
    Record<string, unknown> | undefined;
  return validated?.query as ReportQuery;
}

export function createReportsController(service: ReportsService) {
  const respond =
    (action: (input: ReportQuery) => Promise<unknown>): RequestHandler =>
    async (_request, response, next) => {
      try {
        response.status(200).json(await action(query(response)));
      } catch (error) {
        next(error);
      }
    };

  return {
    summary: respond((input) => service.summary(input)),
    mrr: respond((input) => service.mrr(input)),
    overdue: respond((input) => service.overdue(input)),
    revenue: respond((input) => service.revenue(input)),
  };
}
