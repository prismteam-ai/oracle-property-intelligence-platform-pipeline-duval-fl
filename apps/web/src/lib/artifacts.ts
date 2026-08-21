/**
 * The shape the publish step records on each run.
 *
 * Mirrors `PublishedArtifact` in apps/worker/src/publish/index.ts. It was
 * hand-copied into three readers with three different field sets, and drifted
 * the first time the worker added a field — the `rows` count recorded for the
 * changes artifact was invisible to every one of them.
 */
export interface ArtifactRef {
  dataset: string;
  key: string;
  cid: string;
  bytes: number;
  /** Immutable address of exactly these bytes. Always present. */
  cidUrl: string;
  /** Row count, for artifacts where "how much is in here" is the point. */
  rows?: number;
  /** Only the query table gets a stable pointer — the plan allows one name. */
  ipnsLabel?: string;
  ipnsName?: string;
  ipnsUrl?: string;
}

/** Artifacts keyed by dataset, as stored on `pipeline_runs.artifacts`. */
export type ArtifactMap = Record<string, ArtifactRef | undefined>;
