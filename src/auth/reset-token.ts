import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

export function hashResetToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface EncryptedResetToken {
  ciphertext: string;
  iv: string;
  authTag: string;
}

export function encryptResetToken(
  token: string,
  encryptionKey: string,
): EncryptedResetToken {
  const key = Buffer.from(encryptionKey, "hex");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(token, "utf8"),
    cipher.final(),
  ]);
  return {
    ciphertext: ciphertext.toString("base64url"),
    iv: iv.toString("base64url"),
    authTag: cipher.getAuthTag().toString("base64url"),
  };
}

export function decryptResetToken(
  encrypted: EncryptedResetToken,
  encryptionKey: string,
): string {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    Buffer.from(encryptionKey, "hex"),
    Buffer.from(encrypted.iv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(encrypted.authTag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted.ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
