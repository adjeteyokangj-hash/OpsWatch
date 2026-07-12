import { createHmac, randomUUID } from "crypto";

export const createSignature = (
  payload: unknown,
  timestamp: string,
  nonce: string,
  secret: string
): string => {
  const body = JSON.stringify(payload);
  return createHmac("sha256", secret).update(`${timestamp}.${nonce}.${body}`).digest("hex");
};

export const createIngestSigningHeaders = (
  rawBody: string,
  secret: string,
  timestamp = new Date().toISOString(),
  nonce = randomUUID()
): Record<string, string> => ({
  "x-opswatch-timestamp": timestamp,
  "x-opswatch-nonce": nonce,
  "x-opswatch-signature": createHmac("sha256", secret)
    .update(`${timestamp}.${nonce}.${rawBody}`)
    .digest("hex")
});
