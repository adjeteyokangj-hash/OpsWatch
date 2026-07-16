import type { IntegrationType } from "@prisma/client";

/** Allowlisted remediator webhook actions — never free-text / arbitrary commands. */
export const WORKER_REMEDIATOR_ACTIONS = [
  "restart_sync_worker",
  "restart_outbox_processor",
  "retry_failed_jobs",
  "retry_outbox_item"
] as const;

export type WorkerRemediatorAction = (typeof WORKER_REMEDIATOR_ACTIONS)[number];

export const SERVICE_REMEDIATOR_ACTIONS = ["restart_service"] as const;
export type ServiceRemediatorAction = (typeof SERVICE_REMEDIATOR_ACTIONS)[number];

export const DEPLOYMENT_REMEDIATOR_ACTIONS = ["rollback_deployment"] as const;
export type DeploymentRemediatorAction = (typeof DEPLOYMENT_REMEDIATOR_ACTIONS)[number];

export type RemediatorAction =
  | WorkerRemediatorAction
  | ServiceRemediatorAction
  | DeploymentRemediatorAction;

export const REMEDIATOR_PROVIDER_TYPES = [
  "WORKER_PROVIDER",
  "SERVICE_PROVIDER",
  "DEPLOYMENT_PROVIDER"
] as const;

export type RemediatorProviderType = (typeof REMEDIATOR_PROVIDER_TYPES)[number];

export const isRemediatorProviderType = (type: string): type is RemediatorProviderType =>
  (REMEDIATOR_PROVIDER_TYPES as readonly string[]).includes(type);

export const DEFAULT_CAPABILITIES: Record<RemediatorProviderType, readonly RemediatorAction[]> = {
  WORKER_PROVIDER: WORKER_REMEDIATOR_ACTIONS,
  SERVICE_PROVIDER: SERVICE_REMEDIATOR_ACTIONS,
  DEPLOYMENT_PROVIDER: DEPLOYMENT_REMEDIATOR_ACTIONS
};

export const ALL_ALLOWLISTED_ACTIONS: readonly RemediatorAction[] = [
  ...WORKER_REMEDIATOR_ACTIONS,
  ...SERVICE_REMEDIATOR_ACTIONS,
  ...DEPLOYMENT_REMEDIATOR_ACTIONS
];

export const isAllowlistedRemediatorAction = (action: string): action is RemediatorAction =>
  (ALL_ALLOWLISTED_ACTIONS as readonly string[]).includes(action);

/** Map OpsWatch remediation registry actions → remediator webhook actions. */
export const REGISTRY_TO_REMEDIATOR_ACTION: Partial<
  Record<string, { provider: RemediatorProviderType; action: RemediatorAction; urlKey: string }>
> = {
  RESTART_WORKER: {
    provider: "WORKER_PROVIDER",
    action: "restart_sync_worker",
    urlKey: "WORKER_RESTART_WEBHOOK_URL"
  },
  REQUEUE_FAILED_JOB: {
    provider: "WORKER_PROVIDER",
    action: "retry_failed_jobs",
    urlKey: "WORKER_RESTART_WEBHOOK_URL"
  },
  RESTART_SERVICE: {
    provider: "SERVICE_PROVIDER",
    action: "restart_service",
    urlKey: "SERVICE_RESTART_WEBHOOK_URL"
  },
  ROLLBACK_DEPLOYMENT: {
    provider: "DEPLOYMENT_PROVIDER",
    action: "rollback_deployment",
    urlKey: "DEPLOYMENT_ROLLBACK_WEBHOOK_URL"
  }
};

export const remediatorUrlKeyForProvider = (type: RemediatorProviderType): string => {
  switch (type) {
    case "WORKER_PROVIDER":
      return "WORKER_RESTART_WEBHOOK_URL";
    case "SERVICE_PROVIDER":
      return "SERVICE_RESTART_WEBHOOK_URL";
    case "DEPLOYMENT_PROVIDER":
      return "DEPLOYMENT_ROLLBACK_WEBHOOK_URL";
  }
};

export const resolveRemediatorActionFromContext = (
  registryAction: string,
  extra?: Record<string, unknown> | null
): RemediatorAction | null => {
  const explicit = extra?.remediatorAction;
  if (typeof explicit === "string" && isAllowlistedRemediatorAction(explicit)) {
    return explicit;
  }
  const mapped = REGISTRY_TO_REMEDIATOR_ACTION[registryAction];
  return mapped?.action ?? null;
};

export const providerSupportsAction = (
  providerType: IntegrationType | string,
  action: RemediatorAction,
  advertised: readonly string[] | null | undefined
): boolean => {
  if (!isRemediatorProviderType(String(providerType))) return false;
  const caps =
    advertised && advertised.length > 0
      ? advertised
      : DEFAULT_CAPABILITIES[providerType as RemediatorProviderType];
  return caps.includes(action);
};
