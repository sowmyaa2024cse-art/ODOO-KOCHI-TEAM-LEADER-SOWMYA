import { describe, expect, it } from "vitest";
import knex from "knex";
import { AppError } from "../src/errors/app-error.js";
import { createApp } from "../src/app.js";
import type { AuthRepository } from "../src/auth/auth.repository.js";
import { AuthService } from "../src/auth/auth.service.js";
import type {
  AuthSessionUser,
  AuthUser,
  UserRole,
} from "../src/auth/auth.types.js";
import { decryptResetToken, hashResetToken } from "../src/auth/reset-token.js";
import { SessionToken } from "../src/auth/session-token.js";
import { fixedClock } from "../src/services/clock.js";
import { hashPassword, verifyPassword } from "../src/auth/password.js";
import { scopeCustomerQuery } from "../src/auth/customer-scope.js";
import { parseEnvironment } from "../src/config/env.js";
import request from "supertest";

const authSecret = "phase-two-test-auth-secret-0123456789";
const resetEncryptionKey =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const now = new Date("2026-10-31T12:00:00.000Z");
const validPassword = "Brightloop!2026";

class MemoryAuthRepository implements AuthRepository {
  readonly users = new Map<string, AuthSessionUser>();
  readonly customerCompanies = new Map<string, string | undefined>();
  readonly sessions = new Map<
    string,
    {
      userId: string;
      createdAt: Date;
      expiresAt: Date;
      revokedAt: Date | null;
    }
  >();
  readonly resetTokens = new Map<string, { userId: string; expiresAt: Date }>();
  readonly outbox: Array<{
    recipient: string;
    encryptedToken: { ciphertext: string; iv: string; authTag: string };
    webBaseUrl: string;
  }> = [];
  private nextId = 1;

  async seedUser(
    email: string,
    role: UserRole,
    customerId: string | null = null,
    password = validPassword,
  ): Promise<AuthUser> {
    const user = {
      id: String(this.nextId++),
      email,
      role,
      customerId,
      passwordHash: await hashPassword(password),
    };
    this.users.set(email, user);
    return {
      id: user.id,
      email,
      role,
      customerId,
    };
  }

  async findByEmail(email: string): Promise<AuthSessionUser | null> {
    return this.users.get(email) ?? null;
  }

  async createCustomer(
    email: string,
    passwordHash: string,
    fullName: string,
    companyName: string | undefined,
  ): Promise<AuthUser> {
    if (this.users.has(email)) {
      throw new AppError(
        409,
        "EMAIL_IN_USE",
        "An account with this email already exists.",
      );
    }
    if (!fullName.trim()) {
      throw new Error("Customer name is required.");
    }
    const user: AuthSessionUser = {
      id: String(this.nextId++),
      email,
      role: "customer",
      customerId: String(this.nextId++),
      passwordHash,
    };
    this.users.set(email, user);
    this.customerCompanies.set(user.id, companyName);
    return {
      id: user.id,
      email,
      role: user.role,
      customerId: user.customerId,
    };
  }

  async createStaff(email: string, passwordHash: string): Promise<AuthUser> {
    if (this.users.has(email)) {
      throw new AppError(
        409,
        "EMAIL_IN_USE",
        "An account with this email already exists.",
      );
    }
    const user: AuthSessionUser = {
      id: String(this.nextId++),
      email,
      role: "staff",
      customerId: null,
      passwordHash,
    };
    this.users.set(email, user);
    return {
      id: user.id,
      email,
      role: user.role,
      customerId: null,
    };
  }

  async createSession(
    sessionId: string,
    userId: string,
    createdAt: Date,
    expiresAt: Date,
  ): Promise<void> {
    this.sessions.set(sessionId, {
      userId,
      createdAt,
      expiresAt,
      revokedAt: null,
    });
  }

  async findSessionUser(sessionId: string, at: Date): Promise<AuthUser | null> {
    const session = this.sessions.get(sessionId);
    if (!session || session.revokedAt || session.expiresAt <= at) {
      return null;
    }
    const user = [...this.users.values()].find(
      (candidate) => candidate.id === session.userId,
    );
    return user
      ? {
          id: user.id,
          email: user.email,
          role: user.role,
          customerId: user.customerId,
        }
      : null;
  }

  async revokeSession(sessionId: string, at: Date): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.revokedAt = at;
    }
  }

  async revokeUserSessions(userId: string, at: Date): Promise<void> {
    for (const session of this.sessions.values()) {
      if (session.userId === userId && !session.revokedAt) {
        session.revokedAt = at;
      }
    }
  }

  async queuePasswordReset(
    userId: string,
    tokenHash: string,
    expiresAt: Date,
    recipient: string,
    encryptedToken: { ciphertext: string; iv: string; authTag: string },
    webBaseUrl: string,
  ): Promise<void> {
    this.resetTokens.set(tokenHash, { userId, expiresAt });
    this.outbox.push({ recipient, encryptedToken, webBaseUrl });
  }

  async resetPassword(
    tokenHash: string,
    at: Date,
    passwordHash: string,
  ): Promise<boolean> {
    const reset = this.resetTokens.get(tokenHash);
    if (!reset || reset.expiresAt <= at) {
      return false;
    }
    const user = [...this.users.values()].find(
      (candidate) => candidate.id === reset.userId,
    );
    if (!user) {
      return false;
    }
    user.passwordHash = passwordHash;
    this.resetTokens.delete(tokenHash);
    await this.revokeUserSessions(user.id, at);
    return true;
  }
}

