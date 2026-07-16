/** React Query bindings for the tRPC AppRouter (used by the Next.js frontend). */
import { createTRPCReact, httpBatchLink } from "@trpc/react-query";
import type { AppRouter } from "@oracle-duval/api/router";

export const trpc = createTRPCReact<AppRouter>();

export interface TrpcClientConfig {
  url: string;
  getToken: () => string | null;
}

export function makeTrpcClient(cfg: TrpcClientConfig) {
  return trpc.createClient({
    links: [
      httpBatchLink({
        url: cfg.url,
        headers() {
          const token = cfg.getToken();
          return token ? { authorization: `Bearer ${token}` } : {};
        },
      }),
    ],
  });
}
