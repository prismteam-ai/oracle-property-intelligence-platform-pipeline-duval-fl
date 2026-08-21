"use client";

/**
 * The last line of defence.
 *
 * Every page that reads the published artifact catches failure and renders the
 * `Unavailable` card, which explains that a blank screen is not an empty
 * dataset. This catches what those miss — a throw from somewhere that was not
 * expected to throw — so the worst case is a page that says what went wrong
 * rather than a framework stack trace.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div
      className="card"
      data-testid="app-error"
      style={{ marginTop: 32, borderColor: "var(--border-strong)" }}
    >
      <h2>
        <span className="badge badge-warn">Something went wrong</span>
      </h2>
      <p className="muted" style={{ marginTop: 10 }}>
        This page did not finish loading. It reads the published dataset from
        IPFS on every request and holds no database of its own, so the usual
        cause is the gateway being briefly unreachable. Reloading normally
        resolves it.
      </p>
      <pre
        className="mono subtle"
        style={{ marginTop: 12, whiteSpace: "pre-wrap" }}
      >
        {error.message}
        {error.digest ? `\n\ndigest: ${error.digest}` : ""}
      </pre>
      <div className="row-actions" style={{ marginTop: 14 }}>
        <button className="btn" type="button" onClick={reset}>
          Try again
        </button>
        <a className="btn btn-secondary" href="/">
          Back to the overview
        </a>
      </div>
    </div>
  );
}
