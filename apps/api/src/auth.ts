/**
 * Constant-time bearer-token comparison. A plain `a === b` on the secret leaks length and
 * early-exits on the first differing byte, so a network attacker can time-side-channel the token.
 * We hash both sides to a fixed 32-byte digest and compare with `timingSafeEqual`, which is
 * length-independent and constant-time. Pure (only `node:crypto`) so it is unit-tested offline.
 */
import { createHash, timingSafeEqual } from "node:crypto";

export function safeTokenEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (typeof a !== "string" || typeof b !== "string" || a.length === 0 || b.length === 0) return false;
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}
