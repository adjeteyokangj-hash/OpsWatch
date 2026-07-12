export const ENTITLEMENT_DOMAINS = {
  MONITORING: "monitoring",
  TOPOLOGY: "topology",
  DIAGNOSIS: "diagnosis",
  REMEDIATION: "remediation",
  NOTIFICATIONS: "notifications",
  SECURITY: "security",
  RETENTION: "retention",
  STATUSPAGE: "statuspage",
  API: "api",
  TEAM: "team"
} as const;

export type EntitlementDomain = (typeof ENTITLEMENT_DOMAINS)[keyof typeof ENTITLEMENT_DOMAINS];

export const ENTITLEMENT_KEYS = {
  MONITORING_APPLICATIONS_MAX: "monitoring.applications.max",
  MONITORING_MONITORS_MAX: "monitoring.monitors.max",
  MONITORING_INTERVAL_MIN: "monitoring.interval.min",
  MONITORING_SLOS_MAX: "monitoring.slos.max",
  TEAM_MEMBERS_MAX: "team.members.max",
  RETENTION_INCIDENTS_DAYS: "retention.incidents.days",
  RETENTION_TELEMETRY_DAYS: "retention.telemetry.days",
  STATUSPAGE_PAGES_MAX: "statuspage.pages.max",
  NOTIFICATIONS_CHANNELS_MAX: "notifications.channels.max",
  TOPOLOGY_ADVANCED: "topology.advanced.enabled",
  DIAGNOSIS_AI: "diagnosis.ai.enabled",
  REMEDIATION_SUGGESTED: "remediation.suggested.enabled",
  REMEDIATION_APPROVAL: "remediation.approval.enabled",
  REMEDIATION_AUTONOMOUS: "remediation.autonomous.enabled",
  SECURITY_MTLS: "security.mtls.enabled",
  SECURITY_SSO: "security.sso.enabled",
  API_ACCESS: "api.access.enabled"
} as const;

export type EntitlementKey = (typeof ENTITLEMENT_KEYS)[keyof typeof ENTITLEMENT_KEYS];

/** @deprecated Use domain-scoped keys. Kept for migration/backward compatibility. */
export const LEGACY_ENTITLEMENT_ALIASES: Record<string, EntitlementKey> = {
  "applications.max": ENTITLEMENT_KEYS.MONITORING_APPLICATIONS_MAX,
  "monitors.max": ENTITLEMENT_KEYS.MONITORING_MONITORS_MAX,
  "uptime.check_interval_seconds": ENTITLEMENT_KEYS.MONITORING_INTERVAL_MIN,
  "slos.max": ENTITLEMENT_KEYS.MONITORING_SLOS_MAX,
  "team_members.max": ENTITLEMENT_KEYS.TEAM_MEMBERS_MAX,
  "incidents.retention_days": ENTITLEMENT_KEYS.RETENTION_INCIDENTS_DAYS,
  "telemetry.retention_days": ENTITLEMENT_KEYS.RETENTION_TELEMETRY_DAYS,
  "status_pages.max": ENTITLEMENT_KEYS.STATUSPAGE_PAGES_MAX,
  "notification_channels.max": ENTITLEMENT_KEYS.NOTIFICATIONS_CHANNELS_MAX,
  "topology.advanced": ENTITLEMENT_KEYS.TOPOLOGY_ADVANCED,
  "diagnosis.ai": ENTITLEMENT_KEYS.DIAGNOSIS_AI,
  "remediation.suggested": ENTITLEMENT_KEYS.REMEDIATION_SUGGESTED,
  "remediation.approval_based": ENTITLEMENT_KEYS.REMEDIATION_APPROVAL,
  "remediation.autonomous": ENTITLEMENT_KEYS.REMEDIATION_AUTONOMOUS,
  "security.mtls": ENTITLEMENT_KEYS.SECURITY_MTLS,
  "security.sso": ENTITLEMENT_KEYS.SECURITY_SSO,
  "api.access": ENTITLEMENT_KEYS.API_ACCESS
};

export const normalizeEntitlementKey = (featureKey: string): EntitlementKey => {
  const values = Object.values(ENTITLEMENT_KEYS) as string[];
  if (values.includes(featureKey)) {
    return featureKey as EntitlementKey;
  }
  return LEGACY_ENTITLEMENT_ALIASES[featureKey] ?? (featureKey as EntitlementKey);
};

