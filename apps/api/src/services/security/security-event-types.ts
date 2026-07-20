/**
 * Phase 8 supported security event types.
 * Business types are only evaluated when the connected application supplies evidence.
 */

export const AUTHENTICATION_EVENT_TYPES = [
  "LOGIN_SUCCEEDED",
  "LOGIN_FAILED",
  "MFA_FAILED",
  "PASSWORD_RESET_REQUESTED",
  "SESSION_CREATED",
  "SESSION_REVOKED",
  "ACCOUNT_LOCKED",
  "ACCOUNT_DISABLED"
] as const;

export const ACCESS_EVENT_TYPES = [
  "ACCESS_DENIED",
  "ROLE_CHANGED",
  "PRIVILEGE_GRANTED",
  "PRIVILEGE_REMOVED",
  "ADMIN_ACTION",
  "SENSITIVE_SETTING_CHANGED"
] as const;

export const API_INTEGRATION_EVENT_TYPES = [
  "API_KEY_CREATED",
  "API_KEY_USED",
  "API_KEY_REVOKED",
  "INVALID_API_KEY",
  "INVALID_SIGNATURE",
  "RATE_LIMIT_EXCEEDED",
  "WEBHOOK_REJECTED",
  "INTEGRATION_AUTH_FAILED"
] as const;

export const APPLICATION_EVENT_TYPES = [
  "SUSPICIOUS_REQUEST",
  "FILE_UPLOAD_REJECTED",
  "SECURITY_CONTROL_DISABLED",
  "ADMIN_ROUTE_ACCESSED",
  "UNEXPECTED_CONFIGURATION_CHANGE"
] as const;

export const BUSINESS_EVENT_TYPES = [
  "HIGH_RISK_PAYMENT_CHANGE",
  "HIGH_RISK_REFUND",
  "RELEASE_CODE_ACCESSED",
  "CUSTOMER_DETAILS_CHANGED",
  "BANK_DETAILS_CHANGED",
  "BULK_RECORD_CHANGE"
] as const;

export const EXTERNAL_SURFACE_EVENT_TYPES = [
  "TLS_CERTIFICATE_CHANGE",
  "TLS_EXPIRING",
  "DNS_CHANGE",
  "REDIRECT_CHANGE",
  "SECURITY_HEADER_REMOVED",
  "ADMIN_URL_EXPOSED",
  "DIAGNOSTIC_ENDPOINT_EXPOSED",
  "CONTENT_FINGERPRINT_CHANGE",
  "PUBLIC_ENDPOINT_STATUS_CHANGE"
] as const;

export const ALL_SECURITY_EVENT_TYPES = [
  ...AUTHENTICATION_EVENT_TYPES,
  ...ACCESS_EVENT_TYPES,
  ...API_INTEGRATION_EVENT_TYPES,
  ...APPLICATION_EVENT_TYPES,
  ...BUSINESS_EVENT_TYPES,
  ...EXTERNAL_SURFACE_EVENT_TYPES
] as const;

export type SecurityEventType = (typeof ALL_SECURITY_EVENT_TYPES)[number];

export const SECURITY_EVENT_TYPE_SET = new Set<string>(ALL_SECURITY_EVENT_TYPES);

export const isSecurityEventType = (value: string): value is SecurityEventType =>
  SECURITY_EVENT_TYPE_SET.has(value);

export const BUSINESS_EVENT_TYPE_SET = new Set<string>(BUSINESS_EVENT_TYPES);

export const WRITE_SCOPE_FOR_EVENT_FAMILY: Record<string, string> = {
  authentication: "authentication.events:write",
  access: "security.events:write",
  api: "security.events:write",
  application: "security.events:write",
  business: "security.events:write",
  external: "security.events:write",
  audit: "audit.events:write"
};

export const eventFamily = (eventType: string): string => {
  if ((AUTHENTICATION_EVENT_TYPES as readonly string[]).includes(eventType)) return "authentication";
  if ((ACCESS_EVENT_TYPES as readonly string[]).includes(eventType)) return "access";
  if ((API_INTEGRATION_EVENT_TYPES as readonly string[]).includes(eventType)) return "api";
  if ((APPLICATION_EVENT_TYPES as readonly string[]).includes(eventType)) return "application";
  if ((BUSINESS_EVENT_TYPES as readonly string[]).includes(eventType)) return "business";
  if ((EXTERNAL_SURFACE_EVENT_TYPES as readonly string[]).includes(eventType)) return "external";
  return "audit";
};
