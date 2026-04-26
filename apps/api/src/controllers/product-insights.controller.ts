import { createHash, randomUUID } from "crypto";
import { Request, Response } from "express";
import { prisma } from "../lib/prisma";

type ActionLevel = "SAFE_AUTO_APPLY" | "MANUAL_APPLY" | "APPROVAL_REQUIRED";
type RiskLevel = "LOW" | "MEDIUM" | "HIGH";
type RecommendationStatus = "OPEN" | "APPLIED" | "DISMISSED" | "EXPIRED";
type RecommendationType = "COVERAGE_TARGET" | "MONITORING_PROFILE" | "SYNTHETIC_JOURNEY";

type RecommendationInput = {
  projectId: string;
  type: RecommendationType;
  targetKey: string;
  title: string;
  description: string;
  level: ActionLevel;
  status?: RecommendationStatus;
  expectedCoverageGain?: number;
  actionLabel: string;
  payload?: Record<string, unknown>;
  source?: string;
  riskLevel?: RiskLevel;
  applyType?: string;
  expectedOutcome?: string;
  mostImportantWarning?: string;
  previewItems?: string[];
};

const FLOW_STEPS = [
  { key: "public_site", label: "Public site loads", signals: ["FRONTEND", "HTTP"] },
  { key: "login", label: "Login works", signals: ["AUTH_FAILURE_SPIKE", "AUTH_SPIKE", "KEYWORD"] },
  { key: "booking", label: "Booking submits", signals: ["BOOKING_FAILED"] },
  { key: "payment", label: "Payment completes", signals: ["PAYMENT_FAILED", "STRIPE"] },
  { key: "webhook", label: "Webhook confirms", signals: ["WEBHOOK_FAILED", "WEBHOOK"] },
] as const;

const PROFILE_LIBRARY: Record<string, string[]> = {
  STRIPE: [
    "Payment failure event monitoring",
    "Stripe webhook delivery monitoring",
    "Payment verification remediation",
    "Payment latency and auth failure checks",
  ],
  EMAIL: [
    "Delivery failure monitoring",
    "Bounce/reject event monitoring",
    "Provider health endpoint check",
    "Customer communication impact scoring",
  ],
  WEBHOOK: [
    "Webhook endpoint availability",
    "Signature failure monitoring",
    "Retry and redelivery diagnostics",
    "Downstream integration latency",
  ],
  DEPLOYMENT_PROVIDER: [
    "Deployment failure monitoring",
    "Rollback action readiness",
    "Post-deploy health check",
    "Change-to-incident correlation",
  ],
  SERVICE_PROVIDER: [
    "Service restart action readiness",
    "Provider status correlation",
    "Availability and response-time checks",
  ],
  WORKER_PROVIDER: [
    "Worker heartbeat monitoring",
    "Queue failure monitoring",
    "Requeue remediation readiness",
  ],
  STATUS_PROVIDER: [
    "External status page correlation",
    "Provider incident enrichment",
  ],
  RUNBOOK_PROVIDER: [
    "Incident runbook linking",
    "Human review routing",
  ],
};

const RECOMMENDATION_STATUS = {
  OPEN: "OPEN",
  APPLIED: "APPLIED",
  DISMISSED: "DISMISSED",
  EXPIRED: "EXPIRED",
} as const;

const riskLevelForActionLevel = (level: ActionLevel): RiskLevel => {
  if (level === "APPROVAL_REQUIRED") return "HIGH";
  if (level === "MANUAL_APPLY") return "MEDIUM";
  return "LOW";
};

const sourceForRecommendation = (type: RecommendationType) => {
  if (type === "MONITORING_PROFILE") return "INTEGRATION";
  if (type === "SYNTHETIC_JOURNEY") return "CORRELATION";
  return "COVERAGE";
};

const parseUrl = (value: string | null | undefined): URL | null => {
  if (!value) return null;
  try {
    return new URL(value);
  } catch {
    return null;
  }
};

const isLocalHostname = (hostname: string): boolean => {
  const normalized = hostname.toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
};

const isPublicHttpUrl = (value: string | null | undefined): boolean => {
  const parsed = parseUrl(value);
  return Boolean(parsed && ["http:", "https:"].includes(parsed.protocol) && !isLocalHostname(parsed.hostname));
};

const isPublicHttpsUrl = (value: string | null | undefined): boolean => {
  const parsed = parseUrl(value);
  return Boolean(parsed && parsed.protocol === "https:" && !isLocalHostname(parsed.hostname));
};

const isDemoText = (value: string | null | undefined): boolean => {
  const text = (value || "").toUpperCase();
  return text.includes("INTEGRATION TEST") || text.includes("LOCAL-SMOKE") || text.includes("VERIFICATION ");
};

const serviceMatchesUrl = (service: any, url: string): boolean => {
  if (!service?.baseUrl) return false;
  return service.baseUrl === url;
};

const isValidPublicHttpCheck = (check: any): boolean => {
  const targetUrl = check?.service?.baseUrl;
  return check?.type === "HTTP" && isPublicHttpUrl(targetUrl) && !isDemoText(check?.name);
};

const isValidPublicSslCheck = (check: any): boolean => {
  const targetUrl = check?.service?.baseUrl;
  return check?.type === "SSL" && isPublicHttpsUrl(targetUrl) && !isDemoText(check?.name);
};

const isCredibleOperationalAlert = (alert: any): boolean => {
  const title = String(alert?.title || "");
  const message = String(alert?.message || "");
  if (isDemoText(title) || isDemoText(message)) return false;
  if (message.includes("SSL checks require https:// URLs; received http:")) return false;
  return true;
};

const hasSignal = (project: any, signal: string): boolean => {
  const checks = project.services.flatMap((service: any) =>
    service.checks
      .filter((check: any) => {
        if (check.type === "SSL") return isValidPublicSslCheck({ ...check, service });
        if (check.type === "HTTP") return isValidPublicHttpCheck({ ...check, service });
        return !isDemoText(check.name);
      })
      .map((check: any) => `${service.type} ${check.type} ${check.name}`),
  );
  const integrations = project.integrations.map((integration: any) => integration.type);
  const events = project.events.filter((event: any) => !isDemoText(event.message)).map((event: any) => event.type);
  return [...checks, ...integrations, ...events].some((value) => String(value).toUpperCase().includes(signal));
};

const coverageItem = (
  key: string,
  label: string,
  covered: boolean,
  source: string | null,
  recommendationText: string,
) => ({ key, label, covered, source: source || null, recommendation: recommendationText });

