import Link from "next/link";
import { Stat, Unavailable, num } from "@/components/ui";
import { parseJsonColumn, runHistory } from "@/lib/oracle";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function ms(value: number | null): string {
  if (!value) return "—";
  return value < 1000 ? `${value} ms` : `${(value / 1000).toFixed(1)} s`;
}

/** Defensive: a timestamp the artifact serialised in an unexpected shape must
 *  render as "—", never throw and take the whole page down. */
function when(iso: unknown): string {
  if (typeof iso !== "string" || !iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

export default async function RunsPage() {
  const history = await runHistory();

  if (!history) {
    return (
      <>
        <h1>Pipeline runs</h1>
        <div style={{ marginTop: 20 }}>
          <Unavailable error="The published run-history artifact could not be read from the IPFS gateway." />
        </div>
      </>
    );
  }

  const runs = history.runs;
  const succeeded = runs.filter((r) => r.status === "success");
  const noOps = succeeded.filter(
    (r) => r.inserts === 0 && r.updates === 0 && r.deletes === 0,
  );
  const withChanges = succeeded.filter(
    (r) => r.inserts + r.updates + r.deletes > 0,
  );

  return (
    <>
      <h1>Pipeline runs</h1>
      <p className="muted" style={{ maxWidth: "70ch", marginTop: 8 }}>
        Every run of the Duval pipeline, read from the run-history artifact
        published to IPFS. Change detection happens at two levels — the upstream
        file&rsquo;s ETag, and a hash of each record — so a run against
        unchanged sources does no work and records no deltas.
      </p>

      <div className="grid grid-3" style={{ marginTop: 24 }}>
        <Stat
          testId="stat-runs"
          value={num(runs.length)}
          label="Runs recorded"
        />
        <Stat
          testId="stat-changed"
          value={num(withChanges.length)}
          label="Runs that moved data"
        />
        <Stat
          testId="stat-noop"
          value={num(noOps.length)}
          label="No-op runs"
          hint="Sources unchanged — zero writes"
        />
      </div>

      <div className="table-scroll card" style={{ marginTop: 24, padding: 0 }}>
        <table data-testid="runs-table">
          <thead>
            <tr>
              <th>Run</th>
              <th>Started</th>
              <th>Mode</th>
              <th>Status</th>
              <th className="num">Read</th>
              <th className="num">Inserted</th>
              <th className="num">Updated</th>
              <th className="num">Unchanged</th>
              <th className="num">Skipped</th>
              <th className="num">Duration</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.run_id}>
                <td className="col-name">
                  <Link href={`/runs/${r.run_id}`} className="mono">
                    {r.run_id}
                  </Link>
                </td>
                <td className="subtle">{when(r.started_at)}</td>
                <td>{r.mode}</td>
                <td>
                  <span
                    className={
                      r.status === "success"
                        ? "badge badge-ok"
                        : r.status === "failed"
                          ? "badge badge-error"
                          : "badge"
                    }
                  >
                    {r.status}
                  </span>
                </td>
                <td className="num">{num(r.records_in)}</td>
                <td className="num">{num(r.inserts)}</td>
                <td className="num">{num(r.updates)}</td>
                <td className="num">{num(r.unchanged)}</td>
                <td className="num">{num(r.sources_skipped_unchanged)}</td>
                <td className="num">{ms(r.duration_ms)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section style={{ marginTop: 32 }}>
        <h2>Documented limitations</h2>
        <p className="muted" style={{ marginTop: 6 }}>
          Recorded by the most recent run. Coverage is reported, never implied.
        </p>
        <ul className="muted" style={{ marginTop: 12, lineHeight: 1.7 }}>
          {parseJsonColumn<string[]>(runs[0]?.limitations ?? null, []).map(
            (l, i) => (
              <li key={i} data-testid="limitation">
                {l}
              </li>
            ),
          )}
        </ul>
      </section>

      <div className="card" style={{ marginTop: 24 }}>
        <h3>Source</h3>
        <p className="muted" style={{ marginTop: 8 }}>
          This page holds no database. It read{" "}
          <a href={history.sourceUrl} className="mono">
            pipeline-runs.json
          </a>{" "}
          from the IPFS gateway, generated {when(history.generatedAt)}.
        </p>
      </div>
    </>
  );
}
