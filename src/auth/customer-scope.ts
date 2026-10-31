import type { Knex } from "knex";
import { AppError } from "../errors/app-error.js";
import type { AuthActor } from "./auth.types.js";

export function scopeCustomerQuery<TRecord extends object, TResult>(
  query: Knex.QueryBuilder<TRecord, TResult>,
  actor: AuthActor,
): Knex.QueryBuilder<TRecord, TResult> {
  if (actor.role !== "customer") {
    return query;
  }
  if (!actor.customerId) {
    throw new AppError(
      403,
      "CUSTOMER_PROFILE_REQUIRED",
      "Customer access is unavailable.",
    );
  }

  return query.where("customer_id", actor.customerId);
}