const recommendationId = (projectId: string, type: string, targetKey: string) =>
  createHash("sha1").update(`${projectId}:${type}:${targetKey}`).digest("hex").slice(0, 16);

const recommendation = (input: RecommendationInput) => ({
  id: recommendationId(input.projectId, input.type, input.targetKey),
  projectId: input.projectId,
  type: input.type,
  targetKey: input.targetKey,
  title: input.title,
  description: input.description,
  level: input.level,
  status: input.status || RECOMMENDATION_STATUS.OPEN,
  expectedCoverageGain: input.expectedCoverageGain ?? 10,
  actionLabel: input.actionLabel,
  payload: input.payload || {},
  source: input.source || sourceForRecommendation(input.type),
  riskLevel: input.riskLevel || riskLevelForActionLevel(input.level),
  applyType: input.applyType || input.level,
  expectedOutcome: input.expectedOutcome || input.description,
  mostImportantWarning: input.mostImportantWarning || "Review the target configuration before applying this recommendation.",
  previewItems: input.previewItems || [],
});

type InsightRecommendationView = ReturnType<typeof recommendation>;

const inferBusinessImpact = (alert: any) => {
  if (!isCredibleOperationalAlert(alert)) {
    return { area: "Monitoring hygiene", score: 15, summary: "This finding appears to come from demo or invalid monitoring data and should not drive business prioritization." };
  }
  const text = `${alert.title || ""} ${alert.message || ""}`.toUpperCase();
  if (text.includes("PAYMENT") || text.includes("CHECKOUT") || text.includes("STRIPE")) {
    return { area: "Revenue", score: 95, summary: "Payment or checkout failure can block revenue capture." };
  }
  if (text.includes("BOOKING")) {
    return { area: "Customer conversion", score: 90, summary: "Booking failure can stop customers from completing the core journey." };
  }
  if (text.includes("EMAIL") || text.includes("WEBHOOK")) {
    return { area: "Customer communication", score: 72, summary: "Notification or webhook failure can break customer and operator follow-up." };
  }
  if (text.includes("HEARTBEAT") || text.includes("SERVICE") || text.includes("HTTP") || text.includes("SSL")) {
    return { area: "Availability", score: 80, summary: "Availability signal is impaired; users or operators may be affected." };
  }
  return { area: "Operations", score: 55, summary: "Open alert may require operator review." };
};

const rootCauseHypothesis = (project: any) => {
  const openAlerts = project.alerts.filter((alert: any) => isCredibleOperationalAlert(alert));
  if (openAlerts.length === 0) {
    return { severity: "LOW", title: "No active correlation", summary: "No open alerts are available for correlation.", contributingSignals: [] };
  }
  const titles = openAlerts.map((alert: any) => `${alert.title || ""} ${alert.message || ""}`.toUpperCase());
  const hasBackend = titles.some((title: string) => title.includes("HTTP") || title.includes("RESPONSE") || title.includes("HEARTBEAT") || title.includes("SERVICE"));
  const hasPayment = titles.some((title: string) => title.includes("PAYMENT") || title.includes("STRIPE"));
  const hasWebhook = titles.some((title: string) => title.includes("WEBHOOK"));
  const hasSsl = titles.some((title: string) => title.includes("SSL") || title.includes("TLS"));
  if (hasBackend && (hasPayment || hasWebhook)) {
    return {
      severity: "HIGH",
      title: "Backend degradation may be causing downstream failures",
      summary: "Availability or heartbeat signals are active alongside payment/webhook alerts. Check backend health before treating each downstream alert as independent.",
      contributingSignals: openAlerts.map((alert: any) => alert.title),
    };
  }
  if (hasSsl && openAlerts.length >= 2) {
    return {
      severity: "MEDIUM",
      title: "Monitoring configuration likely needs correction",
      summary: "Multiple SSL/TLS alerts are open. Verify SSL checks target public https:// origins, not local HTTP endpoints.",
      contributingSignals: openAlerts.map((alert: any) => alert.title),
    };
  }
  if (hasPayment) {
    return {
      severity: "HIGH",
      title: "Payment path is the primary active risk",
      summary: "Payment failure alerts are open. Review Stripe/webhook delivery and payment verification before clearing the project.",
      contributingSignals: openAlerts.map((alert: any) => alert.title),
    };
  }
  return {
    severity: "MEDIUM",
    title: openAlerts[0]?.title || "Open operational risk",
    summary: "Open alerts exist but do not yet form a strong multi-layer correlation.",
    contributingSignals: openAlerts.map((alert: any) => alert.title),
  };
};

const remediationLearning = async (organizationId: string) => {
  const logs = await (prisma as any).remediationLog
    .findMany({
      where: { Incident: { Project: { organizationId } } },
      orderBy: { createdAt: "desc" },
      take: 500,
    })
    .catch(() => []);
  const byAction = new Map<string, any>();
  for (const log of logs) {
    const current = byAction.get(log.action) || {
      action: log.action,
      suggestedCount: 0,
      executedCount: 0,
      succeededCount: 0,
      failedCount: 0,
      averageTimeSavedMinutes: 0,
      lastEnvironment: null,
      impactTier: log.impactTier || null,
    };
    current.suggestedCount += 1;
    if (["SUCCEEDED", "FAILED", "EXECUTING"].includes(log.status)) current.executedCount += 1;
    if (log.status === "SUCCEEDED") current.succeededCount += 1;
    if (log.status === "FAILED") current.failedCount += 1;
    if (!current.lastEnvironment && log.contextJson?.environment) current.lastEnvironment = log.contextJson.environment;
    byAction.set(log.action, current);
  }
  return Array.from(byAction.values()).map((item) => ({
    ...item,
    successRate: item.executedCount ? Math.round((item.succeededCount / item.executedCount) * 100) : 0,
    failureRate: item.executedCount ? Math.round((item.failedCount / item.executedCount) * 100) : 0,
    averageTimeSavedMinutes: item.succeededCount * 8,
  }));
};

