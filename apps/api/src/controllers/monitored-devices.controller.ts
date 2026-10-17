import { Response } from "express";
import { z } from "zod";
import type { AuthRequest } from "../middleware/auth";
import { requireOrg } from "../lib/require-org";
import { prisma } from "../lib/prisma";
import { presentMonitoredDevices } from "../services/device-heartbeat";

const labelSchema = z.object({
  label: z.string().trim().min(1).max(80).nullable()
});

export const patchMonitoredDeviceLabel = async (req: AuthRequest, res: Response) => {
  const orgId = requireOrg(req, res);
  if (!orgId) return;

  const parsed = labelSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Label must be 1-80 characters, or null to clear it" });
    return;
  }

  const existing = await prisma.monitoredDevice.findFirst({
    where: {
      projectId: req.params.projectId,
      deviceId: req.params.deviceId,
      Project: { organizationId: orgId }
    }
  });
  if (!existing) {
    res.status(404).json({ error: "Computer not found" });
    return;
  }

  const updated = await prisma.monitoredDevice.update({
    where: { id: existing.id },
    data: { label: parsed.data.label, updatedAt: new Date() }
  });
  const [device] = presentMonitoredDevices([updated]);
  res.json({ device });
};
