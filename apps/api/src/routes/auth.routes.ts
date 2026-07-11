import { Router } from "express";
import { loginController, logoutController, changePasswordController } from "../controllers/auth.controller";
import { registerUser, inviteUser } from "../controllers/users.controller";
import { requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/require-role";

export const authRouter = Router();

authRouter.post("/auth/login", loginController);
authRouter.post("/auth/logout", requireAuth, logoutController);
authRouter.post("/auth/change-password", requireAuth, changePasswordController);
authRouter.post("/auth/register", registerUser);
authRouter.post("/auth/invite", requireAuth, requireRole("ADMIN"), inviteUser);
