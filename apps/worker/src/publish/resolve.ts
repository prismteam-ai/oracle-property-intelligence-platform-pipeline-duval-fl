import { FILEBASE } from "../config.ts";

/**
 * Resolve a stable IPNS pointer to the immutable CID it currently names.
 *
 * This exists because of a large, measured performance cliff. Querying the
 * published Parquet through the IPNS path takes **~4 minutes** — the gateway
 * re-resolves the name on every one of the many HTTP range requests DuckDB
 * issues while reading a Parquet footer and column chunks. Querying the same
 * bytes through the CID path takes **~1.2 seconds**.
 *
 * A `HEAD` against the IPNS URL returns the resolved root in the `x-ipfs-roots`
 * header in about half a second. So consumers resolve once, then read by CID:
 * the stable, discoverable address stays IPNS, and the hot path is content
 * addressed. This is the header-based resolution the Elephant skills prescribe,
 * and it is why public gateways dropped the older RPC resolve endpoint.
 */

export interface ResolvedPointer {
  ipnsName: string;
  cid: string;
  ipnsUrl: string;
  cidUrl: string;
  resolvedAt: string;
}

const cache = new Map<string, { value: ResolvedPointer; expiresAt: number }>();

/** How long a resolution is reused before being re-checked. */
const TTL_MS = 5 * 60_000;

export async function resolveIpnsToCid(
  ipnsName: string,
  opts: { ttlMs?: number; signal?: AbortSignal } = {},
): Promise<ResolvedPointer> {
  const now = Date.now();
  const hit = cache.get(ipnsName);
  if (hit && hit.expiresAt > now) return hit.value;

  const ipnsUrl = `${FILEBASE.gateway}/ipns/${ipnsName}`;
  const res = await fetch(ipnsUrl, { method: "HEAD", signal: opts.signal });
  if (!res.ok) {
    throw new Error(`Could not resolve IPNS ${ipnsName}: HTTP ${res.status}`);
  }

  // `x-ipfs-roots` is the resolved root CID; the ETag carries the same value on
  // Filebase's gateway, so it is used as a fallback.
  const cid =
    res.headers.get("x-ipfs-roots")?.split(",")[0]?.trim() ??
    res.headers.get("etag")?.replace(/"/g, "").trim();
  if (!cid) {
    throw new Error(
      `Gateway did not return x-ipfs-roots for IPNS ${ipnsName}; cannot resolve to a CID.`,
    );
  }

  const value: ResolvedPointer = {
    ipnsName,
    cid,
    ipnsUrl,
    cidUrl: `${FILEBASE.gateway}/ipfs/${cid}`,
    resolvedAt: new Date().toISOString(),
  };
  cache.set(ipnsName, {
    value,
    expiresAt: now + (opts.ttlMs ?? TTL_MS),
  });
  return value;
}

export function clearResolutionCache(): void {
  cache.clear();
}
