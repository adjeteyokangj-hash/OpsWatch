import { Request, Response } from "express";
import { login } from "../services/auth.service";

export const loginController = async (req: Request, res: Response) => {
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

export const logoutController = (_req: Request, res: Response) => {
	// JWT auth is stateless for now; this endpoint exists so clients can perform
	// a clean server round-trip when ending a session.
	res.status(204).send();
};

