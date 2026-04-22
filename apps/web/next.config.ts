import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
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
