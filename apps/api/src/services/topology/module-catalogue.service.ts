/** Evidence-based, application-scoped catalogue proposals. Never materialises live topology. */
export type ModuleEvidenceSource = "description" | "public_url" | "connected_api";
export type ModuleProposalState = "suggested" | "inferred" | "verified";
export type ModuleDefinition = {
  key: string;
  label: string;
  terms: readonly string[];
};
export type ModuleProposal = {
  key: string;
  label: string;
  state: ModuleProposalState;
  sources: ModuleEvidenceSource[];
  evidence: string[];
  requiresApproval: true;
};
export const CORE_MODULE_CATALOGUE: readonly ModuleDefinition[] = [
  { key: "identity", label: "Identity and Access", terms: ["login", "authentication", "users", "roles", "staff"] },
  { key: "monitoring", label: "Monitoring and Alerts", terms: ["monitoring", "alerts", "health checks", "heartbeat"] },
  { key: "bookings", label: "Bookings", terms: ["booking", "reservation", "guest house", "hotel"] },
  { key: "rooms", label: "Rooms and Properties", terms: ["rooms", "property", "guest house", "hotel"] },
  { key: "payments", label: "Payments", terms: ["payment", "checkout", "refund", "paystack"] },
  { key: "finance", label: "Finance and Reconciliation", terms: ["finance", "reconciliation", "cash count", "end of day"] },
  { key: "content", label: "Content Management", terms: ["cms", "content management", "website management"] },
  { key: "tasks", label: "Tasks and Workflows", terms: ["task", "workflow", "approval"] },
  { key: "fleet", label: "Fleet and Tracking", terms: ["fleet", "vehicle", "rider", "gps"] },
  { key: "games", label: "Gameplay", terms: ["gameplay", "oware", "game engine", "two-player"] },
  { key: "reports", label: "Reports and Analytics", terms: ["report", "analytics", "dashboard"] },
  { key: "integrations", label: "Integrations", terms: ["webhook", "api integration", "connected api"] }
] as const;
export type ModuleDiscoveryInput = {
  description?: string;
  publicUrl?: string;
  /** Only metadata explicitly authorised and returned by the connected API. */
  connectedApi?: { verified: boolean; capabilities: readonly string[] };
  /** Extensions are scoped to this invocation, never mutated into the shared catalogue. */
  extensions?: readonly ModuleDefinition[];
};
const matchesTerm = (value: string, term: string): boolean => {
  const normalized = ` ${value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
  const needle = ` ${term.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
  return needle.trim().length > 0 && normalized.includes(needle);
};

export const proposeProjectModules = (input: ModuleDiscoveryInput): ModuleProposal[] => {
  const evidence: Array<{ source: ModuleEvidenceSource; value: string; verified: boolean }> = [];
  if (input.description?.trim()) evidence.push({ source: "description", value: input.description.trim(), verified: false });
  if (input.publicUrl?.trim()) {
    try {
      const url = new URL(input.publicUrl);
      if (url.protocol === "https:" || url.protocol === "http:") {
        evidence.push({ source: "public_url", value: url.hostname.toLowerCase(), verified: false });
      }
    } catch { /* Invalid or private URL is not discovery evidence. */ }
  }
  for (const capability of input.connectedApi?.capabilities ?? []) {
    if (capability.trim()) evidence.push({ source: "connected_api", value: capability.trim(), verified: input.connectedApi?.verified === true });
  }
  const unique = new Map<string, ModuleDefinition>();
  for (const definition of [...CORE_MODULE_CATALOGUE, ...(input.extensions ?? [])]) {
    if (!unique.has(definition.key)) unique.set(definition.key, definition);
  }
  return [...unique.values()].flatMap((definition) => {
    const matches = evidence.filter((entry) => definition.terms.some((term) =>
      matchesTerm(entry.value, term)
    ));
    if (!matches.length) return [];
    return [{
      key: definition.key,
      label: definition.label,
      state: matches.some((match) => match.source === "connected_api" && match.verified)
        ? "verified" as const : matches.some((match) => match.source === "description")
          ? "inferred" as const : "suggested" as const,
      sources: [...new Set(matches.map((match) => match.source))],
      evidence: matches.map((match) => match.value),
      requiresApproval: true as const
    }];
  });
};
