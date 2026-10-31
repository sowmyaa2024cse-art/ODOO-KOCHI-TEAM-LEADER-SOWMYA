import { describe, expect, it } from "vitest";
import {
  addBillingPeriod,
  addDays,
} from "../src/subscriptions/subscription.repository.js";

describe("subscription calendar dates", () => {
  it("adds daily and weekly billing periods without timezone rollover", () => {
    expect(addBillingPeriod("2026-10-31", "daily", 1)).toBe("2026-11-01");
    expect(addBillingPeriod("2026-10-31", "weekly", 2)).toBe("2026-11-14");
  });

  it("clamps monthly billing dates to the last day of the target month", () => {
    expect(addBillingPeriod("2026-01-31", "monthly", 1)).toBe("2026-02-28");
    expect(addBillingPeriod("2024-01-31", "monthly", 1)).toBe("2024-02-29");
  });

  it("handles yearly leap-day billing and quote-validity day arithmetic", () => {
    expect(addBillingPeriod("2024-02-29", "yearly", 1)).toBe("2025-02-28");
    expect(addDays("2026-12-31", 30)).toBe("2027-01-30");
  });
});
