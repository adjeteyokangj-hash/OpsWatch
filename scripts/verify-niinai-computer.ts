/**
 * Print the stored monitoring row for one NiiNai computer.
 * Does not print credentials.
 */
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";
import path from "node:path";

dotenv.config({ path: path.resolve(__dirname, "../apps/api/.env") });

const prisma = new PrismaClient();
const deviceId = (process.argv[2] || "").trim().toLowerCase();

async function main() {
  if (!/^[0-9a-f-]{36}$/.test(deviceId)) throw new Error("Pass the computer id");
  const project = await prisma.project.findFirst({
    where: { slug: "niinai-guest-house" },
    select: {
      id: true,
      status: true,
      automationMode: true,
      remediationEmergencyDisabled: true,
      monitoringEnabled: true
    }
  });
  if (!project) throw new Error("Project missing");
  const devices = await prisma.monitoredDevice.findMany({
    where: { projectId: project.id, deviceId }
  });
  const heartbeats = await prisma.heartbeat.count({
    where: { projectId: project.id, deviceId }
  });
  const recent = await prisma.heartbeat.findMany({
    where: { projectId: project.id, deviceId },
    orderBy: { receivedAt: "desc" },
    take: 5,
    select: { status: true, appVersion: true, payloadJson: true }
  });
  const openAlerts = await prisma.alert.count({
    where: { projectId: project.id, status: { in: ["OPEN", "ACKNOWLEDGED"] } }
  });
  const row = devices[0];
  const payload = JSON.stringify(row?.sanitizedPayloadJson ?? {});
  console.log(JSON.stringify({
    projectStatus: project.status,
    openAlerts,
    automationMode: project.automationMode,
    remediationEmergencyDisabled: project.remediationEmergencyDisabled,
    monitoringEnabled: project.monitoringEnabled,
    deviceRows: devices.length,
    heartbeats,
    presence: row?.presence ?? null,
    reportedStatus: row?.reportedStatus ?? null,
    appVersion: row?.appVersion ?? null,
    lifecycleSync: row?.lifecycleSync ?? null,
    financialSync: row?.financialSync ?? null,
    pendingCount: row?.pendingCount ?? null,
    failedCount: row?.failedCount ?? null,
    reportedName: row?.reportedName ?? null,
    payloadHasGuest: /guest|@|GHS|amount/i.test(payload),
    recent: recent.map((beat) => {
      const payload = beat.payloadJson as { sync?: { lifecycle?: { failed?: number }; financial?: { failed?: number } } } | null;
      return {
        status: beat.status,
        appVersion: beat.appVersion,
        bookingFailed: payload?.sync?.lifecycle?.failed ?? null,
        financialFailed: payload?.sync?.financial?.failed ?? null
      };
    })
  }));
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "verify failed");
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
