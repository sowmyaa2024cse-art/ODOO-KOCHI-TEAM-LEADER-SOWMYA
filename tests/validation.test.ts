import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { errorHandler } from "../src/middleware/error-handler.js";
import { validate } from "../src/middleware/validate.js";

describe("validate middleware", () => {
  it("rejects invalid input with the standard 422 response", async () => {
    const app = express();
    app.use(express.json());
    app.post(
      "/subscriptions",
      validate(z.object({ customerId: z.string().uuid() }), "body"),
      (_request, response) => response.sendStatus(204),
    );
    app.use(errorHandler);

    const response = await request(app)
      .post("/subscriptions")
      .send({ customerId: "not-a-uuid" });

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(response.body.error.details).toEqual(
      expect.arrayContaining([expect.stringContaining("customerId")]),
    );
  });

  it("makes parsed, validated data available to route handlers", async () => {
    const app = express();
    app.use(express.json());
    app.post(
      "/subscriptions",
      validate(z.object({ customerId: z.string().trim() }), "body"),
      (_request, response) => response.json(response.locals.validated.body),
    );
    app.use(errorHandler);

    const response = await request(app)
      .post("/subscriptions")
      .send({ customerId: " customer-1 " });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ customerId: "customer-1" });
  });
});
