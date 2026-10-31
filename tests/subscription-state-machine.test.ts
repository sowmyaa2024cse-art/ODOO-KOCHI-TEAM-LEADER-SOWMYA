import { describe, expect, it } from "vitest";
import { AppError } from "../src/errors/app-error.js";
import {
  transitionSubscription,
  type SubscriptionAction,
  type SubscriptionStatus,
} from "../src/subscriptions/subscription-state-machine.js";

const permissivePlan = {
  closable: true,
  pausable: true,
  renewable: true,
};

describe("subscription state machine", () => {
  it.each([
    ["draft", "quote", "quotation"],
    ["quotation", "confirm", "confirmed"],
    ["confirmed", "activate", "active"],
    ["active", "pause", "paused"],
    ["paused", "activate", "active"],
    ["active", "close", "closed"],
    ["closed", "renew", "active"],
    ["draft", "close", "closed"],
  ] as const)("%s can %s to %s", (status, action, nextStatus) => {
    expect(
      transitionSubscription(
        status as SubscriptionStatus,
        action as SubscriptionAction,
        permissivePlan,
      ),
    ).toBe(nextStatus);
  });

  it.each([
    ["draft", "activate"],
    ["quotation", "activate"],
    ["active", "confirm"],
    ["closed", "close"],
  ] as const)(
    "rejects invalid transition %s -> %s with 409",
    (status, action) => {
      try {
        transitionSubscription(
          status as SubscriptionStatus,
          action as SubscriptionAction,
          permissivePlan,
        );
        throw new Error("Expected an invalid transition error.");
      } catch (error) {
        expect(error).toBeInstanceOf(AppError);
        expect(error).toMatchObject({
          status: 409,
          code: "INVALID_SUBSCRIPTION_TRANSITION",
        });
      }
    },
  );

  it.each([
    ["pause", "active", { ...permissivePlan, pausable: false }],
    ["close", "active", { ...permissivePlan, closable: false }],
    ["renew", "closed", { ...permissivePlan, renewable: false }],
  ] as const)("honors plan policy for %s", (action, status, plan) => {
    expect(() => transitionSubscription(status, action, plan)).toThrowError(
      expect.objectContaining({
        status: 409,
        code: "INVALID_SUBSCRIPTION_TRANSITION",
      }),
    );
  });
});
