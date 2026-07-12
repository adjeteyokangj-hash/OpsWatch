import crypto from "crypto";
import { describe, expect, it } from "vitest";
import {
  computeIngestSignature,
  parseIngestTimestampMs,
  verifyGitHubWebhookSignature,
  verifyIngestSignature,
  verifyRenderWebhookSignature,
  verifyVercelWebhookSignature
} from "./request-signature";

describe("request-signature", () => {
  it("verifies Vercel signatures against raw body bytes", () => {
    const secret = "vercel-secret";
    const rawBody = Buffer.from('{"type":"deployment.error"}', "utf8");
    const signature = crypto.createHmac("sha1", secret).update(rawBody).digest("hex");

    expect(verifyVercelWebhookSignature(secret, rawBody, signature)).toBe(true);
    expect(verifyVercelWebhookSignature(secret, Buffer.from("{}"), signature)).toBe(false);
  });

  it("verifies GitHub signatures with sha256 prefix", () => {
    const secret = "github-secret";
    const rawBody = Buffer.from('{"action":"completed"}', "utf8");
    const signature =
      "sha256=" + crypto.createHmac("sha256", secret).update(rawBody).digest("hex");

    expect(verifyGitHubWebhookSignature(secret, rawBody, signature)).toBe(true);
    expect(verifyGitHubWebhookSignature(secret, rawBody, "sha256=deadbeef")).toBe(false);
  });

  it("rejects bodies whose bytes differ from the signed payload", () => {
    const secret = "github-secret";
    const signedBody = Buffer.from('{"type":"deployment.error"}', "utf8");
    const tamperedBody = Buffer.from('{"type": "deployment.error"}', "utf8");
    const signature =
      "sha256=" + crypto.createHmac("sha256", secret).update(signedBody).digest("hex");

    expect(verifyGitHubWebhookSignature(secret, signedBody, signature)).toBe(true);
    expect(verifyGitHubWebhookSignature(secret, tamperedBody, signature)).toBe(false);
  });

  it("verifies Render standard webhook signatures", () => {
    const secret = "render-signing-secret";
    const rawBody = Buffer.from('{"type":"deploy_ended","data":{"status":"failed"}}', "utf8");
    const webhookId = "evt-test";
    const webhookTimestamp = String(Math.floor(Date.now() / 1000));
    const signedContent = `${webhookId}.${webhookTimestamp}.${rawBody.toString("utf8")}`;
    const signature = crypto.createHmac("sha256", secret).update(signedContent).digest("base64");

    expect(
      verifyRenderWebhookSignature(secret, rawBody, {
        webhookId,
        webhookTimestamp,
        webhookSignature: `v1,${signature}`
      })
    ).toBe(true);
  });

  it("rejects stale Render webhook timestamps", () => {
    const secret = "render-signing-secret";
    const rawBody = Buffer.from("{}", "utf8");
    const webhookId = "evt-test";
    const webhookTimestamp = String(Math.floor(Date.now() / 1000) - 600);
    const signedContent = `${webhookId}.${webhookTimestamp}.${rawBody.toString("utf8")}`;
    const signature = crypto.createHmac("sha256", secret).update(signedContent).digest("base64");

    expect(
      verifyRenderWebhookSignature(secret, rawBody, {
        webhookId,
        webhookTimestamp,
        webhookSignature: `v1,${signature}`
      })
    ).toBe(false);
  });

  it("verifies ingest signatures with nonce and raw body bytes", () => {
    const secret = "ingest-secret";
    const rawBody = Buffer.from('{"projectSlug":"demo","type":"SERVICE_DOWN"}', "utf8");
    const timestamp = new Date().toISOString();
    const nonce = "nonce-123";
    const signature = computeIngestSignature(secret, timestamp, nonce, rawBody);

    expect(verifyIngestSignature(secret, rawBody, { timestamp, nonce, signature })).toBe(true);
    expect(verifyIngestSignature(secret, rawBody, { timestamp, nonce, signature: "deadbeef" })).toBe(false);
  });

  it("parses ingest timestamps from ISO and unix values", () => {
    const iso = new Date("2026-07-12T12:00:00.000Z").toISOString();
    expect(parseIngestTimestampMs(iso)).toBe(Date.parse(iso));
    expect(parseIngestTimestampMs("1750000000")).toBe(1750000000000);
    expect(parseIngestTimestampMs("invalid")).toBeNull();
  });
});
