import { describe, expect, it } from "vitest";
import { __testOnlyBuildManagedCredentialAad } from "./connection-auth";

describe("worker connection-auth AAD alignment", () => {
  it("uses the same AAD format as the API managed credential service", () => {
    expect(__testOnlyBuildManagedCredentialAad({
      organizationId: "org-1",
      purpose: "CONNECTION_AUTH",
      familyId: "family-1",
      version: 3
    })).toBe("org-1:CONNECTION_AUTH:family-1:3");
  });
});
