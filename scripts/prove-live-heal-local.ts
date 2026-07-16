/**
 * Smallest local Fix→recover proof against a reachable remediator (mock or TN).
 * Writes evidence JSON to test-artifacts (no secrets).
 *
 *   pnpm exec tsx scripts/prove-live-heal-local.ts
 */
import { randomUUID } from "crypto";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { parseEnvFile } from "./lib/env-utils";

const rootDir = path.resolve(__dirname, "..");
const apiEnv = parseEnvFile(path.join(rootDir, "apps/api/.env"));
for (const key of [
  "DATABASE_URL",
  "OPSWATCH_SECRETS_ENCRYPTION_KEY",
  "JWT_SECRET"
] as const) {
  if (!process.env[key] && apiEnv[key]) {
    process.env[key] = apiEnv[key];
  }
}

const WEBHOOK_URL =
  process.env.LIVE_HEAL_REMEDIATOR_URL || "http://127.0.0.1:8791/";
const TN_SERVER =
  process.env.TN_SERVER ||
  "C:/Users/edwar/OneDrive/My Project/TrueNumeris/server";
const isTnRemediator = WEBHOOK_URL.includes("/api/internal/opswatch/remediator");
const tnEnv =
  isTnRemediator && !process.env.LIVE_HEAL_REMEDIATOR_SECRET
    ? parseEnvFile(path.join(TN_SERVER, ".env"))
    : {};
const WEBHOOK_SECRET =
  process.env.LIVE_HEAL_REMEDIATOR_SECRET ||
  tnEnv.OPSWATCH_REMEDIATOR_WEBHOOK_SECRET ||
  "local-remediator-secret";
const PROJECT_SLUG =
  process.env.LIVE_HEAL_PROJECT_SLUG ||
  process.env.PLAYWRIGHT_ISOLATION_PROJECT_SLUG ||
  "smoke-isolation-app-b";
const INTEGRATION_NAME =
  process.env.LIVE_HEAL_INTEGRATION_NAME ||
  (isTnRemediator
    ? "TrueNumeris Worker Remediator"
    : "Local live-heal remediator");
const EVIDENCE_BASENAME =
  process.env.LIVE_HEAL_EVIDENCE_FILE ||
  (isTnRemediator
    ? "live-heal-tn-evidence.json"
    : "live-heal-local-evidence.json");

type Evidence = {
  at: string;
  proven: boolean;
  remediatorUrl: string;
  remediatorHealth?: { ok?: boolean; role?: string };
  projectId?: string;
  organizationId?: string;
  handshake?: { status?: string; message?: string; capabilities?: string[] };
  repair?: {
    status?: string;
    summary?: string;
    attemptId?: string;
    attemptDbStatus?: string;
  };
  missing?: string[];
  error?: string;
};

