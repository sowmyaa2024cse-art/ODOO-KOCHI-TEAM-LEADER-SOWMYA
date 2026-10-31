import type { ReportQuery } from "./report.schemas.js";
import type { ReportsRepository } from "./reports.repository.js";

export class ReportsService {
  constructor(private readonly repository: ReportsRepository) {}

  summary(query: ReportQuery) {
    return this.repository.summary(query);
  }

  mrr(query: ReportQuery) {
    return this.repository.mrr(query);
  }

  overdue(query: ReportQuery) {
    return this.repository.overdue(query);
  }

  revenue(query: ReportQuery) {
    return this.repository.revenue(query);
  }
}
