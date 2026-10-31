import type { RequestHandler, Response } from "express";
import type { AuthActor } from "../auth/auth.types.js";
import type {
  CreateSubscriptionInput,
  TemplateSubscriptionInput,
  UpdateSubscriptionInput,
} from "../catalog/catalog.schemas.js";
import type { SubscriptionService } from "./subscription.service.js";
import type {
  SubscriptionAction,
  SubscriptionStatus,
} from "./subscription-state-machine.js";

function validated<T>(
  response: Response,
  target: "body" | "params" | "query",
): T {
  const data = response.locals.validated as Record<string, unknown> | undefined;
  return data?.[target] as T;
}

function actor(response: Response): AuthActor {
  return response.locals.authActor as AuthActor;
}

export function createSubscriptionController(service: SubscriptionService) {
  const create: RequestHandler = async (_request, response, next) => {
    try {
      const data = await service.create(
        validated<CreateSubscriptionInput>(response, "body"),
        actor(response),
      );
      response.status(201).json({ data });
    } catch (error) {
      next(error);
    }
  };

  const list: RequestHandler = async (_request, response, next) => {
    try {
      const result = await service.list(
        validated<{
          page: number;
          limit: number;
          status?: SubscriptionStatus;
          customerId?: string;
        }>(response, "query"),
        actor(response),
      );
      response.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  const find: RequestHandler = async (_request, response, next) => {
    try {
      const { id } = validated<{ id: string }>(response, "params");
      const data = await service.find(id, actor(response));
      response.status(200).json({ data });
    } catch (error) {
      next(error);
    }
  };

  const update: RequestHandler = async (_request, response, next) => {
    try {
      const { id } = validated<{ id: string }>(response, "params");
      const data = await service.update(
        id,
        validated<UpdateSubscriptionInput>(response, "body"),
        actor(response),
      );
      response.status(200).json({ data });
    } catch (error) {
      next(error);
    }
  };

  const remove: RequestHandler = async (_request, response, next) => {
    try {
      const { id } = validated<{ id: string }>(response, "params");
      await service.deleteDraft(id, actor(response));
      response.status(204).end();
    } catch (error) {
      next(error);
    }
  };

  const createFromTemplate: RequestHandler = async (
    _request,
    response,
    next,
  ) => {
    try {
      const { templateId } = validated<{ templateId: string }>(
        response,
        "params",
      );
      const data = await service.createFromTemplate(
        templateId,
        validated<TemplateSubscriptionInput>(response, "body"),
        actor(response),
      );
      response.status(201).json({ data });
    } catch (error) {
      next(error);
    }
  };

  const transition =
    (action: SubscriptionAction): RequestHandler =>
    async (_request, response, next) => {
      try {
        const { id } = validated<{ id: string }>(response, "params");
        const data = await service.transition(id, action, actor(response));
        response.status(200).json({ data });
      } catch (error) {
        next(error);
      }
    };

  return {
    create,
    list,
    find,
    update,
    remove,
    createFromTemplate,
    quote: transition("quote"),
    confirm: transition("confirm"),
    activate: transition("activate"),
    pause: transition("pause"),
    renew: transition("renew"),
    close: transition("close"),
  };
}
