import { randomBytes, randomUUID } from "node:crypto";
import { AppError } from "../errors/app-error.js";
import type { Clock } from "../services/clock.js";
import type { AuthRepository } from "./auth.repository.js";
import type {
  CreateStaffInput,
  ForgotPasswordInput,
  LoginInput,
  RegisterInput,
  ResetPasswordInput,
} from "./auth.schemas.js";
import { hashPassword, verifyPassword } from "./password.js";
import { encryptResetToken, hashResetToken } from "./reset-token.js";
import type { SessionToken } from "./session-token.js";
import type { AuthActor, AuthSessionUser, AuthUser } from "./auth.types.js";

const sessionLifetimeMs = 15 * 60 * 1000;
const resetLifetimeMs = 60 * 60 * 1000;

export interface AuthenticatedSession {
  actor: AuthActor;
  token: string;
  expiresAt: Date;
}

export class AuthService {
  constructor(
    private readonly repository: AuthRepository,
    private readonly tokenManager: SessionToken,
    private readonly clock: Clock,
    private readonly resetEncryptionKey: string,
    private readonly webBaseUrl: string,
  ) {}

  async register(input: RegisterInput): Promise<AuthUser> {
    const passwordHash = await hashPassword(input.password);
    return this.repository.createCustomer(
      input.email,
      passwordHash,
      input.fullName,
      input.companyName,
    );
  }

  async login(input: LoginInput): Promise<AuthenticatedSession> {
    const user = await this.repository.findByEmail(input.email);
    const matches = await verifyPassword(
      input.password,
      user?.passwordHash ?? null,
    );
    if (!user || !matches) {
      throw new AppError(
        401,
        "INVALID_CREDENTIALS",
        "Email or password is incorrect.",
      );
    }

    return this.createSession(user);
  }

  async logout(actor: AuthActor): Promise<void> {
    await this.repository.revokeSession(actor.sessionId, this.clock.now());
  }

  async authenticate(token: string): Promise<AuthActor> {
    const now = this.clock.now();
    const claims = await this.tokenManager.verify(token, now);
    const user = await this.repository.findSessionUser(claims.sessionId, now);
    if (!user || user.id !== claims.userId) {
      throw new AppError(401, "UNAUTHENTICATED", "Authentication is required.");
    }

    return { ...user, sessionId: claims.sessionId };
  }

  async forgotPassword(input: ForgotPasswordInput): Promise<void> {
    const user = await this.repository.findByEmail(input.email);
    if (!user) {
      return;
    }

    const token = randomBytes(32).toString("base64url");
    const encryptedToken = encryptResetToken(token, this.resetEncryptionKey);
    const expiresAt = new Date(this.clock.now().getTime() + resetLifetimeMs);
    await this.repository.queuePasswordReset(
      user.id,
      hashResetToken(token),
      expiresAt,
      user.email,
      encryptedToken,
      this.webBaseUrl,
    );
  }

  async resetPassword(input: ResetPasswordInput): Promise<void> {
    const passwordHash = await hashPassword(input.password);
    const updated = await this.repository.resetPassword(
      hashResetToken(input.token),
      this.clock.now(),
      passwordHash,
    );
    if (!updated) {
      throw new AppError(
        400,
        "INVALID_RESET_TOKEN",
        "The password reset link is invalid or has expired.",
      );
    }
  }

  async createStaff(input: CreateStaffInput): Promise<AuthUser> {
    const passwordHash = await hashPassword(input.password);
    return this.repository.createStaff(input.email, passwordHash);
  }

  private async createSession(
    user: AuthSessionUser,
  ): Promise<AuthenticatedSession> {
    const now = this.clock.now();
    const expiresAt = new Date(now.getTime() + sessionLifetimeMs);
    const sessionId = randomUUID();
    const claimsExpiresAt = Math.floor(expiresAt.getTime() / 1000);
    await this.repository.createSession(
      sessionId,
      user.id,
      now,
      new Date(claimsExpiresAt * 1000),
    );

    return {
      actor: {
        id: user.id,
        email: user.email,
        role: user.role,
        customerId: user.customerId,
        sessionId,
      },
      token: await this.tokenManager.sign(
        { sessionId, userId: user.id, expiresAt: claimsExpiresAt },
        Math.floor(now.getTime() / 1000),
      ),
      expiresAt: new Date(claimsExpiresAt * 1000),
    };
  }
}
