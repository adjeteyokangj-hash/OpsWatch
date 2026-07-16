#!/usr/bin/env node
/**
 * Local-only mock remediator webhook for OpsWatch Worker provider validation.
 * Not for production. Supports signed validate + allowlisted repair actions.
 *
 * Usage:
 *   node scripts/mock-remediator-server.mjs
 *   REMEDIATOR_MOCK_SECRET=dev-secret REMEDIATOR_MOCK_PORT=8791 node scripts/mock-remediator-server.mjs
 *
 * Env:
 *   REMEDIATOR_MOCK_SECRET   — shared HMAC secret (default: local-remediator-secret)
 *   REMEDIATOR_MOCK_PORT     — listen port (default: 8791)
 *   REMEDIATOR_MOCK_VERIFY   — when "false", repair returns ok without verified=true
 *   REMEDIATOR_MOCK_REJECT   — when "true", reject repairs
 *   REMEDIATOR_MOCK_DELAY_MS — artificial delay before responding
 */
import http from "node:http";
import crypto from "node:crypto";

const PORT = Number(process.env.REMEDIATOR_MOCK_PORT || 8791);
const SECRET = process.env.REMEDIATOR_MOCK_SECRET || "local-remediator-secret";
const VERIFY = process.env.REMEDIATOR_MOCK_VERIFY !== "false";
const REJECT = process.env.REMEDIATOR_MOCK_REJECT === "true";
const DELAY_MS = Number(process.env.REMEDIATOR_MOCK_DELAY_MS || 0);

const WORKER_ACTIONS = new Set([
  "restart_sync_worker",
  "restart_outbox_processor",
  "retry_failed_jobs",
  "retry_outbox_item",
  "validate"
]);

const seenNonces = new Map();
const seenIdempotency = new Map();

const buildContent = (fields) =>
  [
    fields.timestamp,
    fields.nonce,
    fields.projectId,
    fields.incidentId ?? "",
    fields.action,
    fields.target ?? "",
    fields.reason ?? "",
    fields.idempotencyKey
  ].join(".");

const sign = (fields) =>
  crypto.createHmac("sha256", SECRET).update(buildContent(fields)).digest("hex");

const timingSafeEqual = (a, b) => {
  const aa = Buffer.from(String(a), "utf8");
  const bb = Buffer.from(String(b), "utf8");
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
};

const readBody = (req) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, role: "local-mock-remediator" }));
    return;
  }

  if (req.method !== "POST") {
    res.writeHead(405).end("Method Not Allowed");
    return;
  }

  try {
    const raw = await readBody(req);
    const body = JSON.parse(raw || "{}");
    const timestamp = req.headers["x-opswatch-remediator-timestamp"] || body.timestamp;
    const nonce = req.headers["x-opswatch-remediator-nonce"] || body.nonce;
    const signature = req.headers["x-opswatch-remediator-signature"];
    const idempotencyKey =
      req.headers["x-opswatch-remediator-idempotency-key"] || body.idempotencyKey;

    const fields = {
      timestamp: String(timestamp || ""),
      nonce: String(nonce || ""),
      projectId: String(body.projectId || ""),
      incidentId: body.incidentId ?? "",
      action: String(body.action || body.type || ""),
      target: body.target ?? "",
      reason: body.reason ?? "",
      idempotencyKey: String(idempotencyKey || "")
    };

    const expected = sign(fields);
    if (!signature || !timingSafeEqual(signature, expected)) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, reason: "invalid_signature" }));
      return;
    }

    const ageMs = Math.abs(Date.now() - Date.parse(fields.timestamp));
    if (!Number.isFinite(ageMs) || ageMs > 5 * 60_000) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, reason: "expired_timestamp" }));
      return;
    }

    if (seenNonces.has(fields.nonce)) {
      res.writeHead(409, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, duplicate: true, reason: "replayed_nonce" }));
      return;
    }
    seenNonces.set(fields.nonce, Date.now());

    if (DELAY_MS > 0) {
      await new Promise((r) => setTimeout(r, DELAY_MS));
    }

    if (body.type === "validate" || fields.action === "validate") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          ok: true,
          accepted: true,
          capabilities: [...WORKER_ACTIONS].filter((a) => a !== "validate")
        })
      );
      return;
    }

    if (!WORKER_ACTIONS.has(fields.action)) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, rejected: true, reason: "action_not_allowlisted" }));
      return;
    }

    if (REJECT) {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, rejected: true, reason: "provider_rejected" }));
      return;
    }

    if (seenIdempotency.has(fields.idempotencyKey)) {
      res.writeHead(409, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, duplicate: true, reason: "duplicate_idempotency_key" }));
      return;
    }
    seenIdempotency.set(fields.idempotencyKey, Date.now());

    const payload = {
      ok: true,
      accepted: true,
      action: fields.action,
      target: fields.target,
      verified: VERIFY,
      healthy: VERIFY,
      verificationStatus: VERIFY ? "healthy" : "pending",
      verificationEvidence: VERIFY
        ? { worker: "restarted", outbox: "draining", at: new Date().toISOString() }
        : undefined
    };
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(payload));
  } catch (error) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, reason: String(error?.message || error) }));
  }
});

server.listen(PORT, () => {
  console.log(`[mock-remediator] listening on http://127.0.0.1:${PORT}`);
  console.log(`[mock-remediator] secret=${SECRET.slice(0, 4)}… (local-only)`);
});
