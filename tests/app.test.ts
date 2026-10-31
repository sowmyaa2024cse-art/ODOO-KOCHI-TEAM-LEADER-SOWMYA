import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";

describe("HTTP foundation", () => {
  it("returns a successful health response", async () => {
    const response = await request(createApp()).get("/api/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ data: { status: "ok" } });
  });

  it("uses the standard error shape for unknown routes", async () => {
    const response = await request(createApp()).get("/api/missing");

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: {
        code: "NOT_FOUND",
        message: "The requested resource was not found.",
        details: [],
      },
    });
  });

  it("reports malformed JSON as a client error", async () => {
    const response = await request(createApp())
      .post("/api/health")
      .set("Content-Type", "application/json")
      .send('{"');

    expect(response.status).toBe(400);
    expect(response.body.error).toEqual({
      code: "INVALID_JSON",
      message: "Request body must be valid JSON.",
      details: [],
    });
  });
});
