// @ts-check
/**
 * Duval County (City of Jacksonville) permit adapter — JaxEPICS vendor.
 *
 * JaxEPICS (`https://jaxepics.coj.net/`) is the City of Jacksonville's custom
 * Electronic Permitting & Inspection Control System. It is a JavaScript
 * single-page application: the root and every `/Permit/View/<hexId>` route
 * return the *same* ~73 KB HTML shell, and the permit data is loaded by the app
 * over its own JSON/XHR API. It is served from `*.coj.net`, which geo-blocks
 * non-US network egress at the network layer, so this adapter must run from US
 * infrastructure (the oracle-node permit-harvest worker Lambda in us-east-1).
 *
 * This module mirrors the exported surface of the reference Lee County Accela
 * adapter (`workflow/lambdas/permit-harvest-worker/lee-accela.mjs`) so it can be
 * dropped into the same permit-harvest worker with `duval-*` message types. The
 * shape it produces matches the worker's permit-detail contract, so the existing
 * `@elephant-xyz/query-db` permit loader consumes it unchanged.
 *
 * Design choice — capture the app's own JSON, not a hardcoded endpoint. Because
 * JaxEPICS is a SPA whose internal API path is undocumented and can change, the
 * search/detail flow drives the app in a headless browser and intercepts the
 * JSON the app itself fetches (Puppeteer `page.on('response')`). This is robust
 * to endpoint renames and avoids brittle path guessing, while still degrading to
 * DOM extraction from the rendered results when a response is not JSON.
 *
 * Vendor coverage: JaxEPICS covers the City of Jacksonville and unincorporated
 * Duval. The three beach cities (Jacksonville Beach + Neptune Beach on Click2Gov,
 * Atlantic Beach on eTRAKiT) run separate portals and are served by separate
 * adapters (`duval-click2gov.mjs`, `duval-etrakit.mjs`); the Town of Baldwin has
 * no evident online permit portal (documented as offline records).
 */

import crypto from "crypto";

/** JaxEPICS portal base URL (City of Jacksonville, coj.net — US egress required). */
export const DUVAL_PORTAL_URL = "https://jaxepics.coj.net/";

/**
 * Record-number prefixes that classify a JaxEPICS record type. The record number
 * shape is `<TYPE>-<YY>-<NNNNNN>.000` (e.g. `B-23-658574.000`, `L-16-785825.000`).
 * The `TYPE` prefix drives commercial permit eligibility filtering.
 * @type {Record<string, string>}
 */
export const DUVAL_RECORD_TYPE_PREFIXES = {
  B: "Building",
  L: "Land / Site Development",
  M: "Mechanical",
  E: "Electrical",
  P: "Plumbing",
  R: "Roofing",
  D: "Demolition",
  S: "Sign",
  T: "Trade / Tree",
  Z: "Zoning",
};

/**
 * Structured logger fallback used when the worker does not inject one.
 * @typedef {{ info: (msg: string, meta?: object) => void, warn: (msg: string, meta?: object) => void, error: (msg: string, meta?: object) => void }} Logger
 */

/** @type {Logger} */
export const consoleLogger = {
  info: (msg, meta) => console.log(JSON.stringify({ level: "info", msg, ...meta })),
  warn: (msg, meta) => console.warn(JSON.stringify({ level: "warn", msg, ...meta })),
  error: (msg, meta) => console.error(JSON.stringify({ level: "error", msg, ...meta })),
};

/**
 * Normalize an appraiser parcel value (RE#) into the form JaxEPICS searches on.
 * The Duval appraiser RE# is a 10-digit TEXT value with significant leading
 * zeros; JaxEPICS accepts the digits-only RE#. Keep it as TEXT and left-padded —
 * parsing it as an integer drops the leading zero and breaks the join.
 *
 * @param {string} value - Appraiser RE# (e.g. `0000500020`).
 * @returns {string | null} Digits-only 10-char RE#, or null when unusable.
 */
export function normalizeParcelSearchValue(value) {
  const digits = String(value ?? "").replace(/[^0-9]/g, "");
  if (digits.length === 0) return null;
  return digits.length <= 10 ? digits.padStart(10, "0") : digits;
}

/**
 * Convert arbitrary text into a stable, S3-safe path segment.
 * @param {string} value - Raw value.
 * @returns {string} Lowercase S3-safe segment.
 */
