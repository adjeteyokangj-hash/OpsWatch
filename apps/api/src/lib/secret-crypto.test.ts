import { afterEach, describe, expect, it } from "vitest";
import {
  CURRENT_KEY_VERSION,
  decryptSecret,
  decryptSecretVersioned,
  encryptSecret,
  encryptSecretVersioned,
  fingerprintSecret,
  maskSecret
} from "./secret-crypto";

describe("secret-crypto", () => {
  afterEach(() => {
    delete process.env.OPSWATCH_SECRETS_ENCRYPTION_KEY;
    delete process.env.JWT_SECRET;
  });

  it("encrypts and decrypts secrets", () => {
    process.env.JWT_SECRET = "test-secret-key";
    const encrypted = encryptSecret("sk_test_1234567890");
    expect(decryptSecret(encrypted)).toBe("sk_test_1234567890");
  });

  it("masks secrets without revealing full value", () => {
    expect(maskSecret("sk_test_1234567890")).toMatch(/7890$/);
    expect(maskSecret("sk_test_1234567890")).not.toContain("sk_test");
  });

  it("encrypts and decrypts versioned secrets with AAD", () => {
    process.env.OPSWATCH_SECRETS_ENCRYPTION_KEY = "managed-secret-key";
    const aad = "org-1:PROJECT_SIGNING:family-1:1";
    const encrypted = encryptSecretVersioned("signing-value-1234", aad);
    expect(encrypted.keyVersion).toBe(CURRENT_KEY_VERSION);
    expect(decryptSecretVersioned(encrypted, aad)).toBe("signing-value-1234");
  });

  it("rejects versioned decrypt when AAD mismatches", () => {
    process.env.OPSWATCH_SECRETS_ENCRYPTION_KEY = "managed-secret-key";
    const encrypted = encryptSecretVersioned("signing-value-1234", "org-1:PROJECT_SIGNING:family-1:1");
    expect(() => decryptSecretVersioned(encrypted, "org-1:PROJECT_SIGNING:family-1:2")).toThrow();
  });

  it("fingerprints secrets as sha256 hex", () => {
    const fingerprint = fingerprintSecret("hello");
    expect(fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(fingerprint).toBe(fingerprintSecret("hello"));
  });
});
