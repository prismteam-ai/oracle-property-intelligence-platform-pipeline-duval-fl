import { headers } from "next/headers";
import { Answer } from "@/components/answer";
import { askAgent } from "@/lib/agent";
import { GATEWAY } from "@/lib/oracle";
import { clientKey, rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const revalidate = 0;
// Agent answers involve several tool round-trips against IPFS-backed data.
export const maxDuration = 120;

const EXAMPLES = [
  "Which properties have roofs older than 15 years and have not exchanged ownership in more than 10 years?",
  "Which properties are near public transportation and also have regional owners?",
  "Which properties appear to be strong candidates for further review based on ownership age, roof age, and location signals?",
  "How many waterfront properties in Jacksonville are owned by someone out of state?",
];

export default async function AgentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const qParam = raw["q"];
  const question = (Array.isArray(qParam) ? qParam[0] : qParam)?.trim();

  let answer: Awaited<ReturnType<typeof askAgent>> | undefined;
  let error: string | undefined;
  if (question) {
    // The agent spends model tokens per call and is reachable by GET, so it is
    // limited before any work is done.
    const limit = rateLimit(clientKey(await headers(), "agent"), {
      limit: 10,
      windowMs: 60_000,
    });
    if (!limit.allowed) {
      error = `Too many questions from this address. The agent is limited to 10 per minute because each call spends model tokens; try again in ${limit.retryAfterSeconds}s.`;
    } else {
      try {
        answer = await askAgent(question);
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      }
    }
  }

  return (
    <>
      <h1>Ask the dataset</h1>
      <p className="muted" style={{ maxWidth: "70ch", marginTop: 8 }}>
        A natural-language agent over the published Duval dataset. It cannot
        invent numbers: every figure it reports comes from a read-only SQL query
        against the Parquet artifact on IPFS, and the queries it ran are shown
        with the answer.
      </p>

      <form
        method="get"
        className="card"
        style={{ marginTop: 20, display: "flex", gap: 12, flexWrap: "wrap" }}
        data-testid="agent-form"
      >
        <input
          type="text"
          name="q"
          defaultValue={question ?? ""}
          placeholder="Ask about Duval County property…"
          data-testid="agent-input"
          style={{
            flex: "1 1 420px",
            background: "var(--bg-sunken)",
            color: "var(--fg)",
            border: "1px solid var(--border-strong)",
            borderRadius: "var(--radius)",
            padding: "9px 12px",
            fontFamily: "inherit",
            fontSize: "0.95rem",
          }}
        />
        <button className="btn" type="submit" data-testid="agent-submit">
          Ask
        </button>
      </form>

      {!question ? (
        <div style={{ marginTop: 24 }}>
          <h2>Try one of these</h2>
          <div className="grid" style={{ marginTop: 12 }}>
            {EXAMPLES.map((ex) => (
              <a
                key={ex}
                href={`/agent?q=${encodeURIComponent(ex)}`}
                className="card"
                data-testid="agent-example"
                style={{ color: "inherit", textDecoration: "none" }}
              >
                {ex}
              </a>
            ))}
          </div>
        </div>
      ) : null}

      {error ? (
        <div
          className="card"
          style={{ marginTop: 20, borderColor: "var(--border-strong)" }}
          data-testid="agent-error"
        >
          <h2>
            <span className="badge badge-warn">Agent unavailable</span>
          </h2>
          <p className="muted" style={{ marginTop: 8 }}>
            The agent could not complete this question.
          </p>
          <pre
            className="mono subtle"
            style={{ marginTop: 10, marginBottom: 0, whiteSpace: "pre-wrap" }}
          >
            {error}
          </pre>
        </div>
      ) : null}

      {answer ? (
        <>
          <div
            className="card"
            style={{ marginTop: 20 }}
            data-testid="agent-answer"
          >
            <h2>
              Answer{" "}
              {answer.incomplete ? (
                <span className="badge badge-warn">incomplete</span>
              ) : null}
            </h2>
            <div style={{ marginTop: 10 }}>
              {answer.text ? (
                <Answer text={answer.text} />
              ) : (
                <p className="muted" data-testid="agent-answer-text">
                  {answer.incomplete}
                </p>
              )}
            </div>
          </div>

          <section style={{ marginTop: 28 }}>
            <h2>How it got there</h2>
            <p className="muted" style={{ marginTop: 6 }}>
              {answer.toolCalls.length} tool{" "}
              {answer.toolCalls.length === 1 ? "call" : "calls"} against the
              published dataset, answered by {answer.model}.
            </p>
            <div className="grid" style={{ marginTop: 12 }}>
              {answer.toolCalls.map((call, i) => (
                <div className="card" key={i} data-testid="agent-tool-call">
                  <h3 className="mono">{call.tool}</h3>
                  {call.sql ? (
                    <pre
                      className="mono"
                      style={{
                        marginTop: 10,
                        marginBottom: 0,
                        overflowX: "auto",
                        color: "var(--fg-muted)",
                        whiteSpace: "pre",
                      }}
                    >
                      {call.sql}
                    </pre>
                  ) : null}
                  <div className="subtle" style={{ marginTop: 10 }}>
                    {call.rowCount ?? 0} row{call.rowCount === 1 ? "" : "s"}
                    {call.durationMs !== undefined
                      ? ` · ${call.durationMs} ms`
                      : ""}
                  </div>
                </div>
              ))}
            </div>
            {answer.cid ? (
              <p className="subtle" style={{ marginTop: 14 }}>
                Every query above ran against the published artifact{" "}
                <a href={`${GATEWAY}/ipfs/${answer.cid}`} className="mono">
                  {answer.cid}
                </a>
                .
              </p>
            ) : null}
          </section>
        </>
      ) : null}
    </>
  );
}
