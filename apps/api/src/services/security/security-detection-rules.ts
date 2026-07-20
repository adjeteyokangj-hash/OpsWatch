import { createHash, randomUUID } from "crypto";
import { prisma } from "../../lib/prisma";
import { BASELINE_WORDING } from "./security-scopes";

export type DetectionRuleDef = {
  ruleKey: string;
  name: string;
  description: string;
  category: "IDENTITY" | "API" | "APPLICATION" | "BUSINESS" | "EXTERNAL";
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  windowMs: number;
  minimumSamples: number;
  threshold: Record<string, number | string | boolean>;
  eventTypes: string[];
  recommendedResponse: string;
  version: number;
};

/** Deterministic default rules — no executable code, no AI claims. */
export const DEFAULT_DETECTION_RULES: DetectionRuleDef[] = [
  {
    ruleKey: "identity.failed_login_burst",
    name: "Failed login burst",
    description: "Repeated LOGIN_FAILED events from one source within a short window.",
    category: "IDENTITY",
    severity: "HIGH",
    windowMs: 5 * 60 * 1000,
    minimumSamples: 5,
    threshold: { count: 5 },
    eventTypes: ["LOGIN_FAILED"],
    recommendedResponse: "Increase monitoring; consider temporary rate-limit of source if supported.",
    version: 1
  },
  {
    ruleKey: "identity.credential_stuffing",
    name: "Failures across many accounts from one source",
    description: "LOGIN_FAILED against many distinct accounts from one truncated source IP.",
    category: "IDENTITY",
    severity: "HIGH",
    windowMs: 10 * 60 * 1000,
    minimumSamples: 8,
    threshold: { distinctAccounts: 5, count: 8 },
    eventTypes: ["LOGIN_FAILED"],
    recommendedResponse: "Investigate source IP; open security incident if sustained.",
    version: 1
  },
  {
    ruleKey: "identity.login_after_failures",
    name: "Successful login following repeated failures",
    description: "LOGIN_SUCCEEDED after multiple LOGIN_FAILED for the same account.",
    category: "IDENTITY",
    severity: "HIGH",
    windowMs: 15 * 60 * 1000,
    minimumSamples: 4,
    threshold: { priorFailures: 3 },
    eventTypes: ["LOGIN_FAILED", "LOGIN_SUCCEEDED"],
    recommendedResponse: "Verify session legitimacy; revoke session if connector supports it.",
    version: 1
  },
  {
    ruleKey: "identity.privilege_change",
    name: "Unusual privileged-role change",
    description: "ROLE_CHANGED or PRIVILEGE_GRANTED on sensitive roles.",
    category: "IDENTITY",
    severity: "CRITICAL",
    windowMs: 60 * 60 * 1000,
    minimumSamples: 1,
    threshold: { count: 1 },
    eventTypes: ["ROLE_CHANGED", "PRIVILEGE_GRANTED"],
    recommendedResponse: "Confirm change with administrator; open security incident.",
    version: 1
  },
  {
    ruleKey: "identity.dormant_admin",
    name: "Dormant administrator activity",
    description: "ADMIN_ACTION from an account marked dormant in payload evidence.",
    category: "IDENTITY",
    severity: "HIGH",
    windowMs: 24 * 60 * 60 * 1000,
    minimumSamples: 1,
    threshold: { count: 1 },
    eventTypes: ["ADMIN_ACTION"],
    recommendedResponse: "Investigate account; request credential rotation.",
    version: 1
  },
  {
    ruleKey: "identity.mfa_failure_burst",
    name: "Repeated MFA failure",
    description: "Multiple MFA_FAILED events for one account.",
    category: "IDENTITY",
    severity: "MEDIUM",
    windowMs: 10 * 60 * 1000,
    minimumSamples: 4,
    threshold: { count: 4 },
    eventTypes: ["MFA_FAILED"],
    recommendedResponse: "Monitor account; lock if application supports it.",
    version: 1
  },
  {
    ruleKey: "identity.session_after_reset",
    name: "Unexpected session creation after password reset",
    description: "SESSION_CREATED shortly after PASSWORD_RESET_REQUESTED.",
    category: "IDENTITY",
    severity: "HIGH",
    windowMs: 30 * 60 * 1000,
    minimumSamples: 2,
    threshold: { count: 2 },
    eventTypes: ["PASSWORD_RESET_REQUESTED", "SESSION_CREATED"],
    recommendedResponse: "Verify reset was intentional; revoke unexpected sessions.",
    version: 1
  },
  {
    ruleKey: "api.invalid_key_burst",
    name: "Invalid API-key burst",
    description: "Repeated INVALID_API_KEY events.",
    category: "API",
    severity: "HIGH",
    windowMs: 5 * 60 * 1000,
    minimumSamples: 10,
    threshold: { count: 10 },
    eventTypes: ["INVALID_API_KEY"],
    recommendedResponse: "Quarantine webhook/event source; revoke compromised keys if OpsWatch-issued.",
    version: 1
  },
  {
    ruleKey: "api.invalid_signature_burst",
    name: "Invalid webhook signatures",
    description: "Repeated INVALID_SIGNATURE or WEBHOOK_REJECTED events.",
    category: "API",
    severity: "HIGH",
    windowMs: 5 * 60 * 1000,
    minimumSamples: 5,
    threshold: { count: 5 },
    eventTypes: ["INVALID_SIGNATURE", "WEBHOOK_REJECTED"],
    recommendedResponse: "Disable compromised test integration; rotate webhook secret.",
    version: 1
  },
  {
    ruleKey: "api.auth_denied_burst",
    name: "Repeated 401/403 style access denials",
    description: "ACCESS_DENIED burst indicating API abuse.",
    category: "API",
    severity: "MEDIUM",
    windowMs: 5 * 60 * 1000,
    minimumSamples: 20,
    threshold: { count: 20 },
    eventTypes: ["ACCESS_DENIED"],
    recommendedResponse: "Increase monitoring frequency; rate-limit source where supported.",
    version: 1
  },
  {
    ruleKey: "api.rate_spike",
    name: "API rate spike",
    description: "RATE_LIMIT_EXCEEDED above normal operating pattern.",
    category: "API",
    severity: "MEDIUM",
    windowMs: 5 * 60 * 1000,
    minimumSamples: 5,
    threshold: { count: 5 },
    eventTypes: ["RATE_LIMIT_EXCEEDED"],
    recommendedResponse: "Confirm legitimate traffic; temporarily rate-limit source if supported.",
    version: 1
  },
  {
    ruleKey: "api.key_wrong_environment",
    name: "API key used in the wrong environment",
    description: "API_KEY_USED with environment mismatch evidence.",
    category: "API",
    severity: "HIGH",
    windowMs: 60 * 60 * 1000,
    minimumSamples: 1,
    threshold: { count: 1 },
    eventTypes: ["API_KEY_USED"],
    recommendedResponse: "Revoke OpsWatch-issued key; investigate cross-environment use.",
    version: 1
  },
  {
    ruleKey: "api.revoked_key_use",
    name: "Revoked or expired credential use",
    description: "Use of revoked/expired credential evidenced by INVALID_API_KEY with reason.",
    category: "API",
    severity: "HIGH",
    windowMs: 60 * 60 * 1000,
    minimumSamples: 1,
    threshold: { count: 1 },
    eventTypes: ["INVALID_API_KEY", "API_KEY_REVOKED"],
    recommendedResponse: "Confirm revocation; open security incident if continued use.",
    version: 1
  },
  {
    ruleKey: "api.integration_auth_failure_burst",
    name: "Integration authentication failure burst",
    description: "Repeated INTEGRATION_AUTH_FAILED events.",
    category: "API",
    severity: "HIGH",
    windowMs: 10 * 60 * 1000,
    minimumSamples: 5,
    threshold: { count: 5 },
    eventTypes: ["INTEGRATION_AUTH_FAILED"],
    recommendedResponse: "Disable compromised test integration; request credential rotation.",
    version: 1
  },
  {
    ruleKey: "app.admin_route_forbidden",
    name: "Repeated forbidden admin-route access",
    description: "ADMIN_ROUTE_ACCESSED with denied/forbidden evidence.",
    category: "APPLICATION",
    severity: "HIGH",
    windowMs: 10 * 60 * 1000,
    minimumSamples: 5,
    threshold: { count: 5 },
    eventTypes: ["ADMIN_ROUTE_ACCESSED", "ACCESS_DENIED"],
    recommendedResponse: "Increase monitoring; verify admin URL exposure.",
    version: 1
  },
  {
    ruleKey: "app.security_header_removed",
    name: "Security header removed",
    description: "SECURITY_HEADER_REMOVED external check finding.",
    category: "EXTERNAL",
    severity: "MEDIUM",
    windowMs: 24 * 60 * 60 * 1000,
    minimumSamples: 1,
    threshold: { count: 1 },
    eventTypes: ["SECURITY_HEADER_REMOVED"],
    recommendedResponse: "Run additional check; correlate with recent deployment.",
    version: 1
  },
  {
    ruleKey: "app.diagnostic_exposed",
    name: "Public diagnostic endpoint exposed",
    description: "DIAGNOSTIC_ENDPOINT_EXPOSED or ADMIN_URL_EXPOSED.",
    category: "EXTERNAL",
    severity: "HIGH",
    windowMs: 24 * 60 * 60 * 1000,
    minimumSamples: 1,
    threshold: { count: 1 },
    eventTypes: ["DIAGNOSTIC_ENDPOINT_EXPOSED", "ADMIN_URL_EXPOSED"],
    recommendedResponse: "Confirm exposure; open security incident; increase check frequency.",
    version: 1
  },
  {
    ruleKey: "app.tls_dns_change",
    name: "TLS/DNS unexpected change",
    description: "TLS_CERTIFICATE_CHANGE or DNS_CHANGE outside change window.",
    category: "EXTERNAL",
    severity: "HIGH",
    windowMs: 24 * 60 * 60 * 1000,
    minimumSamples: 1,
    threshold: { count: 1 },
    eventTypes: ["TLS_CERTIFICATE_CHANGE", "DNS_CHANGE", "REDIRECT_CHANGE"],
    recommendedResponse: "Verify change was authorised; correlate with deployment events.",
    version: 1
  },
  {
    ruleKey: "app.upload_rejection_pattern",
    name: "Suspicious file-upload rejection pattern",
    description: "Repeated FILE_UPLOAD_REJECTED events.",
    category: "APPLICATION",
    severity: "MEDIUM",
    windowMs: 15 * 60 * 1000,
    minimumSamples: 8,
    threshold: { count: 8 },
    eventTypes: ["FILE_UPLOAD_REJECTED"],
    recommendedResponse: "Monitor source; investigate upload abuse.",
    version: 1
  },
  {
    ruleKey: "business.refund_frequency",
    name: "Unusual refund frequency",
    description: "HIGH_RISK_REFUND above configured threshold when business evidence supplied.",
    category: "BUSINESS",
    severity: "HIGH",
    windowMs: 60 * 60 * 1000,
    minimumSamples: 5,
    threshold: { count: 5 },
    eventTypes: ["HIGH_RISK_REFUND"],
    recommendedResponse: "Investigate staff action; open security incident if unauthorised.",
    version: 1
  },
  {
    ruleKey: "business.high_value_off_hours",
    name: "High-value operational change outside configured hours",
    description: "HIGH_RISK_PAYMENT_CHANGE outside configured operating hours.",
    category: "BUSINESS",
    severity: "HIGH",
    windowMs: 24 * 60 * 60 * 1000,
    minimumSamples: 1,
    threshold: { count: 1 },
    eventTypes: ["HIGH_RISK_PAYMENT_CHANGE"],
    recommendedResponse: "Confirm authorisation; mark accepted risk only with authority.",
    version: 1
  },
  {
    ruleKey: "business.details_before_payment",
    name: "Customer or bank details changed before payment/release",
    description: "CUSTOMER_DETAILS_CHANGED or BANK_DETAILS_CHANGED near payment/release events.",
    category: "BUSINESS",
    severity: "CRITICAL",
    windowMs: 60 * 60 * 1000,
    minimumSamples: 2,
    threshold: { count: 2 },
    eventTypes: ["CUSTOMER_DETAILS_CHANGED", "BANK_DETAILS_CHANGED", "RELEASE_CODE_ACCESSED", "HIGH_RISK_PAYMENT_CHANGE"],
    recommendedResponse: "Contain payment workflow; open security incident.",
    version: 1
  },
  {
    ruleKey: "business.bulk_sensitive_change",
    name: "Bulk sensitive-record changes",
    description: "BULK_RECORD_CHANGE events exceeding threshold.",
    category: "BUSINESS",
    severity: "HIGH",
    windowMs: 30 * 60 * 1000,
    minimumSamples: 1,
    threshold: { count: 1 },
    eventTypes: ["BULK_RECORD_CHANGE"],
    recommendedResponse: "Verify staff role/location; open security incident if unexpected.",
    version: 1
  }
];

