import { Router } from "express";
import {
  deactivateUserHandler,
  getManagementCenter,
  getUserById,
  listUserAuditLogsHandler,
  listUsers,
  patchUser,
  reactivateUserHandler,
  resetUserPasswordHandler,
  setPlatformSuperAdminHandler
} from "../controllers/users.controller";
import { requireAdmin } from "../middleware/auth";
import { requirePlatformSuperAdmin } from "../middleware/require-platform-super-admin";
import { requireUserIdParam } from "../middleware/require-user-id-param";

export const usersRouter = Router();

usersRouter.get("/users/management-center", requireAdmin, getManagementCenter);
usersRouter.get("/users/audit-logs", requireAdmin, listUserAuditLogsHandler);
usersRouter.get("/users", listUsers);
usersRouter.get("/users/:userId", requireUserIdParam, getUserById);
usersRouter.patch("/users/:userId", requireAdmin, requireUserIdParam, patchUser);
usersRouter.post(
  "/users/:userId/platform-super-admin",
  requireAdmin,
  requirePlatformSuperAdmin,
  requireUserIdParam,
  setPlatformSuperAdminHandler
);
usersRouter.post("/users/:userId/reset-password", requireAdmin, requireUserIdParam, resetUserPasswordHandler);
usersRouter.post("/users/:userId/deactivate", requireAdmin, requireUserIdParam, deactivateUserHandler);
usersRouter.post("/users/:userId/reactivate", requireAdmin, requireUserIdParam, reactivateUserHandler);
usersRouter.delete("/users/:userId", requireAdmin, requireUserIdParam, deactivateUserHandler);
