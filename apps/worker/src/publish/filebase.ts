import fs from "node:fs";
import {
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
// @ts-expect-error — ipfs-only-hash ships no type declarations.
import Hash from "ipfs-only-hash";
import { FILEBASE } from "../config.ts";

/**
 * Filebase is the Elephant ecosystem's IPFS on-ramp: an S3-compatible upload
 * API that pins to IPFS, plus a separate REST API for IPNS names.
 *
 * Two conventions here are load-bearing and easy to get wrong:
 *
 *  - The IPNS endpoint is `/v1/names`, **not** `/v1/ipns`. The latter 404s, and
 *    because the upload succeeds first, the symptom is a run that reports
 *    success while the pointer never moves.
 *  - The bearer token is *derived* from the S3 key pair — there is no separate
 *    API token to issue.
 */

function requireCredentials(): {
  accessKeyId: string;
  secretAccessKey: string;
} {
  const { accessKeyId, secretAccessKey } = FILEBASE;
  if (!accessKeyId || !secretAccessKey) {
    throw new Error(
      "Filebase credentials are not configured. Set S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY.",
    );
  }
  return { accessKeyId, secretAccessKey };
}

let client: S3Client | undefined;
function s3(): S3Client {
  if (!client) {
    const credentials = requireCredentials();
    client = new S3Client({
      endpoint: FILEBASE.endpoint,
      region: "us-east-1",
      credentials,
      forcePathStyle: true,
    });
  }
  return client;
}

/**
 * Locally-derived CID, kept as a cross-check rather than as the published value.
 *
 * Filebase decides the chunking and DAG layout. An earlier version derived a
 * CIDv1 with raw leaves, which does not match the CIDv0 Filebase pins; the IPNS
 * pointer then named content that was never pinned and the gateway timed out.
 * `cidVersion: 0` aligns the version, but the chunker parameters are still
 * Filebase's to choose, so the derived value is a hint and never the published
 * one. The uploaded object's own metadata is the source of truth.
 */
export async function computeCid(bytes: Buffer): Promise<string> {
  return (await Hash.of(bytes, { cidVersion: 0 })) as string;
}

export async function uploadFile(opts: {
  filePath: string;
  key: string;
  contentType: string;
}): Promise<{
  key: string;
  cid: string;
  bytes: number;
  cidMatchesLocalDerivation: boolean;
}> {
  const body = fs.readFileSync(opts.filePath);
  await s3().send(
    new PutObjectCommand({
      Bucket: FILEBASE.bucket,
      Key: opts.key,
      Body: body,
      ContentType: opts.contentType,
    }),
  );

  // Filebase reports the CID it actually pinned in the object's user metadata.
  const head = await s3().send(
    new HeadObjectCommand({ Bucket: FILEBASE.bucket, Key: opts.key }),
  );
  const cid = head.Metadata?.["cid"];
  if (!cid) {
    throw new Error(
      `Filebase returned no CID for ${opts.key}; refusing to publish an IPNS pointer to unknown content.`,
    );
  }

  const derived = await computeCid(body).catch(() => undefined);
  return {
    key: opts.key,
    cid,
    bytes: body.byteLength,
    cidMatchesLocalDerivation: derived === cid,
  };
}

function authHeader(): string {
  const { accessKeyId, secretAccessKey } = requireCredentials();
  const token = Buffer.from(`${accessKeyId}:${secretAccessKey}`).toString(
    "base64",
  );
  return `Bearer ${token}`;
}

interface IpnsName {
  label: string;
  /** The resolvable `k51…` name. Filebase returns this as `network_key`. */
  networkKey: string;
  cid: string;
}

async function listNames(): Promise<Array<Record<string, unknown>>> {
  const res = await fetch(FILEBASE.namesApi, {
    headers: { Authorization: authHeader() },
  });
  if (!res.ok) {
    throw new Error(`GET /v1/names failed: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as unknown;
  return Array.isArray(body)
    ? (body as Array<Record<string, unknown>>)
    : ((body as { names?: Array<Record<string, unknown>> }).names ?? []);
}

/**
 * Point a stable IPNS label at a CID, creating the name on first use.
 *
 * The label is what stays constant across every republish, so consumers — the
 * MCP, the UI, the downstream CRM — never need to learn a new address when the
 * data changes.
 */
export async function publishIpns(
  label: string,
  cid: string,
): Promise<IpnsName> {
  const existing = await listNames();
  const found = existing.find((n) => n["label"] === label);

  const res = found
    ? await fetch(`${FILEBASE.namesApi}/${encodeURIComponent(label)}`, {
        method: "PUT",
        headers: {
          Authorization: authHeader(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ cid }),
      })
    : await fetch(FILEBASE.namesApi, {
        method: "POST",
        headers: {
          Authorization: authHeader(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ label, cid, enabled: true }),
      });

  if (!res.ok) {
    throw new Error(
      `IPNS ${found ? "update" : "create"} for ${label} failed: ${res.status} ${await res.text()}`,
    );
  }

  const payload = (await res.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  const networkKey =
    (payload["network_key"] as string | undefined) ??
    (found?.["network_key"] as string | undefined);
  if (!networkKey) {
    throw new Error(
      `IPNS response for ${label} carried no network_key; the pointer cannot be resolved.`,
    );
  }
  return { label, networkKey, cid };
}

/**
 * Confirm the gateway actually serves the published bytes.
 *
 * A Parquet file starts with the magic bytes `PAR1`. Range-reading the first
 * four bytes proves three things at once: IPNS resolved, the gateway serves the
 * object, and it supports the HTTP range requests DuckDB relies on to query the
 * file without downloading it.
 */
export async function verifyParquetByCid(cid: string): Promise<{
  url: string;
  magic: string;
  rangeSupported: boolean;
}> {
  const url = cidUrl(cid);
  const res = await fetch(url, { headers: { Range: "bytes=0-3" } });
  if (!res.ok) {
    throw new Error(`Gateway read of ${url} failed: ${res.status}`);
  }
  // Take the first four bytes explicitly. A gateway that ignores the Range
  // header answers 200 with the whole 40 MB object, and comparing the entire
  // body against "PAR1" would fail a perfectly good artifact — reporting a
  // valid Parquet as corrupt. Whether the range was honoured is reported
  // separately rather than being conflated with validity.
  const magic = Buffer.from(await res.arrayBuffer())
    .subarray(0, 4)
    .toString("ascii");
  if (magic !== "PAR1") {
    throw new Error(
      `Published artifact at ${url} does not begin with PAR1 (got ${JSON.stringify(magic)}); it is not a readable Parquet file.`,
    );
  }
  return { url, magic, rangeSupported: res.status === 206 };
}

/** Confirm an uploaded object is retrievable from the gateway. */
export async function headByCid(
  cid: string,
): Promise<{ url: string; ok: boolean; status: number }> {
  const url = cidUrl(cid);
  try {
    const res = await fetch(url, { method: "HEAD" });
    return { url, ok: res.ok, status: res.status };
  } catch {
    return { url, ok: false, status: 0 };
  }
}

/**
 * Resolve the IPNS pointer, retrying while it propagates.
 *
 * A freshly created name is not immediately resolvable at the gateway — the
 * first publish routinely 504s for a few minutes. The content itself is already
 * verified by CID, so a pointer that has not propagated yet is reported as such
 * rather than failing the run.
 */
export async function resolveIpns(
  networkKey: string,
  opts: { attempts?: number; delayMs?: number } = {},
): Promise<{ url: string; resolved: boolean; status: number }> {
  const url = `${FILEBASE.gateway}/ipns/${networkKey}`;
  const attempts = opts.attempts ?? 3;
  const delayMs = opts.delayMs ?? 15_000;
  let status = 0;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { headers: { Range: "bytes=0-3" } });
      status = res.status;
      if (res.ok) {
        const magic = Buffer.from(await res.arrayBuffer())
          .subarray(0, 4)
          .toString("ascii");
        if (magic === "PAR1") return { url, resolved: true, status };
      }
    } catch {
      status = 0;
    }
    if (i < attempts - 1) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  return { url, resolved: false, status };
}

/** Stable address for an IPNS name. */
export function gatewayUrl(networkKey: string): string {
  return `${FILEBASE.gateway}/ipns/${networkKey}`;
}

/** Immutable address for exactly these bytes. */
export function cidUrl(cid: string): string {
  return `${FILEBASE.gateway}/ipfs/${cid}`;
}
