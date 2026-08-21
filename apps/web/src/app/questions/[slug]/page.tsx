import Link from "next/link";
import { notFound } from "next/navigation";
import { Evidence, Unavailable, cell, num } from "@/components/ui";
import { runQuery } from "@/lib/oracle";
import { buildCountSql, buildSql, questionBySlug } from "@/lib/questions";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function QuestionPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const raw = await searchParams;
  const question = questionBySlug(slug);
  if (!question) notFound();

  const selected: Record<string, string | undefined> = {};
  for (const p of question.params ?? []) {
    const v = raw[p.name];
    selected[p.name] = Array.isArray(v) ? v[0] : (v ?? p.default);
  }

  const listSql = buildSql(question, selected, 50);
  const countSql = buildCountSql(question, selected);

  let matches: number | undefined;
  let rows: Array<Record<string, unknown>> = [];
  let durationMs = 0;
  let pointer;
  let error: string | undefined;

  try {
    const [countResult, listResult] = await Promise.all([
      runQuery<{ matches: number }>(countSql),
      runQuery<Record<string, unknown>>(listSql, { limit: 50 }),
    ]);
    matches = Number(countResult.rows[0]?.matches ?? 0);
    rows = listResult.rows;
    durationMs = countResult.durationMs + listResult.durationMs;
    pointer = listResult.pointer;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  return (
    <>
      <p className="subtle">
        <Link href="/questions">← All questions</Link>
      </p>
      <h1>{question.title}</h1>
      <p className="muted" style={{ marginTop: 8 }}>
        {question.prompt}
      </p>

      {question.params?.length ? (
        <form
          method="get"
          className="card"
          style={{
            marginTop: 20,
            display: "flex",
            gap: 16,
            flexWrap: "wrap",
            alignItems: "flex-end",
          }}
          data-testid="question-controls"
        >
          {question.params.map((p) => (
            <label key={p.name} style={{ display: "grid", gap: 6 }}>
              <span className="stat-label">{p.label}</span>
              <select
                name={p.name}
                defaultValue={selected[p.name]}
                data-testid={`param-${p.name}`}
                style={{
                  background: "var(--bg-sunken)",
                  color: "var(--fg)",
                  border: "1px solid var(--border-strong)",
                  borderRadius: "var(--radius)",
                  padding: "7px 10px",
                  fontFamily: "inherit",
                  fontSize: "0.9rem",
                }}
              >
                {p.options.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <button className="btn" type="submit" data-testid="apply-params">
            Apply
          </button>
        </form>
      ) : null}

      {error ? (
        <div style={{ marginTop: 24 }}>
          <Unavailable error={error} />
        </div>
      ) : (
        <>
          <div className="card" style={{ marginTop: 20 }}>
            <div className="stat-value" data-testid="match-count">
              {num(matches)}
            </div>
            <div className="stat-label">
              matching properties across Duval County
            </div>
            {rows.length > 0 ? (
              <div className="subtle" style={{ marginTop: 8 }}>
                Showing {num(rows.length)} of {num(matches)}, ordered by{" "}
                {question.orderLabel}.
              </div>
            ) : null}
          </div>

          <div
            className="table-scroll card"
            style={{ marginTop: 16, padding: 0 }}
          >
            <table data-testid="results-table">
              <thead>
                <tr>
                  {question.columns.map((c) => (
                    <th key={c.key} className={c.numeric ? "num" : undefined}>
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={String(row["request_identifier"] ?? i)}>
                    {question.columns.map((c) => (
                      <td key={c.key} className={c.numeric ? "num" : undefined}>
                        {c.key === "request_identifier" ? (
                          <Link
                            href={`/property/${encodeURIComponent(String(row[c.key]))}`}
                            className="mono"
                          >
                            {cell(row[c.key])}
                          </Link>
                        ) : (
                          cell(row[c.key], c.numeric)
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={question.columns.length} className="muted">
                      No properties matched these criteria.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          <Evidence
            sql={listSql}
            basis={question.basis}
            caveat={question.caveat}
            pointer={pointer}
            durationMs={durationMs}
          />
        </>
      )}
    </>
  );
}
