export type AlertListRow = {
  id: string;
  title: string;
  message: string;
  severity: string;
  status: string;
  category: string;
  sourceType: string;
  firstSeenAt: string;
  lastSeenAt: string;
  project: { id: string; name: string };
  service: { id: string; name: string } | null;
  linkedIncidents?: Array<{ id: string; title: string; status: string }>;
};

export type AlertGroup = {
  key: string;
  title: string;
  severity: string;
  sourceType: string;
  serviceName: string | null;
  count: number;
  firstSeenAt: string;
  lastSeenAt: string;
  latestId: string;
  linkedIncident: { id: string; title: string; status: string } | null;
  memberIds: string[];
};

/**
 * Group alerts by exact operational signature: project + title + sourceType + service.
 * This is deterministic dedup/storm grouping — not ML clustering.
 */
export const groupAlertsBySignature = (alerts: AlertListRow[]): AlertGroup[] => {
  const map = new Map<string, AlertGroup>();

  for (const alert of alerts) {
    const key = [
      alert.project.id,
      alert.title.trim().toLowerCase(),
      alert.sourceType,
      alert.service?.id ?? "none"
    ].join("|");

    const existing = map.get(key);
    if (!existing) {
      map.set(key, {
        key,
        title: alert.title,
        severity: alert.severity,
        sourceType: alert.sourceType,
        serviceName: alert.service?.name ?? null,
        count: 1,
        firstSeenAt: alert.firstSeenAt,
        lastSeenAt: alert.lastSeenAt,
        latestId: alert.id,
        linkedIncident: alert.linkedIncidents?.[0] ?? null,
        memberIds: [alert.id]
      });
      continue;
    }

    existing.count += 1;
    existing.memberIds.push(alert.id);
    if (new Date(alert.firstSeenAt).getTime() < new Date(existing.firstSeenAt).getTime()) {
      existing.firstSeenAt = alert.firstSeenAt;
    }
    if (new Date(alert.lastSeenAt).getTime() > new Date(existing.lastSeenAt).getTime()) {
      existing.lastSeenAt = alert.lastSeenAt;
      existing.latestId = alert.id;
      existing.severity = alert.severity;
      existing.linkedIncident = alert.linkedIncidents?.[0] ?? existing.linkedIncident;
    }
  }

  return Array.from(map.values()).sort(
    (a, b) => new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime()
  );
};
