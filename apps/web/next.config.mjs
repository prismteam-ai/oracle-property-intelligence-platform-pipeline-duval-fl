/** @type {import('next').NextConfig} */
const nextConfig = {
  // Static export — the frontend is a static bundle deployed to Amplify. All data access is
  // server-only in the tRPC Lambda; no secret ever reaches the client bundle.
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  // Compile the workspace packages (they ship TypeScript source).
  transpilePackages: ["@oracle-duval/api-client", "@oracle-duval/shared"],
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: false },
};

export default nextConfig;
