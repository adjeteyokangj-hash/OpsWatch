import type { NextFunction, Response } from "express";
import type { AuthRequest } from "./auth";

export const requireRole = (role: string) => {
	return (req: AuthRequest, res: Response, next: NextFunction) => {
		if (!req.user) {
			res.status(401).json({ error: "Unauthorized" });
			return;
		}
		if (req.user.role !== role) {
			res.status(403).json({ error: "Forbidden" });
			return;
		}
		next();
	};
};

