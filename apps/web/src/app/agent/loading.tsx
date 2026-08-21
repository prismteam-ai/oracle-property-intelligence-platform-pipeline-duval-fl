/**
 * Shown while the agent works.
 *
 * The route takes 10–40 seconds — it runs several SQL queries over 404,023
 * parcels before it answers. Without this, a client-side navigation left the
 * previous page on screen, fully interactive and completely unchanged, for the
 * whole wait; every user reads that as a dead button and clicks again.
 */
export default function Loading() {
  return (
    <div className="card" data-testid="agent-loading" style={{ marginTop: 24 }}>
      <h2 style={{ marginTop: 0 }}>Working on it</h2>
      <p className="muted" style={{ marginTop: 10 }}>
        The agent is running queries against the published dataset. This usually
        takes 10–30 seconds — it reads the artifact, then asks it several
        questions before answering.
      </p>
      <div className="skeleton-bars" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}
