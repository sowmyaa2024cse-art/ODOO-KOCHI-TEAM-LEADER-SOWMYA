import { AppError } from "../errors/app-error.js";
import type { AuthActor } from "../auth/auth.types.js";
import type {
  CreateSubscriptionInput,
  TemplateSubscriptionInput,
  UpdateSubscriptionInput,
} from "../catalog/catalog.schemas.js";
import type { Clock } from "../services/clock.js";
import type {
  SubscriptionAction,
  SubscriptionStatus,
} from "./subscription-state-machine.js";
import type {
  SubscriptionListInput,
  SubscriptionRepository,
} from "./subscription.repository.js";

export class SubscriptionService {
  constructor(
    private readonly repository: SubscriptionRepository,
    private readonly clock: Clock,
  ) {}

  create(input: CreateSubscriptionInput, actor: AuthActor) {
    return this.repository.create(input, actor, this.clock.now());
  }

  createFromTemplate(
    templateId: string,
    input: TemplateSubscriptionInput,
    actor: AuthActor,
  ) {
    return this.repository.createFromTemplate(
      templateId,
      input,
      actor,
      this.clock.now(),
    );
  }

  update(id: string, input: UpdateSubscriptionInput, actor: AuthActor) {
    return this.repository.update(id, input, actor, this.clock.now());
  }

  async deleteDraft(id: string, actor: AuthActor): Promise<void> {
    await this.repository.deleteDraft(id, actor, this.clock.now());
  }

  list(input: SubscriptionListInput, actor: AuthActor) {
    return this.repository.list(input, actor);
  }

  find(id: string, actor: AuthActor) {
    return this.repository.find(id, actor);
  }

  transition(id: string, action: SubscriptionAction, actor: AuthActor) {
    if (
      actor.role === "customer" &&
      !["quote", "confirm", "close"].includes(action)
    ) {
      throw new AppError(
        403,
        "FORBIDDEN",
        "Customers cannot perform this subscription action.",
      );
    }

    return this.repository.transition(id, action, actor, this.clock.now());
  }
}

export type { SubscriptionAction, SubscriptionStatus };
