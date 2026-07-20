import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import {
  DEFAULT_DETECTION_RULES,
  baselineNoteFor,
  ensureDefaultDetectionRules,
  findingFingerprint,
  type DetectionRuleDef
} from "./security-detection-rules";

export type EvaluateDetectionsArgs = {
  organizationId: string;
  projectId?: string | null;
  environment?: string | null;
  lookbackMs?: number;
};

type EventRow = {
  id: string;
  eventType: string;
  timestamp: Date;
  accountIdentifierHash: string | null;
  sourceIpTruncated: string | null;
  entityId: string | null;
  relationshipId: string | null;
  environment: string;
  projectId: string | null;
  payloadJson: unknown;
  correlationId: string | null;
  severity: string;
};

const asThresholdNumber = (threshold: Record<string, unknown>, key: string, fallback: number): number => {
  const value = threshold[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
};

const resolveRules = async (organizationId: string): Promise<DetectionRuleDef[]> => {
  await ensureDefaultDetectionRules(organizationId);
  const overrides = await prisma.securityDetectionRule.findMany({
    where: { organizationId, enabled: true }
  });
  const byKey = new Map(DEFAULT_DETECTION_RULES.map((rule) => [rule.ruleKey, rule]));
  for (const row of overrides) {
    const base = byKey.get(row.ruleKey) ?? DEFAULT_DETECTION_RULES[0]!;
    byKey.set(row.ruleKey, {
      ruleKey: row.ruleKey,
      name: row.name,
      description: row.description || base.description,
      category: (row.category as DetectionRuleDef["category"]) || base.category,
      severity: (row.severity as DetectionRuleDef["severity"]) || base.severity,
      windowMs: row.windowMs,
      minimumSamples: row.minimumSamples,
      threshold: (row.thresholdJson as Record<string, number | string | boolean>) || base.threshold,
      eventTypes: base.eventTypes,
      recommendedResponse: row.recommendedResponse || base.recommendedResponse,
      version: row.version
    });
  }
  return Array.from(byKey.values());
};

const entityKeyFor = (rule: DetectionRuleDef, events: EventRow[]): string => {
  if (rule.ruleKey.includes("credential_stuffing")) {
    return `ip:${events[0]?.sourceIpTruncated || "unknown"}`;
  }
  if (events[0]?.accountIdentifierHash) return `acct:${events[0].accountIdentifierHash}`;
  if (events[0]?.entityId) return `entity:${events[0].entityId}`;
  if (events[0]?.sourceIpTruncated) return `ip:${events[0].sourceIpTruncated}`;
  return `env:${events[0]?.environment || "unknown"}`;
};

const matchesRule = (rule: DetectionRuleDef, events: EventRow[]): {
  matched: boolean;
  matchedEvents: EventRow[];
  confidence: number;
  baselineNote: string;
} => {
  const windowStart = Date.now() - rule.windowMs;
  const inWindow = events.filter(
    (event) => rule.eventTypes.includes(event.eventType) && event.timestamp.getTime() >= windowStart
  );
  if (inWindow.length < rule.minimumSamples) {
    return {
      matched: false,
      matchedEvents: inWindow,
      confidence: 0,
      baselineNote: baselineNoteFor({
        sampleCount: inWindow.length,
        minimumSamples: rule.minimumSamples,
        exceeded: false
      })
    };
  }

  const threshold = rule.threshold as Record<string, unknown>;
  const countThreshold = asThresholdNumber(threshold, "count", rule.minimumSamples);

  if (rule.ruleKey === "identity.credential_stuffing") {
    const byIp = new Map<string, EventRow[]>();
    for (const event of inWindow) {
      const key = event.sourceIpTruncated || "unknown";
      const list = byIp.get(key) || [];
      list.push(event);
      byIp.set(key, list);
    }
    for (const [, group] of byIp) {
      const accounts = new Set(group.map((e) => e.accountIdentifierHash).filter(Boolean));
      const distinctAccounts = asThresholdNumber(threshold, "distinctAccounts", 5);
      if (group.length >= countThreshold && accounts.size >= distinctAccounts) {
        return {
          matched: true,
          matchedEvents: group,
          confidence: Math.min(0.95, 0.55 + accounts.size * 0.05),
          baselineNote: baselineNoteFor({
            sampleCount: group.length,
            minimumSamples: rule.minimumSamples,
            exceeded: true
          })
        };
      }
    }
    return {
      matched: false,
      matchedEvents: inWindow,
      confidence: 0,
      baselineNote: baselineNoteFor({
        sampleCount: inWindow.length,
        minimumSamples: rule.minimumSamples,
        exceeded: false
      })
    };
  }

  if (rule.ruleKey === "identity.login_after_failures") {
    const byAccount = new Map<string, EventRow[]>();
    for (const event of inWindow) {
      const key = event.accountIdentifierHash || event.sourceIpTruncated || "unknown";
      const list = byAccount.get(key) || [];
      list.push(event);
      byAccount.set(key, list);
    }
    const priorFailures = asThresholdNumber(threshold, "priorFailures", 3);
    for (const [, group] of byAccount) {
      const ordered = [...group].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
      let failures = 0;
      for (const event of ordered) {
        if (event.eventType === "LOGIN_FAILED") failures += 1;
        if (event.eventType === "LOGIN_SUCCEEDED" && failures >= priorFailures) {
          return {
            matched: true,
            matchedEvents: ordered,
            confidence: 0.85,
            baselineNote: baselineNoteFor({
              sampleCount: ordered.length,
              minimumSamples: rule.minimumSamples,
              exceeded: true
            })
          };
        }
      }
    }
    return {
      matched: false,
      matchedEvents: inWindow,
      confidence: 0,
      baselineNote: baselineNoteFor({
        sampleCount: inWindow.length,
        minimumSamples: rule.minimumSamples,
        exceeded: false
      })
    };
  }

  if (rule.ruleKey === "identity.dormant_admin") {
    const dormant = inWindow.filter((event) => {
      const payload = event.payloadJson as Record<string, unknown> | null;
      return payload && (payload.dormant === true || payload.accountState === "dormant");
    });
    if (dormant.length >= countThreshold) {
      return {
        matched: true,
        matchedEvents: dormant,
        confidence: 0.8,
        baselineNote: baselineNoteFor({
          sampleCount: dormant.length,
          minimumSamples: rule.minimumSamples,
          exceeded: true
        })
      };
    }
    return {
      matched: false,
      matchedEvents: inWindow,
      confidence: 0,
      baselineNote: baselineNoteFor({
        sampleCount: inWindow.length,
        minimumSamples: rule.minimumSamples,
        exceeded: false
      })
    };
  }

  if (rule.ruleKey === "api.key_wrong_environment") {
    const mismatched = inWindow.filter((event) => {
      const payload = event.payloadJson as Record<string, unknown> | null;
      return Boolean(payload && (payload.environmentMismatch === true || payload.wrongEnvironment === true));
    });
    if (mismatched.length >= countThreshold) {
      return {
        matched: true,
        matchedEvents: mismatched,
        confidence: 0.9,
        baselineNote: baselineNoteFor({
          sampleCount: mismatched.length,
          minimumSamples: rule.minimumSamples,
          exceeded: true
        })
      };
    }
    return {
      matched: false,
      matchedEvents: inWindow,
      confidence: 0,
      baselineNote: baselineNoteFor({
        sampleCount: inWindow.length,
        minimumSamples: rule.minimumSamples,
        exceeded: false
      })
    };
  }

  if (rule.ruleKey === "api.revoked_key_use") {
    const revoked = inWindow.filter((event) => {
      const payload = event.payloadJson as Record<string, unknown> | null;
      const reason = String(payload?.reason || payload?.failureReason || "").toLowerCase();
      return reason.includes("revoked") || reason.includes("expired") || event.eventType === "API_KEY_REVOKED";
    });
    if (revoked.length >= countThreshold) {
      return {
        matched: true,
        matchedEvents: revoked,
        confidence: 0.9,
        baselineNote: baselineNoteFor({
          sampleCount: revoked.length,
          minimumSamples: rule.minimumSamples,
          exceeded: true
        })
      };
    }
    return {
      matched: false,
      matchedEvents: inWindow,
      confidence: 0,
      baselineNote: baselineNoteFor({
        sampleCount: inWindow.length,
        minimumSamples: rule.minimumSamples,
        exceeded: false
      })
    };
  }

  // Default count threshold grouping by entity key buckets
  const buckets = new Map<string, EventRow[]>();
  for (const event of inWindow) {
    const key = entityKeyFor(rule, [event]);
    const list = buckets.get(key) || [];
    list.push(event);
    buckets.set(key, list);
  }
  for (const [, group] of buckets) {
    if (group.length >= countThreshold) {
      return {
        matched: true,
        matchedEvents: group,
        confidence: Math.min(0.95, 0.5 + group.length / (countThreshold * 2)),
        baselineNote: baselineNoteFor({
          sampleCount: group.length,
          minimumSamples: rule.minimumSamples,
          exceeded: true,
          aboveNormal: group.length >= countThreshold * 2
        })
      };
    }
  }

  return {
    matched: false,
    matchedEvents: inWindow,
    confidence: 0,
    baselineNote: baselineNoteFor({
      sampleCount: inWindow.length,
      minimumSamples: rule.minimumSamples,
      exceeded: false
    })
  };
};

const upsertFinding = async (args: {
  organizationId: string;
  rule: DetectionRuleDef;
  matchedEvents: EventRow[];
  confidence: number;
  baselineNote: string;
}) => {
  const { organizationId, rule, matchedEvents, confidence, baselineNote } = args;
  if (matchedEvents.length === 0) return null;

  const sample = matchedEvents[0]!;
  const environment = sample.environment || "unknown";
  const projectId = sample.projectId;
  const fingerprint = findingFingerprint({
    ruleKey: rule.ruleKey,
    organizationId,
    projectId,
    environment,
    entityKey: entityKeyFor(rule, matchedEvents)
  });

  const existing = await prisma.securityFinding.findFirst({
    where: {
      organizationId,
      projectId: projectId ?? null,
      environment,
      fingerprint
    }
  });

  const now = new Date();
  const firstSeen = matchedEvents.reduce(
    (min, event) => (event.timestamp < min ? event.timestamp : min),
    sample.timestamp
  );
  const lastSeen = matchedEvents.reduce(
    (max, event) => (event.timestamp > max ? event.timestamp : max),
    sample.timestamp
  );

  if (existing) {
    if (existing.state === "SUPPRESSED" && existing.suppressedUntil && existing.suppressedUntil > now) {
      return existing;
    }
    if (existing.state === "ACCEPTED_RISK" && existing.acceptedRiskUntil && existing.acceptedRiskUntil > now) {
      return existing;
    }

    let nextState = existing.state;
    if (["RESOLVED", "FALSE_POSITIVE"].includes(existing.state)) {
      nextState = "OPEN";
    } else if (existing.state === "SUPPRESSED") {
      nextState = "OPEN";
    }

    const updated = await prisma.securityFinding.update({
      where: { id: existing.id },
      data: {
        state: nextState,
        lastSeenAt: lastSeen > existing.lastSeenAt ? lastSeen : existing.lastSeenAt,
        occurrenceCount: existing.occurrenceCount + matchedEvents.length,
        confidence: Math.max(existing.confidence, confidence),
        severity: rule.severity,
        baselineNote,
        matchedEvidenceJson: {
          eventIds: matchedEvents.slice(-20).map((event) => event.id),
          eventTypes: [...new Set(matchedEvents.map((event) => event.eventType))],
          count: matchedEvents.length
        },
        thresholdWindowJson: {
          windowMs: rule.windowMs,
          threshold: rule.threshold,
          minimumSamples: rule.minimumSamples
        },
        updatedAt: now
      }
    });

    for (const event of matchedEvents.slice(-20)) {
      await prisma.securityFindingOccurrence.create({
        data: {
          id: randomUUID(),
          organizationId,
          findingId: updated.id,
          securityEventId: event.id,
          occurredAt: event.timestamp,
          evidenceJson: {
            eventType: event.eventType,
            correlationId: event.correlationId
          }
        }
      });
    }
    return updated;
  }

  const created = await prisma.securityFinding.create({
    data: {
      id: randomUUID(),
      organizationId,
      projectId: projectId ?? null,
      environment,
      fingerprint,
      ruleKey: rule.ruleKey,
      ruleVersion: rule.version,
      ruleName: rule.name,
      state: "OPEN",
      severity: rule.severity,
      confidence,
      firstSeenAt: firstSeen,
      lastSeenAt: lastSeen,
      occurrenceCount: matchedEvents.length,
      affectedEntityId: sample.entityId,
      affectedRelationshipId: sample.relationshipId,
      recommendedResponse: rule.recommendedResponse,
      baselineNote,
      evidenceSummaryJson: {
        ruleKey: rule.ruleKey,
        ruleVersion: rule.version,
        sampleCount: matchedEvents.length
      },
      thresholdWindowJson: {
        windowMs: rule.windowMs,
        threshold: rule.threshold,
        minimumSamples: rule.minimumSamples
      },
      matchedEvidenceJson: {
        eventIds: matchedEvents.slice(-20).map((event) => event.id),
        eventTypes: [...new Set(matchedEvents.map((event) => event.eventType))],
        count: matchedEvents.length
      },
      updatedAt: now
    }
  });

  for (const event of matchedEvents.slice(-20)) {
    await prisma.securityFindingOccurrence.create({
      data: {
        id: randomUUID(),
        organizationId,
        findingId: created.id,
        securityEventId: event.id,
        occurredAt: event.timestamp,
        evidenceJson: {
          eventType: event.eventType,
          correlationId: event.correlationId
        }
      }
    });
  }

  return created;
};

export const evaluateSecurityDetections = async (args: EvaluateDetectionsArgs) => {
  const lookbackMs = args.lookbackMs ?? 60 * 60 * 1000;
  const since = new Date(Date.now() - lookbackMs);
  const rules = await resolveRules(args.organizationId);

  const events = (await prisma.securityEvent.findMany({
    where: {
      organizationId: args.organizationId,
      timestamp: { gte: since },
      ...(args.projectId ? { projectId: args.projectId } : {}),
      ...(args.environment ? { environment: args.environment } : {})
    },
    orderBy: { timestamp: "asc" },
    take: 2000
  })) as EventRow[];

  const findings = [];
  for (const rule of rules) {
    const result = matchesRule(rule, events);
    if (!result.matched) continue;
    const finding = await upsertFinding({
      organizationId: args.organizationId,
      rule,
      matchedEvents: result.matchedEvents,
      confidence: result.confidence,
      baselineNote: result.baselineNote
    });
    if (finding) findings.push(finding);
  }

  return { evaluatedRules: rules.length, findingsCreatedOrUpdated: findings.length, findings };
};
