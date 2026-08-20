import { afterEach, describe, expect, it, vi } from "vitest";

// The S3 client is constructed lazily inside filebase.ts, so the mock has to be
// installed before the module under test is imported.
const send = vi.fn();
vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: class {
    send = send;
  },
  PutObjectCommand: class {
    constructor(public input: unknown) {}
  },
  HeadObjectCommand: class {
    constructor(public input: unknown) {}
  },
}));

process.env["S3_ACCESS_KEY_ID"] ??= "test-key";
process.env["S3_SECRET_ACCESS_KEY"] ??= "test-secret";

const {
  cidUrl,
  gatewayUrl,
  publishIpns,
  resolveIpns,
  uploadFile,
  verifyParquetByCid,
} = await import("./filebase.ts");

const FILEBASE_CID = "QmTYQhvpQ2JDadZDW2eis4aoSATPPH64Kh7YAx9S8Sz9m2";
const NAME = "k51qzi5uqu5dkokw1ojybn247mp12gu2x71hiqmt5mul44l5wbud2l3jm37azb";

function tempParquet(): string {
  const fs = require("node:fs") as typeof import("node:fs");
  const os = require("node:os") as typeof import("node:os");
  const path = require("node:path") as typeof import("node:path");
  const file = path.join(os.tmpdir(), `filebase-test-${Date.now()}.parquet`);
  fs.writeFileSync(file, Buffer.from("PAR1payloadPAR1"));
  return file;
}

afterEach(() => {
  vi.restoreAllMocks();
  send.mockReset();
});

describe("uploadFile", () => {
  it("publishes the CID Filebase pinned, not the locally derived one", async () => {
    // This is the regression that broke publication once: a locally derived
    // CIDv1 named content Filebase never pinned, so the gateway timed out.
    send
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ Metadata: { cid: FILEBASE_CID } });

    const result = await uploadFile({
      filePath: tempParquet(),
      key: "query-tables/duval/query-table.parquet",
      contentType: "application/vnd.apache.parquet",
    });

    expect(result.cid).toBe(FILEBASE_CID);
    expect(result.bytes).toBe(15);
    // Our local derivation of this tiny buffer is not Filebase's CID, and the
    // mismatch is reported rather than silently preferred.
    expect(result.cidMatchesLocalDerivation).toBe(false);
  });

  it("refuses to continue when Filebase reports no CID", async () => {
    send.mockResolvedValueOnce({}).mockResolvedValueOnce({ Metadata: {} });
    await expect(
      uploadFile({
        filePath: tempParquet(),
        key: "k",
        contentType: "application/json",
      }),
    ).rejects.toThrow(/refusing to publish an IPNS pointer to unknown content/);
  });
});

describe("verifyParquetByCid", () => {
  it("accepts a Parquet served over a range request", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 206,
        arrayBuffer: async () => Buffer.from("PAR1"),
      }),
    );
    const r = await verifyParquetByCid(FILEBASE_CID);
    expect(r.magic).toBe("PAR1");
    expect(r.rangeSupported).toBe(true);
    expect(r.url).toBe(cidUrl(FILEBASE_CID));
  });

  it("accepts a valid Parquet even when the gateway ignores the Range header", async () => {
    // A gateway answering 200 with the whole object must not be misreported as
    // a corrupt artifact — only the first four bytes are the magic number.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        arrayBuffer: async () => Buffer.from("PAR1" + "x".repeat(50_000)),
      }),
    );
    const r = await verifyParquetByCid(FILEBASE_CID);
    expect(r.magic).toBe("PAR1");
    expect(r.rangeSupported).toBe(false);
  });

  it("rejects content that is not a Parquet file", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 206,
        arrayBuffer: async () => Buffer.from("<htm"),
      }),
    );
    await expect(verifyParquetByCid(FILEBASE_CID)).rejects.toThrow(
      /does not begin with PAR1/,
    );
  });

  it("surfaces a gateway error with its status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 504 }),
    );
    await expect(verifyParquetByCid(FILEBASE_CID)).rejects.toThrow(
      /failed: 504/,
    );
  });
});

describe("resolveIpns", () => {
  it("returns resolved on the first successful attempt", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 206,
      arrayBuffer: async () => Buffer.from("PAR1"),
    });
    vi.stubGlobal("fetch", fetchMock);

    const r = await resolveIpns(NAME, { attempts: 3, delayMs: 0 });
    expect(r.resolved).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(r.url).toBe(gatewayUrl(NAME));
  });

  it("retries a propagating name and succeeds once it appears", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 504 })
      .mockResolvedValueOnce({
        ok: true,
        status: 206,
        arrayBuffer: async () => Buffer.from("PAR1"),
      });
    vi.stubGlobal("fetch", fetchMock);

    const r = await resolveIpns(NAME, { attempts: 3, delayMs: 0 });
    expect(r.resolved).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps retrying through a thrown network error rather than giving up", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("ECONNRESET"))
      .mockResolvedValueOnce({
        ok: true,
        status: 206,
        arrayBuffer: async () => Buffer.from("PAR1"),
      });
    vi.stubGlobal("fetch", fetchMock);

    expect(
      (await resolveIpns(NAME, { attempts: 3, delayMs: 0 })).resolved,
    ).toBe(true);
  });

  it("reports unresolved without throwing when the name never propagates", async () => {
    // An unpropagated pointer is a limitation on the run, not a failure — the
    // content is already verified at its CID.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 504 }),
    );
    const r = await resolveIpns(NAME, { attempts: 2, delayMs: 0 });
    expect(r.resolved).toBe(false);
    expect(r.status).toBe(504);
  });
});

describe("publishIpns", () => {
  it("creates the name with POST when the label does not exist yet", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ network_key: NAME }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const r = await publishIpns("oracle-query-table-duval", FILEBASE_CID);
    expect(r.networkKey).toBe(NAME);
    expect(fetchMock.mock.calls[1]?.[1]?.method).toBe("POST");
  });

  it("repoints an existing label with PUT so the address stays stable", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { label: "oracle-query-table-duval", network_key: NAME },
        ],
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);

    const r = await publishIpns("oracle-query-table-duval", FILEBASE_CID);
    expect(fetchMock.mock.calls[1]?.[1]?.method).toBe("PUT");
    // network_key comes from the existing record when the PUT body omits it.
    expect(r.networkKey).toBe(NAME);
    expect(r.cid).toBe(FILEBASE_CID);
  });

  it("throws rather than returning an unresolvable pointer", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);

    await expect(publishIpns("some-label", FILEBASE_CID)).rejects.toThrow(
      /carried no network_key/,
    );
  });

  it("surfaces the plan's IPNS name limit instead of swallowing it", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        text: async () => '{"error":{"reason":"ERR_TOO_MANY_NAMES"}}',
      });
    vi.stubGlobal("fetch", fetchMock);

    await expect(publishIpns("second-label", FILEBASE_CID)).rejects.toThrow(
      /ERR_TOO_MANY_NAMES/,
    );
  });
});