const buildRecommendations = (
  project: any,
  coverage: Array<ReturnType<typeof coverageItem>>,
  criticalPaths: any[],
  connectionProfiles: any[],
) => {
  const recommendations: InsightRecommendationView[] = [];
  const serviceWithUrl = project.services.find((service: any) => isPublicHttpUrl(service.baseUrl));

  for (const item of coverage.filter((coverageItemValue) => !coverageItemValue.covered)) {
    if (item.key === "public_site" && (project.frontendUrl || serviceWithUrl?.baseUrl)) {
      recommendations.push(recommendation({
        projectId: project.id,
        type: "COVERAGE_TARGET",
        targetKey: item.key,
        title: "Create public site HTTP check",
        description: "Add a safe HTTP 200 check for the main public entry point.",
        level: "SAFE_AUTO_APPLY",
        expectedCoverageGain: 16,
        actionLabel: "Create HTTP check",
        payload: { url: project.frontendUrl || serviceWithUrl?.baseUrl },
        expectedOutcome: "Create or reuse a frontend service and attach a public HTTP availability check.",
        mostImportantWarning: "Use the real public URL, not an internal or local endpoint.",
        previewItems: ["Frontend service record", "HTTP 200 health check", "Coverage target update for public_site"],
      }));
    } else if (item.key === "ssl" && (project.frontendUrl || serviceWithUrl?.baseUrl)) {
      recommendations.push(recommendation({
        projectId: project.id,
        type: "COVERAGE_TARGET",
        targetKey: item.key,
        title: "Create SSL expiry check",
        description: "Add an SSL certificate expiry check for a public https:// origin.",
        level: "MANUAL_APPLY",
        expectedCoverageGain: 16,
        actionLabel: "Create SSL check",
        payload: { url: project.frontendUrl || serviceWithUrl?.baseUrl },
        expectedOutcome: "Create or reuse a frontend service and attach an SSL expiry check.",
        mostImportantWarning: "This only works against a public https:// endpoint with a valid certificate chain.",
        previewItems: ["Frontend service record", "SSL expiry check", "Coverage target update for ssl"],
      }));
    } else {
      recommendations.push(recommendation({
        projectId: project.id,
        type: "COVERAGE_TARGET",
        targetKey: item.key,
        title: `Plan ${item.label.toLowerCase()}`,
        description: item.recommendation,
        level: item.key === "payment_flow" ? "APPROVAL_REQUIRED" : "MANUAL_APPLY",
        expectedCoverageGain: 10,
        actionLabel: "Track recommendation",
        expectedOutcome: "Record the missing coverage target and keep it visible in Insights.",
        mostImportantWarning: "This recommendation does not create live monitoring yet; it records the gap for follow-up.",
        previewItems: ["Insight action log", "Coverage target tracking state"],
      }));
    }
  }

  for (const path of criticalPaths.filter((criticalPath) => !criticalPath.covered)) {
    recommendations.push(recommendation({
      projectId: project.id,
      type: "SYNTHETIC_JOURNEY",
      targetKey: path.key,
      title: `Create synthetic journey: ${path.label}`,
      description: path.recommendedCheck,
      level: path.key === "payment" ? "APPROVAL_REQUIRED" : "MANUAL_APPLY",
      expectedCoverageGain: 8,
      actionLabel: "Create journey template",
      expectedOutcome: "Create a draft synthetic journey template for this critical path.",
      mostImportantWarning: path.key === "payment"
        ? "Payment flows can affect real provider traffic if test-mode boundaries are unclear."
        : "Confirm credentials and target data are safe before turning the draft into an active journey.",
      previewItems: ["Synthetic journey draft", "Journey template event", `Coverage target update for ${path.key}`],
    }));
  }

  for (const profile of connectionProfiles.filter((connectionProfile) => connectionProfile.attachedCount === 0)) {
    recommendations.push(recommendation({
      projectId: project.id,
      type: "MONITORING_PROFILE",
      targetKey: profile.type,
      title: `Install ${profile.type} monitoring profile`,
      description: `Attach recommended monitors: ${profile.monitors.join(", ")}.`,
      level: profile.type === "STRIPE" ? "APPROVAL_REQUIRED" : "MANUAL_APPLY",
      expectedCoverageGain: 12,
      actionLabel: "Install profile",
      expectedOutcome: `Enable the ${profile.type} monitoring profile for this project.`,
      mostImportantWarning: profile.type === "STRIPE"
        ? "Confirm payment-provider credentials and webhook targets before enabling production monitoring."
        : "Profile installation enables provider-specific monitoring for this project integration.",
      previewItems: ["Project integration upsert", ...profile.monitors.slice(0, 3)],
    }));
  }

  return recommendations;
};

