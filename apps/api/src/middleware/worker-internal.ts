import { NextFunction, Request, Response } from "express";

export const requireWorkerInternal = (req: Request, res: Response, next: NextFunction): void => {
  const configured = process.env.WORKER_INTERNAL_SECRET?.trim();
  if (!configured) {
    res.status(503).json({ error: "Worker internal secret is not configured" });
    return;
  }

  const provided = req.header("x-opswatch-worker-secret")?.trim();
  if (!provided || provided !== configured) {
    res.status(401).json({ error: "Unauthorized worker request" });
    return;
  }

  next();
};
