export const config = {
  timeoutMs: 120000,
};

/* =============================================================================
 * Duval County (FL) — Transform v2 handler
 *
 * Reads the legacy Duval County Property Appraiser WebForms detail page
 * (paopropertysearch.coj.net/Basic/Detail.aspx) captured by the Browser Flow v2
 * prepare step, together with the seed parcel and unnormalized address, and
 * writes Lexicon-aligned "County" data-group entities and relationships through
 * the CLI helper APIs (writeJson / writeRelationship).
 *
 * The page is server-rendered ASP.NET WebForms with stable control ids
 * (ctl00_cphBody_*). This handler parses those ids with pure string / RegExp
 * operations and carries no external dependency, so the transform ZIP needs
 * only this single file.
 *
 * The DOR 4-digit property-use classification table below is the authoritative
 * Duval mapping reused from the shipped county transform, verified value-by-value
 * against the live Lexicon `property` schema enums.
 * ========================================================================== */

// --- DOR property-use -> lexicon property classification ---------------------
// Default classification for a code that carries no explicit value. Only
// property_type is asserted (schema-required, non-null); ownership_estate_type
// and build_status stay null so an unmapped code never fabricates estate/build
// facts (build_status is instead derived from the page's heated area below).
const PROPERTY_USE_DEFAULT = {"property_type":"Building","property_usage_type":"Commercial","structure_form":null,"ownership_estate_type":null,"build_status":null};