const loadProjectsForInsights = async (orgId: string) => {
  const rows = await (prisma as any).project.findMany({
    where: { organizationId: orgId },
    include: {
      ProjectIntegration: true,
      Event: { orderBy: { createdAt: "desc" }, take: 50 },
      Heartbeat: { orderBy: { receivedAt: "desc" }, take: 1 },
      Alert: {
        where: { status: { in: ["OPEN", "ACKNOWLEDGED"] } },
        orderBy: { lastSeenAt: "desc" },
      },
      Service: {
        include: {
          Check: {
            include: { CheckResult: { orderBy: { checkedAt: "desc" }, take: 1 } },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });
  return rows.map((project: any) => ({
    ...project,
    integrations: project.ProjectIntegration,
    events: project.Event,
    heartbeats: project.Heartbeat,
    alerts: project.Alert,
    services: project.Service.map((service: any) => ({
      ...service,
      checks: service.Check.map((check: any) => ({ ...check, results: check.CheckResult })),
    })),
  }));
};

const buildProjectInsight = (project: any) => {
  const checks = project.services.flatMap((service: any) => service.checks.map((check: any) => ({ ...check, service })));
  const serviceTypes = new Set<string>(project.services.map((service: any) => service.type as string));
  const validHttpChecks = checks.filter((check: any) => isValidPublicHttpCheck(check));
  const validSslChecks = checks.filter((check: any) => isValidPublicSslCheck(check));
  const checkTypes = new Set<string>([
    ...(validHttpChecks.length > 0 ? ["HTTP"] : []),
    ...(validSslChecks.length > 0 ? ["SSL"] : []),
  ]);
  const integrations = new Set<string>(project.integrations.map((integration: any) => integration.type as string));
  const meaningfulEvents = project.events.filter((event: any) => !isDemoText(event.message));
  const credibleAlerts = project.alerts.filter((alert: any) => isCredibleOperationalAlert(alert));
  const coverage = [
    coverageItem("public_site", "Public site monitored", serviceTypes.has("FRONTEND") && validHttpChecks.length > 0, "HTTP check", "Add an HTTP or keyword check for the main public URL."),
    coverageItem("admin_flow", "Admin flow monitored", checks.some((check: any) => check.name.toUpperCase().includes("ADMIN")), "Synthetic journey", "Add a synthetic login/dashboard journey for the admin path."),
    coverageItem("payment_flow", "Payment flow monitored", integrations.has("STRIPE") || meaningfulEvents.some((event: any) => event.type === "PAYMENT_FAILED"), "Stripe/event signal", "Attach Stripe profile and add a test-mode payment journey."),
    coverageItem("webhook_health", "Webhook health monitored", integrations.has("WEBHOOK") || meaningfulEvents.some((event: any) => event.type === "WEBHOOK_FAILED"), "Webhook integration", "Add webhook delivery monitoring and signature failure events."),
    coverageItem("ssl", "SSL monitored", validSslChecks.length > 0, "SSL check", "Add SSL expiry checks only for public https:// origins."),
    coverageItem("domain_expiry", "Domain expiry monitored", meaningfulEvents.some((event: any) => event.type === "DOMAIN_EXPIRING"), "Domain event", "Add domain expiry monitoring for production domains."),
  ];
  const criticalPaths = FLOW_STEPS.map((step) => ({
    ...step,
    covered: step.signals.some((signal) => hasSignal(project, signal)),
    recommendedCheck: step.key === "payment"
      ? "Run checkout in test mode and expect payment confirmation webhook."
      : step.key === "login"
        ? "Open login page, submit test credentials, confirm dashboard render."
        : step.key === "booking"
          ? "Submit test booking and confirm success state."
          : step.key === "webhook"
            ? "Send signed test webhook and confirm acknowledgement."
            : "Open public page and validate expected content.",
  }));
  const connectionProfiles = Array.from(integrations).map((type) => ({
    type,
    enabled: project.integrations.find((integration: any) => integration.type === type)?.enabled ?? false,
    monitors: PROFILE_LIBRARY[type] || ["Provider validation", "Availability check"],
    attachedCount: checks.filter((check: any) => check.name.toUpperCase().includes(type)).length,
  }));
  const businessImpact = credibleAlerts
    .map((alert: any) => ({ alertId: alert.id, title: alert.title, severity: alert.severity, ...inferBusinessImpact(alert) }))
    .sort((left: any, right: any) => right.score - left.score);
  const deepDiagnostics = credibleAlerts.length > 0
    ? [
        "Temporarily increase check frequency for affected services.",
        "Compare last successful result against latest failed result.",
        "Cluster repeated error messages and retry traces.",
        "Run provider-specific diagnostics for connected integrations.",
      ]
    : ["Deep diagnostics stays idle until an incident or open alert appears."];
  return {
    id: project.id,
    name: project.name,
    status: project.status,
    openAlertCount: credibleAlerts.length,
    latestHeartbeatAt: project.heartbeats[0]?.receivedAt ?? null,
    coverage,
    coverageScore: Math.round((coverage.filter((item) => item.covered).length / coverage.length) * 100),
    criticalPaths,
    syntheticJourneys: criticalPaths.filter((step) => !step.covered).map((step) => ({
      name: step.label,
      mode: step.key === "payment" ? "checkout-test-mode" : "browser",
      recommendation: step.recommendedCheck,
    })),
    connectionProfiles,
    rootCause: rootCauseHypothesis(project),
    businessImpact,
    deepDiagnostics,
    recommendations: buildRecommendations(project, coverage, criticalPaths, connectionProfiles),
  };
};

const createInsightActionEvent = async (
  db: any,
  projectId: string,
  rec: InsightRecommendationView,
  status: string,
  message: string,
  details: Record<string, unknown>,
) => {
  await db.event.create({
    data: {
      id: randomUUID(),
      projectId,
      type: "DEPLOYMENT_FINISHED",
      severity: "INFO",
      source: "insight-action",
      message,
      payloadJson: {
        recommendationId: rec.id,
        recommendationType: rec.type,
        targetKey: rec.targetKey,
        level: rec.level,
        status,
        details,
      },
    },
  });
};

const ensureServiceForRecommendation = async (db: any, project: any, url: string, type: string) => {
  const existing = project.services.find((service: any) => service.type === type && serviceMatchesUrl(service, url))
    || (await db.service.findFirst({ where: { projectId: project.id, type, baseUrl: url } }));
  if (existing) return existing;
  return db.service.create({
    data: {
      id: randomUUID(),
      projectId: project.id,
      name: type === "FRONTEND" ? "Public site" : `${type.toLowerCase()} service`,
      type,
      baseUrl: url,
      isCritical: type === "FRONTEND",
      updatedAt: new Date(),
    },
  });
};

const ensureHttpCheckForRecommendation = async (db: any, serviceId: string) => {
  const existing = await db.check.findFirst({
    where: {
      serviceId,
      OR: [{ name: "Public site HTTP" }, { type: "HTTP", expectedStatusCode: 200 }],
    },
  });
  if (existing) return { check: existing, created: false };
  const check = await db.check.create({
    data: {
      id: randomUUID(),
      serviceId,
      name: "Public site HTTP",
      type: "HTTP",
      intervalSeconds: 60,
      timeoutMs: 5000,
      expectedStatusCode: 200,
      failureThreshold: 1,
      recoveryThreshold: 1,
      updatedAt: new Date(),
    },
  });
  return { check, created: true };
};

const ensureSslCheckForRecommendation = async (db: any, serviceId: string) => {
  const existing = await db.check.findFirst({ where: { serviceId, name: "Public SSL expiry" } });
  if (existing) return { check: existing, created: false };
  const check = await db.check.create({
    data: {
      id: randomUUID(),
      serviceId,
      name: "Public SSL expiry",
      type: "SSL",
      intervalSeconds: 86400,
      timeoutMs: 5000,
      failureThreshold: 1,
      recoveryThreshold: 1,
      updatedAt: new Date(),
    },
  });
  return { check, created: true };
};

const ensureSyntheticJourneyForRecommendation = async (
  db: any,
  projectId: string,
  rec: InsightRecommendationView,
  createdById: string | null,
) => {
  const journeyName = rec.title.replace("Create synthetic journey: ", "");
  const journeyType = rec.targetKey === "payment" ? "CHECKOUT" : "BROWSER";
  const existing = await db.syntheticJourney.findFirst({ where: { projectId, name: journeyName, type: journeyType } }).catch(() => null);
  if (existing) return { journey: existing, created: false };
  const journey = await db.syntheticJourney.create({
    data: {
      id: randomUUID(),
      projectId,
      name: journeyName,
      type: journeyType,
      status: "DRAFT",
      definitionJson: { targetKey: rec.targetKey, recommendation: rec.description },
      createdById,
    },
  });
  return { journey, created: true };
};

const upsertCoverageTargetForRecommendation = async (
  db: any,
  projectId: string,
  rec: InsightRecommendationView,
  details: Record<string, unknown>,
) => {
  await db.coverageTarget?.upsert?.({
    where: { projectId_targetKey: { projectId, targetKey: rec.targetKey } },
    update: {
      targetType: rec.type,
      label: rec.title,
      isCovered: true,
      coverageSource: rec.source,
      detailsJson: { recommendationId: rec.id, ...details },
      updatedAt: new Date(),
    },
    create: {
      id: randomUUID(),
      projectId,
      targetType: rec.type,
      targetKey: rec.targetKey,
      label: rec.title,
      criticality: rec.riskLevel,
      isCovered: true,
      coverageSource: rec.source,
      detailsJson: { recommendationId: rec.id, ...details },
      updatedAt: new Date(),
    },
  }).catch(() => null);
};

const upsertPersistedRecommendation = async (rec: InsightRecommendationView) => {
  const existing = await (prisma as any).insightRecommendation.findUnique({ where: { id: rec.id } });
  if (!existing) {
    return (prisma as any).insightRecommendation.create({
      data: {
        id: rec.id,
        projectId: rec.projectId,
        type: rec.type,
        title: rec.title,
        description: rec.description,
        priority: 100 - rec.expectedCoverageGain,
        riskLevel: rec.riskLevel,
        actionLevel: rec.level,
        payloadJson: rec.payload,
        status: RECOMMENDATION_STATUS.OPEN,
        source: rec.source,
      },
    });
  }
  return (prisma as any).insightRecommendation.update({
    where: { id: rec.id },
    data: {
      title: rec.title,
      description: rec.description,
      priority: 100 - rec.expectedCoverageGain,
      riskLevel: rec.riskLevel,
      actionLevel: rec.level,
      payloadJson: rec.payload,
      source: rec.source,
    },
  });
};

const logActionRun = async (
  db: any,
  projectId: string,
  insightRecommendationId: string,
  actionType: string,
  status: string,
  requestedById: string | undefined,
  approvedById: string | undefined,
  resultJson: Record<string, unknown> | null,
  errorMessage: string | null,
) => db.insightActionRun.create({
  data: {
    id: randomUUID(),
    projectId,
    insightRecommendationId,
    actionType,
    status,
    requestedById: requestedById || null,
    approvedById: approvedById || null,
    resultJson,
    errorMessage,
    completedAt: status === "COMPLETED" || status === "FAILED" || status === "DISMISSED" || status === "APPROVED" ? new Date() : null,
  },
});

const ensureProjectIntegration = async (tx: any, projectId: string, type: string, monitors: string[] = []) => tx.projectIntegration.upsert({
  where: { projectId_type: { projectId, type } },
  update: { enabled: true, updatedAt: new Date() },
  create: {
    id: randomUUID(),
    projectId,
    type,
    enabled: true,
    name: `${type} monitoring profile`,
    configJson: { monitors: monitors.length ? monitors : PROFILE_LIBRARY[type] || [] },
    updatedAt: new Date(),
  },
});

const syncPersistedRecommendationState = async (projectInsights: any[]) => {
  for (const insight of projectInsights) {
    for (const rec of insight.recommendations as InsightRecommendationView[]) {
      await upsertPersistedRecommendation(rec);
    }

    const activeIds = (insight.recommendations as InsightRecommendationView[]).map((rec) => rec.id);
    await (prisma as any).insightRecommendation.updateMany({
      where: {
        projectId: insight.id,
        status: RECOMMENDATION_STATUS.OPEN,
        ...(activeIds.length ? { id: { notIn: activeIds } } : {}),
      },
      data: { status: RECOMMENDATION_STATUS.EXPIRED },
    });

    const persisted = await (prisma as any).insightRecommendation.findMany({
      where: { projectId: insight.id, id: { in: activeIds } },
      select: { id: true, status: true },
    });
    const persistedById = new Map<string, RecommendationStatus>(
      persisted.map((row: { id: string; status: RecommendationStatus }) => [row.id, row.status]),
    );

    insight.recommendations = (insight.recommendations as InsightRecommendationView[])
      .map((rec) => ({ ...rec, status: persistedById.get(rec.id) || rec.status }))
      .filter((rec) => rec.status === RECOMMENDATION_STATUS.OPEN);
  }

  return projectInsights;
};

const summarizeActionResult = (resultJson: Record<string, unknown> | null | undefined) => {
  if (!resultJson) return null;
  const keys = Object.keys(resultJson).filter((key) => resultJson[key] !== null && resultJson[key] !== undefined);
  if (!keys.length) return null;
  return keys.map((key) => `${key}: ${String(resultJson[key])}`).join(", ");
};

export const getProductInsights = async (req: Request, res: Response) => {
  const orgId = (req as any).user?.organizationId;
  if (!orgId) {
    res.status(403).json({ error: "Organization required" });
    return;
  }
  const projects = await loadProjectsForInsights(orgId);
  const projectInsights = await syncPersistedRecommendationState(projects.map(buildProjectInsight));
  const learningLoop = await remediationLearning(orgId);
  const actionHistory = await (prisma as any).event
    .findMany({ where: { Project: { organizationId: orgId }, source: "insight-action" }, orderBy: { createdAt: "desc" }, take: 30 })
    .catch(() => []);
  res.json({
    generatedAt: new Date().toISOString(),
    projects: projectInsights,
    portfolio: {
      projects: projectInsights.length,
      averageCoverage: projectInsights.length ? Math.round(projectInsights.reduce((sum: number, project: any) => sum + project.coverageScore, 0) / projectInsights.length) : 0,
      openBusinessRisks: projectInsights.reduce((sum: number, project: any) => sum + project.businessImpact.length, 0),
      activeCorrelations: projectInsights.filter((project: any) => project.rootCause.severity !== "LOW").length,
    },
    remediationLearning: learningLoop,
    actionHistory,
  });
};

export const getInsightRecommendations = async (req: Request, res: Response) => {
  const orgId = (req as any).user?.organizationId;
  if (!orgId) {
    res.status(403).json({ error: "Organization required" });
    return;
  }
  const { projectId, status } = req.query as Record<string, string>;
  const projects = await loadProjectsForInsights(orgId);
  const filteredProjects = projectId ? projects.filter((project: any) => project.id === projectId) : projects;
  const generatedByProject = new Map<string, InsightRecommendationView[]>();
  for (const project of filteredProjects) {
    const insight = buildProjectInsight(project);
    generatedByProject.set(project.id, insight.recommendations);
    for (const rec of insight.recommendations) await upsertPersistedRecommendation(rec);
  }
  for (const [currentProjectId, recs] of generatedByProject.entries()) {
    const activeIds = recs.map((rec) => rec.id);
    await (prisma as any).insightRecommendation.updateMany({
      where: {
        projectId: currentProjectId,
        status: RECOMMENDATION_STATUS.OPEN,
        ...(activeIds.length ? { id: { notIn: activeIds } } : {}),
      },
      data: { status: RECOMMENDATION_STATUS.EXPIRED },
    });
  }
  const recommendations = await (prisma as any).insightRecommendation.findMany({
    where: {
      projectId: { in: filteredProjects.map((project: any) => project.id) },
      ...(status ? { status: String(status) } : {}),
    },
    orderBy: [{ createdAt: "desc" }, { priority: "asc" }],
  });
  res.json({ recommendations });
};

export const getInsightActionRuns = async (req: Request, res: Response) => {
  const orgId = (req as any).user?.organizationId;
  if (!orgId) {
    res.status(403).json({ error: "Organization required" });
    return;
  }
  const { projectId } = req.query as Record<string, string>;
  const orgProjects = await (prisma as any).project.findMany({ where: { organizationId: orgId }, select: { id: true } });
  const scopedProjectIds = orgProjects.map((project: { id: string }) => project.id);
  const actionRuns = await (prisma as any).insightActionRun.findMany({
    where: { projectId: { in: scopedProjectIds }, ...(projectId ? { projectId } : {}) },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  const userIds = Array.from(new Set(actionRuns.flatMap((run: any) => [run.requestedById, run.approvedById].filter(Boolean)))) as string[];
  const users = userIds.length
    ? await (prisma as any).user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } })
    : [];
  const usersById = new Map(users.map((user: any) => [user.id, user]));
  res.json({
    actionRuns: actionRuns.map((run: any) => ({
      ...run,
      requestedBy: run.requestedById ? usersById.get(run.requestedById) || null : null,
      approvedBy: run.approvedById ? usersById.get(run.approvedById) || null : null,
      resultSummary: summarizeActionResult(run.resultJson),
    })),
  });
};

export const getInsightApprovals = async (req: Request, res: Response) => {
  const orgId = (req as any).user?.organizationId;
  if (!orgId) {
    res.status(403).json({ error: "Organization required" });
    return;
  }
  const { projectId } = req.query as Record<string, string>;
  const orgProjects = await (prisma as any).project.findMany({ where: { organizationId: orgId }, select: { id: true } });
  const scopedProjectIds = orgProjects.map((project: { id: string }) => project.id);
  const latestPendingRuns = await (prisma as any).insightActionRun.findMany({
    where: {
      projectId: { in: scopedProjectIds },
      status: "PENDING_APPROVAL",
      ...(projectId ? { projectId } : {}),
    },
    orderBy: [{ createdAt: "desc" }],
    take: 100,
  });
  const deduped = new Map<string, any>();
  for (const run of latestPendingRuns) {
    if (!deduped.has(run.insightRecommendationId)) {
      deduped.set(run.insightRecommendationId, run);
    }
  }
  const pendingRuns = Array.from(deduped.values());
  const recommendationIds = pendingRuns.map((run: any) => run.insightRecommendationId);
  const recommendations = recommendationIds.length
    ? await (prisma as any).insightRecommendation.findMany({ where: { id: { in: recommendationIds } } })
    : [];
  const recById = new Map(recommendations.map((rec: any) => [rec.id, rec]));
  const userIds = Array.from(new Set(pendingRuns.flatMap((run: any) => [run.requestedById].filter(Boolean)))) as string[];
  const users = userIds.length
    ? await (prisma as any).user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } })
    : [];
  const usersById = new Map(users.map((user: any) => [user.id, user]));
  res.json({
    approvals: pendingRuns
      .map((run: any) => ({
        recommendation: recById.get(run.insightRecommendationId) || null,
        pendingRun: {
          ...run,
          requestedBy: run.requestedById ? usersById.get(run.requestedById) || null : null,
        },
      }))
      .filter((item: any) => item.recommendation),
  });
};

