import { describe, expect, it } from "vitest";
import { nalUrl, pinUrl, sdfUrl } from "./fldor.ts";

// These URLs are the pipeline's entire link to the upstream county data. A silent
// change in shape means the pipeline 404s, so they are asserted literally rather
// than pattern-matched.
describe("Florida DOR artifact URLs", () => {
  it("builds the Duval NAL roll URL for a roll period", () => {
    expect(nalUrl("2026P")).toBe(
      "https://floridarevenue.com/property/dataportal/Documents/PTO%20Data%20Portal" +
        "/Tax%20Roll%20Data%20Files/NAL/2026P/Duval%2026%20Preliminary%20NAL%202026.zip",
    );
  });

  it("builds the Duval SDF sale-file URL for a roll period", () => {
    expect(sdfUrl("2026P")).toBe(
      "https://floridarevenue.com/property/dataportal/Documents/PTO%20Data%20Portal" +
        "/Tax%20Roll%20Data%20Files/SDF/2026P/Duval%2026%20Preliminary%20SDF%202026.zip",
    );
  });

  it("drops the vintage suffix from the parcel-geometry filename", () => {
    // The Map Data directory carries the suffix ("2026F PIN") but the file
    // inside does not. Verified against the live 2024F/2025F/2026F listings.
    expect(pinUrl("2026F")).toBe(
      "https://floridarevenue.com/property/dataportal/Documents/PTO%20Data%20Portal" +
        "/Map%20Data/2026F/2026F%20PIN/duval_2026pin.zip",
    );
  });

  it("derives the four-digit year from the roll period", () => {
    expect(nalUrl("2025P")).toContain("NAL%202025.zip");
    expect(pinUrl("2024F")).toContain("duval_2024pin.zip");
  });
});
