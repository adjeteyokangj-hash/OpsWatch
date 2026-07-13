import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { resolveSessionCookieDomain } from "./lib/cookie-domain";

const clearSessionCookies = (response: NextResponse, hostname: string): void => {
  const domain = resolveSessionCookieDomain(hostname);
  const names = ["opswatch_session", "opswatch_csrf", "opswatch_token"] as const;

  for (const name of names) {
    if (domain) {
      response.cookies.set(name, "", { path: "/", maxAge: 0, domain });
      continue;
    }

    response.cookies.delete(name);
  }
};

const hasSessionCookie = (request: NextRequest): boolean =>
  Boolean(request.cookies.get("opswatch_session")?.value);

const validateSession = async (request: NextRequest): Promise<boolean> => {
  if (!hasSessionCookie(request)) {
    return false;
  }

  try {
    const sessionUrl = new URL("/api/auth/session", request.url);
    const response = await fetch(sessionUrl, {
      headers: {
        cookie: request.headers.get("cookie") ?? ""
      },
      cache: "no-store"
    });
    return response.ok;
  } catch {
    return false;
  }
};

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  const isAuthRoute = pathname.startsWith("/login") || pathname.startsWith("/register");
  const isPublicRoute = isAuthRoute || pathname.startsWith("/status") || pathname.startsWith("/status-page");
  const sessionValid = hasSessionCookie(request) ? await validateSession(request) : false;

  if (isAuthRoute && sessionValid) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  if (isPublicRoute) {
    if (isAuthRoute && hasSessionCookie(request) && !sessionValid) {
      const response = NextResponse.next();
      clearSessionCookies(response, request.nextUrl.hostname);
      return response;
    }
    return NextResponse.next();
  }

  if (!sessionValid) {
    const response = NextResponse.redirect(new URL("/login", request.url));
    clearSessionCookies(response, request.nextUrl.hostname);
    return response;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|brand/|api/).*)"]
};
