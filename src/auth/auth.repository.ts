import type { Knex } from "knex";
import { AppError } from "../errors/app-error.js";
import type { AuthSessionUser, AuthUser, UserRole } from "./auth.types.js";

interface DatabaseUser {
  id: string;
  email: string;
  role: UserRole;
  password_hash: string;
  customer_id: string | null;
}

export interface AuthRepository {
  findByEmail(email: string): Promise<AuthSessionUser | null>;
  createCustomer(
    email: string,
    passwordHash: string,
    fullName: string,
    companyName: string | undefined,
  ): Promise<AuthUser>;
  createStaff(email: string, passwordHash: string): Promise<AuthUser>;
  createSession(
    sessionId: string,
    userId: string,
    createdAt: Date,
    expiresAt: Date,
  ): Promise<void>;
  findSessionUser(sessionId: string, now: Date): Promise<AuthUser | null>;
  revokeSession(sessionId: string, now: Date): Promise<void>;
  revokeUserSessions(userId: string, now: Date): Promise<void>;
  queuePasswordReset(
    userId: string,
    tokenHash: string,
    expiresAt: Date,
    recipient: string,
    encryptedToken: {
      ciphertext: string;
      iv: string;
      authTag: string;
    },
    webBaseUrl: string,
  ): Promise<void>;
  resetPassword(
    tokenHash: string,
    now: Date,
    passwordHash: string,
  ): Promise<boolean>;
}

export class KnexAuthRepository implements AuthRepository {
  constructor(private readonly database: Knex) {}

  async findByEmail(email: string): Promise<AuthSessionUser | null> {
    const row = await this.database<DatabaseUser>("users")
      .leftJoin("customers", "customers.user_id", "users.id")
      .select(
        "users.id",
        "users.email",
        "users.role",
        "users.password_hash",
        "customers.id as customer_id",
      )
      .where("users.email", email)
      .first();
    return row ? this.toSessionUser(row) : null;
  }

  async createCustomer(
    email: string,
    passwordHash: string,
    fullName: string,
    companyName: string | undefined,
  ): Promise<AuthUser> {
    return this.database.transaction(async (transaction) => {
      try {
        const [user] = await transaction("users")
          .insert({ email, password_hash: passwordHash, role: "customer" })
          .returning(["id", "email", "role"]);
        const [customer] = await transaction("customers")
          .insert({
            user_id: user.id,
            full_name: fullName,
            company_name: companyName ?? null,
          })
          .returning(["id"]);
        return {
          id: String(user.id),
          email: user.email,
          role: user.role,
          customerId: String(customer.id),
        };
      } catch (error) {
        this.throwUniqueEmailConflict(error);
      }
    });
  }

  async createStaff(email: string, passwordHash: string): Promise<AuthUser> {
    try {
      const [user] = await this.database("users")
        .insert({ email, password_hash: passwordHash, role: "staff" })
        .returning(["id", "email", "role"]);
      return {
        id: String(user.id),
        email: user.email,
        role: user.role,
        customerId: null,
      };
    } catch (error) {
      this.throwUniqueEmailConflict(error);
    }
  }

  async createSession(
    sessionId: string,
    userId: string,
    createdAt: Date,
    expiresAt: Date,
  ): Promise<void> {
    await this.database("auth_sessions").insert({
      session_id: sessionId,
      user_id: userId,
      created_at: createdAt,
      expires_at: expiresAt,
    });
  }

  async findSessionUser(
    sessionId: string,
    now: Date,
  ): Promise<AuthUser | null> {
    const row = await this.database<DatabaseUser>("auth_sessions")
      .join("users", "users.id", "auth_sessions.user_id")
      .leftJoin("customers", "customers.user_id", "users.id")
      .select(
        "users.id",
        "users.email",
        "users.role",
        "users.password_hash",
        "customers.id as customer_id",
      )
      .where("auth_sessions.session_id", sessionId)
      .whereNull("auth_sessions.revoked_at")
      .where("auth_sessions.expires_at", ">", now)
      .first();
    return row ? this.toUser(row) : null;
  }

  async revokeSession(sessionId: string, now: Date): Promise<void> {
    await this.database("auth_sessions")
      .where({ session_id: sessionId })
      .whereNull("revoked_at")
      .update({ revoked_at: now });
  }

  async revokeUserSessions(userId: string, now: Date): Promise<void> {
    await this.database("auth_sessions")
      .where({ user_id: userId })
      .whereNull("revoked_at")
      .update({ revoked_at: now });
  }

  async queuePasswordReset(
    userId: string,
    tokenHash: string,
    expiresAt: Date,
    recipient: string,
    encryptedToken: {
      ciphertext: string;
      iv: string;
      authTag: string;
    },
    webBaseUrl: string,
  ): Promise<void> {
    await this.database.transaction(async (transaction) => {
      await transaction("users").where({ id: userId }).update({
        reset_token_hash: tokenHash,
        reset_expires: expiresAt,
        updated_at: this.database.fn.now(),
      });
      await transaction("email_outbox").insert({
        recipient,
        template_key: "password-reset",
        payload: {
          reset_url: `${webBaseUrl.replace(/\/$/, "")}/reset-password`,
          token_ciphertext: encryptedToken.ciphertext,
          token_iv: encryptedToken.iv,
          token_auth_tag: encryptedToken.authTag,
        },
      });
    });
  }

  async resetPassword(
    tokenHash: string,
    now: Date,
    passwordHash: string,
  ): Promise<boolean> {
    return this.database.transaction(async (transaction) => {
      const user = await transaction("users")
        .select("id")
        .where({ reset_token_hash: tokenHash })
        .where("reset_expires", ">", now)
        .forUpdate()
        .first();
      if (!user) {
        return false;
      }

      await transaction("users")
        .where({ id: user.id, reset_token_hash: tokenHash })
        .update({
          password_hash: passwordHash,
          reset_token_hash: null,
          reset_expires: null,
          updated_at: now,
        });
      await transaction("auth_sessions")
        .where({ user_id: user.id })
        .whereNull("revoked_at")
        .update({ revoked_at: now });
      return true;
    });
  }

  private toSessionUser(row: DatabaseUser): AuthSessionUser {
    return {
      ...this.toUser(row),
      passwordHash: row.password_hash,
    };
  }

  private toUser(row: DatabaseUser): AuthUser {
    return {
      id: String(row.id),
      email: row.email,
      role: row.role,
      customerId: row.customer_id === null ? null : String(row.customer_id),
    };
  }

  private throwUniqueEmailConflict(error: unknown): never {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "23505"
    ) {
      throw new AppError(
        409,
        "EMAIL_IN_USE",
        "An account with this email already exists.",
      );
    }
    throw error;
  }
}
