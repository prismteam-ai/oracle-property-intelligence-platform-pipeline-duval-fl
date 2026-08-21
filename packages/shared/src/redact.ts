/**
 * PII redaction for structured logs and any evidence that leaves the server.
 *
 * The design PII boundary (design §8): owner names and mailing addresses are never logged and
 * never leave the authenticated hosted layer in the clear. Logs keep the *shape* of a record
 * (which keys, how many, value types) but drop the sensitive values. This is applied by the API
 * logger before anything is written to CloudWatch.
 */

/** Keys whose values are owner-identifying and must be dropped from logs. */
const PII_KEYS = new Set(
  [
    "owner_name",
    "owner_names",
    "full_name",
    "first_name",
    "middle_name",
    "last_name",
    "normalized_name",
    "mailing_address",
    "owner_mailing_address",
    "owner_address",
    "birth_date",
    "email",
    "phone",
  ].map((k) => k.toLowerCase()),
);

/** Replace a PII value with a shape-preserving marker. */
function mask(value: unknown): string {
  if (typeof value === "string") return `‹redacted:${value.length}c›`;
  if (Array.isArray(value)) return `‹redacted:${value.length} items›`;
  return "‹redacted›";
}

/**
 * Deep-redact an arbitrary value for logging: drops PII-keyed values, bounds recursion, and keeps
 * everything else intact so logs stay useful for debugging without carrying owner identity.
 */
export function redactForLog(input: unknown, depth = 0): unknown {
  if (depth > 6) return "‹depth-limit›";
  if (input === null || input === undefined) return input;
  if (Array.isArray(input)) return input.slice(0, 50).map((v) => redactForLog(v, depth + 1));
  if (typeof input === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      out[k] = PII_KEYS.has(k.toLowerCase()) ? mask(v) : redactForLog(v, depth + 1);
    }
    return out;
  }
  return input;
}

/** True when a field name denotes owner-identifying PII (used by evidence builders). */
export function isPiiKey(key: string): boolean {
  return PII_KEYS.has(key.toLowerCase());
}
