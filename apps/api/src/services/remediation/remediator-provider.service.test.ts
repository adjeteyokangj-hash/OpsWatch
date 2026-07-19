import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockProjectFindFirst,
  mockIntegrationFindFirst,
  mockIntegrationUpdate,
  mockRepairCreate,
  mockRepairFindUnique,
  mockRepairUpdate,
  mockCheckResultFindFirst,
  mockTimelineCreate
} = vi.hoisted(() => ({
  mockProjectFindFirst: vi.fn(),
  mockIntegrationFindFirst: vi.fn(),
  mockIntegrationUpdate: vi.fn(),
  mockRepairCreate: vi.fn(),
  mockRepairFindUnique: vi.fn(),
  mockRepairUpdate: vi.fn(),
  mockCheckResultFindFirst: vi.fn(),
  mockTimelineCreate: vi.fn()
}));

vi.mock("../../lib/prisma", () => ({
  prisma: {
    project: { findFirst: mockProjectFindFirst },
    projectIntegration: {
      findFirst: mockIntegrationFindFirst,
      update: mockIntegrationUpdate
    },
    remediatorRepairAttempt: {
      create: mockRepairCreate,
      findUnique: mockRepairFindUnique,
      update: mockRepairUpdate
    },
    checkResult: { findFirst: mockCheckResultFindFirst },
    operationsTimelineEvent: { create: mockTimelineCreate }
  }
}));

