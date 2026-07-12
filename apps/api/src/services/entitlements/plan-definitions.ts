import type { EntitlementKey } from "./entitlement-keys";
import { ENTITLEMENT } from "./entitlement-keys";

export type PlanCode = "PILOT" | "STARTER" | "GROWTH" | "BUSINESS" | "ENTERPRISE";

export type PlanEntitlementDefinition = {
  featureKey: EntitlementKey;
  enabled: boolean;
  limit?: number | null;
  retentionDays?: number | null;
  configuration?: Record<string, unknown>;
};

export type PlanDefinition = {
  code: PlanCode;
  name: string;
  monthlyPrice: number;
  annualPrice: number | null;
  currency: string;
  sortOrder: number;
  active: boolean;
  entitlements: PlanEntitlementDefinition[];
};

const entitlement = (
  featureKey: EntitlementKey,
  enabled: boolean,
  options?: { limit?: number | null; retentionDays?: number | null; configuration?: Record<string, unknown> }
): PlanEntitlementDefinition => ({
  featureKey,
  enabled,
  limit: options?.limit ?? null,
  retentionDays: options?.retentionDays ?? null,
  configuration: options?.configuration
});

const coreMonitoring = (options: {
  applications: number;
  teamMembers: number;
  monitors: number;
  checkIntervalSeconds: number;
  incidentsRetentionDays: number;
  telemetryRetentionDays: number;
  slos: number;
  statusPages: number;
  notificationChannels: number;
}) => [
  entitlement(ENTITLEMENT.APPLICATIONS_MAX, true, { limit: options.applications }),
  entitlement(ENTITLEMENT.TEAM_MEMBERS_MAX, true, { limit: options.teamMembers }),
  entitlement(ENTITLEMENT.MONITORS_MAX, true, { limit: options.monitors }),
  entitlement(ENTITLEMENT.INTERVAL_MIN, true, {
    limit: options.checkIntervalSeconds
  }),
  entitlement(ENTITLEMENT.RETENTION_INCIDENTS_DAYS, true, {
    retentionDays: options.incidentsRetentionDays
  }),
  entitlement(ENTITLEMENT.RETENTION_TELEMETRY_DAYS, true, {
    retentionDays: options.telemetryRetentionDays
  }),
  entitlement(ENTITLEMENT.SLOS_MAX, true, { limit: options.slos }),
  entitlement(ENTITLEMENT.STATUS_PAGES_MAX, true, { limit: options.statusPages }),
  entitlement(ENTITLEMENT.NOTIFICATION_CHANNELS_MAX, true, {
    limit: options.notificationChannels
  })
];

