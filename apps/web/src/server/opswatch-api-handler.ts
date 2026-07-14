import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import supertest from "supertest";
import { resolveEmbeddedResponseBody } from "./embedded-response";

type ExpressApplication = Parameters<typeof supertest>[0];

let appPromise: Promise<ExpressApplication> | null = null;

const hopByHopHeaders = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length"
]);

const loadExpressApp = async (): Promise<ExpressApplication> => {
  if (!appPromise) {
    appPromise = (async () => {
      const { bootstrapApi } = await import("@opswatch/api/bootstrap");
      const { app } = await import("@opswatch/api/app");
      bootstrapApi();
      return app;
    })();
  }
  return appPromise;
};

const buildApiPath = (nextRequest: NextRequest, pathSegments: string[]): string => {
  const path = pathSegments.join("/");
  const search = nextRequest.nextUrl.search;
  return `/api/${path}${search}`;
};

const forwardSupertestHeaders = (headers: Record<string, string | string[] | undefined>): Headers => {
  const nextHeaders = new Headers();

  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const entry of value) {
        nextHeaders.append(key, String(entry));
      }
      continue;
    }
    nextHeaders.append(key, String(value));
  }

  return nextHeaders;
};

const dispatchSupertest = (
  app: ExpressApplication,
  method: string,
  path: string
) => {
  const agent = supertest(app);
  switch (method) {
    case "POST":
      return agent.post(path);
    case "PUT":
      return agent.put(path);
    case "PATCH":
      return agent.patch(path);
    case "DELETE":
      return agent.delete(path);
    case "OPTIONS":
      return agent.options(path);
    case "HEAD":
      return agent.head(path);
    default:
      return agent.get(path);
  }
};

/** Run the OpsWatch Express API in-process (Noble-style same-origin /api). */
export const handleEmbeddedOpswatchApi = async (
  nextRequest: NextRequest,
  pathSegments: string[]
): Promise<NextResponse> => {
  const app = await loadExpressApp();
  const method = nextRequest.method.toUpperCase();
  const path = buildApiPath(nextRequest, pathSegments);
  const incomingHeaders = Object.fromEntries(nextRequest.headers.entries());
  const bodyBytes =
    method === "GET" || method === "HEAD"
      ? undefined
      : Buffer.from(await nextRequest.arrayBuffer());

  let agent = dispatchSupertest(app, method, path);

  for (const [key, value] of Object.entries(incomingHeaders)) {
    if (hopByHopHeaders.has(key.toLowerCase())) continue;
    agent = agent.set(key, value);
  }

  if (bodyBytes !== undefined && bodyBytes.length > 0) {
    const contentType = incomingHeaders["content-type"] || incomingHeaders["Content-Type"];
    if (contentType) {
      agent = agent.set("Content-Type", contentType);
    }
    // Send as utf8 string so express.json() can parse application/json reliably.
    const asText = bodyBytes.toString("utf8");
    agent = agent.send(asText);
  }

  const response = await agent;
  const status = Number(response.status) || 500;
  const responseBody = resolveEmbeddedResponseBody(status, response.text);

  return new NextResponse(responseBody, {
    status,
    headers: forwardSupertestHeaders(response.headers)
  });
};
