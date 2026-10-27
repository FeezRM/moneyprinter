import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "./env";

// AES-256-GCM; output is base64(iv | tag | ciphertext).
export function encryptSecret(plaintext: string, key = Buffer.from(env().TOKEN_ENCRYPTION_KEY, "base64")): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64");
}

export function decryptSecret(encoded: string, key = Buffer.from(env().TOKEN_ENCRYPTION_KEY, "base64")): string {
  const buf = Buffer.from(encoded, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key, buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString("utf8");
}