export const applyRecommendationById = async (req: Request, res: Response) => {
  try {
    const orgId = (req as any).user?.organizationId;
    if (!orgId) {
      res.status(403).json({ error: "Organization required" });
      return;
    }
    const { id } = req.params;
    const { projectId, approve } = req.body || {};
    if (!projectId) {
      res.status(400).json({ error: "projectId is required" });
      return;
    }
    const projects = await loadProjectsForInsights(orgId);
    const project = projects.find((projectValue: any) => projectValue.id === projectId);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    const insight = buildProjectInsight(project);
    const generatedRec = insight.recommendations.find((rec: InsightRecommendationView) => rec.id === id);
    let persisted = await (prisma as any).insightRecommendation.findFirst({ where: { id, projectId } });
    if (!persisted && generatedRec) persisted = await upsertPersistedRecommendation(generatedRec);
    if (!persisted) {
      res.status(404).json({ error: "Recommendation not found" });
      return;
    }
    if (persisted.status === RECOMMENDATION_STATUS.APPLIED) {
      res.status(409).json({ error: "Recommendation already applied", recommendation: persisted });
      return;
    }
    if (persisted.status === RECOMMENDATION_STATUS.DISMISSED) {
      res.status(409).json({ error: "Recommendation already dismissed", recommendation: persisted });
      return;
    }
    if (persisted.status === RECOMMENDATION_STATUS.EXPIRED) {
      res.status(409).json({ error: "Recommendation expired", recommendation: persisted });
      return;
    }
    const rec: InsightRecommendationView = generatedRec
      ? { ...generatedRec, payload: generatedRec.payload || persisted.payloadJson || {} }
      : recommendation({
          projectId: persisted.projectId,
          type: persisted.type,
          targetKey: persisted.type,
          title: persisted.title,
          description: persisted.description,
          level: persisted.actionLevel,
          status: persisted.status,
          expectedCoverageGain: 10,
          actionLabel: "Apply",
          payload: persisted.payloadJson || {},
          source: persisted.source,
          riskLevel: persisted.riskLevel,
          previewItems: [],
        });
    if (rec.level === "APPROVAL_REQUIRED" && !approve) {
      await createInsightActionEvent(prisma as any, project.id, rec, "PENDING_APPROVAL", `Approval required for ${rec.title}`, {});
      await logActionRun(prisma as any, project.id, rec.id, rec.type, "PENDING_APPROVAL", (req as any).user?.id, undefined, null, null);
      res.status(202).json({ status: "PENDING_APPROVAL", recommendation: rec });
      return;
    }
    const result = await (prisma as any).$transaction(async (tx: any) => {
      const details: Record<string, unknown> = {};
      const requestedById = (req as any).user?.id || null;
      const approvedById = rec.level === "APPROVAL_REQUIRED" && approve ? requestedById : null;
      if (rec.type === "COVERAGE_TARGET" && rec.targetKey === "public_site") {
        const url = (rec.payload as any).url;
        if (!url || typeof url !== "string") throw new Error("HTTP recommendation requires a public URL");
        const service = await ensureServiceForRecommendation(tx, project, url, "FRONTEND");
        const { check } = await ensureHttpCheckForRecommendation(tx, service.id);
        details.serviceId = service.id;
        details.checkId = check.id;
      } else if (rec.type === "COVERAGE_TARGET" && rec.targetKey === "ssl") {
        const url = (rec.payload as any).url;
        if (!url || !String(url).startsWith("https://")) throw new Error("SSL recommendation needs a public https:// URL");
        const service = await ensureServiceForRecommendation(tx, project, url, "FRONTEND");
        const { check } = await ensureSslCheckForRecommendation(tx, service.id);
        details.serviceId = service.id;
        details.checkId = check.id;
      } else if (rec.type === "COVERAGE_TARGET" && rec.targetKey === "admin_flow") {
        const journeyRec = recommendation({
          projectId: project.id,
          type: "SYNTHETIC_JOURNEY",
          targetKey: "admin_access",
          title: "Verify admin access flow",
          description: "Create an admin access synthetic journey to continuously verify privileged login and dashboard availability.",
          level: "MANUAL_APPLY",
          actionLabel: "Create admin journey",
          payload: {
            steps: ["open_admin_login", "submit_credentials", "check_admin_dashboard"],
            type: "BROWSER",
            templateKey: "admin_access",
          },
          expectedCoverageGain: 15,
          source: "COVERAGE",
          riskLevel: "MEDIUM",
        });
        const { journey, created } = await ensureSyntheticJourneyForRecommendation(tx, project.id, journeyRec, requestedById);
        details.journeyId = journey.id;
        details.created = created;
      } else if (rec.type === "COVERAGE_TARGET" && rec.targetKey === "payment_flow") {
        const integration = await ensureProjectIntegration(tx, project.id, "STRIPE");
        details.integrationId = integration.id;
      } else if (rec.type === "COVERAGE_TARGET" && rec.targetKey === "webhook_health") {
        const integration = await ensureProjectIntegration(tx, project.id, "WEBHOOK");
        details.integrationId = integration.id;
      } else if (rec.type === "COVERAGE_TARGET" && rec.targetKey === "domain_expiry") {
        const integration = await ensureProjectIntegration(tx, project.id, "STATUS_PROVIDER");
        details.integrationId = integration.id;
      } else if (rec.type === "MONITORING_PROFILE") {
        const integration = await ensureProjectIntegration(tx, project.id, rec.targetKey);
        details.integrationId = integration.id;
      } else if (rec.type === "SYNTHETIC_JOURNEY") {
        const { journey, created } = await ensureSyntheticJourneyForRecommendation(tx, project.id, rec, requestedById);
        details.journeyId = journey.id;
        details.created = created;
        if (created) {
          await tx.event.create({
            data: {
              id: randomUUID(),
              projectId: project.id,
              type: "DEPLOYMENT_FINISHED",
              severity: "INFO",
              source: "synthetic-journey-template",
              message: `Synthetic journey template created: ${rec.title}`,
              payloadJson: { targetKey: rec.targetKey, recommendation: rec.description, journeyId: journey.id },
            },
          });
        }
      } else {
        await createInsightActionEvent(tx, project.id, rec, "TRACKED", `Tracked recommendation: ${rec.title}`, {});
        await logActionRun(tx, project.id, rec.id, rec.type, "TRACKED", requestedById || undefined, approvedById || undefined, {}, null);
        return { status: "TRACKED", recommendation: rec, details };
      }
      if (approvedById) {
        await tx.insightActionRun.updateMany({
          where: {
            insightRecommendationId: rec.id,
            projectId: project.id,
            status: "PENDING_APPROVAL",
          },
          data: {
            status: "APPROVED",
            approvedById,
            completedAt: new Date(),
            resultJson: { approved: true },
          },
        });
      }
      const persistedRecommendation = await tx.insightRecommendation.update({
        where: { id: rec.id },
        data: { status: RECOMMENDATION_STATUS.APPLIED, appliedAt: new Date() },
      });
      await upsertCoverageTargetForRecommendation(tx, project.id, rec, details);
      await createInsightActionEvent(tx, project.id, rec, "APPLIED", `Applied recommendation: ${rec.title}`, details);
      await logActionRun(tx, project.id, rec.id, rec.type, "COMPLETED", requestedById || undefined, approvedById || undefined, details, null);
      return { status: "APPLIED", recommendation: persistedRecommendation, details };
    });
    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to apply recommendation";
    const statusCode = message.includes("https://") || message.includes("requires a public URL") ? 400 : 500;
    console.error("Failed to apply insight recommendation", error);
    res.status(statusCode).json({ error: message });
  }
};

