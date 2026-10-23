import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { isDisallowedNetworkAddress, parseSafeExternalHttpUrl } from "@opswatch/shared";

export async function resolvePublicWebsiteTarget(raw: string) {
  const url = parseSafeExternalHttpUrl(raw, { requireHttps: true });
  if (url.username || url.password) throw new Error("Website credentials are not allowed");
  let timer: ReturnType<typeof setTimeout> | undefined;
  const addresses = await Promise.race([
    lookup(url.hostname, { all: true, verbatim: true }),
    new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Website DNS lookup timed out")), 3000); })
  ]).finally(() => { if (timer) clearTimeout(timer); });
  const first = addresses[0];
  if (!first || addresses.some(row => isDisallowedNetworkAddress(row.address))) throw new Error("Private website target blocked");
  return { url, address: first.address };
}

export async function readPublicWebsiteHtml(raw: string): Promise<string> {
  const { url, address } = await resolvePublicWebsiteTarget(raw);
  return new Promise((resolve, reject) => {
    // Connect to the validated IP rather than resolving the name a second time.
    // TLS verification and the Host header still use the original hostname.
    const req = request({ hostname: address, servername: url.hostname, port: url.port || 443,
      path: url.pathname + url.search, method: "GET", agent: false,
      signal: AbortSignal.timeout(8000), headers: { host: url.host, accept: "text/html", "user-agent": "OpsWatch-Metadata/1.0" }
    }, response => {
      if (response.statusCode !== 200 || !response.headers["content-type"]?.includes("text/html")) {
        response.destroy(); reject(new Error("Website metadata unavailable")); return;
      }
      const chunks: Buffer[] = []; let bytes = 0;
      response.on("data", (chunk: Buffer) => {
        const remaining = 65_536 - bytes;
        if (remaining > 0) chunks.push(chunk.subarray(0, remaining));
        bytes += chunk.length;
        if (bytes >= 65_536) { resolve(Buffer.concat(chunks).toString("utf8")); response.destroy(); }
      });
      response.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      response.on("error", reject);
    });
    req.on("error", reject); req.end();
  });
}
