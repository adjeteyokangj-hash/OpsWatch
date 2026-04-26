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