export function safeKeyPart(value) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "unknown";
}

/**
 * Short deterministic hash for building stable keys from long values.
 * @param {string} value - Value to hash.
 * @returns {string} First 12 hex chars of SHA-256.
 */
export function shortHash(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 12);
}

/**
 * Collapse whitespace and decode the most common HTML entities.
 * @param {unknown} value - Value to normalize.
 * @returns {string} Normalized single-line text.
 */
export function collapseText(value) {
  return String(value ?? "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Strip tags from an HTML fragment and collapse to readable text.
 * @param {string} html - HTML fragment.
 * @returns {string} Plain text.
 */
export function htmlToText(html) {
  return collapseText(
    String(html ?? "")
      .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\/\s*\1\s*>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  );
}

/**
 * @typedef {object} DuvalRecordNumberParts
 * @property {string} recordNumber - The full record number as displayed.
 * @property {string | null} typePrefix - Leading type letter (e.g. `B`).
 * @property {string | null} typeLabel - Human-readable record type.
 * @property {number | null} year - Four-digit year derived from the `<YY>` field.
 * @property {string | null} sequence - Zero-padded sequence portion.
 */

/**
 * Parse a JaxEPICS record number `<TYPE>-<YY>-<NNNNNN>.000`.
 *
 * @param {string} value - Raw record number.
 * @returns {DuvalRecordNumberParts} Parsed components (fields null when absent).
 */
export function parseJaxEpicsRecordNumber(value) {
  const recordNumber = collapseText(value);
  const m = /^([A-Z])-(\d{2})-(\d{4,7})(?:\.\d+)?$/i.exec(recordNumber);
  if (!m) {
    return { recordNumber, typePrefix: null, typeLabel: null, year: null, sequence: null };
  }
  const typePrefix = m[1].toUpperCase();
  const yy = Number.parseInt(m[2], 10);
  // JaxEPICS record years are 2000-era; two-digit `YY` maps to 20YY.
  const year = Number.isFinite(yy) ? 2000 + yy : null;
  return {
    recordNumber,
    typePrefix,
    typeLabel: DUVAL_RECORD_TYPE_PREFIXES[typePrefix] ?? null,
    year,
    sequence: m[3],
  };
}

/**
 * Decide whether a record type prefix is a commercial/permit-priority record.
 * Building, Land/site, Mechanical, Electrical, Plumbing, Roofing, Demolition and
 * Sign records are retained for commercial-first harvesting; Zoning/Trade are not.
 *
 * @param {string | null} typePrefix - Record type prefix letter.
 * @returns {boolean} True when the record is permit-priority.
 */
export function isPermitPriorityRecordType(typePrefix) {
  if (!typePrefix) return true; // unknown → keep, classify downstream
  return ["B", "L", "M", "E", "P", "R", "D", "S"].includes(typePrefix.toUpperCase());
}

/**
 * @typedef {object} PermitLink
 * @property {string} recordNumber - JaxEPICS record number.
 * @property {string | null} detailId - Opaque hex id used in `/Permit/View/<id>`.
 * @property {string | null} detailUrl - Absolute detail URL when known.
 * @property {string | null} recordType - Record type label.
 * @property {string | null} status - Record status as listed.
 */

/**
 * Read a JaxEPICS permit-list JSON payload (whatever key nesting the app uses)
 * into a normalized set of permit links. Kept generic: it walks the payload for
 * objects that carry a record-number-shaped field, so it survives the app
 * renaming its result envelope.
 *
 * @param {unknown} payload - Parsed JSON from the app's search response.
 * @returns {PermitLink[]} Normalized permit links.
 */
export function extractPermitLinksFromJson(payload) {
  /** @type {PermitLink[]} */
  const links = [];
  const seen = new Set();
  const recordRe = /^[A-Z]-\d{2}-\d{4,7}(?:\.\d+)?$/i;

  /** @param {any} node */
  const visit = (node) => {
    if (node == null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    // A record object is any object exposing a record-number-shaped string.
    const recordNumber = firstStringMatching(node, recordRe);
    if (recordNumber && !seen.has(recordNumber)) {
      seen.add(recordNumber);
      const detailId = firstStringMatching(node, /^[0-9a-f]{6,}$/i, ["id", "hexId", "recordId", "guid"]);
      links.push({
        recordNumber: collapseText(recordNumber),
        detailId: detailId ?? null,
        detailUrl: detailId ? new URL(`/Permit/View/${detailId}`, DUVAL_PORTAL_URL).href : null,
        recordType: readStringField(node, ["recordType", "type", "recordTypeName", "moduleName"]),
        status: readStringField(node, ["status", "recordStatus", "statusName"]),
      });
    }
    for (const value of Object.values(node)) visit(value);
  };
  visit(payload);
  return links;
}

/**
 * Find the first string value in an object matching a pattern, optionally
 * restricted to a set of preferred keys.
 * @param {Record<string, any>} obj - Object to scan.
 * @param {RegExp} pattern - Value pattern.
 * @param {string[]} [preferredKeys] - Preferred keys checked first.
 * @returns {string | null} Matching string or null.
 */
function firstStringMatching(obj, pattern, preferredKeys) {
  if (preferredKeys) {
    for (const key of preferredKeys) {
      const v = obj[key];
      if (typeof v === "string" && pattern.test(v.trim())) return v.trim();
    }
  }
  for (const v of Object.values(obj)) {
    if (typeof v === "string" && pattern.test(v.trim())) return v.trim();
  }
  return null;
}

/**
 * Read the first present string among candidate keys.
 * @param {Record<string, any>} obj - Object.
 * @param {string[]} keys - Candidate keys.
 * @returns {string | null} Value or null.
 */
function readStringField(obj, keys) {
  for (const key of keys) {
    const v = obj[key];
    if (typeof v === "string" && v.trim().length > 0) return collapseText(v);
    if (typeof v === "number") return String(v);
  }
  return null;
}

/**
 * @typedef {object} SearchDuvalPermitParcelParams
 * @property {import("puppeteer").Browser} browser - Shared Chromium browser (from the worker layer).
 * @property {string} parcelIdentifier - Appraiser RE# for the requested parcel.
 * @property {string | null} [bestPermitAddress] - Situs address fallback when RE# search returns nothing.
 * @property {string} [portalUrl] - Override portal URL.
 * @property {number} [maxPages] - Max result pages to page through.
 * @property {Logger} [logger] - Structured logger.
 */

/**
 * @typedef {object} SearchDuvalPermitParcelResult
 * @property {string} searchKey - Stable key for this parcel search.
 * @property {string} normalizedParcelIdentifier - Digits-only RE# searched.
 * @property {PermitLink[]} permits - Permit links found for the parcel.
 * @property {boolean} noResults - True when the portal reported zero permits.
 * @property {Array<{ url: string, json: unknown }>} capturedResponses - Raw JSON responses captured, for provenance.
 */

/**
 * Search JaxEPICS for a parcel's permits by driving the SPA and intercepting the
 * JSON the app fetches. Falls back to the situs address when the RE# search is
 * empty (JaxEPICS does not consistently key permits by RE#; many are addressed).
 *
 * Live-portal note: the exact search-input selector and the app's response
 * envelope are confirmed at runtime from us-east-1 (the portal geo-blocks
 * non-US probing). The interception approach means only the search entry point
 * and the record-number shape — both stable and documented — are relied upon.
 *
 * @param {SearchDuvalPermitParcelParams} params - Search parameters.
 * @returns {Promise<SearchDuvalPermitParcelResult>} Normalized parcel permit links.
 */
export async function searchDuvalPermitParcel({
  browser,
  parcelIdentifier,
  bestPermitAddress = null,
  portalUrl = DUVAL_PORTAL_URL,
  maxPages = 10,
  logger = consoleLogger,
}) {
  const normalizedParcelIdentifier = normalizeParcelSearchValue(parcelIdentifier);
  if (normalizedParcelIdentifier === null) {
    throw new Error(`Invalid Duval parcel identifier: ${parcelIdentifier}`);
  }
  const searchKey = `parcel-${safeKeyPart(normalizedParcelIdentifier)}`;
  const page = await browser.newPage();
  /** @type {Array<{ url: string, json: unknown }>} */
  const capturedResponses = [];
  /** @type {PermitLink[]} */
  const permits = [];
  const seen = new Set();

  // Intercept the app's own JSON responses — this is where the permit list lives.
  page.on("response", async (response) => {
    try {
      const ct = response.headers()["content-type"] || "";
      if (!/json/i.test(ct)) return;
      const json = await response.json();
      capturedResponses.push({ url: response.url(), json });
      for (const link of extractPermitLinksFromJson(json)) {
        if (seen.has(link.recordNumber)) continue;
        seen.add(link.recordNumber);
        permits.push(link);
      }
    } catch {
      // Non-JSON or already-consumed body — ignore; DOM fallback covers it.
    }
  });

  try {
    logger.info("duval_parcel_search_open", { searchKey, normalizedParcelIdentifier });
    await page.goto(portalUrl, { waitUntil: "networkidle2", timeout: 90000 });

    const terms = [normalizedParcelIdentifier];
    if (bestPermitAddress) terms.push(collapseText(bestPermitAddress));

    for (const term of terms) {
      await submitSearch(page, term, logger);
      await pageWaitForResults(page, maxPages, logger);
      if (permits.length > 0) break; // RE# hit; skip the address fallback
    }

    const noResults = permits.length === 0;
    logger.info("duval_parcel_search_done", {
      searchKey,
      permitsFound: permits.length,
      responsesCaptured: capturedResponses.length,
      noResults,
    });
    return { searchKey, normalizedParcelIdentifier, permits, noResults, capturedResponses };
  } finally {
    await page.close().catch(() => {});
  }
}

/**
 * Enter a search term into the JaxEPICS search field and submit. The app exposes
 * a single free-text search box; we type the term and press Enter, then let the
 * response interceptor collect the results. Selector candidates are tried in
 * order so a minor markup change does not break the flow.
 *
 * @param {import("puppeteer").Page} page - Active page.
 * @param {string} term - Search term (RE# or address).
 * @param {Logger} logger - Logger.
 * @returns {Promise<void>}
 */
async function submitSearch(page, term, logger) {
  const selectors = [
    "input[type='search']",
    "input[name*='search' i]",
    "input[placeholder*='search' i]",
    "#searchInput",
  ];
  for (const selector of selectors) {
    const handle = await page.$(selector);
    if (!handle) continue;
    await handle.click({ clickCount: 3 }).catch(() => {});
    await page.type(selector, term, { delay: 15 });
    await page.keyboard.press("Enter");
    logger.info("duval_search_submitted", { selector, termHash: shortHash(term) });
    return;
  }
  logger.warn("duval_search_input_not_found", { termHash: shortHash(term) });
}

/**
 * Wait for the app to render/emit results, paging through if a "next" control is
 * present. Bounded by maxPages so a runaway pager cannot hang the worker.
 *
 * @param {import("puppeteer").Page} page - Active page.
 * @param {number} maxPages - Page bound.
 * @param {Logger} logger - Logger.
 * @returns {Promise<void>}
 */
async function pageWaitForResults(page, maxPages, logger) {
  await page.waitForNetworkIdle({ idleTime: 750, timeout: 30000 }).catch(() => {});
  for (let pageIndex = 1; pageIndex < maxPages; pageIndex += 1) {
    const next = await page.$("a[rel='next'], button[aria-label*='next' i], .pagination-next:not([disabled])");
    if (!next) break;
    await next.click().catch(() => {});
    await page.waitForNetworkIdle({ idleTime: 750, timeout: 30000 }).catch(() => {});
    logger.info("duval_search_page_advanced", { pageIndex: pageIndex + 1 });
  }
}

/**
 * @typedef {object} PermitDetailExtraction
 * @property {string} schemaVersion - Detail schema marker.
 * @property {string} source - Vendor source tag.
 * @property {string} retrievedAt - ISO capture timestamp.
 * @property {string | null} sourceUrl - Detail URL.
 * @property {string | null} recordNumber - Record number.
 * @property {string | null} recordType - Record type label.
 * @property {string | null} recordStatus - Record status.
 * @property {number | null} recordYear - Derived record year.
 * @property {string | null} workLocation - Work location / situs.
 * @property {string | null} parcelIdentifier - Parcel id shown on the record.
 * @property {string | null} applicant - Applicant name (owner PII — kept in payload only).
 * @property {string | null} contractor - Licensed contractor / professional.
 * @property {string | null} projectDescription - Scope of work.
 * @property {string | null} appliedDate - Applied/opened date (ISO when parseable).
 * @property {string | null} issuedDate - Issued date (ISO when parseable).
 * @property {string | null} finaledDate - Final/CO date (ISO when parseable).
 * @property {Array<Record<string, string | null>>} inspections - Inspection rows.
 * @property {Array<Record<string, string | null>>} fees - Fee rows.
 * @property {Record<string, unknown>} raw - Full source payload (nothing dropped).
 */

/**
 * Extract a normalized permit detail from either the app's detail JSON (when the
 * interceptor captured it) or the rendered detail HTML. Everything visible is
 * retained: fields without a lexicon home stay in `raw` (class-(c) policy), so
 * no source data is dropped at capture time.
 *
 * @param {object} params - Extraction inputs.
 * @param {unknown} [params.json] - Captured detail JSON, when available.
 * @param {string} [params.html] - Rendered detail HTML, fallback.
 * @param {string | null} params.sourceUrl - Detail URL.
 * @param {string | null} params.fallbackRecordNumber - Record number from the list.
 * @returns {PermitDetailExtraction} Normalized detail.
 */
export function extractDuvalPermitDetail({ json, html, sourceUrl, fallbackRecordNumber }) {
  /** @type {Record<string, any>} */
  const obj = json && typeof json === "object" ? flattenRecord(json) : {};
  const text = html ? htmlToText(html) : "";

  const recordNumber =
    readStringField(obj, ["recordNumber", "caseNumber", "permitNumber"]) ??
    matchText(text, /Record(?:\s+Number)?[:\s]+([A-Z]-\d{2}-\d{4,7}(?:\.\d+)?)/i) ??
    fallbackRecordNumber ??
    null;
  const parts = parseJaxEpicsRecordNumber(recordNumber ?? "");

  return {
    schemaVersion: "permit-harvest.duval-jaxepics.v1",
    source: "duval-jaxepics",
    retrievedAt: new Date().toISOString(),
    sourceUrl: sourceUrl ?? null,
    recordNumber: parts.recordNumber || recordNumber,
    recordType:
      readStringField(obj, ["recordType", "type", "recordTypeName"]) ?? parts.typeLabel,
    recordStatus: readStringField(obj, ["status", "recordStatus", "statusName"]) ?? matchText(text, /Status[:\s]+([A-Za-z ]+?)(?:\s{2,}|$)/i),
    recordYear: parts.year,
    workLocation:
      readStringField(obj, ["workLocation", "address", "situsAddress", "location"]) ?? matchText(text, /Work Location[:\s]+(.*?)(?:\s{2,}|$)/i),
    parcelIdentifier: readStringField(obj, ["parcelNumber", "parcelId", "reNumber"]),
    applicant: readStringField(obj, ["applicant", "applicantName", "owner"]),
    contractor: readStringField(obj, ["contractor", "licensedProfessional", "contractorName"]),
    projectDescription: readStringField(obj, ["description", "projectDescription", "workDescription", "scope"]),
    appliedDate: toIsoDate(readStringField(obj, ["appliedDate", "openedDate", "applicationDate"])),
    issuedDate: toIsoDate(readStringField(obj, ["issuedDate", "issueDate"])),
    finaledDate: toIsoDate(readStringField(obj, ["finaledDate", "finalDate", "coDate", "completedDate"])),
    inspections: readRowArray(obj, ["inspections", "inspectionList"]),
    fees: readRowArray(obj, ["fees", "feeList"]),
    raw: json && typeof json === "object" ? /** @type {Record<string, unknown>} */ (json) : { html: text },
  };
}

/**
 * Map an extracted Duval permit detail to the query-db permit row contract,
 * linked to the REQUESTED parcel (property-first target), never to whatever
 * parcel the detail happens to display. Child rows (inspections, fees) reference
 * the permit by its stable source_record_key.
 *
 * @param {object} params - Mapping inputs.
 * @param {PermitDetailExtraction} params.detail - Extracted detail.
 * @param {string} params.requestIdentifier - Appraiser RE# of the requested parcel.
 * @param {string} params.sourceSystem - Neon `source_system` (e.g. `duval_jaxepics`).
 * @param {string | null} params.artifactUri - S3 URI of the extracted permit JSON.
 * @returns {{ permit: Record<string, unknown>, inspections: Array<Record<string, unknown>>, fees: Array<Record<string, unknown>> }}
 */
export function mapDuvalPermitDetail({ detail, requestIdentifier, sourceSystem, artifactUri }) {
  const permitNumber = detail.recordNumber ?? "";
  const sourceRecordKey = `${sourceSystem}:${requestIdentifier}:permit:${safeKeyPart(permitNumber)}`;
  const permit = compact({
    source_system: sourceSystem,
    source_record_key: sourceRecordKey,
    // Property-first linkage: bind to the REQUESTED parcel's folio explicitly.
    request_identifier: requestIdentifier,
    permit_number: permitNumber || null,
    permit_type: detail.recordType,
    permit_status: detail.recordStatus,
    permit_year: detail.recordYear,
    work_description: detail.projectDescription,
    work_location: detail.workLocation,
    contractor_name: detail.contractor,
    applied_date: detail.appliedDate,
    issued_date: detail.issuedDate,
    finaled_date: detail.finaledDate,
    source_url: detail.sourceUrl,
    source_artifact_uri: artifactUri,
    source_payload: detail.raw,
  });
  const inspections = detail.inspections.map((row, index) =>
    compact({
      source_system: sourceSystem,
      permit_source_record_key: sourceRecordKey,
      source_record_key: `${sourceRecordKey}:inspection:${index}`,
      inspection_type: row.type ?? row.inspectionType ?? null,
      inspection_status: row.status ?? row.result ?? null,
      inspection_date: toIsoDate(row.date ?? row.completedDate ?? null),
      source_payload: row,
    }),
  );
  const fees = detail.fees.map((row, index) =>
    compact({
      source_system: sourceSystem,
      permit_source_record_key: sourceRecordKey,
      source_record_key: `${sourceRecordKey}:fee:${index}`,
      fee_type: row.type ?? row.feeType ?? null,
      fee_amount: row.amount ?? row.total ?? null,
      source_payload: row,
    }),
  );
  return { permit, inspections, fees };
}

/**
 * Build the deterministic S3 stem for a captured permit, so re-runs overwrite the
 * same object instead of duplicating (resume-safe).
 *
 * @param {object} params - Key inputs.
 * @param {string} params.requestIdentifier - Requested parcel RE#.
 * @param {string} params.recordNumber - Permit record number.
 * @returns {string} S3 key stem (no extension).
 */
export function buildPermitOutputStem({ requestIdentifier, recordNumber }) {
  return `${safeKeyPart(requestIdentifier)}/${safeKeyPart(recordNumber)}-${shortHash(recordNumber)}`;
}

// --- small helpers ----------------------------------------------------------

/**
 * Flatten one level of common wrapper envelopes (`{ data: {...} }`, `{ result: {...} }`).
 * @param {any} json - Parsed JSON.
 * @returns {Record<string, any>} Flattened record.
 */
function flattenRecord(json) {
  let node = json;
  for (const key of ["data", "result", "record", "permit", "payload"]) {
    if (node && typeof node === "object" && !Array.isArray(node) && node[key] && typeof node[key] === "object") {
      node = node[key];
    }
  }
  return node && typeof node === "object" && !Array.isArray(node) ? node : {};
}

/**
 * Read an array of row objects from the first present candidate key.
 * @param {Record<string, any>} obj - Object.
 * @param {string[]} keys - Candidate keys.
 * @returns {Array<Record<string, any>>} Rows (empty when absent).
 */
function readRowArray(obj, keys) {
  for (const key of keys) {
    if (Array.isArray(obj[key])) return obj[key].filter((r) => r && typeof r === "object");
  }
  return [];
}

/**
 * Match the first capture group of a pattern against text.
 * @param {string} text - Source text.
 * @param {RegExp} pattern - Pattern with one capture group.
 * @returns {string | null} Trimmed capture or null.
 */
function matchText(text, pattern) {
  const m = pattern.exec(text || "");
  return m && m[1] ? collapseText(m[1]) : null;
}

/**
 * Best-effort date normalization to ISO `YYYY-MM-DD`.
 * @param {string | null | undefined} value - Raw date.
 * @returns {string | null} ISO date or null.
 */
function toIsoDate(value) {
  if (!value) return null;
  const s = collapseText(value);
  const mdy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (mdy) return `${mdy[3]}-${mdy[1].padStart(2, "0")}-${mdy[2].padStart(2, "0")}`;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const parsed = Date.parse(s);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString().slice(0, 10);
}

/**
 * Drop null/undefined/empty-string entries so idempotent merges do not overwrite
 * existing values with blanks.
 * @param {Record<string, unknown>} obj - Object.
 * @returns {Record<string, unknown>} Compacted object.
 */
function compact(obj) {
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined || v === "") continue;
    out[k] = v;
  }
  return out;
}
