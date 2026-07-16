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

// --- required-field skeletons (all these schemas are additionalProperties:false,
// so every required key must be present and no undefined key may be added) -------
const STRUCTURE_FIELDS = ['architectural_style_type','attachment_type','exterior_wall_material_primary','exterior_wall_material_secondary','exterior_wall_condition','exterior_wall_insulation_type','flooring_material_primary','flooring_material_secondary','subfloor_material','flooring_condition','interior_wall_structure_material','interior_wall_surface_material_primary','interior_wall_surface_material_secondary','interior_wall_finish_primary','interior_wall_finish_secondary','interior_wall_condition','roof_covering_material','roof_underlayment_type','roof_structure_material','roof_design_type','roof_condition','roof_age_years','gutters_material','gutters_condition','roof_material_type','foundation_type','foundation_material','foundation_waterproofing','foundation_condition','ceiling_structure_material','ceiling_surface_material','ceiling_insulation_type','ceiling_height_average','ceiling_condition','exterior_door_material','interior_door_material','window_frame_material','window_glazing_type','window_operation_type','window_screen_material','primary_framing_material','secondary_framing_material','structural_damage_indicators'];
const UTILITY_FIELDS = ['cooling_system_type','heating_system_type','public_utility_type','sewer_type','water_source_type','plumbing_system_type','plumbing_system_type_other_description','electrical_panel_capacity','electrical_wiring_type','hvac_condensing_unit_present','electrical_wiring_type_other_description','solar_panel_type','solar_panel_type_other_description','smart_home_features','smart_home_features_other_description','hvac_unit_condition','hvac_unit_issues'];
const LAYOUT_FIELDS = ['space_type','space_type_index','flooring_material_type','size_square_feet','has_windows','window_design_type','window_material_type','window_treatment_type','is_finished','furnished','paint_condition','flooring_wear','clutter_level','visible_damage','countertop_material','cabinet_style','fixture_finish_quality','design_style','natural_light_quality','decor_elements','pool_type','pool_equipment','spa_type','safety_features','view_type','lighting_features','condition_issues','is_exterior','pool_condition','pool_surface_type','pool_water_quality'];
const LOT_FIELDS = ['lot_type','lot_length_feet','lot_width_feet','lot_area_sqft','landscaping_features','view','fencing_type','fence_height','fence_length','driveway_material','driveway_condition','lot_condition_issues'];
const PROPERTY_IMPROVEMENT_FIELDS = ['improvement_type','improvement_status','completion_date','contractor_type'];

function nullSkeleton(fields) {
  const o = {};
  for (const f of fields) o[f] = null;
  return o;
}

