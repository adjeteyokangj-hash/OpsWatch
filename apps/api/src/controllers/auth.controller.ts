import { Response } from "express";
import type { AuthRequest } from "../middleware/auth";
import {
  AuthError,
  changePassword,
  getSessionUser,
  login,
  PasswordPolicyError
} from "../services/auth.service";
import { logger } from "../config/logger";
import { clearSessionCookies, readSessionToken, setSessionCookies } from "../lib/session-cookie";
import { createUserSession, revokeSessionToken, rotateUserSession } from "../services/session.service";

export const loginController = async (req: AuthRequest, res: Response) => {
  const email = String(req.body?.email ?? "").trim();
  const password = req.body?.password;
  if (!email || !password) {
    res.status(400).json({ error: "email and password are required" });
    return;
  }

  try {
    const result = await login(email, String(password), {
      ipAddress: req.ip,
      userAgent: req.header("user-agent") || undefined
    });
    setSessionCookies(res, result.session.sessionToken, result.session.csrfToken);
    res.json({ user: result.user });
  } catch (error) {
    console.error("LOGIN ERROR:", error);
    const message = error instanceof Error ? error.message : "Unknown login error";
    logger.warn("Login failed", { email, reason: message });
    res.status(401).json({ error: "Invalid credentials" });
  }
};

export const logoutController = async (req: AuthRequest, res: Response) => {
  const sessionToken = readSessionToken(req.headers.cookie);
  if (sessionToken) {
    await revokeSessionToken(sessionToken, "LOGOUT");
  }

  clearSessionCookies(res);
  res.status(204).send();
};

export const sessionController = async (req: AuthRequest, res: Response) => {
  const userId = req.user?.sub;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const user = await getSessionUser(userId);
  if (!user) {
    clearSessionCookies(res);
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  res.json({
    user: {
      ...user,
      isPlatformSuperAdmin: user.isPlatformSuperAdmin
    }
  });
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

    const currentSessionToken = readSessionToken(req.headers.cookie);
    if (currentSessionToken) {
      const rotated = await rotateUserSession({
        currentSessionToken,
        userId,
        ipAddress: req.ip,
        userAgent: req.header("user-agent") || undefined
      });
      if (rotated) {
        setSessionCookies(res, rotated.sessionToken, rotated.csrfToken);
      } else {
        const fresh = await createUserSession({
          userId,
          ipAddress: req.ip,
          userAgent: req.header("user-agent") || undefined
        });
        setSessionCookies(res, fresh.sessionToken, fresh.csrfToken);
      }
    }

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
