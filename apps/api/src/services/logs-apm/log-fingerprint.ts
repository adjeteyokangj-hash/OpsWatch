import { createHash } from "crypto";

/** Strip volatile tokens so repeated errors share a stable template. */
export const normalizeLogMessage = (message: string | undefined | null): string => {
  if (!message) return "";
  return message
    .toLowerCase()
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<uuid>")
    .replace(/\b[0-9a-f]{16,64}\b/gi, "<hex>")
    .replace(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, "<ip>")
    .replace(/\d+/g, "<n>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
};

export const extractExceptionClass = (
  body: string | undefined,
  attributes: Record<string, unknown>
): string | null => {
  const fromAttr =
    (typeof attributes["exception.type"] === "string" && attributes["exception.type"]) ||
    (typeof attributes["error.type"] === "string" && attributes["error.type"]) ||
    null;
  if (fromAttr) return String(fromAttr).slice(0, 120);
  if (!body) return null;
  const match = body.match(/\b([A-Z][A-Za-z0-9_]*(?:Error|Exception))\b/);
  return match?.[1] ?? null;
};

export const extractOperation = (attributes: Record<string, unknown>): string | null => {
  const route =
    attributes["http.route"] ?? attributes["http.target"] ?? attributes["rpc.method"] ?? null;
  return typeof route === "string" ? route.slice(0, 200) : null;
};

export const buildLogFingerprint = (input: {
  projectId: string | null;
  environment: string;
  entityId: string | null;
  severity: string | null;
  normalizedMessage: string;
  exceptionClass: string | null;
  operation: string | null;
}): string => {
  const material = [
    input.projectId ?? "",
    input.environment,
    input.entityId ?? "",
    (input.severity ?? "UNKNOWN").toUpperCase(),
    input.normalizedMessage,
    input.exceptionClass ?? "",
    input.operation ?? ""
  ].join("|");
  return createHash("sha256").update(material).digest("hex").slice(0, 40);
};