// --- building-element -> structure enums (ported from the shipped Duval
// structureMapping.js regex logic; returns null when nothing matches) -----------
function mapExteriorWall(d) {
  if (!d) return null;
  const u = d.toUpperCase();
  if (/VINYL/.test(u)) return 'Vinyl Siding';
  if (/ALUM/.test(u)) return 'Metal Siding';
  if (/BRICK/.test(u)) return 'Brick';
  if (/STUCCO/.test(u)) return 'Stucco';
  if (/CONCRETE\s*BLK|C\.?B\.?/i.test(d)) return 'Concrete Block';
  if (/FIBER|HARDI|LAP/.test(u)) return 'Fiber Cement Siding';
  if (/CEDAR|REDWOOD|WOOD|VERTICAL SHEET|HORIZONTAL LAP/.test(u)) return 'Wood Siding';
  if (/STONE/.test(u)) return 'Manufactured Stone';
  return null;
}
function mapRoofDesign(d) {
  if (!d) return null;
  const u = d.toUpperCase();
  if (/GABLE/.test(u) && /HIP/.test(u)) return 'Combination';
  if (/GABLE/.test(u)) return 'Gable';
  if (/HIP/.test(u)) return 'Hip';
  if (/FLAT/.test(u)) return 'Flat';
  if (/SHED/.test(u)) return 'Shed';
  if (/MANSARD/.test(u)) return 'Mansard';
  if (/GAMBREL/.test(u)) return 'Gambrel';
  return null;
}
function mapRoofCovering(d) {
  if (!d) return null;
  const u = d.toUpperCase();
  if (/ASPH|COMP|SHNG/.test(u)) return 'Architectural Asphalt Shingle';
  if (/BUILT\s*UP|BUILT-UP|T&G/.test(u)) return 'Built-Up Roof';
  if (/METAL/.test(u)) return 'Metal Standing Seam';
  if (/CLAY TILE/.test(u)) return 'Clay Tile';
  if (/CONC(?:RETE)?\s*TILE/.test(u)) return 'Concrete Tile';
  return null;
}
function mapRoofStructure(d) {
  if (!d) return null;
  const u = d.toUpperCase();
  if (/WOOD\s*TRUSS/.test(u)) return 'Wood Truss';
  if (/WOOD\s*RAFTER/.test(u)) return 'Wood Rafter';
  if (/REINF|CONC/.test(u)) return 'Concrete Beam';
  if (/RIGID|BAR\s*J|STEEL/.test(u)) return 'Steel Truss';
  if (/ENGINEERED/.test(u)) return 'Engineered Lumber';
  return null;
}
function mapInteriorWallSurface(d) {
  if (!d) return null;
  const u = d.toUpperCase();
  if (/DRYWALL/.test(u)) return 'Drywall';
  if (/PLASTER/.test(u)) return 'Plaster';
  if (/MASONRY|BLOCK/.test(u)) return 'Exposed Block';
  if (/BRICK/.test(u)) return 'Exposed Brick';
  if (/WOOD/.test(u)) return 'Wood Paneling';
  if (/TILE|DECOR/.test(u)) return 'Tile';
  return null;
}
function mapFlooringPrimary(details) {
  const set = [];
  const add = (v) => { if (!set.includes(v)) set.push(v); };
  for (const d of details) {
    if (!d) continue;
    const u = d.toUpperCase();
    if (/NONE/.test(u)) continue;
    if (/CARPET/.test(u)) add('Carpet');
    if (/HARDWOOD|PARQUET/.test(u)) add('Solid Hardwood');
    if (/VINYL|VNYL|ASPHALT/.test(u)) add('Sheet Vinyl');
    if (/CORK/.test(u)) add('Cork');
    if (/PORCELAIN/.test(u)) add('Porcelain Tile');
    if (/CER|TILE/.test(u)) add('Ceramic Tile');
    if (/STONE|MARBLE/.test(u)) add('Natural Stone Tile');
    if (/LAMINATE/.test(u)) add('Laminate');
    if (/CONCRETE/.test(u)) add('Polished Concrete');
    if (/LINOL/.test(u)) add('Linoleum');
    if (/TERRAZZO/.test(u)) add('Terrazzo');
  }
  return set[0] ?? null;
}

// --- building-element -> utility enums (ported from utilityMapping.js) ----------
function mapHeatingSystem(t) {
  if (!t) return null;
  if (/none/i.test(t)) return null;
  if (/forced/i.test(t) && /duct/i.test(t)) return 'Central';
  if (/heat\s*pump/i.test(t)) return 'HeatPump';
  if (/radiant/i.test(t)) return 'Radiant';
  if (/baseboard/i.test(t)) return 'Baseboard';
  if (/electric/i.test(t)) return 'Electric';
  if (/gas/i.test(t)) return 'Gas';
  return null;
}
function mapHeatingFuel(f) {
  if (!f) return null;
  if (/electric/i.test(f)) return 'Electric';
  if (/gas/i.test(f)) return 'NaturalGas';
  if (/propane/i.test(f)) return 'Propane';
  if (/oil/i.test(f)) return 'Oil';
  if (/kerosene/i.test(f)) return 'Kerosene';
  if (/solar/i.test(f)) return 'Solar';
  return null;
}
function mapCooling(ac) {
  if (!ac) return null;
  if (/none/i.test(ac)) return null;
  if (/central|pack|forced/i.test(ac)) return 'CentralAir';
  if (/wall|window/i.test(ac)) return 'WindowAirConditioner';
  if (/ductless|mini\s*split/i.test(ac)) return 'Ductless';
  return null;
}

// --- sales-grid instrument -> lexicon deed_type -------------------------------
function mapDeedType(s) {
  if (!s) return null;
  const u = s.toUpperCase();
  if (/SPECIAL\s*WARRANTY|\bSW\b/.test(u)) return 'Special Warranty Deed';
  if (/WARRANTY|\bWD\b/.test(u)) return 'Warranty Deed';
  if (/QUIT\s*CLAIM|QUITCLAIM|\bQC\b/.test(u)) return 'Quitclaim Deed';
  if (/TAX\s*DEED|\bTX\b/.test(u)) return 'Tax Deed';
  if (/PERSONAL\s*REP|\bPR\b/.test(u)) return 'Personal Representative Deed';
  if (/TRUSTEE|\bTR\b/.test(u)) return "Trustee's Deed";
  if (/GUARDIAN/.test(u)) return "Guardian's Deed";
  if (/CORRECT/.test(u)) return 'Correction Deed';
  if (/CONTRACT/.test(u)) return 'Contract for Deed';
  if (/COURT\s*ORDER/.test(u)) return 'Court Order Deed';
  return 'Miscellaneous';
}

