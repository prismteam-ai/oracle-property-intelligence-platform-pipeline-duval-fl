/**
 * Build the Duval County parcel seed CSV from the FDOR Final NAL roll and stage it to an S3 seeds bucket.
 *
 * Pipeline: download the per-county FDOR NAL Final roll (identified by county NAME), expand it,
 * derive the appraiser RE# from PARCEL_ID (strip the trailing "R", keep it as TEXT with leading
 * zeros), validate every key against ^\d{10}R$, de-duplicate, order commercial/industrial-eligible
 * first, emit the seed CSV, then stage it (server-side encrypted) to the configured seeds bucket.
 *
 * All environment specifics are parameterized. Set at minimum SEEDS_BUCKET. Example:
 *   SEEDS_BUCKET=my-county-seeds AWS_REGION=us-east-1 npx tsx scripts/build-duval-seed.ts
 * Use DRY_RUN=1 to build and validate locally without uploading.
 *
 * Requires: Node 22+, and the `unzip` and `aws` CLIs on PATH (aws credentials configured out-of-band).
 */
import { execFileSync } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtempSync, mkdirSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { createInterface } from "node:readline";
import { once } from "node:events";

// --- parameters (override via env) ---
const COUNTY_NAME = process.env.COUNTY_NAME ?? "Duval"; // jurisdiction name written to the seed (no "County" suffix)
const DOR_COUNTY_NUM = process.env.DOR_COUNTY_NUM ?? "26"; // FDOR standard county code in the NAL file name (Duval = 26)
const ROLL_YEAR = process.env.ROLL_YEAR ?? "2025"; // NAL roll year
const SEEDS_BUCKET = process.env.SEEDS_BUCKET ?? "CHANGE_ME_seeds_bucket"; // target S3 bucket (REQUIRED; no real default)
const OUTPUT_KEY = process.env.OUTPUT_KEY ?? `${COUNTY_NAME.toLowerCase()}.csv`; // object key, e.g. duval.csv
const APPRAISER_DETAIL_URL =
  process.env.APPRAISER_DETAIL_URL ?? "https://paopropertysearch.coj.net/Basic/Detail.aspx"; // per-parcel GET target
const FDOR_BASE =
  process.env.FDOR_BASE ??
  "https://floridarevenue.com/property/dataportal/Documents/PTO%20Data%20Portal/Tax%20Roll%20Data%20Files/NAL";
const WORKDIR = process.env.WORKDIR ?? mkdtempSync(join(tmpdir(), "duval-seed-"));
mkdirSync(WORKDIR, { recursive: true });
const OUTPUT_CSV = process.env.OUTPUT_CSV ?? join(WORKDIR, OUTPUT_KEY);
const AWS_REGION = process.env.AWS_REGION ?? "us-east-1";
const DRY_RUN = process.env.DRY_RUN === "1";

if (SEEDS_BUCKET === "CHANGE_ME_seeds_bucket" && !DRY_RUN) {
  console.error("ERROR: set SEEDS_BUCKET to your own S3 seeds bucket (or run with DRY_RUN=1).");
  process.exit(2);
}

const RE_PATTERN = /^(\d{10})R$/; // NAL PARCEL_ID = <10 digits> + real-property "R" suffix
const SEED_COLUMNS = [
  "parcel_id",
  "source_identifier",
  "county",
  "method",
  "url",
  "multiValueQueryString",
  "address",
  "dor_uc",
] as const;

/** Parse one CSV line honoring double-quoted fields (RFC-4180 style, incl. escaped ""). */
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { out.push(field); field = ""; }
    else field += c;
  }
  out.push(field);
  return out;
}

/** Build the situs (property) address from the NAL physical-address columns. */
function fullAddress(row: Record<string, string>): string {
  const street = [row.PHY_ADDR1?.trim(), row.PHY_ADDR2?.trim()].filter(Boolean).join(" ");
  const city = row.PHY_CITY?.trim() ?? "";
  let zip = row.PHY_ZIPCD?.trim() ?? "";
  if (zip.length > 5 && /^\d+$/.test(zip)) zip = zip.slice(0, 5);
  const tail = (zip ? `FL ${zip}` : "FL").trim();
  const csz = [city, tail].filter(Boolean).join(", ");
  return street ? `${street}, ${csz}` : csz;
}

/** Commercial/industrial DOR use codes (10–49) → scrape first. */
function eligible(uc: string | undefined): boolean {
  const v = (uc ?? "").trim();
  return /^\d+$/.test(v) && Number(v) >= 10 && Number(v) <= 49;
}