vi.mock("../../config/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret-for-remediator";
process.env.OPSWATCH_SECRETS_ENCRYPTION_KEY =
  process.env.OPSWATCH_SECRETS_ENCRYPTION_KEY || "test-encryption-key-remediator";

import { encryptSecret } from "../../lib/secret-crypto";
import {
  evaluateRemediatorGate,
  executeRemediatorRepair,
  runRemediatorValidationHandshake
} from "./remediator-provider.service";
import {
  computeRemediatorSignature,
  isRemediatorTimestampFresh,
  verifyRemediatorSignature
} from "./remediator-signing";
import { mergeRemediatorConfigForStorage, redactRemediatorConfigForApi } from "./remediator-config";
import { isAllowlistedRemediatorAction } from "./remediator-actions";

const orgId = "org-1";
const projectId = "proj-1";

const baseIntegration = (overrides: Record<string, unknown> = {}) => ({
  id: "int-1",
  type: "WORKER_PROVIDER" as const,
  enabled: true,
  validationStatus: "VALID" as const,
  secretRef: null,
  credentialFamilyId: null,
  projectId,
  Project: { organizationId: orgId, environment: "production" },
  configJson: {
    WORKER_RESTART_WEBHOOK_URL: "https://remediator.test/hook",
    REMEDIATOR_CAPABILITIES: [
      "restart_sync_worker",
      "restart_outbox_processor",
      "retry_failed_jobs",
      "retry_outbox_item"
    ],
    _remediatorSecretEnc: encryptSecret("shared-secret"),
    ...((overrides.configJson as object) ?? {})
  },
  ...overrides,
  configJson: {
    WORKER_RESTART_WEBHOOK_URL: "https://remediator.test/hook",
    REMEDIATOR_CAPABILITIES: [
      "restart_sync_worker",
      "restart_outbox_processor",
      "retry_failed_jobs",
      "retry_outbox_item"
    ],
    _remediatorSecretEnc: encryptSecret("shared-secret"),
    ...((overrides.configJson as object) ?? {})
  },
  Project:
    (overrides.Project as { organizationId: string; environment: string } | undefined) ??
    { organizationId: orgId, environment: "production" }
});

describe("remediator allowlist + signing", () => {
  it("only allowslisted worker actions", () => {
    expect(isAllowlistedRemediatorAction("restart_sync_worker")).toBe(true);
    expect(isAllowlistedRemediatorAction("rm -rf /")).toBe(false);
    expect(isAllowlistedRemediatorAction("restart_outbox_processor")).toBe(true);
  });

  it("signs and verifies remediator requests; rejects tampering", () => {
    const fields = {
      timestamp: new Date().toISOString(),
      nonce: "nonce-1",
      projectId,
      incidentId: "inc-1",
      action: "restart_sync_worker",
      target: "outbox",
      reason: "test",
      idempotencyKey: "idem-1"
    };
    const sig = computeRemediatorSignature("shared-secret", fields);
    expect(verifyRemediatorSignature("shared-secret", fields, sig)).toBe(true);
    expect(verifyRemediatorSignature("wrong", fields, sig)).toBe(false);
    expect(
      verifyRemediatorSignature("shared-secret", { ...fields, action: "retry_failed_jobs" }, sig)
    ).toBe(false);
  });

  it("rejects stale timestamps", () => {
    const old = new Date(Date.now() - 10 * 60_000).toISOString();
    expect(isRemediatorTimestampFresh(old)).toBe(false);
    expect(isRemediatorTimestampFresh(new Date().toISOString())).toBe(true);
  });

  it("encrypts secrets and redacts them from API config", () => {
    const stored = mergeRemediatorConfigForStorage(
      "WORKER_PROVIDER",
      {
        WORKER_RESTART_WEBHOOK_URL: "https://example.com",
        REMEDIATOR_WEBHOOK_SECRET: "super-secret"
      },
      null
    );
    expect(stored.REMEDIATOR_WEBHOOK_SECRET).toBeUndefined();
    expect(stored._remediatorSecretEnc).toBeTruthy();

    const blankPreserve = mergeRemediatorConfigForStorage(
      "WORKER_PROVIDER",
      { WORKER_RESTART_WEBHOOK_URL: "https://example.com", REMEDIATOR_WEBHOOK_SECRET: "" },
      stored
    );
    expect(blankPreserve._remediatorSecretEnc).toEqual(stored._remediatorSecretEnc);

    const redacted = redactRemediatorConfigForApi(stored);
    expect(redacted.secretConfigured).toBe(true);
    expect(redacted.configJson?._remediatorSecretEnc).toBeUndefined();
    expect(redacted.configJson?.REMEDIATOR_WEBHOOK_SECRET).toBeUndefined();
  });
});

describe("evaluateRemediatorGate", () => {
  it("rejects monitoring-only integration types", () => {
    const gate = evaluateRemediatorGate({
      providerType: "WEBHOOK",
      integration: null,
      action: "restart_sync_worker"
    });
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.reason).toBe("MONITORING_ONLY");
  });

  it("rejects missing provider", () => {
    const gate = evaluateRemediatorGate({
      providerType: "WORKER_PROVIDER",
      integration: null,
      action: "restart_sync_worker"
    });
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.reason).toBe("MISSING_PROVIDER");
  });

  it("rejects unvalidated provider", () => {
    const gate = evaluateRemediatorGate({
      providerType: "WORKER_PROVIDER",
      integration: baseIntegration({ validationStatus: "UNKNOWN" }),
      action: "restart_sync_worker"
    });
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.reason).toBe("UNVALIDATED_PROVIDER");
  });

  it("rejects incompatible capability", () => {
    const gate = evaluateRemediatorGate({
      providerType: "WORKER_PROVIDER",
      integration: baseIntegration({
        configJson: {
          WORKER_RESTART_WEBHOOK_URL: "https://remediator.test/hook",
          REMEDIATOR_CAPABILITIES: ["retry_failed_jobs"],
          _remediatorSecretEnc: encryptSecret("shared-secret")
        }
      }),
      action: "restart_sync_worker"
    });
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.reason).toBe("INCOMPATIBLE_CAPABILITY");
  });

  it("rejects emergency disable", () => {
    const gate = evaluateRemediatorGate({
      providerType: "WORKER_PROVIDER",
      integration: baseIntegration({
        configJson: {
          WORKER_RESTART_WEBHOOK_URL: "https://remediator.test/hook",
          REMEDIATOR_EMERGENCY_DISABLED: true,
          _remediatorSecretEnc: encryptSecret("shared-secret")
        }
      }),
      action: "restart_sync_worker"
    });
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.reason).toBe("EMERGENCY_DISABLED");
  });

  it("rejects confidence / policy blocks", () => {
    const confidence = evaluateRemediatorGate({
      providerType: "WORKER_PROVIDER",
      integration: baseIntegration(),
      action: "restart_sync_worker",
      confidenceLabel: "BLOCKED"
    });
    expect(confidence.ok).toBe(false);
    if (!confidence.ok) expect(confidence.reason).toBe("CONFIDENCE_BLOCKED");

    const policy = evaluateRemediatorGate({
      providerType: "WORKER_PROVIDER",
      integration: baseIntegration(),
      action: "restart_sync_worker",
      policyBlocked: true
    });
    expect(policy.ok).toBe(false);
    if (!policy.ok) expect(policy.reason).toBe("POLICY_BLOCKED");
  });
});

