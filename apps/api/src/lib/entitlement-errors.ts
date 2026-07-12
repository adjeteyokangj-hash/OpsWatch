export class EntitlementError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly details?: Record<string, unknown>;

  constructor(
    code: string,
    message: string,
    statusCode = 403,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "EntitlementError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

export const entitlementLimitExceeded = (
  featureKey: string,
  current: number,
  limit: number
): EntitlementError =>
  new EntitlementError(
    "ENTITLEMENT_LIMIT_EXCEEDED",
    `Plan limit reached for ${featureKey}`,
    403,
    { featureKey, current, limit }
  );

export const entitlementFeatureDisabled = (featureKey: string): EntitlementError =>
  new EntitlementError(
    "ENTITLEMENT_FEATURE_DISABLED",
    `Feature not available on your plan: ${featureKey}`,
    403,
    { featureKey }
  );

export const subscriptionReadOnly = (status: string): EntitlementError =>
  new EntitlementError(
    "SUBSCRIPTION_READ_ONLY",
    "Subscription is in read-only mode. Update billing to make changes.",
    403,
    { status }
  );

export const subscriptionInactive = (status: string): EntitlementError =>
  new EntitlementError(
    "SUBSCRIPTION_INACTIVE",
    `Subscription is not active (${status})`,
    403,
    { status }
  );

export const checkIntervalTooFast = (requested: number, minimum: number): EntitlementError =>
  new EntitlementError(
    "CHECK_INTERVAL_TOO_FAST",
    `Minimum check interval for your plan is ${minimum} seconds`,
    403,
    { requestedIntervalSeconds: requested, minimumIntervalSeconds: minimum }
  );
