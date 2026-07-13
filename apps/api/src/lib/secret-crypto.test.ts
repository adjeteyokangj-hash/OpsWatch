import { afterEach, describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, maskSecret } from "./secret-crypto";

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
});
