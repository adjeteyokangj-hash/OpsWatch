import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import supertest from "supertest";

type ExpressApplication = Parameters<typeof supertest>[0];

let appPromise: Promise<ExpressApplication> | null = null;

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
  const headers = Object.fromEntries(nextRequest.headers.entries());
  const body =
    method === "GET" || method === "HEAD"
      ? undefined
      : Buffer.from(await nextRequest.arrayBuffer());

  let agent = dispatchSupertest(app, method, path);

  for (const [key, value] of Object.entries(headers)) {
    agent = agent.set(key, value);
  }

  if (body !== undefined && body.length > 0) {
    agent = agent.send(body);
  }

  const response = await agent;

  return new NextResponse(response.text, {
    status: response.status,
    headers: forwardSupertestHeaders(response.headers)
  });
};

/** Use external API only when explicitly configured (local split dev). */
export const shouldUseEmbeddedOpswatchApi = (): boolean => {
  if (process.env.OPSWATCH_EMBEDDED_API === "false") {
    return false;
  }
  if (process.env.OPSWATCH_API_ORIGIN?.trim()) {
    return false;
  }
  return true;
};
