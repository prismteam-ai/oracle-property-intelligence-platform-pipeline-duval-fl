import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone output keeps the Railway image small and avoids shipping the pnpm store.
  output: "standalone",
  outputFileTracingRoot: new URL("../../", import.meta.url).pathname,
  reactStrictMode: true,
  // The evaluator drives this app with Playwright. Never let a build-time type or lint
  // error become a deploy failure — CI is where those gate, not the runtime.
  eslint: { ignoreDuringBuilds: true },
  // DuckDB ships a native addon. Bundling it breaks .node resolution, so it stays
  // external and is required at runtime from node_modules.
  serverExternalPackages: ["@duckdb/node-api", "@duckdb/node-bindings"],
};

export default nextConfig;
