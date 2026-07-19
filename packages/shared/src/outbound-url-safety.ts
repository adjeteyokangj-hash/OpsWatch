const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata",
  "metadata.google.internal",
  "metadata.goog"
]);

const SENSITIVE_QUERY_KEY = /(?:^|[-_.])(api[-_.]?key|auth|credential|password|secret|signature|token)(?:$|[-_.])/i;

export type SafeExternalUrlOptions = {
  requireHttps?: boolean;
};

export const isDisallowedNetworkAddress = (address: string): boolean => {
  const normalized = address.trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/^::ffff:/, "");
  const ipv4Parts = normalized.split(".");
  const isIpv4 =
    ipv4Parts.length === 4 &&
    ipv4Parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) >= 0 && Number(part) <= 255);

  if (isIpv4) {
    const [a = -1, b = -1, c = -1] = ipv4Parts.map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0 && c === 0) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }

  if (normalized.includes(":")) {
    return (
      normalized === "::" ||
      normalized === "::1" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      /^fe[89ab]/.test(normalized) ||
      normalized.startsWith("ff")
    );
  }

  return false;
};

export const parseSafeExternalHttpUrl = (
  input: string,
  options: SafeExternalUrlOptions = {}
): URL => {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error("Enter a valid public URL");
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Only HTTP and HTTPS URLs are allowed");
  }
  if (options.requireHttps && url.protocol !== "https:") {
    throw new Error("External monitoring requires an https:// URL");
  }
  if (url.username || url.password) {
    throw new Error("URLs must not contain usernames or passwords");
  }
  if (url.hash) {
    url.hash = "";
  }
  for (const key of url.searchParams.keys()) {
    if (SENSITIVE_QUERY_KEY.test(key)) {
      throw new Error("Put credentials in a secure connection, not in the URL");
    }
  }

  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (
    !hostname ||
    BLOCKED_HOSTNAMES.has(hostname) ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    isDisallowedNetworkAddress(hostname)
  ) {
    throw new Error("Local, private, and metadata targets are not allowed");
  }

  url.hostname = hostname;
  return url;
};