export const dismissRecommendationById = async (req: Request, res: Response) => {
  try {
    const orgId = (req as any).user?.organizationId;
    if (!orgId) {
      res.status(403).json({ error: "Organization required" });
      return;
    }
    const { id } = req.params;
    const { projectId, reason } = req.body || {};
    if (!projectId) {
      res.status(400).json({ error: "projectId is required" });
      return;
    }
    const projects = await loadProjectsForInsights(orgId);
    const project = projects.find((projectValue: any) => projectValue.id === projectId);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    const insight = buildProjectInsight(project);
    const generatedRec = insight.recommendations.find((rec: InsightRecommendationView) => rec.id === id);
    let persisted = await (prisma as any).insightRecommendation.findFirst({ where: { id, projectId } });
    if (!persisted && generatedRec) persisted = await upsertPersistedRecommendation(generatedRec);
    if (!persisted) {
      res.status(404).json({ error: "Recommendation not found" });
      return;
    }
    if (persisted.status === RECOMMENDATION_STATUS.APPLIED) {
      res.status(409).json({ error: "Recommendation already applied", recommendation: persisted });
      return;
    }
    if (persisted.status === RECOMMENDATION_STATUS.DISMISSED) {
      res.json({ status: "DISMISSED", recommendation: persisted });
      return;
    }
    if (persisted.status === RECOMMENDATION_STATUS.EXPIRED) {
      res.status(409).json({ error: "Recommendation expired", recommendation: persisted });
      return;
    }
    const updated = await (prisma as any).insightRecommendation.update({
      where: { id },
      data: { status: RECOMMENDATION_STATUS.DISMISSED, dismissedAt: new Date() },
    });
    const rec = generatedRec || recommendation({
      projectId: updated.projectId,
      type: updated.type,
      targetKey: updated.type,
      title: updated.title,
      description: updated.description,
      level: updated.actionLevel,
      status: updated.status,
      expectedCoverageGain: 10,
      actionLabel: "Dismiss",
      payload: updated.payloadJson || {},
      source: updated.source,
      riskLevel: updated.riskLevel,
    });
    await createInsightActionEvent(prisma as any, project.id, rec, "DISMISSED", `Dismissed recommendation: ${rec.title}`, { reason: reason || null });
    await logActionRun(prisma as any, project.id, rec.id, rec.type, "DISMISSED", (req as any).user?.id, undefined, { reason }, null);
    res.json({ status: "DISMISSED", recommendation: updated });
  } catch (error) {
    console.error("Failed to dismiss recommendation", error);
    res.status(500).json({ error: "Failed to dismiss recommendation" });
  }
};