/** Serialize one CSV row, quoting only where required. */
function toCsvRow(fields: string[]): string {
  return fields
    .map((f) => (/[",\n]/.test(f) ? `"${f.replace(/"/g, '""')}"` : f))
    .join(",");
}

async function main(): Promise<void> {
  // --- 1. download the Final NAL roll for the county, identified by NAME ---
  // FDOR file naming: "<County> <DorNum> Final NAL <Year>.zip" under the "<Year>F" (Final) directory.
  const nalFile = `${COUNTY_NAME} ${DOR_COUNTY_NUM} Final NAL ${ROLL_YEAR}.zip`;
  const nalUrl = `${FDOR_BASE}/${ROLL_YEAR}F/${encodeURIComponent(nalFile)}`;
  const zipPath = join(WORKDIR, "nal.zip");
  console.log(`Downloading: ${nalFile}`);
  const res = await fetch(nalUrl, { signal: AbortSignal.timeout(600_000) });
  if (!res.ok || !res.body) {
    console.error(`ERROR: FDOR NAL download returned HTTP ${res.status} for '${nalFile}'.`);
    console.error("       Verify the county name and DOR county number for the target year.");
    process.exit(3);
  }
  const zipOut = createWriteStream(zipPath);
  // @ts-expect-error Node's Web ReadableStream is async-iterable at runtime
  for await (const chunk of res.body) zipOut.write(chunk);
  zipOut.end();
  await once(zipOut, "finish");

  // --- 2. expand and locate the roll CSV ---
  execFileSync("unzip", ["-o", "-q", zipPath, "-d", WORKDIR], { stdio: "inherit" });
  const outBase = basename(OUTPUT_CSV);
  const nalCsv = readdirSync(WORKDIR)
    .filter((n) => n.toLowerCase().endsWith(".csv") && n !== outBase)
    .map((n) => join(WORKDIR, n))[0];
  if (!nalCsv) { console.error("ERROR: no roll CSV found in the NAL archive."); process.exit(4); }
  console.log(`Roll file: ${basename(nalCsv)}`);

  // --- 3. parse -> RE# (TEXT, leading zeros), validate, dedup, order, write seed CSV ---
  const rl = createInterface({ input: createReadStream(nalCsv), crlfDelay: Infinity });
  let header: string[] | null = null;
  const seen = new Set<string>();
  const elig: string[][] = [];
  const rest: string[][] = [];
  let total = 0, malformed = 0, dups = 0, leadzero = 0;

  for await (const line of rl) {
    if (header === null) { header = parseCsvLine(line); continue; }
    if (line === "") continue;
    total++;
    const cells = parseCsvLine(line);
    const row: Record<string, string> = {};
    header.forEach((h, i) => (row[h] = cells[i] ?? ""));
    const m = (row.PARCEL_ID ?? "").trim().match(RE_PATTERN);
    if (!m) { malformed++; continue; }
    const reNum = m[1];
    if (seen.has(reNum)) { dups++; continue; }
    seen.add(reNum);
    if (reNum.startsWith("0")) leadzero++;
    const out = [
      reNum, reNum, COUNTY_NAME, "GET", APPRAISER_DETAIL_URL,
      JSON.stringify({ RE: [reNum] }), fullAddress(row), (row.DOR_UC ?? "").trim(),
    ];
    (eligible(row.DOR_UC) ? elig : rest).push(out);
  }

  const seedOut = createWriteStream(OUTPUT_CSV);
  seedOut.write(toCsvRow([...SEED_COLUMNS]) + "\n");
  for (const r of elig) seedOut.write(toCsvRow(r) + "\n");
  for (const r of rest) seedOut.write(toCsvRow(r) + "\n");
  seedOut.end();
  await once(seedOut, "finish");

  const written = elig.length + rest.length;
  console.log(`source rows:            ${total}`);
  console.log(`malformed PARCEL_ID:    ${malformed}`);
  console.log(`duplicate RE#:          ${dups}`);
  console.log(`written rows:           ${written} (commercial/industrial-first: ${elig.length}, rest: ${rest.length})`);
  const pct = written ? ((leadzero / written) * 100).toFixed(1) : "0.0";
  console.log(`leading-zero RE#:       ${leadzero} (${pct}% -- why RE# MUST be TEXT)`);
  if (malformed || dups) {
    console.error("ERROR: malformed or duplicate keys present; refusing to proceed.");
    process.exit(5);
  }

  // --- 4. stage to the seeds bucket (server-side encrypted) ---
  // NOTE: before a full ingestion run, assert sample appraiser lookups return non-empty for real
  // RE#s from US egress (leading-zero-trap gate); a wrong-width id returns a silent empty page.
  if (DRY_RUN) {
    console.log(`DRY_RUN=1 -> skipping S3 upload. Would stage to s3://${SEEDS_BUCKET}/${OUTPUT_KEY}`);
  } else {
    execFileSync(
      "aws",
      ["s3", "cp", OUTPUT_CSV, `s3://${SEEDS_BUCKET}/${OUTPUT_KEY}`, "--sse", "AES256", "--only-show-errors"],
      { stdio: "inherit", env: { ...process.env, AWS_REGION } },
    );
    console.log(`Staged: s3://${SEEDS_BUCKET}/${OUTPUT_KEY}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
