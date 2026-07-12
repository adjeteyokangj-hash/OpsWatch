import { Router } from "express";
import { requirePermission } from "../middleware/require-permission";
import {
  cancelMaintenanceWindowHandler,
  createMaintenanceWindowHandler,
  getMaintenanceWindowHandler,
  listActiveMaintenanceHandler,
  listMaintenanceWindowsHandler,
  updateMaintenanceWindowHandler
} from "../controllers/maintenance-windows.controller";

const router = Router();

router.get("/maintenance-windows", requirePermission("maintenance:view"), listMaintenanceWindowsHandler);
router.get("/maintenance-windows/active", requirePermission("maintenance:view"), listActiveMaintenanceHandler);
router.get("/maintenance-windows/:id", requirePermission("maintenance:view"), getMaintenanceWindowHandler);
router.post("/maintenance-windows", requirePermission("maintenance:manage"), createMaintenanceWindowHandler);
router.patch("/maintenance-windows/:id", requirePermission("maintenance:manage"), updateMaintenanceWindowHandler);
router.post("/maintenance-windows/:id/cancel", requirePermission("maintenance:manage"), cancelMaintenanceWindowHandler);

export default router;
