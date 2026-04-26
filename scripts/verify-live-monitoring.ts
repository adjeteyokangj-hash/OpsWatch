import { PrismaClient, ProjectStatus } from "@prisma/client";
import { processHeartbeatStaleJob } from "../apps/worker/src/jobs/process-heartbeat-stale.job";
import { runHttpChecksJob } from "../apps/worker/src/jobs/run-http-checks.job";
import { runSslChecksJob } from "../apps/worker/src/jobs/run-ssl-checks.job";

const prisma = new PrismaClient();
const verificationBaseUrl = process.env.VERIFICATION_BASE_URL || "https://sparkle-valeting.vercel.app/";

const assertPass = (condition: unknown, message: string): void => {
  if (!condition) {
    throw new Error(message);
  }
};

const ensureVerificationService = async (projectId: string) => {
  const existing = await prisma.service.findFirst({
    where: {
      projectId,
      name: "OpsWatch Verification Service"
    }
  });

  if (existing) {
    return prisma.service.update({
      where: { id: existing.id },
      data: { baseUrl: verificationBaseUrl, status: ProjectStatus.HEALTHY }
    });
  }

  return prisma.service.create({
    data: {
      projectId,
      name: "OpsWatch Verification Service",
      type: "API",
      status: ProjectStatus.HEALTHY,
      baseUrl: verificationBaseUrl
    }
  });
};

const ensureCheck = async (
  serviceId: string,
  name: string,
  data: {
    type: "HTTP" | "SSL";
    expectedStatusCode?: number;
    timeoutMs?: number;
    failureThreshold?: number;
  }
) => {
  const existing = await prisma.check.findFirst({
    where: { serviceId, name }
  });

  const common = {
    serviceId,
    name,
    type: data.type,
    intervalSeconds: 60,
    timeoutMs: data.timeoutMs ?? 5000,
    expectedStatusCode: data.expectedStatusCode,
    failureThreshold: data.failureThreshold ?? 1,
    recoveryThreshold: 1,
    isActive: true
  };

  if (existing) {
    return prisma.check.update({
      where: { id: existing.id },
      data: common
    });
  }

  return prisma.check.create({ data: common });
};

const verifyHttpLoop = async (projectId: string, serviceId: string): Promise<void> => {
  const failingCheck = await ensureCheck(serviceId, "Verification HTTP Failure/Recovery", {
    type: "HTTP",
    expectedStatusCode: 503,
    failureThreshold: 1
  });

  await runHttpChecksJob();

  const openFailureAlert = await prisma.alert.findFirst({
    where: {
      projectId,
      serviceId,
      sourceType: "CHECK",
      sourceId: failingCheck.id,
      status: "OPEN"
    }
  });
  assertPass(openFailureAlert, "Expected HTTP failure to create an open alert");

  await prisma.check.update({
    where: { id: failingCheck.id },
    data: { expectedStatusCode: 200 }
  });

  await runHttpChecksJob();

  const stillOpenAlert = await prisma.alert.findFirst({
    where: {
      sourceType: "CHECK",
      sourceId: failingCheck.id,
      status: "OPEN"
    }
  });
  assertPass(!stillOpenAlert, "Expected HTTP check recovery to resolve open alert");

  const recentResults = await prisma.checkResult.findMany({
    where: { checkId: failingCheck.id },
    orderBy: { checkedAt: "desc" },
    take: 2
  });
  assertPass(recentResults.length >= 2, "Expected at least two HTTP check results for verification");
};

const verifyHeartbeatStale = async (projectId: string): Promise<void> => {
  await prisma.heartbeat.create({
    data: {
      projectId,
      environment: "verification",
      status: "HEALTHY",
      message: "Synthetic stale heartbeat",
      receivedAt: new Date(Date.now() - 25 * 60 * 1000)
    }
  });

  await processHeartbeatStaleJob();

  const openStaleAlert = await prisma.alert.findFirst({
    where: {
      projectId,
      sourceType: "HEARTBEAT",
      title: "Heartbeat stale",
      status: "OPEN"
    }
  });
  assertPass(openStaleAlert, "Expected stale heartbeat processing to open an alert");

  await prisma.heartbeat.create({
    data: {
      projectId,
      environment: "verification",
      status: "HEALTHY",
      message: "Synthetic recovery heartbeat"
    }
  });

  await processHeartbeatStaleJob();

  const staleStillOpen = await prisma.alert.findFirst({
    where: {
      projectId,
      sourceType: "HEARTBEAT",
      title: "Heartbeat stale",
      status: "OPEN"
    }
  });
  assertPass(!staleStillOpen, "Expected fresh heartbeat to resolve stale alert");
};

const verifySslCheck = async (projectId: string, serviceId: string): Promise<void> => {
  const sslCheck = await ensureCheck(serviceId, "Verification SSL Check", {
    type: "SSL",
    timeoutMs: 3000,
    failureThreshold: 1
  });

  await runSslChecksJob();

  const latestSslResult = await prisma.checkResult.findFirst({
    where: { checkId: sslCheck.id },
    orderBy: { checkedAt: "desc" }
  });
  assertPass(latestSslResult, "Expected SSL check to produce a check result");
  assertPass(latestSslResult.status === "PASS" || latestSslResult.status === "WARN", "Expected SSL verification check to pass on a public https:// target");

  const sslAlert = await prisma.alert.findFirst({
    where: {
      projectId,
      serviceId,
      sourceType: "CHECK",
      sourceId: sslCheck.id,
      status: "OPEN"
    }
  });

  assertPass(!sslAlert, "Expected valid SSL verification target to avoid opening an alert");
};

const cleanupVerificationArtifacts = async (serviceId: string): Promise<void> => {
  const checks = await prisma.check.findMany({ where: { serviceId }, select: { id: true } });
  const checkIds = checks.map((check) => check.id);
  if (checkIds.length > 0) {
    await prisma.alert.deleteMany({ where: { sourceId: { in: checkIds } } });
    await prisma.checkResult.deleteMany({ where: { checkId: { in: checkIds } } });
    await prisma.check.deleteMany({ where: { id: { in: checkIds } } });
  }
  await prisma.service.delete({ where: { id: serviceId } });
};

const main = async (): Promise<void> => {
  const project = await prisma.project.findUnique({ where: { slug: "sparkle" } });
  assertPass(project, "Project 'sparkle' not found. Run api seed first.");

  const service = await ensureVerificationService(project.id);

  await verifyHttpLoop(project.id, service.id);
  await verifyHeartbeatStale(project.id);
  await verifySslCheck(project.id, service.id);
  await cleanupVerificationArtifacts(service.id);

  console.log("LIVE_MONITORING_OK");
  console.log("- HTTP checks create and resolve alerts");
  console.log("- Heartbeat stale detection creates and resolves alerts");
  console.log("- SSL checks validate public https targets without leaving seed noise");
};

void main()
  .catch((error) => {
    console.error("LIVE_MONITORING_FAILED", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
