export const canApproveGlobalPlaybookCatalog = (userEmail?: string | null): boolean => {
  const allowlist =
    process.env.PLATFORM_PLAYBOOK_APPROVER_EMAILS?.split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean) ?? [];
  if (allowlist.length === 0) return false;
  if (!userEmail) return false;
  return allowlist.includes(userEmail.trim().toLowerCase());
};