export const approveRecommendationById = async (req: Request, res: Response) => {
  req.body = { ...(req.body || {}), approve: true };
  return applyRecommendationById(req, res);
};

export const installMonitoringProfile = async (req: Request, res: Response) => {
  try {
    const orgId = (req as any).user?.organizationId;
    if (!orgId) {
      res.status(403).json({ error: "Organization required" });
      return;
    }
    const { id } = req.params;
    if (!id) {
      res.status(400).json({ error: "profile id is required" });
      return;
    }
    const { projectId } = req.body || {};
    if (!projectId) {
      res.status(400).json({ error: "projectId is required" });
      return;
    }
    const project = await (prisma as any).project.findFirst({ where: { id: projectId, organizationId: orgId } });
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    const profile = await (prisma as any).monitoringProfile?.findUnique?.({ where: { id } }).catch(() => null);
    const profileType = profile?.providerType || id.toUpperCase();
    const monitors = profile?.definitionJson?.monitors || PROFILE_LIBRARY[profileType] || ["Provider validation", "Availability check"];
    const integration = await (prisma as any).projectIntegration.upsert({
      where: { projectId_type: { projectId, type: profileType } },
      update: { enabled: true, updatedAt: new Date() },
      create: {
        id: randomUUID(),
        projectId,
        type: profileType,
        enabled: true,
        name: `${profileType} monitoring profile`,
        configJson: { monitors },
        updatedAt: new Date(),
      },
    });
    await (prisma as any).event.create({
      data: {
        id: randomUUID(),
        projectId,
        type: "DEPLOYMENT_FINISHED",
        severity: "INFO",
        source: "insight-action",
        message: `Installed monitoring profile: ${profile?.name || profileType}`,
        payloadJson: { profileId: id, profileType, integrationId: integration.id, monitors },
      },
    });
    res.json({ status: "INSTALLED", integrationId: integration.id, profileType, monitors });
  } catch (error) {
    console.error("Failed to install monitoring profile", error);
    res.status(500).json({ error: "Failed to install profile" });
  }
};