// --- taxing-district name -> tax_jurisdiction.jurisdiction_type ---------------
function mapJurisdictionType(name) {
  if (!name) return null;
  const u = name.toUpperCase();
  if (/SCHOOL/.test(u)) return 'School Board';
  if (/WATER\s*MGMT|WATER\s*MANAGEMENT|WMD|SJRWMD/.test(u)) return 'Water District';
  if (/FIRE/.test(u)) return 'Fire District';
  if (/LIBRARY/.test(u)) return 'Library District';
  if (/COUNTY|GEN\s*GOVT|GENERAL\s*GOV/.test(u)) return 'County';
  if (/NAVIGATION|INLAND|URBAN\s*SERVICE|SERVICE\s*DIST|MGMT\s*DIST|SPECIAL/.test(u)) return 'Special District';
  if (/CITY|TOWN|MUNICIP|BALDWIN|JACKSONVILLE\s*BEACH|ATLANTIC\s*BEACH|NEPTUNE/.test(u)) return 'Municipal';
  return null;
}

// --- extra-feature description -> property_improvement.improvement_type -------
function mapImprovementType(desc) {
  if (!desc) return null;
  const u = desc.toUpperCase();
  if (/POOL|SPA/.test(u)) return 'PoolSpaInstallation';
  if (/FENCE|FENCING/.test(u)) return 'Fencing';
  if (/DOCK|BOAT|SEAWALL|SHORE/.test(u)) return 'DockAndShore';
  if (/SCREEN/.test(u)) return 'ScreenEnclosure';
  if (/GARAGE|CARPORT|SHED|UTIL|BARN|CANOPY|STORAGE|BLDG|BUILDING/.test(u)) return 'GeneralBuilding';
  return null;
}

