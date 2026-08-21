import Link from "next/link";
import type { ArtifactRef } from "@/lib/artifacts";
import { notFound } from "next/navigation";
import { Unavailable, bytes, num } from "@/components/ui";
import { parseJsonColumn, runHistory } from "@/lib/oracle";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface StepDetail {
  recordsIn?: number;
  inserts?: number;
  updates?: number;
  deletes?: number;
  unchanged?: number;
  skippedUnchanged?: boolean;
  reason?: string;
  artifactUri?: string;
  [key: string]: unknown;
}

export default async function RunDetailPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = await params;
  const history = await runHistory();
  if (!history) {
    return <Unavailable error="Run history is unavailable from the gateway." />;
  }

  const run = history.runs.find((r) => r.run_id === runId);
  if (!run) notFound();
  const steps = history.steps.filter((s) => s.run_id === runId);
  const limitations = parseJsonColumn<string[]>(run.limitations, []);
  const artifacts = parseJsonColumn<Record<string, ArtifactRef>>(
    run.artifacts,
    {},
  );

  return (
    <>
      <p className="subtle">
        <Link href="/runs">← All runs</Link>
      </p>
      <h1 className="mono" style={{ fontSize: "1.4rem" }}>
        {run.run_id}
      </h1>
      <p className="muted" style={{ marginTop: 8 }}>
        {run.mode} run, triggered {run.trigger}, finished{" "}
        <span
          className={
            run.status === "success" ? "badge badge-ok" : "badge badge-warn"
          }
        >
          {run.status}
        </span>{" "}
        in{" "}
        {Number.isFinite(Number(run.duration_ms)) && run.duration_ms
          ? `${(Number(run.duration_ms) / 1000).toFixed(1)}s`
          : "—"}
        .
      </p>

      <h2 style={{ marginTop: 28 }}>Step journal</h2>
      <p className="muted" style={{ marginTop: 6 }}>
        Each source step short-circuits when its upstream input is unchanged.
      </p>
      <div className="table-scroll card" style={{ marginTop: 12, padding: 0 }}>
        <table data-testid="steps-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Step</th>
              <th>Status</th>
              <th className="num">Read</th>
              <th className="num">Ins</th>
              <th className="num">Upd</th>
              <th className="num">Unch</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {steps.map((s) => {
              const d = parseJsonColumn<StepDetail>(s.detail, {});
              return (
                <tr key={s.step_key}>
                  <td className="num">{s.seq}</td>
                  <td className="mono">{s.step_key}</td>
                  <td>
                    <span
                      className={
                        s.status === "success"
                          ? "badge badge-ok"
                          : s.status === "skipped_unchanged"
                            ? "badge badge-info"
                            : "badge badge-warn"
                      }
                    >
                      {s.status}
                    </span>
                  </td>
                  <td className="num">
                    {d.recordsIn === undefined ? "—" : num(d.recordsIn)}
                  </td>
                  <td className="num">
                    {d.inserts === undefined ? "—" : num(d.inserts)}
                  </td>
                  <td className="num">
                    {d.updates === undefined ? "—" : num(d.updates)}
                  </td>
                  <td className="num">
                    {d.unchanged === undefined ? "—" : num(d.unchanged)}
                  </td>
                  <td className="subtle">{s.error ?? d.reason ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {Object.keys(artifacts).length ? (
        <>
          <h2 style={{ marginTop: 32 }}>Artifacts published by this run</h2>
          <div
            className="table-scroll card"
            style={{ marginTop: 12, padding: 0 }}
          >
            <table data-testid="run-artifacts">
              <thead>
                <tr>
                  <th>Dataset</th>
                  <th>CID</th>
                  <th className="num">Size</th>
                  <th>IPNS</th>
                </tr>
              </thead>
              <tbody>
                {Object.values(artifacts).map((a) => (
                  <tr key={a.cid ?? a.dataset}>
                    <td>{a.dataset}</td>
                    <td className="mono" style={{ wordBreak: "break-all" }}>
                      {a.cidUrl ? (
                        <a href={a.cidUrl}>{a.cid}</a>
                      ) : (
                        (a.cid ?? "—")
                      )}
                    </td>
                    <td className="num">{bytes(a.bytes)}</td>
                    <td
                      className="mono subtle"
                      style={{ wordBreak: "break-all" }}
                    >
                      {a.ipnsName ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      {limitations.length ? (
        <section style={{ marginTop: 32 }}>
          <h2>What this run could not support</h2>
          <ul className="muted" style={{ marginTop: 12, lineHeight: 1.7 }}>
            {limitations.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
