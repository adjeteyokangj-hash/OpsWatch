import crypto from "crypto";

export type HmacAlgorithm = "sha1" | "sha256";

export const timingSafeEqualString = (provided: string, expected: string): boolean => {
  const providedBuf = Buffer.from(provided, "utf8");
  const expectedBuf = Buffer.from(expected, "utf8");
  if (providedBuf.length !== expectedBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(providedBuf, expectedBuf);
};

export const hmacDigest = (
  secret: string,
  payload: string | Buffer,
  algorithm: HmacAlgorithm,
  encoding: "hex" | "base64" = "hex"
): string => crypto.createHmac(algorithm, secret).update(payload).digest(encoding);

export const decodeWebhookSecret = (secret: string): Buffer => {
  if (secret.startsWith("whsec_")) {
    return Buffer.from(secret.slice("whsec_".length), "base64");
  }
  return Buffer.from(secret, "utf8");
};

export const verifyVercelWebhookSignature = (
  secret: string,
  rawBody: Buffer,
  signatureHeader: string
): boolean => {
  const expected = hmacDigest(secret, rawBody, "sha1", "hex");
  return timingSafeEqualString(signatureHeader, expected);
};

export const verifyGitHubWebhookSignature = (
  secret: string,
  rawBody: Buffer,
  signatureHeader: string
): boolean => {
  const expected = `sha256=${hmacDigest(secret, rawBody, "sha256", "hex")}`;
  return timingSafeEqualString(signatureHeader, expected);
};

export const verifyRenderWebhookSignature = (
  secret: string,
  rawBody: Buffer,
  headers: {
    webhookId?: string;
    webhookTimestamp?: string;
    webhookSignature?: string;
  },
  maxAgeSeconds = 300
): boolean => {
  const webhookId = headers.webhookId?.trim();
  const webhookTimestamp = headers.webhookTimestamp?.trim();
  const webhookSignature = headers.webhookSignature?.trim();

  if (!webhookId || !webhookTimestamp || !webhookSignature) {
    return false;
  }

  const timestampSeconds = Number(webhookTimestamp);
  if (!Number.isFinite(timestampSeconds)) {
    return false;
  }

  const ageSeconds = Math.abs(Math.floor(Date.now() / 1000) - timestampSeconds);
  if (ageSeconds > maxAgeSeconds) {
    return false;
  }

  const secretBytes = decodeWebhookSecret(secret);
  const signedContent = `${webhookId}.${webhookTimestamp}.${rawBody.toString("utf8")}`;
  const expected = crypto.createHmac("sha256", secretBytes).update(signedContent).digest("base64");

  for (const versionedSignature of webhookSignature.split(" ")) {
    const [version, signature] = versionedSignature.split(",", 2);
    if (version !== "v1" || !signature) {
      continue;
    }
    if (timingSafeEqualString(signature, expected)) {
      return true;
    }
  }

  return false;
};
