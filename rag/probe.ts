/**
 * Verification probes (Task 11 gate) — run a set of natural-language questions against the REAL
 * OpenSearch index and print the retrieved real Duval records with their source-backed citations.
 *
 * Records are cited by folio / RE# + source_system + source_record_key — never by owner identity.
 * Run: DATABASE_URL=... OPENSEARCH_* ... AWS_PROFILE=... AWS_REGION=us-east-1 npm run rag:probe
 */
import { Retriever } from "./retrieve.ts";
import type { RetrievalFilters } from "./types.ts";

interface Probe {
  question: string;
  filters?: RetrievalFilters;
  topK?: number;
}

const PROBES: Probe[] = [
  { question: "commercial properties with recent roofing permits", topK: 5 },
  { question: "properties near public transit within walking distance", topK: 5 },
  { question: "waterfront parcels with a water view", topK: 5 },
  { question: "auto repair or auto sales businesses", topK: 3 },
  { question: "warehouse or industrial storage properties", topK: 3 },
];

async function main(): Promise<void> {
  const retriever = new Retriever();
  for (const probe of PROBES) {
    const res = await retriever.retrieve(probe.question, { topK: probe.topK, filters: probe.filters });
    console.log("\n" + "=".repeat(92));
    console.log(`PROBE: "${res.question}"`);
    if (probe.filters && Object.keys(probe.filters).length > 0)
      console.log(`  filters: ${JSON.stringify(probe.filters)}`);
    console.log(`  retrieved ${res.count} record(s) via ${res.embedding_model}`);
    for (const r of res.records) {
      console.log(
        `\n  • folio ${r.folio}  [score ${r.score} / ${r.band}]  ${r.property_usage_type ?? "?"}` +
          `${r.is_commercial ? " (commercial)" : ""}`,
      );
      if (r.situs_address) console.log(`    situs: ${r.situs_address}`);
      const f = r.facts;
      const facts: string[] = [];
      if (f.roofing_permit_count > 0)
        facts.push(
          `roofing permits: ${f.roofing_permit_count}` +
            (f.roof_age_years != null ? ` (roof age ~${f.roof_age_years}y)` : "") +
            (f.most_recent_roofing_permit_date ? `, last ${f.most_recent_roofing_permit_date}` : ""),
        );
      if (f.permit_count > 0) facts.push(`total permits: ${f.permit_count}`);
      if (f.near_transit)
        facts.push(
          `near transit${f.nearest_transit_stop_name ? ` ("${f.nearest_transit_stop_name}"${f.nearest_transit_distance_m != null ? ` ${Math.round(f.nearest_transit_distance_m)}m` : ""})` : ""}`,
        );
      if (f.water_view)
        facts.push(`waterfront${f.nearest_water_distance_m != null ? ` (${Math.round(f.nearest_water_distance_m)}m)` : ""}`);
      if (facts.length) console.log(`    facts: ${facts.join("; ")}`);
      console.log(`    citations (${r.citations.length}):`);
      for (const c of r.citations)
        console.log(`      - [${c.source_system}] ${c.source_record_key ?? "(no key)"} — ${c.contributes}`);
    }
  }
  console.log("\n" + "=".repeat(92));
}

main().catch((e) => {
  console.error("[probe] FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
