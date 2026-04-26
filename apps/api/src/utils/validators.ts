import { Request, Response, NextFunction } from "express";
import { z } from "zod";

export const validateBody =
  <T extends z.ZodTypeAny>(schema: T) =>
  (req: Request, res: Response, next: NextFunction): void => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Validation failed",
        details: parsed.error.flatten()
      });
      return;
    }
    req.body = parsed.data;
    next();
  };
