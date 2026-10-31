import { jwtVerify, SignJWT } from "jose";
import { AppError } from "../errors/app-error.js";
import type { SessionClaims } from "./auth.types.js";

export class SessionToken {
  private readonly secret: Uint8Array;

  constructor(secret: string) {
    this.secret = new TextEncoder().encode(secret);
  }

  sign(claims: SessionClaims, issuedAt: number): Promise<string> {
    return new SignJWT({ sid: claims.sessionId })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setIssuer("brightloop")
      .setAudience("brightloop-api")
      .setSubject(claims.userId)
      .setIssuedAt(issuedAt)
      .setExpirationTime(claims.expiresAt)
      .sign(this.secret);
  }

  async verify(token: string, now: Date): Promise<SessionClaims> {
    try {
      const { payload } = await jwtVerify(token, this.secret, {
        algorithms: ["HS256"],
        issuer: "brightloop",
        audience: "brightloop-api",
        currentDate: now,
      });

      if (
        typeof payload.sid !== "string" ||
        typeof payload.sub !== "string" ||
        typeof payload.exp !== "number"
      ) {
        throw this.invalidToken();
      }

      return {
        sessionId: payload.sid,
        userId: payload.sub,
        expiresAt: payload.exp,
      };
    } catch {
      throw this.invalidToken();
    }
  }

  private invalidToken(): AppError {
    return new AppError(401, "UNAUTHENTICATED", "Authentication is required.");
  }
}
