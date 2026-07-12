import { describe, expect, it } from "vitest";
import { canApproveGlobalPlaybookCatalog } from "./platform-playbook-governance";

describe("platform-playbook-governance", () => {
  it("denies global approval when allowlist is empty", () => {
    const previous = process.env.PLATFORM_PLAYBOOK_APPROVER_EMAILS;
    delete process.env.PLATFORM_PLAYBOOK_APPROVER_EMAILS;
    expect(canApproveGlobalPlaybookCatalog("admin@example.com")).toBe(false);
    process.env.PLATFORM_PLAYBOOK_APPROVER_EMAILS = previous;
  });

  it("allows only configured platform approver emails", () => {
    const previous = process.env.PLATFORM_PLAYBOOK_APPROVER_EMAILS;
    process.env.PLATFORM_PLAYBOOK_APPROVER_EMAILS = "Platform@Example.com, other@example.com";
    expect(canApproveGlobalPlaybookCatalog("platform@example.com")).toBe(true);
    expect(canApproveGlobalPlaybookCatalog("org-admin@example.com")).toBe(false);
    process.env.PLATFORM_PLAYBOOK_APPROVER_EMAILS = previous;
  });
});
