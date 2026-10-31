import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const keyLength = 64;
const dummySalt = Buffer.from("brightloop-dummy-salt");
const dummyHash = Buffer.alloc(keyLength);

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derivedKey = (await scrypt(password, salt, keyLength)) as Buffer;
  return `scrypt$${salt.toString("hex")}$${derivedKey.toString("hex")}`;
}

export async function verifyPassword(
  password: string,
  storedHash: string | null,
): Promise<boolean> {
  const segments = storedHash?.split("$") ?? [];
  const salt =
    segments.length === 3 &&
    segments[0] === "scrypt" &&
    /^[0-9a-f]{32}$/i.test(segments[1]) &&
    /^[0-9a-f]{128}$/i.test(segments[2])
      ? Buffer.from(segments[1], "hex")
      : dummySalt;
  const expected =
    segments.length === 3 &&
    segments[0] === "scrypt" &&
    /^[0-9a-f]{128}$/i.test(segments[2])
      ? Buffer.from(segments[2], "hex")
      : dummyHash;
  const actual = (await scrypt(password, salt, keyLength)) as Buffer;
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
