import { afterEach, describe, expect, it, vi } from "vitest";
import { clearResolutionCache, resolveIpnsToCid } from "./resolve.ts";

const NAME = "k51qzi5uqu5dtestnameforresolution";
const CID = "QmTYQhvpQ2JDadZDW2eis4aoSATPPH64Kh7YAx9S8Sz9m2";

function headResponse(headers: Record<string, string>, ok = true) {
  return {
    ok,
    status: ok ? 200 : 502,
    headers: new Headers(headers),
  } as Response;
}

afterEach(() => {
  clearResolutionCache();
  vi.restoreAllMocks();
});

describe("resolveIpnsToCid", () => {
  it("reads the root CID from x-ipfs-roots and builds both addresses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(headResponse({ "x-ipfs-roots": CID })),
    );

    const r = await resolveIpnsToCid(NAME);
    expect(r.cid).toBe(CID);
    expect(r.ipnsUrl).toBe(`https://ipfs.filebase.io/ipns/${NAME}`);
    expect(r.cidUrl).toBe(`https://ipfs.filebase.io/ipfs/${CID}`);
  });

  it("takes only the first root when the gateway returns a chain", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          headResponse({ "x-ipfs-roots": `${CID}, QmSomethingElse` }),
        ),
    );
    expect((await resolveIpnsToCid(NAME)).cid).toBe(CID);
  });

  it("falls back to the ETag when x-ipfs-roots is absent", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(headResponse({ etag: `"${CID}"` })),
    );
    expect((await resolveIpnsToCid(NAME)).cid).toBe(CID);
  });

  it("caches so repeated reads cost one HEAD, not one per query", async () => {
    // This is the whole point: resolving per-query is the ~4 minute path.
    const fetchMock = vi
      .fn()
      .mockResolvedValue(headResponse({ "x-ipfs-roots": CID }));
    vi.stubGlobal("fetch", fetchMock);

    await resolveIpnsToCid(NAME);
    await resolveIpnsToCid(NAME);
    await resolveIpnsToCid(NAME);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("re-resolves once the cache entry expires", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(headResponse({ "x-ipfs-roots": CID }));
    vi.stubGlobal("fetch", fetchMock);

    await resolveIpnsToCid(NAME, { ttlMs: 0 });
    await resolveIpnsToCid(NAME, { ttlMs: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws with the name when the gateway cannot resolve", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(headResponse({}, false)));
    await expect(resolveIpnsToCid(NAME)).rejects.toThrow(
      `Could not resolve IPNS ${NAME}: HTTP 502`,
    );
  });

  it("throws when the gateway responds without any root header", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(headResponse({})));
    await expect(resolveIpnsToCid(NAME)).rejects.toThrow(
      /did not return x-ipfs-roots/,
    );
  });
});
