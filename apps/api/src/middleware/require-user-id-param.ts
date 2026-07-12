import type { NextFunction, Request, Response } from "express";

const USER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const requireUserIdParam = (req: Request, res: Response, next: NextFunction): void => {
  const userId = req.params.userId;
  if (!userId || !USER_ID_PATTERN.test(userId)) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  next();
};
