import { Router } from "express";
import { loginController, logoutController, changePasswordController, sessionController } from "../controllers/auth.controller";
import { registerUser, inviteUser } from "../controllers/users.controller";
import { requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/require-role";

export const authRouter = Router();

authRouter.post("/auth/login", loginController);
authRouter.get("/auth/session", requireAuth, sessionController);
// Logout must remain available even when the stored session is stale or invalid;
// the controller revokes a valid token when possible and always clears cookies.
authRouter.post("/auth/logout", logoutController);
authRouter.post("/auth/change-password", requireAuth, changePasswordController);
authRouter.post("/auth/register", registerUser);
authRouter.post("/auth/invite", requireAuth, requireRole("ADMIN"), inviteUser);
