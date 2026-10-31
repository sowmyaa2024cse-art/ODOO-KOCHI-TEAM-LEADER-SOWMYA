export type UserRole = "admin" | "staff" | "customer";

export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
  customerId: string | null;
}

export interface AuthActor extends AuthUser {
  sessionId: string;
}

export interface AuthSessionUser extends AuthUser {
  passwordHash: string;
}

export interface SessionClaims {
  sessionId: string;
  userId: string;
  expiresAt: number;
}
