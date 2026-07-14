import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { resolveOpswatchApiOrigin, shouldUseEmbeddedOpswatchApi } from "../../../lib/api-origin";
import { handleEmbeddedOpswatchApi } from "../../../server/opswatch-api-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Avoid hard kills on cold embedded Express + Prisma; Pro plans allow up to 300s. */
export const maxDuration = 60;

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

const buildUpstreamUrl = (request: NextRequest, pathSegments: string[]): string => {
  const path = pathSegments.join("/");
  const search = request.nextUrl.search;
  return `${resolveOpswatchApiOrigin()}/api/${path}${search}`;
};

const forwardRequestHeaders = (request: NextRequest): Headers => {
  const headers = new Headers();
  request.headers.forEach((value, key) => {
    if (hopByHopHeaders.has(key.toLowerCase())) return;
    headers.set(key, value);
  });
  return headers;
};

const forwardResponseHeaders = (upstream: Response): Headers => {
  const headers = new Headers();
  upstream.headers.forEach((value, key) => {
    if (hopByHopHeaders.has(key.toLowerCase())) return;
    if (key.toLowerCase() === "set-cookie") return;
    headers.append(key, value);
  });

  const setCookies =
    typeof upstream.headers.getSetCookie === "function"
      ? upstream.headers.getSetCookie()
      : upstream.headers.get("set-cookie")
        ? [upstream.headers.get("set-cookie") as string]
        : [];

  for (const cookie of setCookies) {
    headers.append("set-cookie", cookie);
  }

  return headers;
};

async function proxyToExternalApi(
  request: NextRequest,
  pathSegments: string[]
): Promise<NextResponse> {
  const upstreamUrl = buildUpstreamUrl(request, pathSegments);
  const method = request.method.toUpperCase();
  const headers = forwardRequestHeaders(request);
  const body =
    method === "GET" || method === "HEAD" ? undefined : await request.arrayBuffer();

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      method,
      headers,
      body,
      redirect: "manual",
      cache: "no-store"
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: "API unavailable", detail },
      { status: 502 }
    );
  }

  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers: forwardResponseHeaders(upstream)
  });
}

async function handleOpswatchApi(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> }
): Promise<NextResponse> {
  const { path } = await context.params;

  if (shouldUseEmbeddedOpswatchApi()) {
    try {
      return await handleEmbeddedOpswatchApi(request, path);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return NextResponse.json(
        { error: "API unavailable", detail },
        { status: 500 }
      );
    }
  }

  return proxyToExternalApi(request, path);
}

export const GET = handleOpswatchApi;
export const POST = handleOpswatchApi;
export const PUT = handleOpswatchApi;
export const PATCH = handleOpswatchApi;
export const DELETE = handleOpswatchApi;
export const OPTIONS = handleOpswatchApi;