export const PLAN_DEFINITIONS: PlanDefinition[] = [
  {
    code: "PILOT",
    name: "Pilot",
    monthlyPrice: 59,
    annualPrice: 590,
    currency: "GBP",
    sortOrder: 10,
    active: true,
    entitlements: [
      ...coreMonitoring({
        applications: 3,
        teamMembers: 5,
        monitors: 50,
        checkIntervalSeconds: 300,
        incidentsRetentionDays: 30,
        telemetryRetentionDays: 14,
        slos: 5,
        statusPages: 1,
        notificationChannels: 1
      }),
      entitlement(ENTITLEMENT.TOPOLOGY_ADVANCED, false),
      entitlement(ENTITLEMENT.DIAGNOSIS_AI, false),
      entitlement(ENTITLEMENT.REMEDIATION_SUGGESTED, true),
      entitlement(ENTITLEMENT.REMEDIATION_APPROVAL, false),
      entitlement(ENTITLEMENT.REMEDIATION_AUTONOMOUS, false),
      entitlement(ENTITLEMENT.SECURITY_MTLS, false),
      entitlement(ENTITLEMENT.SECURITY_SSO, false),
      entitlement(ENTITLEMENT.API_ACCESS, false),
      entitlement(ENTITLEMENT.RETENTION_INCIDENT_MEMORY_DAYS, true, { retentionDays: 90 })
    ]
  },
  {
    code: "STARTER",
    name: "Starter",
    monthlyPrice: 29,
    annualPrice: 290,
    currency: "GBP",
    sortOrder: 20,
    active: false,
    entitlements: [
      ...coreMonitoring({
        applications: 2,
        teamMembers: 3,
        monitors: 25,
        checkIntervalSeconds: 300,
        incidentsRetentionDays: 30,
        telemetryRetentionDays: 7,
        slos: 3,
        statusPages: 1,
        notificationChannels: 1
      }),
      entitlement(ENTITLEMENT.TOPOLOGY_ADVANCED, false),
      entitlement(ENTITLEMENT.DIAGNOSIS_AI, false),
      entitlement(ENTITLEMENT.REMEDIATION_SUGGESTED, false),
      entitlement(ENTITLEMENT.REMEDIATION_APPROVAL, false),
      entitlement(ENTITLEMENT.REMEDIATION_AUTONOMOUS, false),
      entitlement(ENTITLEMENT.SECURITY_MTLS, false),
      entitlement(ENTITLEMENT.SECURITY_SSO, false),
      entitlement(ENTITLEMENT.API_ACCESS, false),
      entitlement(ENTITLEMENT.RETENTION_INCIDENT_MEMORY_DAYS, true, { retentionDays: 90 })
    ]
  },
  {
    code: "GROWTH",
    name: "Growth",
    monthlyPrice: 129,
    annualPrice: 1290,
    currency: "GBP",
    sortOrder: 30,
    active: true,
    entitlements: [
      ...coreMonitoring({
        applications: 10,
        teamMembers: 10,
        monitors: 150,
        checkIntervalSeconds: 60,
        incidentsRetentionDays: 90,
        telemetryRetentionDays: 30,
        slos: 25,
        statusPages: 3,
        notificationChannels: 10
      }),
      entitlement(ENTITLEMENT.TOPOLOGY_ADVANCED, true),
      entitlement(ENTITLEMENT.DIAGNOSIS_AI, true),
      entitlement(ENTITLEMENT.REMEDIATION_SUGGESTED, true),
      entitlement(ENTITLEMENT.REMEDIATION_APPROVAL, true),
      entitlement(ENTITLEMENT.REMEDIATION_AUTONOMOUS, false),
      entitlement(ENTITLEMENT.SECURITY_MTLS, false),
      entitlement(ENTITLEMENT.SECURITY_SSO, false),
      entitlement(ENTITLEMENT.API_ACCESS, true),
      entitlement(ENTITLEMENT.RETENTION_INCIDENT_MEMORY_DAYS, true, { retentionDays: 180 })
    ]
  },
  {
    code: "BUSINESS",
    name: "Business",
    monthlyPrice: 349,
    annualPrice: 3490,
    currency: "GBP",
    sortOrder: 40,
    active: true,
    entitlements: [
      ...coreMonitoring({
        applications: 30,
        teamMembers: 30,
        monitors: 750,
        checkIntervalSeconds: 30,
        incidentsRetentionDays: 365,
        telemetryRetentionDays: 90,
        slos: 100,
        statusPages: 10,
        notificationChannels: 9999
      }),
      entitlement(ENTITLEMENT.NOTIFICATION_CHANNELS_MAX, true, { limit: null }),
      entitlement(ENTITLEMENT.TOPOLOGY_ADVANCED, true),
      entitlement(ENTITLEMENT.DIAGNOSIS_AI, true),
      entitlement(ENTITLEMENT.REMEDIATION_SUGGESTED, true),
      entitlement(ENTITLEMENT.REMEDIATION_APPROVAL, true),
      entitlement(ENTITLEMENT.REMEDIATION_AUTONOMOUS, true),
      entitlement(ENTITLEMENT.SECURITY_MTLS, true),
      entitlement(ENTITLEMENT.SECURITY_SSO, true),
      entitlement(ENTITLEMENT.API_ACCESS, true),
      entitlement(ENTITLEMENT.RETENTION_INCIDENT_MEMORY_DAYS, true, { retentionDays: 365 })
    ]
  },
  {
    code: "ENTERPRISE",
    name: "Enterprise",
    monthlyPrice: 1000,
    annualPrice: null,
    currency: "GBP",
    sortOrder: 50,
    active: true,
    entitlements: [
      ...coreMonitoring({
        applications: 9999,
        teamMembers: 9999,
        monitors: 9999,
        checkIntervalSeconds: 30,
        incidentsRetentionDays: 365,
        telemetryRetentionDays: 365,
        slos: 9999,
        statusPages: 9999,
        notificationChannels: 9999
      }),
      entitlement(ENTITLEMENT.TOPOLOGY_ADVANCED, true),
      entitlement(ENTITLEMENT.DIAGNOSIS_AI, true),
      entitlement(ENTITLEMENT.REMEDIATION_SUGGESTED, true),
      entitlement(ENTITLEMENT.REMEDIATION_APPROVAL, true),
      entitlement(ENTITLEMENT.REMEDIATION_AUTONOMOUS, true),
      entitlement(ENTITLEMENT.SECURITY_MTLS, true),
      entitlement(ENTITLEMENT.SECURITY_SSO, true),
      entitlement(ENTITLEMENT.API_ACCESS, true),
      entitlement(ENTITLEMENT.RETENTION_INCIDENT_MEMORY_DAYS, true, { retentionDays: null })
    ]
  }
];

export const DEFAULT_LAUNCH_PLAN_CODE: PlanCode = "PILOT";

export const getPlanDefinition = (code: PlanCode): PlanDefinition => {
  const plan = PLAN_DEFINITIONS.find((row) => row.code === code);
  if (!plan) {
    throw new Error(`Unknown plan code: ${code}`);
  }
  return plan;
};
