import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  const token = request.cookies.get("opswatch_token")?.value;
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/login") || pathname.startsWith("/status")) {
    return NextResponse.next();
  }

  if (!token) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/projects/:path*",
    "/alerts/:path*",
    "/incidents/:path*",
    "/checks/:path*",
    "/settings/:path*",
    "/users/:path*",
    "/billing/:path*",
    "/org/:path*",
    "/onboarding/:path*"
  ]
};
