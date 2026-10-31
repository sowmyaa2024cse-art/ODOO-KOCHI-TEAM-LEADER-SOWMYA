import { AppError } from "../errors/app-error.js";

export type SubscriptionStatus =
  "draft" | "quotation" | "confirmed" | "active" | "paused" | "closed";

export type SubscriptionAction =
  "quote" | "confirm" | "activate" | "pause" | "renew" | "close";

export interface SubscriptionTransitionContext {
  closable: boolean;
  pausable: boolean;
  renewable: boolean;
}

const transitions: Record<
  SubscriptionAction,
  (
    status: SubscriptionStatus,
    context: SubscriptionTransitionContext,
  ) => boolean
> = {
  quote: (status) => status === "draft",
  confirm: (status) => status === "quotation",
  activate: (status) => status === "confirmed" || status === "paused",
  pause: (status, context) => status === "active" && context.pausable,
  renew: (status, context) => status === "closed" && context.renewable,
  close: (status, context) => status !== "closed" && context.closable,
};

const nextStatus: Record<SubscriptionAction, SubscriptionStatus> = {
  quote: "quotation",
  confirm: "confirmed",
  activate: "active",
  pause: "paused",
  renew: "active",
  close: "closed",
};

export function transitionSubscription(
  status: SubscriptionStatus,
  action: SubscriptionAction,
  context: SubscriptionTransitionContext,
): SubscriptionStatus {
  if (!transitions[action](status, context)) {
    throw new AppError(
      409,
      "INVALID_SUBSCRIPTION_TRANSITION",
      `Cannot ${action} a ${status} subscription.`,
    );
  }
  return nextStatus[action];
}
