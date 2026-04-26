import { Router } from "express";
import { listUsers, getUserById, patchUser, deleteUser } from "../controllers/users.controller";
import { requireAdmin } from "../middleware/auth";

export const usersRouter = Router();

usersRouter.get("/users", listUsers);
usersRouter.get("/users/:userId", getUserById);
usersRouter.patch("/users/:userId", patchUser);
usersRouter.delete("/users/:userId", requireAdmin, deleteUser);
