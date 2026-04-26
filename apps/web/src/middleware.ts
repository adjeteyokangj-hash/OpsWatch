import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const isTokenUsable = (token: string | undefined): boolean => {
  if (!token) {
    return false;
  }

  const parts = token.split(".");
  if (parts.length !== 3 || !parts[1]) {
    return false;
  }

  try {
    const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"))) as {
      exp?: number;
    };

    if (typeof payload.exp === "number") {
      const nowSeconds = Math.floor(Date.now() / 1000);
      if (payload.exp <= nowSeconds) {
        return false;
      }
    }

    return true;
  } catch {
    return false;
  }
};

export function middleware(request: NextRequest) {
  const token = request.cookies.get("opswatch_token")?.value;
  const hasUsableToken = isTokenUsable(token);
  const { pathname } = request.nextUrl;
  const isAuthRoute = pathname.startsWith("/login") || pathname.startsWith("/register");
  const isPublicRoute = isAuthRoute || pathname.startsWith("/status") || pathname.startsWith("/status-page");

  if (isAuthRoute && hasUsableToken) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  if (isPublicRoute) {
    return NextResponse.next();
  }

  if (!hasUsableToken) {
    const response = NextResponse.redirect(new URL("/login", request.url));
    response.cookies.delete("opswatch_token");
    return response;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|brand/).*)"]
};