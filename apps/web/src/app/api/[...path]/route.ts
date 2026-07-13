import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { resolveOpswatchApiOrigin } from "../../../lib/api-origin";

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

async function proxy(request: NextRequest, context: { params: Promise<{ path: string[] }> }): Promise<NextResponse> {
  const { path } = await context.params;
  const upstreamUrl = buildUpstreamUrl(request, path);
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
    const configHint =
      process.env.NODE_ENV === "production" && !process.env.OPSWATCH_API_ORIGIN
        ? " Set OPSWATCH_API_ORIGIN on the web project (or keep NEXT_PUBLIC_OPSWATCH_API_URL as the absolute API URL)."
        : "";
    return NextResponse.json(
      { error: "API unavailable", detail: `${detail}${configHint}` },
      { status: 502 }
    );
  }

  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers: forwardResponseHeaders(upstream)
  });
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const OPTIONS = proxy;
