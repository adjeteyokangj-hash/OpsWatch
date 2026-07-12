-- Rename flat entitlement keys to domain-scoped keys.
UPDATE "PlanEntitlement" SET "featureKey" = 'monitoring.applications.max' WHERE "featureKey" = 'applications.max';
UPDATE "PlanEntitlement" SET "featureKey" = 'monitoring.monitors.max' WHERE "featureKey" = 'monitors.max';
UPDATE "PlanEntitlement" SET "featureKey" = 'monitoring.interval.min' WHERE "featureKey" = 'uptime.check_interval_seconds';
UPDATE "PlanEntitlement" SET "featureKey" = 'monitoring.slos.max' WHERE "featureKey" = 'slos.max';
UPDATE "PlanEntitlement" SET "featureKey" = 'team.members.max' WHERE "featureKey" = 'team_members.max';
UPDATE "PlanEntitlement" SET "featureKey" = 'retention.incidents.days' WHERE "featureKey" = 'incidents.retention_days';
UPDATE "PlanEntitlement" SET "featureKey" = 'retention.telemetry.days' WHERE "featureKey" = 'telemetry.retention_days';
UPDATE "PlanEntitlement" SET "featureKey" = 'statuspage.pages.max' WHERE "featureKey" = 'status_pages.max';
UPDATE "PlanEntitlement" SET "featureKey" = 'notifications.channels.max' WHERE "featureKey" = 'notification_channels.max';
UPDATE "PlanEntitlement" SET "featureKey" = 'topology.advanced.enabled' WHERE "featureKey" = 'topology.advanced';
UPDATE "PlanEntitlement" SET "featureKey" = 'diagnosis.ai.enabled' WHERE "featureKey" = 'diagnosis.ai';
UPDATE "PlanEntitlement" SET "featureKey" = 'remediation.suggested.enabled' WHERE "featureKey" = 'remediation.suggested';
UPDATE "PlanEntitlement" SET "featureKey" = 'remediation.approval.enabled' WHERE "featureKey" IN ('remediation.approval_based', 'remediation.approval.enabled');
UPDATE "PlanEntitlement" SET "featureKey" = 'remediation.autonomous.enabled' WHERE "featureKey" = 'remediation.autonomous';
UPDATE "PlanEntitlement" SET "featureKey" = 'security.mtls.enabled' WHERE "featureKey" = 'security.mtls';
UPDATE "PlanEntitlement" SET "featureKey" = 'security.sso.enabled' WHERE "featureKey" = 'security.sso';
UPDATE "PlanEntitlement" SET "featureKey" = 'api.access.enabled' WHERE "featureKey" = 'api.access';
