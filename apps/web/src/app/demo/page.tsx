import Link from "next/link";

export const dynamic = "force-dynamic";

/**
 * A guided tour, written as deep links.
 *
 * The assignment's demo transcript is a sequence of things to show. Rendering it
 * as a runtime page rather than leaving it in a document means a reviewer never
 * has to guess where a capability lives — each step is one click, with the
 * expected result stated up front so it is obvious whether it worked.
 */

interface Step {
  n: number;
  title: string;
  href: string;
  says: string;
  expect: string;
}

const STEPS: Step[] = [
  {
    n: 1,
    title: "Pipeline run history and deltas",
    href: "/runs",
    says: "I open the pipeline run summary and history.",
    expect:
      "Multiple runs with timestamps, per-run insert/update/unchanged counts, sources skipped as unchanged, durations, and the limitations each run recorded. At least one run moved hundreds of thousands of records; at least one is a zero-delta no-op, which is the idempotency proof.",
  },
  {
    n: 2,
    title: "A single run, step by step",
    href: "/runs",
    says: "I open one run and show the step journal and what it published.",
    expect:
      "Per-step status — including sources that short-circuited on an unchanged ETag — plus the CIDs of every artifact that run pinned to IPFS.",
  },
  {
    n: 3,
    title: "Records by source, with provenance",
    href: "/",
    says: "I show the total uploaded records by source.",
    expect:
      "404,023 parcels, 403,813 with coordinates, 311,170 distinct owners, and county-wide counts for each of the six questions — every figure read live from the published artifact.",
  },
  {
    n: 4,
    title: "The DuckDB-backed query layer",
    href: "/explore",
    says: "Now I open the DuckDB-backed query layer.",
    expect:
      "Arbitrary read-only SQL against the `properties` view, answered in milliseconds, with the resolved CID shown. No database is involved.",
  },
  {
    n: 5,
    title: "Elephant IPFS artifacts",
    href: "/artifacts",
    says: "I show the Elephant IPFS artifacts created for the uploaded datasets.",
    expect:
      "A stable IPNS name, the CID it resolves to, per-artifact sizes, and the exact PROPERTY_QUERY_TABLE_MAP value that makes Duval servable by elephant-mcp.",
  },
  {
    n: 6,
    title: "Roofs older than 15 years",
    href: "/questions/roof-age",
    says: "I search for properties with roofs older than 15 years.",
    expect:
      "279,756 matching residential properties, ranked oldest first, with the executed SQL, the derivation basis, and the caveat that this is effective year built rather than a roofing permit.",
  },
  {
    n: 7,
    title: "Properties with a view of water",
    href: "/questions/water-view",
    says: "Show properties with a view of water.",
    expect:
      "12,697 waterfront parcels with the named water body each one adjoins — Ribault River, Julington Creek, Cedar River — and an explicit statement that adjacency is not a view.",
  },
  {
    n: 8,
    title: "No ownership change in 10+ years",
    href: "/questions/ownership-tenure",
    says: "Show properties that have not exchanged ownership in more than 10 years.",
    expect:
      "Results split by evidence: exact where a sale is recorded, banded from the Florida assessment-cap differential otherwise, with the coverage stated rather than blurred.",
  },
  {
    n: 9,
    title: "Regional owners",
    href: "/questions/regional-owners",
    says: "Show properties with regional owners.",
    expect:
      "Owners classified by mailing address against situs, ranked by how many Duval parcels each holds — which is what turns 'regional owner' into an acquisition signal.",
  },
  {
    n: 10,
    title: "Walking distance to transit",
    href: "/questions/near-transit",
    says: "Show properties within walking distance of public transportation.",
    expect:
      "42,358 parcels within 800 m of a transit stop, with the distance basis shown and straight-line stated as the limitation.",
  },
  {
    n: 11,
    title: "Walking distance to Starbucks",
    href: "/questions/near-starbucks",
    says: "Show properties within walking distance of Starbucks.",
    expect:
      "119,834 parcels within 800 m of one of the 78 Duval Starbucks locations, using parcel coordinates and Overture place data.",
  },
  {
    n: 12,
    title: "Ask the agent",
    href: "/agent?q=Which%20properties%20have%20roofs%20older%20than%2015%20years%20and%20have%20not%20exchanged%20ownership%20in%20more%20than%2010%20years%3F",
    says: "Now I ask the same question through the agent.",
    expect:
      "A natural-language answer with the tool calls and SQL that produced it, plus the CID it queried. The agent cannot state a number it did not query.",
  },
  {
    n: 13,
    title: "A second agent question",
    href: "/agent?q=Which%20properties%20are%20near%20public%20transportation%20and%20also%20have%20regional%20owners%3F",
    says: "Which properties are near public transportation and also have regional owners?",
    expect:
      "Coordinate-based distance logic combined with ownership evidence, answered from live queries.",
  },
  {
    n: 14,
    title: "MCP-ready, served from IPFS",
    href: "/mcp",
    says: "Finally, I show that the system is MCP-ready and served from Elephant IPFS.",
    expect:
      "A Model Context Protocol endpoint listing its tools. POST JSON-RPC to it and it answers from the same Parquet artifact on IPFS — no Oracle-hosted infrastructure.",
  },
  {
    n: 15,
    title: "No ongoing infrastructure cost",
    href: "/infrastructure",
    says: "And that Oracle can operate without carrying the infrastructure cost.",
    expect:
      "What runs, what it costs, and a copy-pasteable DuckDB command that queries the same dataset with no account and no server.",
  },
];

export default function DemoPage() {
  return (
    <>
      <h1>Guided demo</h1>
      <p className="muted" style={{ maxWidth: "70ch", marginTop: 8 }}>
        The assignment&rsquo;s demo transcript, as clickable steps. Each one is
        a deep link with the expected result stated up front, so nothing depends
        on knowing where to look.
      </p>

      <div className="grid" style={{ marginTop: 24 }}>
        {STEPS.map((step) => (
          <div
            className="card"
            key={step.n}
            data-testid={`demo-step-${step.n}`}
          >
            <div
              style={{
                display: "flex",
                gap: 14,
                alignItems: "baseline",
                flexWrap: "wrap",
              }}
            >
              <span
                className="stat-value"
                style={{ fontSize: "1.1rem", color: "var(--accent)" }}
              >
                {String(step.n).padStart(2, "0")}
              </span>
              <h2 style={{ flex: 1 }}>{step.title}</h2>
              <Link
                href={step.href}
                className="btn"
                data-testid={`demo-open-${step.n}`}
              >
                Open
              </Link>
            </div>
            <p className="muted" style={{ marginTop: 10, fontStyle: "italic" }}>
              &ldquo;{step.says}&rdquo;
            </p>
            <p className="subtle" style={{ marginTop: 8 }}>
              <strong>Expected:</strong> {step.expect}
            </p>
          </div>
        ))}
      </div>
    </>
  );
}
