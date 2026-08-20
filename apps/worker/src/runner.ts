import crypto from "node:crypto";
import { COUNTY } from "./config.ts";
import { exec, lit, query, scalar } from "./warehouse.ts";

/**
 * A journaled step runner.
 *
 * This implements the durability properties the Elephant `durable-workflow-builder`
 * skill prescribes — journaled steps, deterministic idempotency keys, single-writer
 * per county, bounded windows, and resume-from-failure — without standing up
 * Restate. The trade is deliberate: an always-on orchestrator contradicts this
 * story's "Oracle carries no ongoing infrastructure cost" constraint, and it is
 * argued in docs/architecture-decisions/002-durable-steps-without-restate.md.
 *
 * Resume is opt-in and explicit. `startRun({ resumeRunId })` re-adopts an
 * existing run's journal, and steps that already reached a terminal success are
 * skipped, so a crashed run continues at the first incomplete step. Without that
 * flag every invocation is a fresh run with an empty journal.
 */

export type RunMode = "backfill" | "incremental" | "scheduled";
export type RunTrigger = "manual" | "cron" | "api";

export interface StepResult {
  /** Rows read from the source in this step. */
  recordsIn?: number;
  inserts?: number;
  updates?: number;
  deletes?: number;
  unchanged?: number;
  /** Set when artifact-level change detection short-circuited the work. */
  skippedUnchanged?: boolean;
  [key: string]: unknown;
}

export interface RunContext {
  runId: string;
  mode: RunMode;
  /** Execute a named step exactly once per run, journaling its outcome. */
  step<T extends StepResult>(
    key: string,
    fn: (ctx: RunContext) => Promise<T>,
  ): Promise<T | undefined>;
  /** Record a source limitation to surface honestly in the run history. */
  limitation(note: string): void;
  /** Attach a published artifact reference to the run. */
  artifact(name: string, value: unknown): void;
}

export function newRunId(now: Date): string {
  // yyyymmddhhmmss — 14 chars, stopping before the millisecond separator so the
  // id stays URL-safe and readable in the run history.
  const stamp = now.toISOString().replace(/[-:T]/g, "").slice(0, 14);
  return `run-${stamp}-${crypto.randomBytes(3).toString("hex")}`;
}

