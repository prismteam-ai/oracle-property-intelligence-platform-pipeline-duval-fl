import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { exec, lit, query } from "../warehouse.ts";

const execFileAsync = promisify(execFile);

/**
 * Artifact-level change detection, shared by every file-based source.
 *
 * The ordering here is load-bearing. `probeArtifact` only *reads* the previously
 * ingested fingerprint to decide whether work is needed; the new fingerprint is
 * committed by `commitArtifact` after the load has actually landed. Recording it
 * at probe time would mean a run that detected a new roll and then failed
 * mid-ingest would leave the new ETag stored against data that was never loaded,
 * and every subsequent run would compare equal, skip the source, and report
 * success with zero deltas — the roll silently never arriving.
 */

export interface ArtifactProbe {
  uri: string;
  etag: string | null;
  contentLength: number | null;
  /** True when the upstream fingerprint differs from the last committed load. */
  changed: boolean;
}

export async function probeArtifact(
  uri: string,
  sourceSystem: string,
): Promise<ArtifactProbe> {
  const res = await fetch(uri, { method: "HEAD" });
  if (!res.ok) throw new Error(`HEAD ${uri} failed: ${res.status}`);
  const etag = res.headers.get("etag");
  const len = Number(res.headers.get("content-length") ?? "0") || null;

  const prior = await query<{
    etag: string | null;
    content_length: number | null;
  }>(
    `SELECT etag, content_length FROM source_artifacts WHERE artifact_uri = ${lit(uri)}`,
  );
  const p = prior[0];
  const changed =
    !p ||
    p.etag !== etag ||
    Number(p.content_length ?? -1) !== Number(len ?? -2);

  await exec(`
    INSERT INTO source_artifacts (artifact_uri, source_system, discovered_at)
    VALUES (${lit(uri)}, ${lit(sourceSystem)}, now())
    ON CONFLICT (artifact_uri) DO UPDATE SET discovered_at = now()
  `);

  return { uri, etag, contentLength: len, changed };
}

/** Record the fingerprint of an artifact whose contents are now loaded. */
export async function commitArtifact(
  probe: ArtifactProbe,
  opts: { sha256: string; runId: string },
): Promise<void> {
  await exec(`
    UPDATE source_artifacts SET
      etag = ${probe.etag ? lit(probe.etag) : "NULL"},
      content_length = ${probe.contentLength ?? "NULL"},
      sha256 = ${lit(opts.sha256)},
      downloaded_at = now(),
      first_seen_run_id = COALESCE(first_seen_run_id, ${lit(opts.runId)})
    WHERE artifact_uri = ${lit(probe.uri)}
  `);
}

/**
 * Fetch to `dest`, returning the SHA-256 of the bytes on disk.
 *
 * `force` must be set whenever the caller has detected an upstream change:
 * the cache path is keyed on the logical vintage (roll year, map vintage), not
 * on content, so a republished artifact reuses the same filename. Serving the
 * cached copy in that case would ingest last week's data while stamping this
 * week's fingerprint against it.
 */
export async function download(
  uri: string,
  dest: string,
  opts: { force: boolean },
): Promise<string> {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (opts.force || !fs.existsSync(dest)) {
    const res = await fetch(uri);
    if (!res.ok) throw new Error(`GET ${uri} failed: ${res.status}`);
    fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  }
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(dest))
    .digest("hex");
}

/**
 * Extract with the system `unzip`. Florida DOR archives use compression methods
 * that not every pure-JS reader supports, and a partially-supported reader fails
 * by producing truncated output rather than by erroring.
 */
export async function unzipTo(
  zipPath: string,
  destDir: string,
  opts: { force: boolean },
): Promise<void> {
  if (opts.force && fs.existsSync(destDir)) {
    fs.rmSync(destDir, { recursive: true, force: true });
  }
  fs.mkdirSync(destDir, { recursive: true });
  await execFileAsync("unzip", ["-o", "-q", zipPath, "-d", destDir]);
}

export function filesIn(dir: string, extension: string): string[] {
  return fs
    .readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith(extension))
    .map((f) => path.join(dir, f));
}