export const groupEntitlementsByDomain = (
  entitlements: Record<string, unknown>
): Record<EntitlementDomain, Record<string, unknown>> => {
  const grouped = Object.values(ENTITLEMENT_DOMAINS).reduce(
    (accumulator, domain) => {
      accumulator[domain] = {};
      return accumulator;
    },
    {} as Record<EntitlementDomain, Record<string, unknown>>
  );

  for (const [key, value] of Object.entries(entitlements)) {
    const normalized = normalizeEntitlementKey(key);
    const domain = normalized.split(".")[0] as EntitlementDomain;
    if (grouped[domain]) {
      grouped[domain][normalized] = value;
    }
  }

  return grouped;
};

export const LIMIT_ENTITLEMENT_KEYS = [
  ENTITLEMENT_KEYS.MONITORING_APPLICATIONS_MAX,
  ENTITLEMENT_KEYS.MONITORING_MONITORS_MAX,
  ENTITLEMENT_KEYS.MONITORING_SLOS_MAX,
  ENTITLEMENT_KEYS.TEAM_MEMBERS_MAX,
  ENTITLEMENT_KEYS.STATUSPAGE_PAGES_MAX,
  ENTITLEMENT_KEYS.NOTIFICATIONS_CHANNELS_MAX
] as const;

export type LimitEntitlementKey = (typeof LIMIT_ENTITLEMENT_KEYS)[number];

export const USAGE_METRIC_BY_ENTITLEMENT: Record<LimitEntitlementKey, string> = {
  [ENTITLEMENT_KEYS.MONITORING_APPLICATIONS_MAX]: "applications",
  [ENTITLEMENT_KEYS.MONITORING_MONITORS_MAX]: "monitors",
  [ENTITLEMENT_KEYS.MONITORING_SLOS_MAX]: "slos",
  [ENTITLEMENT_KEYS.TEAM_MEMBERS_MAX]: "team_members",
  [ENTITLEMENT_KEYS.STATUSPAGE_PAGES_MAX]: "status_pages",
  [ENTITLEMENT_KEYS.NOTIFICATIONS_CHANNELS_MAX]: "notification_channels"
};

// Short aliases used across controllers during migration.
export const ENTITLEMENT = {
  APPLICATIONS_MAX: ENTITLEMENT_KEYS.MONITORING_APPLICATIONS_MAX,
  MONITORS_MAX: ENTITLEMENT_KEYS.MONITORING_MONITORS_MAX,
  INTERVAL_MIN: ENTITLEMENT_KEYS.MONITORING_INTERVAL_MIN,
  SLOS_MAX: ENTITLEMENT_KEYS.MONITORING_SLOS_MAX,
  TEAM_MEMBERS_MAX: ENTITLEMENT_KEYS.TEAM_MEMBERS_MAX,
  RETENTION_INCIDENTS_DAYS: ENTITLEMENT_KEYS.RETENTION_INCIDENTS_DAYS,
  RETENTION_TELEMETRY_DAYS: ENTITLEMENT_KEYS.RETENTION_TELEMETRY_DAYS,
  STATUS_PAGES_MAX: ENTITLEMENT_KEYS.STATUSPAGE_PAGES_MAX,
  NOTIFICATION_CHANNELS_MAX: ENTITLEMENT_KEYS.NOTIFICATIONS_CHANNELS_MAX,
  TOPOLOGY_ADVANCED: ENTITLEMENT_KEYS.TOPOLOGY_ADVANCED,
  DIAGNOSIS_AI: ENTITLEMENT_KEYS.DIAGNOSIS_AI,
  REMEDIATION_SUGGESTED: ENTITLEMENT_KEYS.REMEDIATION_SUGGESTED,
  REMEDIATION_APPROVAL: ENTITLEMENT_KEYS.REMEDIATION_APPROVAL,
  REMEDIATION_AUTONOMOUS: ENTITLEMENT_KEYS.REMEDIATION_AUTONOMOUS,
  SECURITY_MTLS: ENTITLEMENT_KEYS.SECURITY_MTLS,
  SECURITY_SSO: ENTITLEMENT_KEYS.SECURITY_SSO,
  API_ACCESS: ENTITLEMENT_KEYS.API_ACCESS
} as const;
