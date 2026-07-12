import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: path.resolve(__dirname, "..", ".."),
  async rewrites() {
    // Same-origin /api in local dev so session cookies set by the API are scoped to the web app.
    const apiOrigin = process.env.OPSWATCH_API_ORIGIN?.trim() || "http://127.0.0.1:4000";
    return [
      {
        source: "/api/:path*",
        destination: `${apiOrigin}/api/:path*`
      }
    ];
  },
  async redirects() {
    return [
      {
        source: "/users",
        destination: "/members",
        permanent: false
      },
      {
        source: "/projects/:projectId/team",
        destination: "/projects/:projectId/contacts",
        permanent: false
      },
      {
        source: "/:path*",
        has: [
          {
            type: "host",
            value: "sparkle-valeting.vercel.app",
          },
        ],
        destination: "https://sparklevaleting.com/:path*",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