export const createJourneyFromTemplate = async (req: Request, res: Response) => {
  try {
    const orgId = (req as any).user?.organizationId;
    if (!orgId) {
      res.status(403).json({ error: "Organization required" });
      return;
    }
    const { key } = req.params;
    if (!key) {
      res.status(400).json({ error: "journey template key is required" });
      return;
    }
    const { projectId, name } = req.body || {};
    if (!projectId) {
      res.status(400).json({ error: "projectId is required" });
      return;
    }
    const project = await (prisma as any).project.findFirst({ where: { id: projectId, organizationId: orgId } });
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    const templates: Record<string, { type: string; definition: Record<string, unknown> }> = {
      public_site: { type: "BROWSER", definition: { steps: ["open_url", "check_status_200"] } },
      login: { type: "BROWSER", definition: { steps: ["open_login", "submit_credentials", "check_dashboard"] } },
      booking: { type: "BROWSER", definition: { steps: ["open_booking_form", "submit_booking", "check_confirmation"] } },
      payment: { type: "CHECKOUT", definition: { steps: ["open_checkout", "submit_test_card", "check_payment_confirmation_webhook"] } },
      webhook: { type: "WEBHOOK", definition: { steps: ["send_signed_webhook", "check_acknowledgement"] } },
      admin_access: { type: "BROWSER", definition: { steps: ["open_admin_login", "submit_credentials", "check_admin_dashboard"] } },
    };
    const template = templates[key];
    if (!template) {
      res.status(400).json({ error: `Unknown journey template key: ${key}` });
      return;
    }
    const journeyName = name || `${key.replace(/_/g, " ")} journey`;
    const existing = await (prisma as any).syntheticJourney?.findFirst?.({
      where: { projectId, definitionJson: { path: "$.templateKey", equals: key } },
    }).catch(() => null);
    if (existing) {
      res.json({ status: "ALREADY_EXISTS", journey: existing });
      return;
    }
    const journey = await (prisma as any).syntheticJourney.create({
      data: {
        id: randomUUID(),
        projectId,
        name: journeyName,
        type: template.type,
        status: "DRAFT",
        definitionJson: { ...template.definition, templateKey: key },
        createdById: (req as any).user?.id || null,
      },
    });
    await (prisma as any).event.create({
      data: {
        id: randomUUID(),
        projectId,
        type: "DEPLOYMENT_FINISHED",
        severity: "INFO",
        source: "synthetic-journey-template",
        message: `Synthetic journey created from template: ${journeyName}`,
        payloadJson: { templateKey: key, journeyId: journey.id },
      },
    });
    res.status(201).json({ status: "CREATED", journey });
  } catch (error) {
    console.error("Failed to create journey from template", error);
    res.status(500).json({ error: "Failed to create journey" });
  }
};

export const applyInsightRecommendation = async (req: Request, res: Response) => {
  const { recommendationId: id, ...rest } = req.body || {};
  req.params = { ...req.params, id };
  req.body = { ...rest };
  return applyRecommendationById(req, res);
};