const PROPERTY_USE_MAPPINGS = {
  "1000": {"property_type":"LandParcel","property_usage_type":"Commercial","build_status":"VacantLand"},
  "1001": {"property_type":"LandParcel","property_usage_type":"Commercial"},
  "1040": {"property_type":"LandParcel","property_usage_type":"Commercial"},
  "1140": {"property_type":"Unit","property_usage_type":"RetailStore","ownership_estate_type":"Condominium"},
  "1191": {"property_type":"Building","property_usage_type":"RetailStore"},
  "1192": {"property_type":"Building","property_usage_type":"RetailStore"},
  "1193": {"property_type":"Building","property_usage_type":"RetailStore"},
  "1194": {"property_type":"Building","property_usage_type":"RetailStore"},
  "1196": {"property_type":"Building","property_usage_type":"RetailStore"},
  "1200": {"property_type":"Building","property_usage_type":"Commercial"},
  "1210": {"property_type":"Building","property_usage_type":"Residential"},
  "1295": {"property_type":"Building","property_usage_type":"Residential"},
  "1391": {"property_type":"Building","property_usage_type":"DepartmentStore"},
  "1392": {"property_type":"Building","property_usage_type":"RetailStore"},
  "1393": {"property_type":"Building","property_usage_type":"DepartmentStore"},
  "1491": {"property_type":"Building","property_usage_type":"Supermarket"},
  "1492": {"property_type":"Building","property_usage_type":"RetailStore"},
  "1493": {"property_type":"Building","property_usage_type":"RetailStore"},
  "1494": {"property_type":"Building","property_usage_type":"RetailStore"},
  "1500": {"property_type":"Building","property_usage_type":"ShoppingCenterRegional"},
  "1642": {"property_type":"Building","property_usage_type":"RetailStore"},
  "1691": {"property_type":"Building","property_usage_type":"ShoppingCenterCommunity"},
  "1692": {"property_type":"Building","property_usage_type":"ShoppingCenterCommunity"},
  "1700": {"property_type":"Building","property_usage_type":"OfficeBuilding"},
  "1740": {"property_type":"Unit","property_usage_type":"OfficeBuilding","ownership_estate_type":"Condominium"},
  "1742": {"property_type":"Building","property_usage_type":"OfficeBuilding"},
  "1800": {"property_type":"Building","property_usage_type":"OfficeBuilding"},
  "1840": {"property_type":"Unit","property_usage_type":"OfficeBuilding","ownership_estate_type":"Condominium"},
  "1910": {"property_type":"Building","property_usage_type":"Commercial"},
  "1940": {"property_type":"Unit","property_usage_type":"MedicalOffice","ownership_estate_type":"Condominium"},
  "1942": {"property_type":"Building","property_usage_type":"MedicalOffice"},
  "1991": {"property_type":"Building","property_usage_type":"MedicalOffice"},
  "2000": {"property_type":"Building","property_usage_type":"TransportationTerminal"},
  "2191": {"property_type":"Building","property_usage_type":"Restaurant"},
  "2192": {"property_type":"Building","property_usage_type":"Restaurant"},
  "2200": {"property_type":"Building","property_usage_type":"Restaurant"},
  "2300": {"property_type":"Building","property_usage_type":"FinancialInstitution"},
  "2591": {"property_type":"Building","property_usage_type":"Commercial"},
  "2592": {"property_type":"Building","property_usage_type":"Commercial"},
  "2691": {"property_type":"Building","property_usage_type":"ServiceStation"},
  "2692": {"property_type":"Building","property_usage_type":"AutoSalesRepair"},
  "2693": {"property_type":"Building","property_usage_type":"AutoSalesRepair"},
  "2694": {"property_type":"Building","property_usage_type":"AutoSalesRepair"},
  "2791": {"property_type":"Building","property_usage_type":"AutoSalesRepair"},
  "2792": {"property_type":"Building","property_usage_type":"AutoSalesRepair"},
  "2794": {"property_type":"Building","property_usage_type":"AutoSalesRepair"},
  "2891": {"property_type":"LandParcel","property_usage_type":"TransportationTerminal"},
  "2892": {"property_type":"Building","property_usage_type":"TransportationTerminal"},
  "2893": {"property_type":"LandParcel","property_usage_type":"MobileHomePark"},
  "2900": {"property_type":"Building","property_usage_type":"WholesaleOutlet"},
  "3000": {"property_type":"Building","property_usage_type":"RetailStore"},
  "3100": {"property_type":"Building","property_usage_type":"Theater"},
  "3200": {"property_type":"Building","property_usage_type":"Theater"},
  "3300": {"property_type":"Building","property_usage_type":"Entertainment"},
  "3400": {"property_type":"Building","property_usage_type":"Entertainment"},
  "3500": {"property_type":"Building","property_usage_type":"Entertainment"},
  "3600": {"property_type":"LandParcel","property_usage_type":"Recreational"},
  "3700": {"property_type":"LandParcel","property_usage_type":"RaceTrack"},
  "3800": {"property_type":"LandParcel","property_usage_type":"GolfCourse"},
  "3940": {"property_type":"Unit","property_usage_type":"Hotel","ownership_estate_type":"Condominium"},
  "3991": {"property_type":"Building","property_usage_type":"Hotel"},
  "3992": {"property_type":"Building","property_usage_type":"Hotel"},
  "3993": {"property_type":"Building","property_usage_type":"Hotel"},
  "3994": {"property_type":"Building","property_usage_type":"Hotel"},
  "3995": {"property_type":"Building","property_usage_type":"Hotel"},
  "4000": {"property_type":"LandParcel","property_usage_type":"Industrial","build_status":"VacantLand"},
  "4001": {"property_type":"LandParcel","property_usage_type":"Industrial"},
  "4040": {"property_type":"LandParcel","property_usage_type":"Industrial"},
  "4100": {"property_type":"Building","property_usage_type":"LightManufacturing"},
  "4200": {"property_type":"Building","property_usage_type":"HeavyManufacturing"},
  "4300": {"property_type":"Building","property_usage_type":"LumberYard"},
  "4400": {"property_type":"Building","property_usage_type":"PackingPlant"},
  "4500": {"property_type":"Building","property_usage_type":"Cannery"},
  "4600": {"property_type":"Building","property_usage_type":"LightManufacturing"},
  "4700": {"property_type":"Building","property_usage_type":"MineralProcessing"},
  "4800": {"property_type":"Building","property_usage_type":"Warehouse"},
  "4840": {"property_type":"Unit","property_usage_type":"Warehouse","ownership_estate_type":"Condominium"},
  "4842": {"property_type":"Building","property_usage_type":"Warehouse"},
  "4891": {"property_type":"Building","property_usage_type":"Warehouse"},
  "4892": {"property_type":"Building","property_usage_type":"Warehouse"},
  "4893": {"property_type":"Building","property_usage_type":"Warehouse"},
  "4894": {"property_type":"Building","property_usage_type":"Warehouse"},
  "4895": {"property_type":"Building","property_usage_type":"Warehouse"},
  "4897": {"property_type":"Building","property_usage_type":"Warehouse"},
  "4898": {"property_type":"Building","property_usage_type":"Utility"},
  "4899": {"property_type":"Building","property_usage_type":"Warehouse"},
  "4900": {"property_type":"LandParcel","property_usage_type":"OpenStorage"},
  "5000": {"property_type":"LandParcel","property_usage_type":"Agricultural"},
  "5100": {"property_type":"LandParcel","property_usage_type":"DrylandCropland","build_status":"VacantLand"},
  "5200": {"property_type":"LandParcel","property_usage_type":"CroplandClass2","build_status":"VacantLand"},
  "5300": {"property_type":"LandParcel","property_usage_type":"CroplandClass3","build_status":"VacantLand"},
  "5400": {"property_type":"LandParcel","property_usage_type":"TimberLand","build_status":"VacantLand"},
  "5500": {"property_type":"LandParcel","property_usage_type":"TimberLand","build_status":"VacantLand"},
  "5600": {"property_type":"LandParcel","property_usage_type":"TimberLand","build_status":"VacantLand"},
  "5700": {"property_type":"LandParcel","property_usage_type":"TimberLand","build_status":"VacantLand"},
  "5800": {"property_type":"LandParcel","property_usage_type":"TimberLand","build_status":"VacantLand"},
  "5900": {"property_type":"LandParcel","property_usage_type":"TimberLand","build_status":"VacantLand"},
  "6000": {"property_type":"LandParcel","property_usage_type":"NativePasture","build_status":"VacantLand"},
  "6100": {"property_type":"LandParcel","property_usage_type":"ImprovedPasture","build_status":"VacantLand"},
  "6200": {"property_type":"LandParcel","property_usage_type":"Rangeland","build_status":"VacantLand"},
  "6300": {"property_type":"LandParcel","property_usage_type":"PastureWithTimber","build_status":"VacantLand"},
  "6400": {"property_type":"LandParcel","property_usage_type":"GrazingLand","build_status":"VacantLand"},
  "6500": {"property_type":"LandParcel","property_usage_type":"GrazingLand","build_status":"VacantLand"},
  "6600": {"property_type":"LandParcel","property_usage_type":"OrchardGroves","build_status":"VacantLand"},
  "6700": {"property_type":"LandParcel","property_usage_type":"Poultry","build_status":"VacantLand"},
  "6800": {"property_type":"LandParcel","property_usage_type":"LivestockFacility","build_status":"VacantLand"},
  "6900": {"property_type":"LandParcel","property_usage_type":"Agricultural"},
  "7000": {"property_type":"LandParcel","property_usage_type":"GovernmentProperty","build_status":"VacantLand"},
  "7100": {"property_type":"Building","property_usage_type":"Church"},
  "7200": {"property_type":"Building","property_usage_type":"PrivateSchool"},
  "7300": {"property_type":"Building","property_usage_type":"PrivateHospital"},
  "7400": {"property_type":"Building","property_usage_type":"HomesForAged"},
  "7500": {"property_type":"Building","property_usage_type":"NonProfitCharity"},
  "7691": {"property_type":"Building","property_usage_type":"MortuaryCemetery"},
  "7692": {"property_type":"LandParcel","property_usage_type":"MortuaryCemetery"},
  "7693": {"property_type":"LandParcel","property_usage_type":"MortuaryCemetery"},
  "7700": {"property_type":"Building","property_usage_type":"ClubsLodges"},
  "7800": {"property_type":"Building","property_usage_type":"SanitariumConvalescentHome"},
  "7900": {"property_type":"Building","property_usage_type":"CulturalOrganization"},
  "8000": {"property_type":"LandParcel","property_usage_type":"GovernmentProperty","build_status":"VacantLand"},
  "8100": {"property_type":"Building","property_usage_type":"Military"},
  "8200": {"property_type":"LandParcel","property_usage_type":"ForestParkRecreation"},
  "8300": {"property_type":"Building","property_usage_type":"PublicSchool"},
  "8400": {"property_type":"Building","property_usage_type":"CulturalOrganization"},
  "8500": {"property_type":"Building","property_usage_type":"PublicHospital"},
  "8600": {"property_type":"Building","property_usage_type":"GovernmentProperty"},
  "8700": {"property_type":"Building","property_usage_type":"GovernmentProperty"},
  "8800": {"property_type":"Building","property_usage_type":"GovernmentProperty"},
  "8900": {"property_type":"Building","property_usage_type":"GovernmentProperty"},
  "9000": {"property_type":"LandParcel","property_usage_type":"Unknown","ownership_estate_type":"Leasehold","build_status":"VacantLand"},
  "9100": {"property_type":"Building","property_usage_type":"Utility"},
  "9200": {"property_type":"LandParcel","property_usage_type":"MineralProcessing"},
  "9300": {"property_type":"LandParcel","property_usage_type":"Unknown","ownership_estate_type":"SubsurfaceRights","build_status":"VacantLand"},
  "9400": {"property_type":"LandParcel","property_usage_type":"TransportationTerminal","ownership_estate_type":"RightOfWay","build_status":"VacantLand"},
  "9500": {"property_type":"LandParcel","property_usage_type":"RiversLakes","build_status":"VacantLand"},
  "9600": {"property_type":"LandParcel","property_usage_type":"TransitionalProperty","build_status":"VacantLand"},
  "9700": {"property_type":"LandParcel","property_usage_type":"ForestParkRecreation"},
  "9800": {"property_type":"Building","property_usage_type":"Utility"},
  "9900": {"property_type":"LandParcel","property_usage_type":"Residential","build_status":"VacantLand"},
  "9999": {"property_type":"LandParcel","property_usage_type":"Unknown","build_status":"VacantLand"},
  "0000": {"property_type":"LandParcel","property_usage_type":"Residential","build_status":"VacantLand"},
  "0041": {"property_type":"Unit","property_usage_type":"Residential","structure_form":"ApartmentUnit","ownership_estate_type":"Condominium","build_status":"VacantLand"},
  "0100": {"property_type":"Building","property_usage_type":"Residential","structure_form":"SingleFamilyDetached"},
  "0200": {"property_type":"ManufacturedHome","property_usage_type":"Residential","structure_form":"ManufacturedHomeOnLand"},
  "0300": {"property_type":"Building","property_usage_type":"Residential","structure_form":"MultiFamilyMoreThan10"},
  "0310": {"property_type":"Building","property_usage_type":"Residential","structure_form":"MultiFamilyMoreThan10"},
  "0400": {"property_type":"Unit","property_usage_type":"Residential","structure_form":"ApartmentUnit","ownership_estate_type":"Condominium"},
  "0500": {"property_type":"Unit","property_usage_type":"Residential","structure_form":"ApartmentUnit","ownership_estate_type":"Cooperative"},
  "0600": {"property_type":"Building","property_usage_type":"HomesForAged"},
  "0691": {"property_type":"Building","property_usage_type":"HomesForAged"},
  "0700": {"property_type":"Building","property_usage_type":"Residential"},
  "0800": {"property_type":"Building","property_usage_type":"Residential","structure_form":"MultiFamilyLessThan10"},
  "0810": {"property_type":"Building","property_usage_type":"Residential","structure_form":"MultiFamilyLessThan10"},
  "0991": {"property_type":"LandParcel","property_usage_type":"ResidentialCommonElementsAreas"},
  "0994": {"property_type":"LandParcel","property_usage_type":"ResidentialCommonElementsAreas"},
  "9700A": {"property_type":"LandParcel","property_usage_type":"ForestParkRecreation"},
  "9700B": {"property_type":"LandParcel","property_usage_type":"ForestParkRecreation"},
  "SERVICECENTER": {"property_type":"Building","property_usage_type":"GovernmentProperty"},
};

