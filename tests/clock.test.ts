import { describe, expect, it } from "vitest";
import { fixedClock } from "../src/services/clock.js";

describe("fixedClock", () => {
  it("returns a fresh date for the configured instant", () => {
    const instant = new Date("2026-01-15T12:00:00.000Z");
    const clock = fixedClock(instant);
    const first = clock.now();

    first.setUTCFullYear(2000);

    expect(clock.now().toISOString()).toBe("2026-01-15T12:00:00.000Z");
    expect(clock.after(60_000).toISOString()).toBe("2026-01-15T12:01:00.000Z");
  });
});
