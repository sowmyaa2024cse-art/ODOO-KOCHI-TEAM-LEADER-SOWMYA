import type { RequestHandler, Response } from "express";
import type { AuthService } from "./auth.service.js";
import type {
  CreateStaffInput,
  ForgotPasswordInput,
  LoginInput,
  RegisterInput,
  ResetPasswordInput,
} from "./auth.schemas.js";
import type { AuthActor } from "./auth.types.js";
import { clearAuthCookie, setAuthCookie } from "./auth.middleware.js";

function validatedBody<T>(response: Response): T {
  const validated = response.locals.validated as { body?: unknown } | undefined;
  return validated?.body as T;
}

function currentActor(response: Response): AuthActor {
  return response.locals.authActor as AuthActor;
}

function publicUser<
  T extends {
    id: string;
    email: string;
    role: string;
    customerId: string | null;
  },
>(user: T) {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    customerId: user.customerId,
  };
}

export function createAuthController(
  service: AuthService,
  secureCookies: boolean,
) {
  const register: RequestHandler = async (_request, response, next) => {
    try {
      const user = await service.register(
        validatedBody<RegisterInput>(response),
      );
      response.status(201).json({ data: publicUser(user) });
    } catch (error) {
      next(error);
    }
  };

  const login: RequestHandler = async (_request, response, next) => {
    try {
      const session = await service.login(validatedBody<LoginInput>(response));
      setAuthCookie(response, session.token, secureCookies);
      response.status(200).json({ data: publicUser(session.actor) });
    } catch (error) {
      next(error);
    }
  };

  const logout: RequestHandler = async (_request, response, next) => {
    try {
      await service.logout(currentActor(response));
      clearAuthCookie(response, secureCookies);
      response.status(204).end();
    } catch (error) {
      next(error);
    }
  };

  const me: RequestHandler = (_request, response) => {
    response.status(200).json({ data: publicUser(currentActor(response)) });
  };

  const forgotPassword: RequestHandler = async (_request, response, next) => {
    try {
      await service.forgotPassword(
        validatedBody<ForgotPasswordInput>(response),
      );
      response.status(202).json({
        data: {
          message:
            "If an account exists for that email, password reset instructions will be sent.",
        },
      });
    } catch (error) {
      next(error);
    }
  };

  const resetPassword: RequestHandler = async (_request, response, next) => {
    try {
      await service.resetPassword(validatedBody<ResetPasswordInput>(response));
      clearAuthCookie(response, secureCookies);
      response.status(204).end();
    } catch (error) {
      next(error);
    }
  };

  const createStaff: RequestHandler = async (_request, response, next) => {
    try {
      const user = await service.createStaff(
        validatedBody<CreateStaffInput>(response),
      );
      response.status(201).json({ data: publicUser(user) });
    } catch (error) {
      next(error);
    }
  };

  return {
    register,
    login,
    logout,
    me,
    forgotPassword,
    resetPassword,
    createStaff,
  };
}
