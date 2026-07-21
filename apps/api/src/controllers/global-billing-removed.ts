import type { Request, Response } from "express";

/**
 * Global workspace subscription purchase / manage has been removed. Billing is
 * per application (POST/GET /projects/:projectId/billing). Any attempt to
 * initiate or manage a single global OpsWatch subscription is rejected here.
 */
export const rejectGlobalWorkspaceBilling = (_req: Request, res: Response): void => {
  res.status(410).json({
    error:
      "Global workspace subscription billing has been removed. Billing is configured per application under /projects/:projectId/billing.",
    redirectTo: "/projects"
  });
};