// --- Owner-name org tokens (owner emitted as `company` when matched) ----------
const COMPANY_TOKEN_RE =
  /(^|[^A-Z])(LLC|L\.?L\.?C|INC|CORP|CO|COMPANY|LTD|LP|LLP|PA|PLLC|PLC|TRUST|TR|ESTATE|EST|BANK|CHURCH|MINISTR|ASSOC|ASSN|ASSOCIATION|PROPERTIES|PROPERTY|HOLDINGS?|PARTNERS|PARTNERSHIP|ENTERPRISES?|INVESTMENTS?|GROUP|FUND|CITY|COUNTY|STATE|USA|DEVELOPMENT|BUILDERS|HOMES|REALTY|MGMT|MANAGEMENT|SERVICES|FOUNDATION|CLUB|LODGE|SCHOOL|HOSPITAL|AUTHORITY|DISTRICT|CEMETERY|MORTGAGE|CAPITAL|EQUITY|VENTURES?|RENTALS?|LEASING|SYSTEMS)([^A-Z]|$)/i;

// last-token name suffixes -> lexicon person.suffix_name enum
const NAME_SUFFIXES = {
  JR: 'Jr.',
  SR: 'Sr.',
  II: 'II',
  III: 'III',
  IV: 'IV',
};

// Lexicon person name patterns (guard so we never emit an invalid person).
const PERSON_NAME_RE = /^[A-Z][a-z]*([ \-',.][A-Za-z][a-z]*)*$/;
const PERSON_MIDDLE_RE = /^[A-Z][a-zA-Z\s\-',.]*$/;

// --- generic parsing helpers -------------------------------------------------
function decodeEntities(s) {
  return String(s)
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function cleanText(s) {
  if (s == null) return null;
  const out = decodeEntities(String(s).replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
  return out === '' ? null : out;
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Text content of the first element carrying the exact DOM id.
function textById(html, id) {
  const re = new RegExp('id="' + escapeRe(id) + '"[^>]*>([\\s\\S]*?)<\\/', '');
  const m = html.match(re);
  return m ? cleanText(m[1]) : null;
}

// Rows (arrays of cell text) of the <table> carrying the exact DOM id.
function gridById(html, id) {
  const at = html.indexOf('id="' + id + '"');
  if (at < 0) return [];
  const end = html.indexOf('</table>', at);
  const seg = html.slice(at, end < 0 ? undefined : end);
  const rows = [];
  for (const rm of seg.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    // Capture both <td> and <th> so a <th> header is always row 0 and the
    // slice(1) that callers apply never drops a real data row.
    const cells = [...rm[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((c) =>
      cleanText(c[1]),
    );
    if (cells.length) rows.push(cells);
  }
  return rows;
}

function money(s) {
  if (s == null) return null;
  const cleaned = String(s).replace(/[^0-9.\-]/g, '');
  // Empty / non-numeric strings ("", "$", "N/A") must be null, not 0 — a
  // fabricated 0 would write a false value amount and can flip guards.
  if (cleaned === '' || !/\d/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function toInt(s) {
  if (s == null) return null;
  const n = parseInt(String(s).replace(/[^0-9\-]/g, ''), 10);
  return Number.isFinite(n) ? n : null;
}

// M/D/YYYY (Duval sales grid) -> YYYY-MM-DD
function toISODate(s) {
  if (s == null) return null;
  const m = String(s).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const [, mm, dd, yyyy] = m;
  return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
}

// RE# is a 10-digit TEXT identifier; leading zeros are significant.
function normalizeRe(s) {
  if (s == null) return null;
  const digits = String(s).replace(/[^0-9]/g, '');
  if (!digits) return null;
  return digits.length <= 10 ? digits.padStart(10, '0') : digits;
}

function areaString(raw) {
  const n = money(raw);
  return n != null && n >= 10 ? String(Math.round(n)) : null;
}

// DOR use-code -> classification (mirrors the shipped county transform lookup).
function classifyUse(propertyUseText) {
  const merge = (entry) => ({ ...PROPERTY_USE_DEFAULT, ...entry });
  if (!propertyUseText) return merge(null);
  const codeMatch = propertyUseText.match(/^\s*([0-9]{1,4})/);
  const code = codeMatch ? codeMatch[1] : propertyUseText.trim();

  if (Object.prototype.hasOwnProperty.call(PROPERTY_USE_MAPPINGS, code)) {
    return merge(PROPERTY_USE_MAPPINGS[code]);
  }
  if (/^\d+$/.test(code) && code.length < 4) {
    const padded = code.padStart(4, '0');
    if (PROPERTY_USE_MAPPINGS[padded]) return merge(PROPERTY_USE_MAPPINGS[padded]);
  }
  const normalized = propertyUseText.replace(/[^0-9A-Za-z]/g, '').toUpperCase();
  if (normalized && PROPERTY_USE_MAPPINGS[normalized]) {
    return merge(PROPERTY_USE_MAPPINGS[normalized]);
  }
  return merge(null); // default classification keeps property_type valid
}

function titleCaseToken(t) {
  if (!t) return t;
  return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
}

// Best-effort split of "LAST FIRST [MIDDLE] [SUFFIX]" into a schema-valid person.
// Returns null when the value is not confidently a single natural person, so the
// caller can fall back to a `company` entity (which has no name pattern).
function parsePersonName(raw) {
  if (!raw) return null;
  if (raw.includes('&') || /[0-9]/.test(raw)) return null;
  const tokens = raw.trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 2 || tokens.length > 4) return null;

  let suffix = null;
  const lastTok = tokens[tokens.length - 1].replace(/\./g, '').toUpperCase();
  if (NAME_SUFFIXES[lastTok]) {
    suffix = NAME_SUFFIXES[lastTok];
    tokens.pop();
  }
  if (tokens.length < 2) return null;
  if (!tokens.every((t) => /^[A-Za-z]+$/.test(t))) return null;

  const last = titleCaseToken(tokens[0]);
  const first = titleCaseToken(tokens[1]);
  const middle = tokens.length > 2 ? tokens.slice(2).map(titleCaseToken).join(' ') : null;

  if (!PERSON_NAME_RE.test(first) || !PERSON_NAME_RE.test(last)) return null;
  if (middle != null && !PERSON_MIDDLE_RE.test(middle)) return null;

  return { first_name: first, last_name: last, middle_name: middle, suffix_name: suffix };
}

function looksLikeCompany(raw) {
  return !!raw && (raw.includes('&') || COMPANY_TOKEN_RE.test(raw));
}

// --- owner extraction (repeaterOwnerInformation_ctlNN_*) ---------------------
function extractOwners(html) {
  const owners = [];
  const re = /id="ctl00_cphBody_repeaterOwnerInformation_ctl(\d+)_lblOwnerName"/g;
  const seen = new Set();
  let m;
  while ((m = re.exec(html)) !== null) {
    const idx = m[1];
    if (seen.has(idx)) continue;
    seen.add(idx);
    const base = `ctl00_cphBody_repeaterOwnerInformation_ctl${idx}_`;
    const name = textById(html, base + 'lblOwnerName');
    if (!name) continue;
    const mailing = [
      textById(html, base + 'lblMailingAddressLine1'),
      textById(html, base + 'lblMailingAddressLine2'),
      textById(html, base + 'lblMailingAddressLine3'),
    ]
      .filter(Boolean)
      .join(', ');
    owners.push({ name, mailing: mailing || null });
  }
  return owners;
}

// Load the appraiser detail capture, robust to capture naming across prepare
// paths: a v2 browser-flow `captures.json` (any capture name), or a v1 prepared
// ZIP whose capture is `<RE#>.html` / `input.html`. Fails loud when no usable
// capture is found rather than letting the handler emit a hollow property.
async function loadDetailHtml(input, readCapture, seedId) {
  const manifest = Array.isArray(input.captures?.captures)
    ? input.captures.captures
    : [];
  const re = seedId != null ? String(seedId) : null;
  const rePadded = normalizeRe(seedId);
  const candidates = [];
  for (const c of manifest) if (c && c.name) candidates.push(c.name);
  for (const cand of [
    re,
    rePadded,
    re ? `${re}.html` : null,
    rePadded ? `${rePadded}.html` : null,
    'property_detail',
    'input',
    'input.html',
  ]) {
    if (cand) candidates.push(cand);
  }

  const tried = [];
  const seen = new Set();
  for (const name of candidates) {
    if (seen.has(name)) continue;
    seen.add(name);
    tried.push(name);
    try {
      const html = await readCapture(name);
      if (html && html.length > 0) return html;
    } catch {
      // This capture name is not present in this ZIP; try the next candidate.
    }
  }
  throw new Error(
    `Duval transform: no appraiser detail capture found (tried: ${tried.join(', ')})`,
  );
}

// -----------------------------------------------------------------------------
export async function handler({ input, readCapture, writeJson, writeRelationship, logger }) {
  const parcel = input.parcel ?? {};
  const unAddress = input.address ?? {};
  const seedId = input.request_identifier ?? parcel.request_identifier ?? null;

  const html = await loadDetailHtml(input, readCapture, seedId);

  const htmlReNumber = textById(html, 'ctl00_cphBody_lblRealEstateNumber');
  const propertyUseText = textById(html, 'ctl00_cphBody_lblPropertyUse');

  // Fail loud on an empty / blocked capture instead of writing a hollow property.
  // The RE# label is the correctness gate for the leading-zero trap: a stripped
  // RE# returns HTTP 200 with an empty page carrying neither label.
  if (!htmlReNumber && !propertyUseText) {
    throw new Error(
      `Duval transform: appraiser detail capture has no RE# label or property use ` +
        `(request_identifier=${seedId ?? 'unknown'}) — likely an empty or blocked page`,
    );
  }

  const parcelIdentifier = normalizeRe(htmlReNumber) || normalizeRe(seedId) || seedId;

  const cls = classifyUse(propertyUseText);

  // legal description (gridLegal, description column)
  const legalRows = gridById(html, 'ctl00_cphBody_gridLegal')
    .slice(1)
    .map((r) => (r.length >= 2 ? r[1] : null))
    .filter(Boolean);
  const legalDescription = legalRows.length ? legalRows.join('; ') : null;

  // zoning (gridLand)
  let zoning = null;
  for (const r of gridById(html, 'ctl00_cphBody_gridLand').slice(1)) {
    if (r.length >= 10 && r[3]) zoning = r[3];
  }

  const yearBuilt = toInt(
    textById(html, 'ctl00_cphBody_repeaterBuilding_ctl00_lblYearBuilt'),
  );

  // heated area "Total" row from the first building's area grid
  let heatedArea = null;
  for (const r of gridById(
    html,
    'ctl00_cphBody_repeaterBuilding_ctl00_gridBuildingArea',
  ).slice(1)) {
    if (r[0] && r[0].toLowerCase() === 'total' && r.length >= 3) heatedArea = r[2];
  }
  const heatedAreaStr = areaString(heatedArea);

  const subdivision = textById(html, 'ctl00_cphBody_lblSubdivision');
  const totalAreaStr = areaString(textById(html, 'ctl00_cphBody_lblTotalArea1'));

  // build_status: prefer an explicit mapping value; otherwise derive honestly
  // from the page — a positive heated area means Improved, land with no area
  // means VacantLand, anything else stays null (genuinely unknown).
  let buildStatus = cls.build_status ?? null;
  if (buildStatus == null) {
    const heatedNum = money(heatedArea);
    if (heatedNum != null && heatedNum > 0) buildStatus = 'Improved';
    else if (cls.property_type === 'LandParcel') buildStatus = 'VacantLand';
  }

  // ---- property entity ----
  await writeJson('property', {
    parcel_identifier: parcelIdentifier,
    property_type: cls.property_type,
    property_usage_type: cls.property_usage_type ?? null,
    structure_form: cls.structure_form ?? null,
    ownership_estate_type: cls.ownership_estate_type ?? null,
    build_status: buildStatus,
    property_legal_description_text: legalDescription,
    property_structure_built_year: yearBuilt,
    property_effective_built_year: null,
    number_of_units: null,
    number_of_units_type: null,
    livable_floor_area: heatedAreaStr,
    area_under_air: heatedAreaStr,
    subdivision: subdivision ?? null,
    total_area: totalAreaStr,
    zoning: zoning ?? null,
  });

  // ---- situs address entity ----
  const situs =
    unAddress.full_address ||
    unAddress.unnormalized_address ||
    textById(html, 'ctl00_cphBody_lblPrimarySiteAddress') ||
    null;
  await writeJson('address', {
    unnormalized_address: situs,
    county_name: 'Duval',
  });
  await writeRelationship({
    type: 'property_has_address',
    name: 'relationship_property_has_address',
    from: 'property',
    to: 'address',
  });

  // ---- tax entity (certified value summary) ----
  const market = money(textById(html, 'ctl00_cphBody_lblJustMarketValueCertified'));
  const assessed = money(textById(html, 'ctl00_cphBody_lblAssessedValueA10Certified'));
  const building = money(textById(html, 'ctl00_cphBody_lblBuildingValueCertified'));
  const land = money(textById(html, 'ctl00_cphBody_lblLandValueMarketCertified'));
  const taxable = money(textById(html, 'ctl00_cphBody_lblTaxableValueCertified'));
  const exempt = money(textById(html, 'ctl00_cphBody_lblExemptValueCertified'));
  const taxYear = toInt(textById(html, 'ctl00_cphBody_lblHeaderCertified'));

  if (market != null || assessed != null || building != null) {
    const tax = {
      tax_year: taxYear,
      property_building_amount: building,
      monthly_tax_amount: null,
      period_start_date: null,
      period_end_date: null,
    };
    if (market != null) tax.property_market_value_amount = market;
    if (assessed != null) tax.property_assessed_value_amount = assessed;
    if (land != null) tax.property_land_amount = land;
    if (taxable != null) tax.property_taxable_value_amount = taxable;
    if (exempt != null) tax.property_exemption_amount = exempt;
    await writeJson('tax', tax);
    await writeRelationship({
      type: 'property_has_tax',
      name: 'relationship_property_has_tax',
      from: 'property',
      to: 'tax',
    });
  }

  // ---- owner(s): person or company, with mailing address ----
  const owners = extractOwners(html);
  let pIdx = 0;
  let cIdx = 0;
  for (const owner of owners) {
    const person = looksLikeCompany(owner.name) ? null : parsePersonName(owner.name);
    let stem;
    let hasMailingType;
    if (person) {
      pIdx += 1;
      stem = `person_${pIdx}`;
      hasMailingType = 'person_has_mailing_address';
      await writeJson(stem, {
        birth_date: null,
        first_name: person.first_name,
        last_name: person.last_name,
        middle_name: person.middle_name,
        prefix_name: null,
        suffix_name: person.suffix_name,
        us_citizenship_status: null,
        veteran_status: null,
      });
      await writeRelationship({
        type: 'person_has_property',
        name: `relationship_${stem}_has_property`,
        from: stem,
        to: 'property',
      });
    } else {
      cIdx += 1;
      stem = `company_${cIdx}`;
      hasMailingType = 'company_has_mailing_address';
      await writeJson(stem, { name: owner.name });
      await writeRelationship({
        type: 'company_has_property',
        name: `relationship_${stem}_has_property`,
        from: stem,
        to: 'property',
      });
    }

    if (owner.mailing) {
      const mailStem = `${stem}_mailing_address`;
      await writeJson(mailStem, { unnormalized_address: owner.mailing });
      await writeRelationship({
        type: hasMailingType,
        name: `relationship_${mailStem}`,
        from: stem,
        to: mailStem,
      });
    }
  }

  // ---- sales history ----
  const saleRows = gridById(html, 'ctl00_cphBody_gridSalesHistory').slice(1);
  let sIdx = 0;
  for (const r of saleRows) {
    if (r.length < 3) continue;
    const date = toISODate(r[1]);
    const price = money(r[2]);
    if (!date && (price == null || price <= 0)) continue;
    sIdx += 1;
    const stem = `sales_history_${sIdx}`;
    const sale = {
      ownership_transfer_date: date,
      sale_type: 'TypicallyMotivated',
    };
    if (price != null && price > 0) sale.purchase_price_amount = price;
    await writeJson(stem, sale);
    await writeRelationship({
      type: 'property_has_sales_history',
      name: `relationship_property_has_${stem}`,
      from: 'property',
      to: stem,
    });
  }

  if (logger && typeof logger.info === 'function') {
    logger.info(
      `Duval transform: parcel=${parcelIdentifier} use=${propertyUseText ?? 'n/a'} ` +
        `owners=${owners.length} sales=${sIdx}`,
    );
  }
}