describe("executeRemediatorRepair", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProjectFindFirst.mockResolvedValue({
      id: projectId,
      remediationEmergencyDisabled: false
    });
    mockIntegrationFindFirst.mockResolvedValue(baseIntegration());
    mockRepairFindUnique.mockResolvedValue(null);
    mockRepairCreate.mockResolvedValue({ id: "attempt-1" });
    mockRepairUpdate.mockResolvedValue({});
    mockIntegrationUpdate.mockResolvedValue({});
    mockCheckResultFindFirst.mockResolvedValue(null);
    mockTimelineCreate.mockResolvedValue({ id: "tl-1" });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not claim success when webhook is missing", async () => {
    mockIntegrationFindFirst.mockResolvedValue(
      baseIntegration({
        configJson: {
          WORKER_RESTART_WEBHOOK_URL: "",
          REMEDIATOR_CAPABILITIES: ["restart_sync_worker"],
          _remediatorSecretEnc: encryptSecret("shared-secret")
        }
      })
    );

    const result = await executeRemediatorRepair({
      registryAction: "RESTART_WORKER",
      providerType: "WORKER_PROVIDER",
      context: { organizationId: orgId, projectId }
    });

    expect(result.success).toBe(false);
    expect(result.summary).toMatch(/webhook|configured/i);
  });

  it("blocks duplicates via idempotency key", async () => {
    mockRepairFindUnique.mockResolvedValue({
      id: "existing",
      status: "COMPLETED"
    });

    const result = await executeRemediatorRepair({
      registryAction: "RESTART_WORKER",
      providerType: "WORKER_PROVIDER",
      context: {
        organizationId: orgId,
        projectId,
        extra: { idempotencyKey: "same-key", remediatorAction: "restart_sync_worker" }
      }
    });

    expect(result.success).toBe(false);
    expect(result.details?.reason).toBe("DUPLICATE_REQUEST");
  });

  it("records provider rejection", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        json: async () => ({ ok: false, rejected: true, reason: "not_allowed" })
      })
    );

    const result = await executeRemediatorRepair({
      registryAction: "RESTART_WORKER",
      providerType: "WORKER_PROVIDER",
      context: {
        organizationId: orgId,
        projectId,
        incidentId: "inc-1",
        extra: { remediatorAction: "restart_sync_worker", idempotencyKey: "k-reject" }
      }
    });

    expect(result.success).toBe(false);
    expect(result.details?.reason).toBe("PROVIDER_REJECTION");
  });

  it("times out when provider hangs", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(
        (_url: string, init?: { signal?: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              const err = new Error("The operation was aborted");
              reject(err);
            });
          })
      )
    );
    mockIntegrationFindFirst.mockResolvedValue(
      baseIntegration({
        configJson: {
          WORKER_RESTART_WEBHOOK_URL: "https://remediator.test/hook",
          WORKER_PROVIDER_TIMEOUT_MS: 20,
          REMEDIATOR_CAPABILITIES: ["restart_sync_worker"],
          _remediatorSecretEnc: encryptSecret("shared-secret")
        }
      })
    );

    const result = await executeRemediatorRepair({
      registryAction: "RESTART_WORKER",
      providerType: "WORKER_PROVIDER",
      context: {
        organizationId: orgId,
        projectId,
        extra: { remediatorAction: "restart_sync_worker", idempotencyKey: "k-timeout" }
      }
    });

    expect(result.success).toBe(false);
    expect(result.details?.reason).toBe("TIMEOUT");
  });

  it("fails post-repair verification when provider returns HTTP 200 without verified signals", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ ok: true, accepted: true })
      })
    );

    const result = await executeRemediatorRepair({
      registryAction: "RESTART_WORKER",
      providerType: "WORKER_PROVIDER",
      context: {
        organizationId: orgId,
        projectId,
        extra: { remediatorAction: "restart_sync_worker", idempotencyKey: "k-verify-fail" }
      }
    });

    expect(result.success).toBe(false);
    expect(result.details?.reason).toBe("VERIFICATION_FAILED");
  });

  it("completes successful worker restart with verification", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          accepted: true,
          verified: true,
          healthy: true,
          verificationEvidence: { worker: "up" }
        })
      })
    );

    const result = await executeRemediatorRepair({
      registryAction: "RESTART_WORKER",
      providerType: "WORKER_PROVIDER",
      context: {
        organizationId: orgId,
        projectId,
        incidentId: "inc-1",
        extra: { remediatorAction: "restart_sync_worker", idempotencyKey: "k-ok-restart" }
      }
    });

    expect(result.success).toBe(true);
    expect(result.status).toBe("COMPLETED");
    expect(result.summary).toMatch(/restart_sync_worker/);
  });

  it("completes successful job retry with verification", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          verified: true,
          verificationStatus: "healthy"
        })
      })
    );

    const result = await executeRemediatorRepair({
      registryAction: "REQUEUE_FAILED_JOB",
      providerType: "WORKER_PROVIDER",
      context: {
        organizationId: orgId,
        projectId,
        extra: { remediatorAction: "retry_failed_jobs", idempotencyKey: "k-ok-retry" }
      }
    });

    expect(result.success).toBe(true);
    expect(result.status).toBe("COMPLETED");
  });

  it("blocks project-level emergency disable", async () => {
    mockProjectFindFirst.mockResolvedValue({
      id: projectId,
      remediationEmergencyDisabled: true
    });

    const result = await executeRemediatorRepair({
      registryAction: "RESTART_WORKER",
      providerType: "WORKER_PROVIDER",
      context: { organizationId: orgId, projectId }
    });

    expect(result.success).toBe(false);
    expect(result.summary).toMatch(/emergency/i);
  });
});

describe("runRemediatorValidationHandshake", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("validates signed handshake and advertises capabilities", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          capabilities: ["restart_sync_worker", "retry_failed_jobs"]
        })
      })
    );

    const result = await runRemediatorValidationHandshake({
      projectId,
      providerType: "WORKER_PROVIDER",
      configJson: {
        WORKER_RESTART_WEBHOOK_URL: "https://remediator.test/hook",
        _remediatorSecretEnc: encryptSecret("shared-secret")
      }
    });

    expect(result.status).toBe("VALID");
    expect(result.capabilities).toContain("restart_sync_worker");
  });

  it("fails handshake without secret — never claims connected", async () => {
    const result = await runRemediatorValidationHandshake({
      projectId,
      providerType: "WORKER_PROVIDER",
      configJson: {
        WORKER_RESTART_WEBHOOK_URL: "https://remediator.test/hook"
      }
    });
    expect(result.status).toBe("INVALID");
    expect(result.message).toMatch(/secret/i);
  });
});
