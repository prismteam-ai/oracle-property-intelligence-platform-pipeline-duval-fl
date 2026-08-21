/**
 * Shared tRPC client contract. Both the AppRouter type and the client factory live here so any
 * frontend imports one package instead of re-deriving the client. The auth token is supplied by
 * the app at runtime (never baked into the bundle) and sent as a Bearer header.
 */
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { AppRouter } from "@oracle-duval/api/router";

export type { AppRouter };

export interface ClientOptions {
  url: string;
  /** Returns the current access token (or null) — read from session storage in the browser. */
  getToken?: () => string | null;
}

export function createClient(opts: ClientOptions) {
  return createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: opts.url,
        headers() {
          const token = opts.getToken?.() ?? null;
          return token ? { authorization: `Bearer ${token}` } : {};
        },
      }),
    ],
  });
}