function createService(repository = new MemoryAuthRepository()) {
  const service = new AuthService(
    repository,
    new SessionToken(authSecret),
    fixedClock(now),
    resetEncryptionKey,
    "http://localhost:4173",
  );
  return { repository, service };
}

function firstCookie(response: request.Response): string {
  const header: unknown = response.headers["set-cookie"];
  const value = Array.isArray(header) ? header[0] : header;
  if (typeof value !== "string") {
    throw new Error("Expected an auth session cookie.");
  }
  return value;
}

describe("authentication", () => {
  it("rejects scaffold auth secrets in production", () => {
    expect(() =>
      parseEnvironment({
        NODE_ENV: "production",
        DATABASE_URL:
          "postgresql://brightloop:secret@localhost:5432/brightloop",
        AUTH_TOKEN_SECRET: "replace-with-at-least-32-random-characters",
        RESET_TOKEN_ENCRYPTION_KEY:
          "0000000000000000000000000000000000000000000000000000000000000000",
      }),
    ).toThrow(/Production requires a generated/);
  });

  it("registers customers with a hashed password and rejects weak passwords", async () => {
    const { repository, service } = createService();
    const invalid = await request(createApp({ authService: service }))
      .post("/api/auth/register")
      .send({
        email: "customer@example.test",
        password: "weakpassword",
        fullName: "Example Customer",
      });

    expect(invalid.status).toBe(422);
    const response = await request(createApp({ authService: service }))
      .post("/api/auth/register")
      .send({
        email: " Customer@Example.Test ",
        password: validPassword,
        fullName: "Example Customer",
      });

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({
      email: "customer@example.test",
      role: "customer",
    });
    const user = repository.users.get("customer@example.test");
    expect(user?.passwordHash).not.toBe(validPassword);
    expect(
      await verifyPassword(validPassword, user?.passwordHash ?? null),
    ).toBe(true);

    const duplicate = await request(createApp({ authService: service }))
      .post("/api/auth/register")
      .send({
        email: "customer@example.test",
        password: validPassword,
        fullName: "Duplicate Customer",
      });
    expect(duplicate.status).toBe(409);
  });

  it("logs in, authenticates /me, and revokes sessions on logout", async () => {
    const repository = new MemoryAuthRepository();
    await repository.seedUser("customer@example.test", "customer", "52");
    const { service } = createService(repository);
    const app = createApp({ authService: service });
    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: "customer@example.test", password: validPassword });
    const cookieHeader = firstCookie(login);
    const cookie = cookieHeader.split(";")[0];

    expect(login.status).toBe(200);
    expect(cookieHeader).toContain("HttpOnly");
    expect(cookieHeader).toContain("SameSite=Lax");
    expect(
      (await request(app).get("/api/auth/me").set("Cookie", cookie)).body.data,
    ).toMatchObject({
      email: "customer@example.test",
      role: "customer",
      customerId: "52",
    });

    expect(
      (await request(app).post("/api/auth/logout").set("Cookie", cookie))
        .status,
    ).toBe(204);
    expect(
      (await request(app).get("/api/auth/me").set("Cookie", cookie)).status,
    ).toBe(401);
  });

  it("allows only admins to create staff", async () => {
    const repository = new MemoryAuthRepository();
    await repository.seedUser("customer@example.test", "customer");
    await repository.seedUser("staff@example.test", "staff");
    await repository.seedUser("admin@example.test", "admin");
    const { service } = createService(repository);
    const app = createApp({ authService: service });
    const unauthenticated = await request(app)
      .post("/api/users")
      .send({ email: "newstaff@example.test", password: validPassword });
    expect(unauthenticated.status).toBe(401);

    const customerLogin = await request(app)
      .post("/api/auth/login")
      .send({ email: "customer@example.test", password: validPassword });
    const customerCookie = firstCookie(customerLogin).split(";")[0];
    const forbidden = await request(app)
      .post("/api/users")
      .set("Cookie", customerCookie)
      .send({ email: "staff@example.test", password: validPassword });
    expect(forbidden.status).toBe(403);

    const staffLogin = await request(app)
      .post("/api/auth/login")
      .send({ email: "staff@example.test", password: validPassword });
    const staffCookie = firstCookie(staffLogin).split(";")[0];
    const staffForbidden = await request(app)
      .post("/api/users")
      .set("Cookie", staffCookie)
      .send({ email: "newstaff@example.test", password: validPassword });
    expect(staffForbidden.status).toBe(403);

    const adminLogin = await request(app)
      .post("/api/auth/login")
      .send({ email: "admin@example.test", password: validPassword });
    const adminCookie = firstCookie(adminLogin).split(";")[0];
    const created = await request(app)
      .post("/api/users")
      .set("Cookie", adminCookie)
      .send({ email: "created-staff@example.test", password: validPassword });

    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({
      email: "created-staff@example.test",
      role: "staff",
      customerId: null,
    });
  });

  it("queues an encrypted single-use reset token and revokes sessions", async () => {
    const repository = new MemoryAuthRepository();
    await repository.seedUser("customer@example.test", "customer");
    const { service } = createService(repository);
    const session = await service.login({
      email: "customer@example.test",
      password: validPassword,
    });

    await service.forgotPassword({ email: "customer@example.test" });
    const queued = repository.outbox[0];
    const token = decryptResetToken(queued.encryptedToken, resetEncryptionKey);
    const tokenHash = hashResetToken(token);
    expect(repository.resetTokens.has(tokenHash)).toBe(true);
    expect(JSON.stringify(queued)).not.toContain(token);
    expect(queued.recipient).toBe("customer@example.test");

    const resetInput = {
      token,
      password: "Reset!Password2026",
    };
    await service.resetPassword(resetInput);
    expect(
      await verifyPassword(
        resetInput.password,
        repository.users.get("customer@example.test")?.passwordHash ?? null,
      ),
    ).toBe(true);
    await expect(service.authenticate(session.token)).rejects.toMatchObject({
      status: 401,
    });
    await expect(service.resetPassword(resetInput)).rejects.toMatchObject({
      status: 400,
      code: "INVALID_RESET_TOKEN",
    });
  });

  it("does not reveal unknown accounts", async () => {
    const repository = new MemoryAuthRepository();
    await repository.seedUser("known@example.test", "customer");
    const { service } = createService(repository);
    const app = createApp({ authService: service });
    const unknownAccount = await request(app)
      .post("/api/auth/forgot-password")
      .send({ email: "missing@example.test" });
    const knownAccount = await request(app)
      .post("/api/auth/forgot-password")
      .send({ email: "known@example.test" });

    expect(unknownAccount.status).toBe(202);
    expect(knownAccount.status).toBe(202);
    expect(unknownAccount.body).toEqual(knownAccount.body);
  });

  it("rate-limits login and password-reset requests", async () => {
    const { service } = createService();
    const app = createApp({
      authService: service,
      authRateLimits: {
        login: { windowMs: 60_000, limit: 1 },
        reset: { windowMs: 60_000, limit: 1 },
      },
    });

    const acceptedReset = await request(app)
      .post("/api/auth/forgot-password")
      .send({ email: "missing@example.test" });
    const limitedReset = await request(app)
      .post("/api/auth/forgot-password")
      .send({ email: "missing@example.test" });
    expect(acceptedReset.status).toBe(202);
    expect(limitedReset.status).toBe(429);

    const invalidLogin = await request(app)
      .post("/api/auth/login")
      .send({ email: "missing@example.test", password: validPassword });
    const limitedLogin = await request(app)
      .post("/api/auth/login")
      .send({ email: "missing@example.test", password: validPassword });
    expect(invalidLogin.status).toBe(401);
    expect(limitedLogin.status).toBe(429);
  });

  it("adds customer ownership to repository queries before execution", async () => {
    const database = knex({ client: "pg" });
    try {
      const customerQuery = scopeCustomerQuery(
        database("subscriptions").select("id"),
        {
          id: "1",
          email: "customer@example.test",
          role: "customer",
          customerId: "52",
          sessionId: "session",
        },
      );
      expect(customerQuery.toSQL().sql).toContain('"customer_id" = ?');
      expect(customerQuery.toSQL().bindings).toEqual(["52"]);

      const staffQuery = scopeCustomerQuery(
        database("subscriptions").select("id"),
        {
          id: "2",
          email: "staff@example.test",
          role: "staff",
          customerId: null,
          sessionId: "staff-session",
        },
      );
      expect(staffQuery.toSQL().sql).not.toContain('"customer_id"');
    } finally {
      await database.destroy();
    }
  });

  it("rejects expired or tampered signed session tokens", async () => {
    const tokens = new SessionToken(authSecret);
    const signed = await tokens.sign(
      {
        sessionId: "88f8a77c-1d3f-4bbc-b867-e20be3a49b9f",
        userId: "1",
        expiresAt: Math.floor(now.getTime() / 1000) + 60,
      },
      Math.floor(now.getTime() / 1000),
    );

    expect((await tokens.verify(signed, now)).userId).toBe("1");
    await expect(
      tokens.verify(`${signed.slice(0, -1)}x`, now),
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      tokens.verify(signed, new Date(now.getTime() + 61_000)),
    ).rejects.toMatchObject({ status: 401 });
  });
});