// Rows of a specific building's element/attribute grid (header row dropped).
function buildingGrid(html, idx, grid) {
  return gridById(html, `ctl00_cphBody_repeaterBuilding_ctl${idx}_${grid}`).slice(1);
}
// Detail (col 2) values of element rows whose label matches `name`.
function elementDetails(rows, name) {
  return rows
    .filter((r) => r[0] && r[0].toLowerCase() === name.toLowerCase())
    .map((r) => r[2] || r[1] || '')
    .filter(Boolean);
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

  // ---- sales history (+ deed per sale) ----
  // The grid is newest-first, so sales_history_1 is the most recent transfer;
  // current owners are linked to it (below).
  const saleRows = gridById(html, 'ctl00_cphBody_gridSalesHistory').slice(1);
  let sIdx = 0;
  let latestSaleStem = null;
  for (const r of saleRows) {
    if (r.length < 3) continue;
    const date = toISODate(r[1]);
    const price = money(r[2]);
    if (!date && (price == null || price <= 0)) continue;
    sIdx += 1;
    const stem = `sales_history_${sIdx}`;
    if (!latestSaleStem) latestSaleStem = stem;
    const sale = { ownership_transfer_date: date, sale_type: 'TypicallyMotivated' };
    if (price != null && price > 0) sale.purchase_price_amount = price;
    await writeJson(stem, sale);
    await writeRelationship({
      type: 'property_has_sales_history',
      name: `relationship_property_has_${stem}`,
      from: 'property',
      to: stem,
    });

    // deed carrying book/page + instrument type
    const bookPage = r[0] ? String(r[0]).split('-') : [];
    const deedType = mapDeedType(r.length >= 4 ? r[3] : null);
    if ((bookPage[0] && bookPage[1]) || deedType) {
      const deedStem = `deed_${sIdx}`;
      const deed = {};
      if (bookPage[0] && bookPage[1]) {
        deed.book = bookPage[0].trim();
        deed.page = bookPage[1].trim();
      }
      if (deedType) deed.deed_type = deedType;
      await writeJson(deedStem, deed);
      await writeRelationship({
        type: 'sales_history_has_deed',
        name: `relationship_${stem}_has_${deedStem}`,
        from: stem,
        to: deedStem,
      });
    }
  }

  // ---- owner(s): person or company, with mailing address ----
  // Ownership is modeled through the latest sale (sales_history_has_person /
  // sales_history_has_company) — the non-deprecated County relationships —
  // rather than the deprecated person_has_property / company_has_property.
  const owners = extractOwners(html);
  let pIdx = 0;
  let cIdx = 0;
  for (const owner of owners) {
    const person = looksLikeCompany(owner.name) ? null : parsePersonName(owner.name);
    let stem;
    let mailingType;
    let saleLinkType;
    if (person) {
      pIdx += 1;
      stem = `person_${pIdx}`;
      mailingType = 'person_has_mailing_address';
      saleLinkType = 'sales_history_has_person';
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
    } else {
      cIdx += 1;
      stem = `company_${cIdx}`;
      mailingType = 'company_has_mailing_address';
      saleLinkType = 'sales_history_has_company';
      await writeJson(stem, { name: owner.name });
    }

    if (latestSaleStem) {
      await writeRelationship({
        type: saleLinkType,
        name: `relationship_${latestSaleStem}_has_${stem}`,
        from: latestSaleStem,
        to: stem,
      });
    }

    if (owner.mailing) {
      const mailStem = `${stem}_mailing_address`;
      await writeJson(mailStem, { unnormalized_address: owner.mailing });
      await writeRelationship({
        type: mailingType,
        name: `relationship_${mailStem}`,
        from: stem,
        to: mailStem,
      });
    }
  }

  // ---- per-building structure + utility (single relationships; first building) ----
  const buildingIndices = [
    ...new Set(
      [...html.matchAll(/repeaterBuilding_ctl(\d+)_gridBuildingElements/g)].map((m) => m[1]),
    ),
  ];
  const firstBuilding = buildingIndices[0] ?? null;
  const elementRows =
    firstBuilding != null ? buildingGrid(html, firstBuilding, 'gridBuildingElements') : [];
  const attributeRows =
    firstBuilding != null ? buildingGrid(html, firstBuilding, 'gridBuildingAttributes') : [];

  if (elementRows.length) {
    const roofStruct = elementDetails(elementRows, 'Roof Struct')[0] || null;
    const roofCover = elementDetails(elementRows, 'Roofing Cover')[0] || null;
    const st = nullSkeleton(STRUCTURE_FIELDS);
    st.exterior_wall_material_primary = mapExteriorWall(elementDetails(elementRows, 'Exterior Wall')[0]);
    st.roof_covering_material = mapRoofCovering(roofCover);
    st.roof_structure_material = mapRoofStructure(roofStruct);
    st.roof_design_type = mapRoofDesign(roofStruct);
    st.interior_wall_surface_material_primary = mapInteriorWallSurface(
      elementDetails(elementRows, 'Interior Wall')[0],
    );
    st.flooring_material_primary = mapFlooringPrimary(elementDetails(elementRows, 'Int Flooring'));
    await writeJson('structure', st);
    await writeRelationship({
      type: 'property_has_structure',
      name: 'relationship_property_has_structure',
      from: 'property',
      to: 'structure',
    });

    const cooling = mapCooling(elementDetails(elementRows, 'Air Cond')[0]);
    const ut = nullSkeleton(UTILITY_FIELDS);
    ut.heating_system_type = mapHeatingSystem(elementDetails(elementRows, 'Heating Type')[0]);
    ut.heating_fuel_type = mapHeatingFuel(elementDetails(elementRows, 'Heating Fuel')[0]);
    ut.cooling_system_type = cooling;
    ut.hvac_condensing_unit_present = cooling ? (cooling === 'CentralAir' ? 'Yes' : 'No') : null;
    await writeJson('utility', ut);
    await writeRelationship({
      type: 'property_has_utility',
      name: 'relationship_property_has_utility',
      from: 'property',
      to: 'utility',
    });
  }

  // ---- layout(s) from the building-attributes grid (array) ----
  if (attributeRows.length) {
    let lIdx = 0;
    const attrCount = (needle) => {
      for (const r of attributeRows) {
        if (r[0] && r[0].toLowerCase().includes(needle)) {
          const n = money(r[1]);
          if (n != null) return Math.min(Math.round(n), 20);
        }
      }
      return 0;
    };
    const emitLayout = async (spaceType, size) => {
      lIdx += 1;
      const stem = `layout_${lIdx}`;
      const lay = nullSkeleton(LAYOUT_FIELDS);
      lay.space_type = spaceType;
      lay.space_type_index = String(lIdx);
      lay.is_finished = true;
      lay.is_exterior = false;
      if (size != null) lay.size_square_feet = size;
      await writeJson(stem, lay);
      await writeRelationship({
        type: 'property_has_layout',
        name: `relationship_property_has_${stem}`,
        from: 'property',
        to: stem,
      });
    };
    await emitLayout('Building', money(heatedArea));
    for (let i = 0; i < attrCount('bedroom'); i++) await emitLayout('Bedroom', null);
    for (let i = 0; i < attrCount('bath'); i++) await emitLayout('Full Bathroom', null);
  }

  // ---- lot from the land grid (single) ----
  const landRows = gridById(html, 'ctl00_cphBody_gridLand').slice(1);
  if (landRows.length) {
    let sqft = 0;
    let acres = 0;
    let front = null;
    let depth = null;
    for (const r of landRows) {
      if (r.length < 9) continue;
      const units = money(r[7]);
      if (units != null) {
        if (/acre/i.test(r[8] || '')) acres += units;
        else sqft += units;
      }
      if (front == null) {
        const f = money(r[4]);
        if (f != null && f > 0) front = Math.round(f);
      }
      if (depth == null) {
        const d = money(r[5]);
        if (d != null && d > 0) depth = Math.round(d);
      }
    }
    const totalSqft = Math.round(sqft + acres * 43560);
    const totalAcre = acres + sqft / 43560;
    const lot = nullSkeleton(LOT_FIELDS);
    lot.lot_area_sqft = totalSqft > 0 ? totalSqft : null;
    lot.lot_size_acre = totalAcre > 0 ? Number(totalAcre.toFixed(4)) : null;
    lot.lot_length_feet = front;
    lot.lot_width_feet = depth;
    lot.lot_type =
      totalAcre > 0.25
        ? 'GreaterThanOneQuarterAcre'
        : totalAcre > 0
          ? 'LessThanOrEqualToOneQuarterAcre'
          : null;
    await writeJson('lot', lot);
    await writeRelationship({
      type: 'property_has_lot',
      name: 'relationship_property_has_lot',
      from: 'property',
      to: 'lot',
    });
  }

  // ---- property improvements from the extra-features grid (array) ----
  const featureRows = gridById(html, 'ctl00_cphBody_gridExtraFeatures').slice(1);
  let impIdx = 0;
  for (const r of featureRows) {
    const desc = r.length >= 3 ? r[2] : null;
    if (!desc) continue;
    impIdx += 1;
    const stem = `property_improvement_${impIdx}`;
    const imp = nullSkeleton(PROPERTY_IMPROVEMENT_FIELDS);
    imp.improvement_type = mapImprovementType(desc);
    await writeJson(stem, imp);
    await writeRelationship({
      type: 'property_has_property_improvement',
      name: `relationship_property_has_${stem}`,
      from: 'property',
      to: stem,
    });
  }

  // ---- Property Record Card document (file) ----
  if (html.includes('gvPRCFinal') || html.includes('downloadPDF')) {
    const name = taxYear ? `Property Record Card ${taxYear}` : 'Property Record Card';
    await writeJson('file_1', {
      name,
      document_type: null,
      file_format: null,
      original_url: null,
      ipfs_url: null,
    });
    await writeRelationship({
      type: 'property_has_file',
      name: 'relationship_property_has_file_1',
      from: 'property',
      to: 'file_1',
    });
  }

  // ---- per-authority tax jurisdictions + exemptions (tax-details grid) ----
  const taxRows = gridById(html, 'ctl00_cphBody_gridTaxDetails').slice(1);
  if ((market != null || assessed != null || building != null) && taxRows.length) {
    let jIdx = 0;
    for (const r of taxRows) {
      const jName = r[0];
      if (!jName || /total/i.test(jName)) continue;
      jIdx += 1;
      const jStem = `tax_jurisdiction_${jIdx}`;
      await writeJson(jStem, {
        jurisdiction_name: jName,
        jurisdiction_type: mapJurisdictionType(jName),
      });
      await writeRelationship({
        type: 'tax_has_tax_jurisdiction',
        name: `relationship_tax_has_${jStem}`,
        from: 'tax',
        to: jStem,
      });

      const exemptAmt = money(r[2]);
      const taxableAmt = money(r[3]);
      const exStem = `tax_exemption_${jIdx}`;
      const ex = { exemption_type: null, tax_year: taxYear };
      if (exemptAmt != null) ex.exemption_value = exemptAmt;
      if (taxableAmt != null) ex.taxable_value_amount = taxableAmt;
      await writeJson(exStem, ex);
      await writeRelationship({
        type: 'tax_jurisdiction_has_tax_exemption',
        name: `relationship_${jStem}_has_${exStem}`,
        from: jStem,
        to: exStem,
      });
    }
  }

  if (logger && typeof logger.info === 'function') {
    logger.info(
      `Duval transform: parcel=${parcelIdentifier} use=${propertyUseText ?? 'n/a'} ` +
        `owners=${owners.length} sales=${sIdx} building=${firstBuilding != null}`,
    );
  }
}
