import type { Response } from "express";
import type { AuthRequest } from "../middleware/auth";

export const requireOrg = (req: AuthRequest, res: Response): string | null => {
  const orgId = req.user?.organizationId;
  if (!orgId) {
    console.error("ORG_REQUIRED", {
      userId: req.user?.id ?? req.user?.sub,
      email: req.user?.email
    });
    res.status(403).json({ error: "Organization required" });
    return null;
  }
  return orgId;
};
