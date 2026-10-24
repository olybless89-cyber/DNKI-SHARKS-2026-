import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

/** High-entropy opaque bearer token, base64url encoded. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** Keyed hash for low-entropy secrets (6-digit codes) so a database dump alone cannot brute-force them. */
export function hmacHex(key: Buffer, value: string): string {
  return createHmac("sha256", key).update(value, "utf8").digest("hex");
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function numericCode(length = 6): string {
  let out = "";
  for (let i = 0; i < length; i++) out += randomInt(0, 10).toString();
  return out;
}

// Crockford base32 without I, L, O, U to avoid transcription errors.
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function crockford(length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) out += CROCKFORD[randomInt(0, CROCKFORD.length)];
  return out;
}

/** Human-readable accreditation ID, e.g. DNKI-7KQ4M-9MXPA. An identifier, not a secret. */
export function generateAccreditationId(): string {
  return `DNKI-${crockford(5)}-${crockford(5)}`;
}

export function generateReference(prefix: string): string {
  return `${prefix}-${crockford(12)}`;
}

/** AES-256-GCM authenticated encryption for data that must be recoverable (TOTP secrets, pass tokens). */
export function encrypt(plaintext: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${ct.toString("base64url")}`;
}

export function decrypt(payload: string, key: Buffer): string {
  const [version, iv, tag, ct] = payload.split(".");
  if (version !== "v1" || !iv || !tag || !ct) throw new Error("Unsupported ciphertext format");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]).toString("utf8");
}
