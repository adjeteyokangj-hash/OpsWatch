import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;

const encryptionKey = (): Buffer => {
  const raw = process.env.OPSWATCH_SECRETS_ENCRYPTION_KEY?.trim() || process.env.JWT_SECRET?.trim();
  if (!raw) {
    throw new Error("OPSWATCH_SECRETS_ENCRYPTION_KEY or JWT_SECRET is required to encrypt stored secrets.");
  }
  return createHash("sha256").update(raw).digest();
};

export type EncryptedSecret = {
  ciphertext: string;
  iv: string;
  authTag: string;
};

export const encryptSecret = (plaintext: string): EncryptedSecret => {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    ciphertext: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64")
  };
};

export const decryptSecret = (payload: EncryptedSecret): string => {
  const decipher = createDecipheriv(ALGORITHM, encryptionKey(), Buffer.from(payload.iv, "base64"));
  decipher.setAuthTag(Buffer.from(payload.authTag, "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, "base64")),
    decipher.final()
  ]);
  return decrypted.toString("utf8");
};

export const maskSecret = (value?: string | null): string | null => {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed.length <= 8) return "••••••••";
  return `${"•".repeat(Math.min(16, trimmed.length - 4))}${trimmed.slice(-4)}`;
};