export const findingFingerprint = (parts: {
  ruleKey: string;
  organizationId: string;
  projectId?: string | null;
  environment: string;
  entityKey: string;
}): string =>
  createHash("sha256")
    .update(
      [parts.organizationId, parts.projectId || "", parts.environment, parts.ruleKey, parts.entityKey].join("|")
    )
    .digest("hex")
    .slice(0, 40);

export const baselineNoteFor = (args: {
  sampleCount: number;
  minimumSamples: number;
  exceeded: boolean;
  aboveNormal?: boolean;
}): string => {
  if (args.sampleCount < args.minimumSamples) return BASELINE_WORDING.INSUFFICIENT_DATA;
  if (args.aboveNormal) return BASELINE_WORDING.ABOVE_NORMAL;
  if (args.exceeded) return BASELINE_WORDING.THRESHOLD_EXCEEDED;
  return BASELINE_WORDING.OUTSIDE_PATTERN;
};

export const ensureDefaultDetectionRules = async (organizationId: string): Promise<number> => {
  let upserted = 0;
  const now = new Date();
  for (const rule of DEFAULT_DETECTION_RULES) {
    const existing = await prisma.securityDetectionRule.findFirst({
      where: {
        organizationId,
        projectId: null,
        environment: null,
        ruleKey: rule.ruleKey
      }
    });
    if (existing) continue;
    await prisma.securityDetectionRule.create({
      data: {
        id: randomUUID(),
        organizationId,
        projectId: null,
        environment: null,
        ruleKey: rule.ruleKey,
        name: rule.name,
        description: rule.description,
        version: rule.version,
        enabled: true,
        severity: rule.severity,
        category: rule.category,
        thresholdJson: rule.threshold,
        windowMs: rule.windowMs,
        minimumSamples: rule.minimumSamples,
        recommendedResponse: rule.recommendedResponse,
        isDefault: true,
        updatedAt: now
      }
    });
    upserted += 1;
  }
  return upserted;
};
