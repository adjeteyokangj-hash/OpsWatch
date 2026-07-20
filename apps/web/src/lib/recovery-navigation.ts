/** Build Topology deep-link URLs for incident / alert recovery flows. */

export type TopologyRecoveryLinkKind = "investigate" | "verify" | "confirm";

export const topologyRecoveryLinkLabel = (kind: TopologyRecoveryLinkKind): string => {
  if (kind === "verify") return "View verification in Topology";
  if (kind === "confirm") return "Confirm recovery in Topology";
  return "Investigate in Topology";
};

export const buildTopologyDeepLink = (input: {
  projectId: string;
  entityId?: string | null;
  incidentId?: string | null;
  recoveryState?: string | null;
}): string => {
  const params = new URLSearchParams();
  if (input.entityId) params.set("entityId", input.entityId);
  if (input.incidentId) params.set("incidentId", input.incidentId);
  if (input.recoveryState) params.set("recoveryState", input.recoveryState);
  const qs = params.toString();
  return `/projects/${input.projectId}/topology${qs ? `?${qs}` : ""}`;
};

export const topologyLinkKindForRecovery = (input: {
  incidentStatus?: string | null;
  unresolvedAlertCount: number;
  verificationPassed?: number | null;
  verificationRequired?: number | null;
  verificationMet?: boolean;
}): TopologyRecoveryLinkKind => {
  if (input.incidentStatus === "RESOLVED" || (input.verificationMet && input.unresolvedAlertCount === 0)) {
    return "confirm";
  }
  if (
    (input.verificationPassed != null &&
      input.verificationRequired != null &&
      input.verificationPassed > 0 &&
      !input.verificationMet) ||
    input.unresolvedAlertCount > 0
  ) {
    return "verify";
  }
  return "investigate";
};

/**
 * Map remediation blockers to the exact configuration destination.
 * Never expose secret values — only names / types.
 */

const appendConfigureQuery = (
  href: string,
  opts: { incidentId?: string | null; missingNames?: string[] }
): string => {
  const url = new URL(href, "http://opswatch.local");
  if (opts.incidentId) {
    url.searchParams.set("returnTo", `/incidents/${opts.incidentId}`);
  }
  if (opts.missingNames && opts.missingNames.length > 0) {
    url.searchParams.set("highlight", opts.missingNames.join(","));
  }
  return `${url.pathname}${url.search}`;
};

export type ConfigureSetupTarget = {
  href: string;
  label: string;
  banner: string;
  missingNames?: string[];
};

export const resolveConfigureSetupTarget = (input: {
  action: string;
  projectId?: string | null;
  serviceId?: string | null;
  checkId?: string | null;
  incidentId?: string | null;
  alertId?: string | null;
  missingFields?: string[];
  missingEnvVars?: string[];
  state?: string | null;
}): ConfigureSetupTarget | null => {
  const projectId = input.projectId;
  const missingNames = [
    ...(input.missingEnvVars ?? []),
    ...(input.missingFields ?? [])
  ].filter(Boolean);
  const withReturn = (href: string) =>
    appendConfigureQuery(href, { incidentId: input.incidentId, missingNames });

  if (input.state === "APPROVAL_REQUIRED" && input.incidentId) {
    return {
      href: withReturn(`/incidents/${input.incidentId}?approval=1`),
      label: "Open approval",
      banner: "This action requires approval before it can run.",
      missingNames
    };
  }

  if (
    input.checkId &&
    (input.action.includes("CHECK") ||
      input.action.includes("HTTP") ||
      input.action === "CONFIGURE_CHECK")
  ) {
    return {
      href: withReturn(`/checks/${input.checkId}`),
      label: "Configure required setup →",
      banner: "Check configuration needs correction before this action can run.",
      missingNames
    };
  }

  if (
    input.action.includes("RESTART") ||
    input.action.includes("ROLLBACK") ||
    input.action.includes("REMEDIATOR") ||
    missingNames.some((name) => /remediator|webhook|REMEDIATOR/i.test(name))
  ) {
    if (projectId && input.serviceId) {
      return {
        href: withReturn(
          `/projects/${projectId}/topology?entityId=${encodeURIComponent(input.serviceId)}&panel=remediation`
        ),
        label: "Configure required setup →",
        banner: "Remediation setup is incomplete for this service.",
        missingNames
      };
    }
    if (projectId) {
      return {
        href: withReturn(`/projects/${projectId}/automation`),
        label: "Configure required setup →",
        banner: "Open remediation setup for this application.",
        missingNames
      };
    }
  }

  if (
    input.action.includes("CONNECTION") ||
    input.action.includes("INTEGRATION") ||
    missingNames.some((name) => /connection|integration|heartbeat/i.test(name))
  ) {
    return {
      href: withReturn(projectId ? `/integrations/${projectId}` : "/connections"),
      label: "Configure required setup →",
      banner: "A monitoring connection must be configured for this action.",
      missingNames
    };
  }

  if (missingNames.length > 0 && projectId) {
    return {
      href: withReturn(
        `/projects/${projectId}/settings?highlight=${encodeURIComponent(missingNames.join(","))}`
      ),
      label: "Configure required setup →",
      banner:
        "Required configuration is missing. Only setting names are shown — never secret values.",
      missingNames
    };
  }

  if (input.state === "MISCONFIGURED_ENV" || input.state === "MISSING_CONTEXT") {
    if (projectId && input.serviceId) {
      return {
        href: withReturn(
          buildTopologyDeepLink({
            projectId,
            entityId: input.serviceId,
            incidentId: input.incidentId
          })
        ),
        label: "Configure required setup →",
        banner: "Open the affected service in Topology to complete remediation setup."
      };
    }
    if (projectId) {
      return {
        href: withReturn(`/projects/${projectId}/settings`),
        label: "Configure required setup →",
        banner: "Open application settings to complete the required setup."
      };
    }
  }

  return null;
};

export const primaryActionButtonLabel = (action: string, state?: string | null): string => {
  if (action === "REQUEST_HUMAN_REVIEW") return "Request review";
  if (action === "ACKNOWLEDGE_INCIDENT") return "Acknowledge incident";
  if (action === "ADD_INCIDENT_NOTE") return "Add note";
  if (action === "OPEN_RUNBOOK") return "Open runbook";
  if (action === "RERUN_HTTP_CHECK" || action === "RERUN_SSL_CHECK") return "Run check now";
  if (state === "APPROVAL_REQUIRED") return "Request approval";
  if (state === "MISCONFIGURED_ENV" || state === "MISSING_CONTEXT") return "Configure required setup →";
  return "Apply recommended action";
};
