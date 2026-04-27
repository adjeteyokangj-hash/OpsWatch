import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: path.resolve(__dirname, "..", ".."),
  async redirects() {
    return [
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
