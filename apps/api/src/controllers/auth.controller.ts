import { Response } from "express";
import type { AuthRequest } from "../middleware/auth";
import {
  AuthError,
  changePassword,
  login,
  refreshSession,
  PasswordPolicyError
} from "../services/auth.service";

export const loginController = async (req: AuthRequest, res: Response) => {
	const { email, password } = req.body ?? {};
	if (!email || !password) {
		res.status(400).json({ error: "email and password are required" });
		return;
	}

	try {
		const result = await login(String(email), String(password));
		res.json(result);
	} catch {
		res.status(401).json({ error: "Invalid credentials" });
	}
};

export const logoutController = (_req: AuthRequest, res: Response) => {
	// JWT auth is stateless for now; this endpoint exists so clients can perform
	// a clean server round-trip when ending a session.
	res.status(204).send();
};

export const sessionController = async (req: AuthRequest, res: Response) => {
	const userId = req.user?.sub;
	if (!userId) {
		res.status(401).json({ error: "Unauthorized" });
		return;
	}

	const result = await refreshSession(userId);
	if (!result) {
		res.status(401).json({ error: "Unauthorized" });
		return;
	}

	res.json(result);
};

export const changePasswordController = async (req: AuthRequest, res: Response) => {
	const userId = req.user?.sub;
	const { currentPassword, newPassword } = req.body ?? {};

	if (!userId) {
		res.status(401).json({ error: "Unauthorized" });
		return;
	}

	if (!currentPassword || !newPassword) {
		res.status(400).json({ error: "currentPassword and newPassword are required" });
		return;
	}

	try {
		await changePassword(userId, String(currentPassword), String(newPassword));
		// Stateless JWT: other outstanding tokens remain valid until expiry.
		// Clients should replace their session token after a successful change.
		res.json({ ok: true });
	} catch (error) {
		if (error instanceof AuthError) {
			if (error.code === "INVALID_CREDENTIALS") {
				res.status(401).json({ error: "Invalid credentials" });
				return;
			}
			res.status(400).json({ error: error.message });
			return;
		}
		if (error instanceof PasswordPolicyError) {
			res.status(400).json({ error: error.message });
			return;
		}
		throw error;
	}
};
