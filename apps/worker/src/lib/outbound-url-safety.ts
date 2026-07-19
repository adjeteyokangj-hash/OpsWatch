import { lookup } from "dns/promises";
import {
  isDisallowedNetworkAddress,
  parseSafeExternalHttpUrl
} from "@opswatch/shared";

export type ResolvedSafeTarget = {
  url: URL;
  addresses: string[];
};

export const resolveSafeOutboundTarget = async (
  target: string,
  options: { requireHttps?: boolean } = {}
): Promise<ResolvedSafeTarget> => {
  const url = parseSafeExternalHttpUrl(target, options);
  if (process.env.NODE_ENV === "test" && url.hostname.endsWith(".test")) {
    return { url, addresses: ["203.0.113.1"] };
  }
  const resolved = await lookup(url.hostname, { all: true, verbatim: true });
  const addresses = [...new Set(resolved.map(({ address }) => address))];
  if (!addresses.length) {
    throw new Error("The monitoring target did not resolve");
  }
  if (addresses.some(isDisallowedNetworkAddress)) {
    throw new Error("The monitoring target resolved to a local, private, or metadata address");
  }
  return { url, addresses };
};
