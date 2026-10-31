import type { RequestHandler } from "express";
import { AppError } from "../errors/app-error.js";
import type { AuthService } from "./auth.service.js";
import type { AuthActor, UserRole } from "./auth.types.js";

export const authCookieName = "brightloop_session";

export function requireAuth(service: AuthService): RequestHandler {
  return async (request, response, next) => {
    try {
      const token = readCookie(request.headers.cookie, authCookieName);
      if (!token) {
        throw new AppError(
          401,
          "UNAUTHENTICATED",
          "Authentication is required.",
        );
      }
      response.locals.authActor = await service.authenticate(token);
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function requireRoles(...roles: UserRole[]): RequestHandler {
  return (_request, response, next) => {
    const actor = response.locals.authActor as AuthActor | undefined;
    if (!actor) {
      next(new AppError(401, "UNAUTHENTICATED", "Authentication is required."));
      return;
    }
    if (!roles.includes(actor.role)) {
      next(
        new AppError(
          403,
          "FORBIDDEN",
          "You do not have permission to perform this action.",
        ),
      );
      return;
    }
    next();
  };
}

export function readCookie(
  cookieHeader: string | undefined,
  name: string,
): string | null {
  if (!cookieHeader) {
    return null;
  }

  for (const cookie of cookieHeader.split(";")) {
    const separator = cookie.indexOf("=");
    if (separator < 0 || cookie.slice(0, separator).trim() !== name) {
      continue;
    }
    const value = cookie.slice(separator + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return null;
    }
  }
  return null;
}

export function setAuthCookie(
  response: { append: (field: string, value: string) => unknown },
  token: string,
  secure: boolean,
): void {
  const attributes = [
    `${authCookieName}=${encodeURIComponent(token)}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    "Max-Age=900",
  ];
  if (secure) {
    attributes.push("Secure");
  }
  response.append("Set-Cookie", attributes.join("; "));
}

export function clearAuthCookie(
  response: { append: (field: string, value: string) => unknown },
  secure: boolean,
): void {
  const attributes = [
    `${authCookieName}=`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    "Max-Age=0",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
  ];
  if (secure) {
    attributes.push("Secure");
  }
  response.append("Set-Cookie", attributes.join("; "));
}
