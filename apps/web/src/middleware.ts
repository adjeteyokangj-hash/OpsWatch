import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  // Presence of opswatch_session is an access hint only; the API validates session state.
  const sessionCookie = request.cookies.get("opswatch_session")?.value;
  const hasSession = Boolean(sessionCookie);
  const { pathname } = request.nextUrl;
  const isAuthRoute = pathname.startsWith("/login") || pathname.startsWith("/register");
  const isPublicRoute = isAuthRoute || pathname.startsWith("/status") || pathname.startsWith("/status-page");

  if (isAuthRoute && hasSession) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  if (isPublicRoute) {
    return NextResponse.next();
  }

  if (!hasSession) {
    const response = NextResponse.redirect(new URL("/login", request.url));
    response.cookies.delete("opswatch_session");
    response.cookies.delete("opswatch_csrf");
    response.cookies.delete("opswatch_token");
    return response;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|brand/).*)"]
};