async function main() {
  const evidence: Evidence = {
    at: new Date().toISOString(),
    proven: false,
    remediatorUrl: WEBHOOK_URL,
    missing: []
  };

  const missing = evidence.missing!;

  if (!process.env.OPSWATCH_SECRETS_ENCRYPTION_KEY?.trim()) {
    missing.push("OPSWATCH_SECRETS_ENCRYPTION_KEY");
  }
  if (!process.env.DATABASE_URL?.trim()) {
    missing.push("DATABASE_URL");
  }

  try {
    // Append /health to the webhook path (not origin-root /health) so nested
    // TN paths like /api/internal/opswatch/remediator keep working. Mock :8791/
    // still resolves to http://127.0.0.1:8791/health.
    const base = WEBHOOK_URL.replace(/\/$/, "");
    const healthUrl = `${base}/health`;
    const healthRes = await fetch(healthUrl);
    const healthBody = (await healthRes.json().catch(() => ({}))) as {
      ok?: boolean;
      role?: string;
    };
    evidence.remediatorHealth = healthBody;
    if (!healthRes.ok || healthBody.ok !== true) {
      missing.push(`remediator_health(${healthUrl})`);
    }
  } catch (error) {
    missing.push(`remediator_unreachable(${WEBHOOK_URL})`);
    evidence.error = error instanceof Error ? error.message : String(error);
  }

  if (missing.length > 0) {
    writeEvidence(evidence);
    console.log(JSON.stringify(evidence, null, 2));
    process.exitCode = 1;
    return;
  }

  const prisma = new PrismaClient();
  try {
    const { encryptSecret } = await import(
      "../apps/api/src/lib/secret-crypto"
    );
    const {
      runRemediatorValidationHandshake,
      executeRemediatorRepair
    } = await import(
      "../apps/api/src/services/remediation/remediator-provider.service"
    );

    const project = await prisma.project.findFirst({
      where: { slug: PROJECT_SLUG },
      select: { id: true, organizationId: true, remediationEmergencyDisabled: true }
    });
    if (!project) {
      missing.push(`project_slug:${PROJECT_SLUG}`);
      writeEvidence(evidence);
      console.log(JSON.stringify(evidence, null, 2));
      process.exitCode = 1;
      return;
    }

    evidence.projectId = project.id;
    evidence.organizationId = project.organizationId;

    const configJson = {
      WORKER_RESTART_WEBHOOK_URL: WEBHOOK_URL.replace(/\/$/, "") + "/",
      REMEDIATOR_CAPABILITIES: [
        "restart_sync_worker",
        "restart_outbox_processor",
        "retry_failed_jobs",
        "retry_outbox_item"
      ],
      _remediatorSecretEnc: encryptSecret(WEBHOOK_SECRET)
    };

    const existing = await prisma.projectIntegration.findFirst({
      where: { projectId: project.id, type: "WORKER_PROVIDER" },
      select: { id: true }
    });

    const integration = existing
      ? await prisma.projectIntegration.update({
          where: { id: existing.id },
          data: {
            enabled: true,
            name: INTEGRATION_NAME,
            configJson,
            validationStatus: "UNKNOWN",
            validationMessage: "Pending handshake",
            updatedAt: new Date()
          }
        })
      : await prisma.projectIntegration.create({
          data: {
            id: randomUUID(),
            projectId: project.id,
            type: "WORKER_PROVIDER",
            name: INTEGRATION_NAME,
            enabled: true,
            configJson,
            validationStatus: "UNKNOWN",
            updatedAt: new Date()
          }
        });

    const handshake = await runRemediatorValidationHandshake({
      projectId: project.id,
      providerType: "WORKER_PROVIDER",
      configJson: integration.configJson as Record<string, unknown>,
      secretRef: integration.secretRef
    });
    evidence.handshake = {
      status: handshake.status,
      message: handshake.message,
      capabilities: handshake.capabilities
    };

    await prisma.projectIntegration.update({
      where: { id: integration.id },
      data: {
        validationStatus: handshake.status,
        validationMessage: handshake.message,
        lastValidatedAt: new Date(),
        configJson: {
          ...(integration.configJson as object),
          REMEDIATOR_CAPABILITIES: handshake.capabilities
        },
        updatedAt: new Date()
      }
    });

    if (handshake.status !== "VALID") {
      missing.push("handshake_not_valid");
      writeEvidence(evidence);
      console.log(JSON.stringify(evidence, null, 2));
      process.exitCode = 1;
      return;
    }

    const repair = await executeRemediatorRepair({
      registryAction: "RESTART_WORKER",
      providerType: "WORKER_PROVIDER",
      confidenceLabel: "high",
      context: {
        organizationId: project.organizationId,
        projectId: project.id,
        incidentId: null,
        alertId: null,
        serviceId: "live-heal-local-proof",
        extra: {
          target: "sync_worker",
          reason: "local_live_heal_proof",
          idempotencyKey: `live-heal-local-${Date.now()}`
        }
      }
    });

    const attemptId =
      repair.details && typeof repair.details === "object"
        ? String((repair.details as { attemptId?: string }).attemptId || "")
        : "";

    let attemptDbStatus: string | undefined;
    if (attemptId) {
      const row = await prisma.remediatorRepairAttempt.findUnique({
        where: { id: attemptId },
        select: { status: true }
      });
      attemptDbStatus = row?.status;
    } else {
      const latest = await prisma.remediatorRepairAttempt.findFirst({
        where: { projectId: project.id },
        orderBy: { createdAt: "desc" },
        select: { id: true, status: true }
      });
      attemptDbStatus = latest?.status;
      if (latest) {
        (repair as { details?: { attemptId?: string } }).details = {
          ...(typeof repair.details === "object" && repair.details
            ? (repair.details as object)
            : {}),
          attemptId: latest.id
        };
      }
    }

    evidence.repair = {
      status: repair.status,
      summary: repair.summary,
      attemptId:
        attemptId ||
        (repair.details as { attemptId?: string } | undefined)?.attemptId,
      attemptDbStatus
    };

    evidence.proven =
      handshake.status === "VALID" &&
      (repair.status === "SUCCEEDED" ||
        repair.status === "SUCCESS" ||
        attemptDbStatus === "COMPLETED");

    if (!evidence.proven) {
      missing.push("repair_not_completed");
    }

    writeEvidence(evidence);
    console.log(JSON.stringify(evidence, null, 2));
    process.exitCode = evidence.proven ? 0 : 1;
  } catch (error) {
    evidence.error = error instanceof Error ? error.message : String(error);
    missing.push("script_exception");
    writeEvidence(evidence);
    console.log(JSON.stringify(evidence, null, 2));
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

function writeEvidence(evidence: Evidence) {
  const outDir = path.join(rootDir, "test-artifacts");
  fs.mkdirSync(outDir, { recursive: true });
  const payload = JSON.stringify(evidence, null, 2);
  fs.writeFileSync(path.join(outDir, EVIDENCE_BASENAME), payload);
  if (EVIDENCE_BASENAME !== "live-heal-local-evidence.json") {
    fs.writeFileSync(
      path.join(outDir, "live-heal-local-evidence.json"),
      payload
    );
  }
}

main();