/** Stable hash of a source row, used for record-level change detection. */
export function recordHash(row: Record<string, unknown>): string {
  const canonical = JSON.stringify(
    Object.keys(row)
      .sort()
      .map((k) => [k, row[k] ?? null]),
  );
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

/** The most recent run that did not reach a terminal state, if any. */
export async function findResumableRun(): Promise<string | undefined> {
  const rows = await query<{ run_id: string }>(`
    SELECT run_id FROM pipeline_runs
    WHERE county = ${lit(COUNTY)} AND status IN ('running', 'failed')
    ORDER BY started_at DESC LIMIT 1
  `);
  return rows[0]?.run_id;
}

export async function startRun(opts: {
  mode: RunMode;
  trigger: RunTrigger;
  now?: Date;
  /** Re-adopt an existing run's journal instead of starting a new one. */
  resumeRunId?: string;
}): Promise<RunContext> {
  const now = opts.now ?? new Date();
  const limitations: string[] = [];
  const artifacts: Record<string, unknown> = {};
  let seq = 0;

  let runId: string;
  if (opts.resumeRunId) {
    const existing = await query<{ run_id: string }>(
      `SELECT run_id FROM pipeline_runs WHERE run_id = ${lit(opts.resumeRunId)}`,
    );
    if (!existing[0]) {
      throw new Error(`Cannot resume unknown run ${opts.resumeRunId}`);
    }
    runId = opts.resumeRunId;
    const [maxSeq] = await query<{ s: number }>(
      `SELECT COALESCE(max(seq), 0) AS s FROM pipeline_run_steps WHERE run_id = ${lit(runId)}`,
    );
    seq = Number(maxSeq!.s);
    await exec(
      `UPDATE pipeline_runs SET status = 'running', finished_at = NULL WHERE run_id = ${lit(runId)}`,
    );
  } else {
    runId = newRunId(now);
    await exec(`
      INSERT INTO pipeline_runs (run_id, county, mode, trigger, started_at, status)
      VALUES (${lit(runId)}, ${lit(COUNTY)}, ${lit(opts.mode)}, ${lit(opts.trigger)},
              ${lit(now.toISOString())}::TIMESTAMPTZ, 'running')
    `);
  }

  const ctx: RunContext = {
    runId,
    mode: opts.mode,
    limitation(note) {
      limitations.push(note);
    },
    artifact(name, value) {
      artifacts[name] = value;
    },
    async step(key, fn) {
      const done = await scalar<number>(`
        SELECT count(*) FROM pipeline_run_steps
        WHERE run_id = ${lit(runId)} AND step_key = ${lit(key)} AND status IN ('success','skipped_unchanged')
      `);
      if (Number(done) > 0) return undefined;

      const mySeq = ++seq;
      const startedAt = new Date().toISOString();
      await exec(`
        INSERT INTO pipeline_run_steps (run_id, step_key, seq, status, started_at, idempotency_key)
        VALUES (${lit(runId)}, ${lit(key)}, ${mySeq}, 'running', ${lit(startedAt)}::TIMESTAMPTZ,
                ${lit(`${COUNTY}/${runId}/${key}`)})
        ON CONFLICT (run_id, step_key) DO UPDATE SET status = 'running', started_at = EXCLUDED.started_at
      `);

      try {
        const result = await fn(ctx);
        await exec(`
          UPDATE pipeline_run_steps
             SET status = ${result.skippedUnchanged ? "'skipped_unchanged'" : "'success'"},
                 finished_at = now(),
                 detail = ${lit(JSON.stringify(result))}
           WHERE run_id = ${lit(runId)} AND step_key = ${lit(key)}
        `);
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await exec(`
          UPDATE pipeline_run_steps
             SET status = 'failed', finished_at = now(), error = ${lit(message)}
           WHERE run_id = ${lit(runId)} AND step_key = ${lit(key)}
        `);
        throw error;
      }
    },
  };

  // Finalisation is attached lazily so callers can just await finishRun(ctx).
  runState.set(runId, { limitations, artifacts, startedAt: now });
  return ctx;
}

const runState = new Map<
  string,
  { limitations: string[]; artifacts: Record<string, unknown>; startedAt: Date }
>();

export async function finishRun(
  ctx: RunContext,
  status: "success" | "failed",
): Promise<void> {
  const state = runState.get(ctx.runId);
  const startedAt = state?.startedAt ?? new Date();
  const durationMs = Date.now() - startedAt.getTime();

  // Roll the per-step detail up into the run row so the history page is one query.
  const totals = await query<{
    records_in: number;
    inserts: number;
    updates: number;
    deletes: number;
    unchanged: number;
    attempted: number;
    succeeded: number;
    skipped: number;
  }>(`
    SELECT
      COALESCE(SUM(TRY_CAST(json_extract_string(detail, '$.recordsIn') AS BIGINT)), 0) AS records_in,
      COALESCE(SUM(TRY_CAST(json_extract_string(detail, '$.inserts')   AS BIGINT)), 0) AS inserts,
      COALESCE(SUM(TRY_CAST(json_extract_string(detail, '$.updates')   AS BIGINT)), 0) AS updates,
      COALESCE(SUM(TRY_CAST(json_extract_string(detail, '$.deletes')   AS BIGINT)), 0) AS deletes,
      COALESCE(SUM(TRY_CAST(json_extract_string(detail, '$.unchanged') AS BIGINT)), 0) AS unchanged,
      count(*)                                                    AS attempted,
      count(*) FILTER (WHERE status = 'success')                  AS succeeded,
      count(*) FILTER (WHERE status = 'skipped_unchanged')        AS skipped
    FROM pipeline_run_steps WHERE run_id = ${lit(ctx.runId)}
  `);
  const t = totals[0]!;

  await exec(`
    UPDATE pipeline_runs SET
      finished_at = now(), status = ${lit(status)},
      sources_attempted = ${Number(t.attempted)},
      sources_succeeded = ${Number(t.succeeded)},
      sources_skipped_unchanged = ${Number(t.skipped)},
      records_in = ${Number(t.records_in)},
      inserts = ${Number(t.inserts)}, updates = ${Number(t.updates)},
      deletes = ${Number(t.deletes)}, unchanged = ${Number(t.unchanged)},
      duration_ms = ${durationMs},
      limitations = ${lit(JSON.stringify(state?.limitations ?? []))},
      artifacts = ${lit(JSON.stringify(state?.artifacts ?? {}))}
    WHERE run_id = ${lit(ctx.runId)}
  `);
  runState.delete(ctx.runId);
}
